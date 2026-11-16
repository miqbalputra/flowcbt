// Package billing: paket, langganan, kredit ujian, kuota (PRD Bagian 3, M10).
// Quota resolver urutan: bulanan aktif → trial → kredit per ujian (PRD 3.2: bulanan dipakai dulu).
package billing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/audit"
	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/platform"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type Service struct {
	DB       *platform.DB
	Audit    *audit.Writer
	Clock    platform.Clock
	Mailer   platform.Mailer
	Provider PaymentProvider
	Notify   func(ctx context.Context, tenantID, userID, typ, title, body string, data map[string]any)
}

type Plan struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Type        string `json:"type"` // free | per_exam | monthly
	PriceIDR    int    `json:"price_idr"`
	StudentMin  int    `json:"student_min"`
	StudentMax  int    `json:"student_max"`
	ExamQuota   *int   `json:"exam_quota"`
	DurationDays *int  `json:"duration_days"`
	IsActive    bool   `json:"is_active"`
}

// RoutesPublic: endpoint tanpa auth (daftar paket & webhook pembayaran).
func (s *Service) RoutesPublic(r chi.Router) {
	r.Route("/plans", func(r chi.Router) {
		r.Get("/", s.listPlans)
	})
	r.Post("/webhooks/payment/midtrans", s.webhookMidtrans)
	r.Post("/webhooks/payment/mayar", s.webhookMayar)
	r.Post("/webhooks/payment/mock", s.webhookMock)
}

// RoutesAuthed: endpoint /billing butuh JWT tenant (guru/admin).
func (s *Service) RoutesAuthed(r chi.Router) {
	r.Route("/billing", func(r chi.Router) {
		r.Get("/subscription", s.getSubscription)
		r.Get("/invoices", s.listInvoices)
		r.Post("/checkout", s.checkout)
		r.Get("/export-all", s.exportAll)
	})
}

func (s *Service) listPlans(w http.ResponseWriter, r *http.Request) {
	var rows []Plan
	err := s.DB.WithSystemTx(r.Context(), func(tx pgx.Tx) error {
		rws, err := tx.Query(r.Context(), `SELECT id, code, name, type, price_idr, student_min, student_max, exam_quota, duration_days, is_active FROM plans WHERE is_active=true ORDER BY sort_order`)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var p Plan
			if err := rws.Scan(&p.ID, &p.Code, &p.Name, &p.Type, &p.PriceIDR, &p.StudentMin, &p.StudentMax, &p.ExamQuota, &p.DurationDays, &p.IsActive); err != nil {
				return err
			}
			rows = append(rows, p)
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if rows == nil {
		rows = []Plan{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

// StudentLimit mengembalikan batas siswa aktif & jumlah aktif saat ini (FR-3.3b).
func (s *Service) StudentLimit(ctx context.Context, tenantID string) (int, int, error) {
	var limit, active int
	err := s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx,
			`SELECT COALESCE((SELECT student_limit FROM subscriptions WHERE tenant_id=$1 AND status='active' AND ends_at > now() ORDER BY student_limit DESC LIMIT 1),
			                 (SELECT student_limit FROM exam_credits WHERE tenant_id=$1 AND used < quantity ORDER BY student_limit DESC LIMIT 1),
			                 10)`, tenantID).Scan(&limit); err != nil {
			return err
		}
		return tx.QueryRow(ctx,
			`SELECT count(*) FROM students WHERE tenant_id=$1 AND status='active' AND merged_into_id IS NULL`, tenantID).Scan(&active)
	})
	return limit, active, err
}

// QuotaStatus ringkasan kuota tenant (dashboard & gating).
type QuotaStatus struct {
	HasActiveQuota  bool   `json:"has_active_quota"`
	MonthlyActive   bool   `json:"monthly_active"`
	MonthlyEndsAt   string `json:"monthly_ends_at,omitempty"`
	TrialActive     bool   `json:"trial_active"`
	TrialExamsLeft  int    `json:"trial_exams_left"`
	CreditsTotal    int    `json:"credits_total"`
	CreditsUsed     int    `json:"credits_used"`
	CreditsLeft     int    `json:"credits_left"`
	StudentLimit    int    `json:"student_limit"`
	ActiveStudents  int    `json:"active_students"`
	AccessEndedAt   string `json:"access_ended_at,omitempty"`
	ReadOnly        bool   `json:"read_only"`
}

func (s *Service) Status(ctx context.Context, tenantID string) (*QuotaStatus, error) {
	st := &QuotaStatus{}
	err := s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		var subLimit *int
		var subEnds *time.Time
		var subQuota *int
		var subUsed int
		var subType string
		err := tx.QueryRow(ctx,
			`SELECT type, student_limit, exam_quota, exams_used, ends_at FROM subscriptions
			 WHERE tenant_id=$1 AND status='active' AND ends_at > now() ORDER BY ends_at DESC LIMIT 1`, tenantID).
			Scan(&subType, &subLimit, &subQuota, &subUsed, &subEnds)
		if err == nil {
			st.StudentLimit = *subLimit
			if subType == "monthly" {
				st.MonthlyActive = true
				st.MonthlyEndsAt = subEnds.Format(time.RFC3339)
			} else {
				st.TrialActive = true
				st.TrialExamsLeft = *subQuota - subUsed
			}
		}
		var credits, used int
		if err := tx.QueryRow(ctx,
			`SELECT COALESCE(sum(quantity),0), COALESCE(sum(used),0) FROM exam_credits WHERE tenant_id=$1`, tenantID).
			Scan(&credits, &used); err != nil {
			return err
		}
		st.CreditsTotal, st.CreditsUsed = credits, used
		st.CreditsLeft = credits - used
		var active int
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM students WHERE tenant_id=$1 AND status='active' AND merged_into_id IS NULL`, tenantID).Scan(&active); err != nil {
			return err
		}
		st.ActiveStudents = active
		if st.StudentLimit == 0 {
			st.StudentLimit = 10
		}
		var ended *time.Time
		var ro *time.Time
		if err := tx.QueryRow(ctx, `SELECT access_ended_at, read_only_since FROM tenants WHERE id=$1`, tenantID).Scan(&ended, &ro); err != nil {
			return err
		}
		if ended != nil {
			st.AccessEndedAt = ended.Format(time.RFC3339)
		}
		st.ReadOnly = ro != nil
		// grace: ujian yang sedang berjalan tidak terputus walau kuota habis (ditangani saat close/retensi);
		// publish ujian BARU tetap butuh kuota aktif (AC-7).
		st.HasActiveQuota = st.MonthlyActive || st.CreditsLeft > 0 || (st.TrialActive && st.TrialExamsLeft > 0)
		return nil
	})
	return st, err
}

// EnsurePublishable memeriksa kuota aktif untuk publish ujian (AC-7).
func (s *Service) EnsurePublishable(ctx context.Context, tenantID string) error {
	st, err := s.Status(ctx, tenantID)
	if err != nil {
		return err
	}
	if st.ReadOnly {
		return httpx.Err(httpx.CodeTenantReadOnly, "tenant dalam mode baca-saja; perpanjang langganan untuk publish ujian baru", 403)
	}
	if !st.HasActiveQuota {
		return httpx.ErrDetails(httpx.CodeQuotaExceeded,
			"tidak ada kuota ujian aktif. Silakan beli paket per ujian atau bulanan.", 402,
			map[string]any{"buy": "/billing", "plans": "/api/v1/plans"})
	}
	return nil
}

// ConsumeForPublish mengkonsumsi kuota saat exam publish; mengembalikan (source, refID).
// Urutan: bulanan → trial → kredit (PRD 3.2).
func (s *Service) ConsumeForPublish(ctx context.Context, tenantID, examID string) (string, string, error) {
	var source, refID string
	err := s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		// 1) bulanan aktif
		var subID string
		var ends time.Time
		if err := tx.QueryRow(ctx,
			`SELECT id, ends_at FROM subscriptions WHERE tenant_id=$1 AND status='active' AND type='monthly' AND ends_at > now() LIMIT 1`,
			tenantID).Scan(&subID, &ends); err == nil {
			source, refID = "monthly", subID
			return nil
		}
		// 2) trial dengan sisa kuota — guard kondisional anti race (H1)
		var trialID string
		if err := tx.QueryRow(ctx,
			`SELECT id FROM subscriptions WHERE tenant_id=$1 AND status='active' AND type='trial' AND ends_at > now() AND exam_quota > exams_used LIMIT 1`,
			tenantID).Scan(&trialID); err == nil {
			tag, err := tx.Exec(ctx, `UPDATE subscriptions SET exams_used = exams_used + 1 WHERE id=$1 AND exams_used < exam_quota`, trialID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return httpx.Err(httpx.CodeQuotaExceeded, "kuota ujian trial habis; upgrade untuk publish", 402)
			}
			source, refID = "trial", trialID
			return nil
		}
		// 3) kredit per ujian (tidak kedaluwarsa), pilih tier dengan student_limit cukup
		var active int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM students WHERE tenant_id=$1 AND status='active' AND merged_into_id IS NULL`, tenantID).Scan(&active); err != nil {
			return err
		}
		var creditID string
		err := tx.QueryRow(ctx,
			`SELECT id FROM exam_credits WHERE tenant_id=$1 AND used < quantity AND student_limit >= $2 ORDER BY student_limit ASC LIMIT 1`,
			tenantID, active).Scan(&creditID)
		if err != nil {
			return httpx.Err(httpx.CodeQuotaExceeded, "tidak ada kredit ujian yang cukup untuk jumlah siswa saat ini; beli paket sesuai tier", 402)
		}
		// guard kondisional anti race atomik: qty guard di WHERE + cek RowsAffected (H1)
		tag, err := tx.Exec(ctx, `UPDATE exam_credits SET used = used + 1 WHERE id=$1 AND used < quantity`, creditID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.Err(httpx.CodeQuotaExceeded, "kredit ujian tidak tersedia; beli paket sesuai tier", 402)
		}
		source, refID = "credit", creditID
		return nil
	})
	if err != nil {
		return "", "", err
	}
	return source, refID, nil
}

// RefundForUnpublish mengembalikan kuota bila unpublish sebelum ada yang mengerjakan (PRD 3.2).
func (s *Service) RefundForUnpublish(ctx context.Context, tenantID, examID string) error {
	return s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := RefundQuotaTx(ctx, tx, tenantID, examID)
		return err
	})
}

// RefundQuotaTx mengembalikan kuota ujian pada transaksi yang SAMA dengan pengosongan
// quota_source/quota_ref_id — WAJIB dipanggil SEBELUM kolom quota di-null-kan, karena
// sumber refund dibaca dari baris exam (K-2: panggilan post-commit dulu membaca NULL).
func RefundQuotaTx(ctx context.Context, tx pgx.Tx, tenantID, examID string) (bool, error) {
	var source string
	var refID *string
	var refunded *time.Time
	if err := tx.QueryRow(ctx,
		`SELECT quota_source, quota_ref_id, quota_refunded_at FROM exams WHERE tenant_id=$1 AND id=$2`, tenantID, examID).
		Scan(&source, &refID, &refunded); err != nil {
		return false, err
	}
	if refID == nil || refunded != nil {
		return false, nil
	}
	switch source {
	case "trial":
		if _, err := tx.Exec(ctx, `UPDATE subscriptions SET exams_used = GREATEST(exams_used-1,0) WHERE id=$1`, *refID); err != nil {
			return false, err
		}
	case "credit":
		if _, err := tx.Exec(ctx, `UPDATE exam_credits SET used = GREATEST(used-1,0) WHERE id=$1`, *refID); err != nil {
			return false, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE exams SET quota_refunded_at = now() WHERE id=$1`, examID); err != nil {
		return false, err
	}
	return true, nil
}

// RefundForConsume mengembalikan kuota yang baru dikonsumsi ConsumeForPublish untuk
// kompensasi gagal publish (H1) — refund langsung ke baris sumber, BUKAN membaca ulang
// exams.quota_ref_id yang bisa sudah di-set penerbit lain saat race.
func (s *Service) RefundForConsume(ctx context.Context, tenantID, source, refID string) error {
	return s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		switch source {
		case "trial":
			if _, err := tx.Exec(ctx, `UPDATE subscriptions SET exams_used = GREATEST(exams_used-1,0) WHERE id=$1`, refID); err != nil {
				return err
			}
		case "credit":
			if _, err := tx.Exec(ctx, `UPDATE exam_credits SET used = GREATEST(used-1,0) WHERE id=$1`, refID); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Service) getSubscription(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	st, err := s.Status(r.Context(), tid)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, st)
}

func (s *Service) listInvoices(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	var rows []map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		rws, err := tx.Query(r.Context(),
			`SELECT i.invoice_no, i.amount_idr, i.issued_at, p.provider, p.status FROM invoices i JOIN payments p ON p.id=i.payment_id WHERE i.tenant_id=$1 ORDER BY i.issued_at DESC LIMIT 100`, tid)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var no, provider, status string
			var amount int
			var issued time.Time
			if err := rws.Scan(&no, &amount, &issued, &provider, &status); err != nil {
				return err
			}
			rows = append(rows, map[string]any{"invoice_no": no, "amount_idr": amount, "issued_at": issued, "provider": provider, "status": status})
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

type checkoutInput struct {
	PlanCode string `json:"plan_code"`
	Provider string `json:"provider"` // midtrans | mayar | mock
}

// checkout membuat payment pending via PaymentProvider (FR-10.1/10.4), idempoten via Idempotency-Key.
func (s *Service) checkout(w http.ResponseWriter, r *http.Request) {
	var in checkoutInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	actor := httpx.ActorIDFrom(r.Context())
	idem := r.Header.Get("Idempotency-Key")
	if idem == "" {
		idem = platform.NewIDString()
	}
	provider := in.Provider
	if provider == "" {
		provider = s.Provider.Name()
	}
	var plan Plan
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(),
			`SELECT id, code, name, type, price_idr, student_min, student_max, exam_quota, duration_days FROM plans WHERE code=$1 AND is_active=true`, in.PlanCode).
			Scan(&plan.ID, &plan.Code, &plan.Name, &plan.Type, &plan.PriceIDR, &plan.StudentMin, &plan.StudentMax, &plan.ExamQuota, &plan.DurationDays)
	})
	if err != nil {
		httpx.WriteError(w, httpx.NotFound("paket tidak ditemukan"))
		return
	}
	// tier harus mencakup jumlah siswa aktif (PRD 3.2)
	st, _ := s.Status(r.Context(), tid)
	if st != nil && st.ActiveStudents > plan.StudentMax {
		httpx.WriteError(w, httpx.ErrDetails(httpx.CodeQuotaExceeded,
			fmt.Sprintf("paket ini untuk %d–%d siswa; Anda punya %d siswa aktif. Pilih tier lebih besar.", plan.StudentMin, plan.StudentMax, st.ActiveStudents), 409,
			map[string]any{"active_students": st.ActiveStudents}))
		return
	}
	if plan.PriceIDR == 0 {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "paket gratis tidak bisa dibeli"))
		return
	}
	orderID := "FLOW-" + strings.ToUpper(platform.RandomToken(8))
	purpose := "per_exam"
	if plan.Type == "monthly" {
		purpose = "monthly"
	}
	checkoutURL, providerRef, err := s.Provider.CreateCheckout(r.Context(), CheckoutRequest{
		OrderID: orderID, AmountIDR: plan.PriceIDR, PlanCode: plan.Code, Purpose: purpose, TenantID: tid,
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	var payID string
	var tenantName string
	err = s.DB.WithSystemTx(r.Context(), func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `SELECT name FROM tenants WHERE id=$1`, tid).Scan(&tenantName); err != nil {
			return err
		}
		return tx.QueryRow(r.Context(),
			`INSERT INTO payments (tenant_id, tenant_name_snap, plan_id, purpose, provider, order_id, provider_ref, idempotency_key, amount_idr, status, checkout_url)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10) RETURNING id`,
			tid, tenantName, plan.ID, purpose, provider, orderID, providerRef, idem, plan.PriceIDR, checkoutURL).Scan(&payID)
	})
	if err != nil {
		if strings.Contains(err.Error(), "payments_idem_uq") || strings.Contains(err.Error(), "duplicate") {
			httpx.WriteError(w, httpx.Conflict("IDEMPOTENT_REPLAY", "checkout dengan Idempotency-Key ini sudah dibuat"))
			return
		}
		httpx.WriteError(w, err)
		return
	}
	s.Audit.Log(r.Context(), s.DB.System, tid, "user", actor, "billing.checkout", "payment", payID, map[string]any{"plan": plan.Code, "order": orderID}, "")
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"payment_id": payID, "order_id": orderID, "checkout_url": checkoutURL, "amount_idr": plan.PriceIDR, "plan": plan.Code})
}

// webhookMidtrans/webhookMayar/webhookMock: idempoten via payment_webhook_events (UNIQUE provider+event_id).
func (s *Service) handleWebhook(w http.ResponseWriter, r *http.Request, providerName string, eventID string, signatureOK bool, payload []byte) {
	provider, err := s.ProviderByName(providerName)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if !signatureOK {
		// catat event (forensik/audit) lalu tolak tanpa memproses payload (K-1).
		_ = s.DB.WithSystemTx(r.Context(), func(tx pgx.Tx) error {
			_, err := tx.Exec(r.Context(),
				`INSERT INTO payment_webhook_events (provider, event_id, signature_ok, payload) VALUES ($1,$2,false,$3)
				 ON CONFLICT (provider, event_id) DO NOTHING`, providerName, eventID, payload)
			return err
		})
		httpx.WriteError(w, httpx.Unauthorized("signature webhook tidak valid"))
		return
	}
	processed := false
	err = s.DB.WithSystemTx(r.Context(), func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(),
			`INSERT INTO payment_webhook_events (provider, event_id, signature_ok, payload) VALUES ($1,$2,$3,$4)
			 ON CONFLICT (provider, event_id) DO NOTHING`, providerName, eventID, signatureOK, payload)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil // sudah diproses — idempoten, tetap ACK (AC: webhook ganda tidak menggandakan kredit)
		}
		processed = true
		return provider.HandleWebhook(r.Context(), tx, payload)
	})
	if err != nil {
		_, _ = s.DB.System.Exec(r.Context(),
			`UPDATE payment_webhook_events SET error=$1 WHERE provider=$2 AND event_id=$3`, err.Error(), providerName, eventID)
		httpx.WriteError(w, err)
		return
	}
	if processed {
		_, _ = s.DB.System.Exec(r.Context(),
			`UPDATE payment_webhook_events SET processed_at=now() WHERE provider=$1 AND event_id=$2`, providerName, eventID)
		// notifikasi in-app ke owner bahwa pembayaran berhasil (FR-13)
		if s.Notify != nil {
			var m map[string]any
			if json.Unmarshal(payload, &m) == nil {
				if oid, _ := m["order_id"].(string); oid != "" {
					var tid, uid, payStatus string
					_ = s.DB.System.QueryRow(r.Context(),
						`SELECT p.tenant_id, COALESCE(u.id::text,''), p.status FROM payments p LEFT JOIN users u ON u.tenant_id=p.tenant_id AND u.role='owner' WHERE p.order_id=$1`, oid).
						Scan(&tid, &uid, &payStatus)
					if tid != "" && uid != "" && payStatus == "paid" {
						s.Notify(r.Context(), tid, uid, "payment", "Pembayaran berhasil", "Paket/langganan Anda sudah aktif. Terima kasih!", map[string]any{"order_id": oid})
					}
				}
			}
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) webhookMidtrans(w http.ResponseWriter, r *http.Request) {
	body := readBody(r)
	// signature_key Midtrans dikirim DI DALAM body notifikasi; fallback header X-Signature
	var m map[string]any
	sig := r.Header.Get("X-Signature")
	if json.Unmarshal(body, &m) == nil {
		if sk, _ := m["signature_key"].(string); sk != "" {
			sig = sk
		}
	}
	ok := s.Provider.VerifySignature(r.Context(), "midtrans", body, sig)
	ev := webhookEventID("midtrans", body)
	s.handleWebhook(w, r, "midtrans", ev, ok, body)
}

func (s *Service) webhookMayar(w http.ResponseWriter, r *http.Request) {
	body := readBody(r)
	sig := r.Header.Get("X-Signature")
	ok := s.Provider.VerifySignature(r.Context(), "mayar", body, sig)
	ev := webhookEventID("mayar", body)
	s.handleWebhook(w, r, "mayar", ev, ok, body)
}

func (s *Service) webhookMock(w http.ResponseWriter, r *http.Request) {
	body := readBody(r)
	ev := webhookEventID("mock", body)
	s.handleWebhook(w, r, "mock", ev, true, body)
}

// exportAll: endpoint yang memicu job export semua data tenant (PRD 3.2) — hasil via file_jobs.
func (s *Service) exportAll(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	actor := httpx.ActorIDFrom(r.Context())
	var jobID string
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(),
			`INSERT INTO file_jobs (tenant_id, kind, status, created_by, expires_at) VALUES ($1,'tenant_export','queued',$2, now()+interval '7 days') RETURNING id`,
			tid, actor).Scan(&jobID)
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	s.Audit.Log(r.Context(), s.DB.System, tid, "user", actor, "billing.export_all", "file_job", jobID, nil, "")
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"job_id": jobID, "note": "Export semua data sedang diproses; unduh hasilnya dari daftar job/file."})
}

func (s *Service) ProviderByName(name string) (PaymentProvider, error) {
	if name == s.Provider.Name() {
		return s.Provider, nil
	}
	return nil, httpx.BadRequest(httpx.CodeValidation, "provider tidak dikenal: "+name)
}

func readBody(r *http.Request) []byte {
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)
	for {
		n, err := r.Body.Read(tmp)
		buf = append(buf, tmp[:n]...)
		if err != nil {
			break
		}
	}
	return buf
}

func webhookEventID(provider string, body []byte) string {
	sum := sha256.Sum256(append([]byte(provider+":"), body...))
	return hex.EncodeToString(sum[:16])
}

var _ = fmt.Sprint
