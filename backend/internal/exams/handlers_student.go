// handlers_student.go — klien CBT siswa (PRD M6): daftar ujian siswa,
// start/resume attempt (paket soal dikunci & acak stabil), ambil paket
// tanpa kunci jawaban, hasil per soal, dan riwayat pengerjaan.
package exams

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"time"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// GET /student/me/exams — kategori {upcoming, open, done} per ujian (FR-6.1)
// ---------------------------------------------------------------------------

// studentExamItem satu ujian untuk daftar siswa.
type studentExamItem struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	SubjectName     string    `json:"subject_name"`
	ExamCode        string    `json:"exam_code"`
	OpenAt          time.Time `json:"open_at"`
	CloseAt         time.Time `json:"close_at"`
	DurationMinutes int       `json:"duration_minutes"`
	MaxAttempts     int       `json:"max_attempts"`
	AttemptsUsed    int       `json:"attempts_used"`
	BestScore       *float64  `json:"best_score"` // null bila nilai belum dirilis
	ActiveAttemptID *string   `json:"active_attempt_id"`
	Status          string    `json:"status_peserta"` // upcoming|open|done
	Paused          bool      `json:"paused"`
	ScoreReleased   bool      `json:"score_released"`
}

const myExamsSQL = `
SELECT e.id::text, e.name, e.subject_name, e.exam_code, e.open_at, e.close_at,
	e.duration_minutes, COALESCE(ep.attempts_override, e.max_attempts) AS max_eff,
	e.score_released, e.paused, e.login_mode,
	(SELECT COUNT(1) FROM attempts a WHERE a.exam_id=e.id AND a.student_id=$1) AS attempts_used,
	(SELECT MAX(a.final_score::float8) FROM attempts a
		WHERE a.exam_id=e.id AND a.student_id=$1 AND a.status IN ('graded','submitted')) AS best_score,
	(SELECT a.id::text FROM attempts a
		WHERE a.exam_id=e.id AND a.student_id=$1 AND a.status='in_progress'
		ORDER BY a.started_at DESC LIMIT 1) AS active_attempt_id
FROM exams e
LEFT JOIN exam_participants ep ON ep.exam_id=e.id AND ep.student_id=$1
WHERE e.status='published' AND (
	EXISTS (
		SELECT 1 FROM exam_assignments ea
		WHERE ea.exam_id=e.id AND (
			(ea.target_type='class' AND ea.class_id=$2)
			OR (ea.target_type='student' AND ea.student_id=$1)))
	OR NOT EXISTS (SELECT 1 FROM exam_assignments ea2 WHERE ea2.exam_id=e.id)
)
ORDER BY e.open_at ASC, e.id ASC`

func (m *Module) myExams(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	sid := ctxinfo.StudentID(r.Context())
	if sid == "" {
		httpx.Error(w, httpx.ErrUnauthorized)
		return
	}
	// Guest-only exam hanya tampil untuk pesertanya (student record is_guest).
	var isGuest bool
	var classID *string
	ctx := r.Context()
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT is_guest, class_id::text FROM students WHERE id=$1`, sid).
			Scan(&isGuest, &classID)
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			httpx.Error(w, httpx.ErrForbidden)
			return
		}
		httpx.Error(w, err)
		return
	}
	var cid any
	if classID != nil {
		cid = *classID
	}

	items := []studentExamItem{}
	now := nowTS()
	err = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, myExamsSQL, sid, cid)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var it studentExamItem
			var best *float64
			var loginMode string
			if err := rows.Scan(&it.ID, &it.Name, &it.SubjectName, &it.ExamCode,
				&it.OpenAt, &it.CloseAt, &it.DurationMinutes, &it.MaxAttempts,
				&it.ScoreReleased, &it.Paused, &loginMode, &it.AttemptsUsed, &best,
				&it.ActiveAttemptID); err != nil {
				return err
			}
			// Ujian khusus guest tidak muncul untuk peserta akun, dan sebaliknya.
			if loginMode == "guest" && !isGuest {
				continue
			}
			if loginMode == "account" && isGuest {
				continue
			}
			// Best score sensitif rilis nilai (FR-5.4).
			if it.ScoreReleased && best != nil {
				it.BestScore = best
			}
			it.Status = examPhase(now, it.OpenAt, it.CloseAt, it.AttemptsUsed, it.MaxAttempts, it.ActiveAttemptID != nil)
			items = append(items, it)
		}
		return rows.Err()
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	// Kelompokkan sesuai kontrak FE: {upcoming, open, done} (PRD FR-6.1).
	grouped := map[string][]studentExamItem{"upcoming": {}, "open": {}, "done": {}}
	for _, it := range items {
		bucket := it.Status
		if bucket != "upcoming" && bucket != "open" && bucket != "done" {
			bucket = "done"
		}
		grouped[bucket] = append(grouped[bucket], it)
	}
	httpx.OK(w, map[string]any{"data": grouped})
}

// examPhase kategori status peserta terhadap satu ujian.
func examPhase(now, openAt, closeAt time.Time, attemptsUsed, maxAttempts int, hasActive bool) string {
	switch {
	case now.Before(openAt):
		return "upcoming"
	case now.After(closeAt):
		return "done"
	case hasActive:
		// Attempt yang belum disubmit tetap bisa dilanjutkan walau kuota
		// percobaan sudah terpakai (FR-6.1 tombol Mulai/Lanjutkan).
		return "open"
	case attemptsUsed > 0 && attemptsUsed >= maxAttempts:
		return "done"
	default:
		return "open"
	}
}

// ---------------------------------------------------------------------------
// POST /student/exams/{examID}/start {token, device_info?} — mulai/lanjut.
// ---------------------------------------------------------------------------

func (m *Module) studentStart(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var req startReq
	if !m.decode(w, r, &req) {
		return
	}
	sid := ctxinfo.StudentID(r.Context())
	if sid == "" {
		httpx.Error(w, httpx.ErrUnauthorized)
		return
	}
	ctx := r.Context()
	now := nowTS()

	var out startResp
	err = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		// (a) Ujian harus published, token cocok, jendela terbuka.
		e, err := loadExam(ctx, tx, examID)
		if err != nil {
			return err
		}
		if e.Status != "published" {
			return httpx.NewErr(http.StatusForbidden, "NOT_OPEN", "Ujian tidak sedang terbuka")
		}
		if !e.TokenActive || normalizeToken(e.Token) != normalizeToken(req.Token) {
			return httpx.NewErr(http.StatusForbidden, "TOKEN_INVALID", "Token ujian salah atau sudah dimatikan")
		}
		if e.Paused {
			return httpx.NewErr(http.StatusConflict, "EXAM_PAUSED",
				"Ujian dijeda pengawas; tunggu instruksi")
		}
		if now.Before(e.OpenAt) {
			return httpx.NewErr(http.StatusForbidden, "NOT_OPEN", "Ujian belum dibuka")
		}
		if now.After(e.CloseAt) {
			return httpx.NewErr(http.StatusForbidden, "EXAM_CLOSED", "Waktu ujian sudah ditutup")
		}

		// (b) Data siswa & aturan login_mode.
		var stuName string
		var isGuest bool
		var classID *string
		if err := tx.QueryRow(ctx,
			`SELECT name, is_guest, class_id::text FROM students WHERE id=$1 AND status='active'`, sid).
			Scan(&stuName, &isGuest, &classID); err != nil {
			if err == pgx.ErrNoRows {
				return httpx.NewErr(http.StatusForbidden, "FORBIDDEN", "Peserta tidak aktif")
			}
			return err
		}
		if e.LoginMode == "guest" && !isGuest {
			return httpx.NewErr(http.StatusForbidden, "FORBIDDEN", "Ujian ini khusus mode tamu")
		}
		if e.LoginMode == "account" && isGuest {
			return httpx.NewErr(http.StatusForbidden, "FORBIDDEN", "Ujian ini memerlukan akun siswa")
		}

		// (c) Penugasan: bila ada daftar, siswa wajib tercantum; tanpa daftar
		// = semua siswa aktif tenant boleh (PIN).
		var assigned int
		if err := tx.QueryRow(ctx,
			`SELECT COUNT(1) FROM exam_assignments WHERE exam_id=$1`, examID).Scan(&assigned); err != nil {
			return err
		}
		if assigned > 0 {
			var okAssigned bool
			err := tx.QueryRow(ctx, `
				SELECT EXISTS (
					SELECT 1 FROM exam_assignments
					WHERE exam_id=$1 AND (
						(target_type='student' AND student_id=$2)
						OR (target_type='class' AND class_id=$3)))`, examID, sid, classID).Scan(&okAssigned)
			if err != nil {
				return err
			}
			if !okAssigned {
				return httpx.NewErr(http.StatusForbidden, "NOT_ASSIGNED",
					"Anda tidak terdaftar pada ujian ini")
			}
		}

		// (d) Peserta: override attempt & tambahan waktu (FR-5.7).
		maxEff, extraSeconds := e.MaxAttempts, 0
		var override *int
		err = tx.QueryRow(ctx, `
			SELECT attempts_override, extra_time_seconds
			FROM exam_participants WHERE exam_id=$1 AND student_id=$2`,
			examID, sid).Scan(&override, &extraSeconds)
		if err != nil && err != pgx.ErrNoRows {
			return err
		}
		if override != nil {
			maxEff = *override
		}

		// (e) Resume attempt yang sedang berjalan (AC-4: garansi lanjut).
		existing, err := scanAttemptRecord(tx.QueryRow(ctx, `
			SELECT `+attemptSelect+` FROM attempts
			WHERE exam_id=$1 AND student_id=$2 AND status='in_progress'
			ORDER BY attempt_no DESC LIMIT 1`, examID, sid))
		if err != nil && err != pgx.ErrNoRows {
			return err
		}
		if existing != nil {
			// Sertakan paket soal saat resume juga — tanpa ini FE menyimpan
			// questions=[] di IndexedDB dan UI pengerjaan tampil tanpa badan soal.
			pkgResume, err := buildStartPackage(ctx, tx, existing.ID, e)
			if err != nil {
				return err
			}
			out = startResp{AttemptID: existing.ID, Resume: true,
				StartedAt: existing.StartedAt, DeadlineAt: existing.DeadlineAt, ServerTime: now, Package: pkgResume}
			// Pastikan cookie perangkat tetap ada & device_token terisi.
			if err := ensureDeviceCookie(tx, tenantID, existing, r, w, req.DeviceInfo); err != nil {
				return err
			}
			return nil
		}

		// (f) Batas attempt.
		var attemptsUsed int
		if err := tx.QueryRow(ctx,
			`SELECT COUNT(1) FROM attempts WHERE exam_id=$1 AND student_id=$2`, examID, sid).
			Scan(&attemptsUsed); err != nil {
			return err
		}
		if attemptsUsed >= maxEff {
			return httpx.NewErr(http.StatusConflict, "ATTEMPT_LIMIT",
				"Jumlah pengerjaan sudah habis untuk ujian ini")
		}

		// (g) Snapshot kelas & nama saat mulai.
		var className *string
		if classID != nil {
			_ = tx.QueryRow(ctx, `SELECT name FROM classes WHERE id=$1`, *classID).Scan(&className)
		}
		classSnap := map[string]any{"id": classID, "name": className}

		// (h) Buat attempt + kunci paket soal.
		deviceToken, err := ensureDeviceToken(tx, tenantID, r, w)
		if err != nil {
			return err
		}
		deadline := now.Add(time.Duration(e.DurationMinutes)*time.Minute +
			time.Duration(extraSeconds)*time.Second)
		var attemptID string
		var startedAt time.Time
		if err := tx.QueryRow(ctx, `
			INSERT INTO attempts(tenant_id, exam_id, student_id, attempt_no, class_snapshot,
				name_snapshot, status, device_token, device_info, started_at, deadline_at)
			VALUES ($1,$2,$3,$4,$5,$6,'in_progress',$7,$8,$9,$10)
			RETURNING id::text, started_at`,
			tenantID, examID, sid, attemptsUsed+1, jsonRaw(classSnap), stuName,
			deviceToken, jsonRaw(req.DeviceInfo), now, deadline).
			Scan(&attemptID, &startedAt); err != nil {
			return examDBError(err)
		}

		// Kunci urutan soal & opsi untuk attempt ini (AC-6 stabil).
		if err := lockAttemptPackage(ctx, tx, e, attemptID); err != nil {
			return err
		}

		// Pra-muat paket untuk klien (FR-7.2): soal tanpa kunci + rules.
		pkg, err := buildStartPackage(ctx, tx, attemptID, e)
		if err != nil {
			return err
		}
		out = startResp{AttemptID: attemptID, Resume: false,
			StartedAt: &startedAt, DeadlineAt: &deadline, ServerTime: now, Package: pkg}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	// Respons FLAT (tanpa pembungkus "data") — sesuai kontrak FE siswa
	// (startExam mengharapkan attempt_id di level atas). Pembungkus "data"
	// membuat FE membaca attempt_id=undefined → navigasi ke /s/attempt/undefined.
	httpx.Created(w, out)
}

// buildStartPackage rangkai paket soal attempt (tanpa kunci) untuk pra-muat.
func buildStartPackage(ctx context.Context, tx pgx.Tx, attemptID string, e *examRecord) (*startPackage, error) {
	var a attemptRecord
	if err := tx.QueryRow(ctx, `SELECT id FROM attempts WHERE id=$1`, attemptID).
		Scan(&a.ID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Attempt tidak ditemukan")
		}
		return nil, err
	}
	qs, err := loadVersionQuestions(ctx, tx, e.QuestionSetVersionID)
	if err != nil {
		return nil, err
	}
	pq, err := assembleQuestions(ctx, tx, &a, e, qs)
	if err != nil {
		return nil, err
	}
	ac := e.antiCheat()
	return &startPackage{
		Name: e.Name, SubjectName: e.SubjectName, Questions: pq,
		ExplainVisible: false,
		Rules: examRulesView{
			AntiCheatEnabled: ac.Enabled, ToleranceSeconds: ac.ToleranceSeconds,
			PenaltyPoints: ac.PenaltyPoints, MaxPenalty: ac.MaxPenalty,
			FlagThreshold: ac.FlagThreshold, AutoSubmit: ac.AutoSubmit,
			CameraEnabled: ac.CameraEnabled, CameraRequired: ac.CameraMode == "wajib",
			SnapshotMinS: ac.SnapshotMinS, SnapshotMaxS: ac.SnapshotMaxS,
		},
		RequireAll: e.RequireAllAnswered, FreeNavigation: e.FreeNavigation,
	}, nil
}

// jsonRaw marhsal util: any → []byte aman nil.
func jsonRaw(v any) []byte {
	if v == nil {
		return []byte(`{}`)
	}
	b, err := json.Marshal(v)
	if err != nil {
		return []byte(`{}`)
	}
	return b
}

// ---------------------------------------------------------------------------
// Cookie & device token (FR-4.5: identitas perangkat pengerjaan)
// ---------------------------------------------------------------------------

const deviceCookieName = "fdev"

// ensureDeviceToken pastikan cookie fdev ada (httpOnly, SameSite=Lax); kembali
// nilai token device yang stabil.
func ensureDeviceToken(tx pgx.Tx, tenantID string, r *http.Request, w http.ResponseWriter) (string, error) {
	if c, err := r.Cookie(deviceCookieName); err == nil && c.Value != "" {
		return c.Value, nil
	}
	tok, err := newUUID()
	if err != nil {
		return "", err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     deviceCookieName,
		Value:    tok,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	return tok, nil
}

// ensureDeviceCookie resume path: tetapkan cookie bila belum ada & simpan
// device_token ke attempt (bila belum).
func ensureDeviceCookie(tx pgx.Tx, tenantID string, a *attemptRecord, r *http.Request, w http.ResponseWriter, deviceInfo map[string]any) error {
	tok, err := ensureDeviceToken(tx, tenantID, r, w)
	if err != nil {
		return err
	}
	if a.DeviceToken == "" {
		if _, err := tx.Exec(r.Context(),
			`UPDATE attempts SET device_token=$2 WHERE id=$1`, a.ID, tok); err != nil {
			return err
		}
	}
	if len(deviceInfo) > 0 {
		if _, err := tx.Exec(r.Context(),
			`UPDATE attempts SET device_info=$2 WHERE id=$1 AND device_info='{}'::jsonb`,
			a.ID, jsonRaw(deviceInfo)); err != nil {
			return err
		}
	}
	return nil
}

// newUUID v4 acak.
func newUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return formatUUID(b), nil
}

func formatUUID(b []byte) string {
	const hex = "0123456789abcdef"
	out := make([]byte, 0, 36)
	for i, v := range b {
		if i == 4 || i == 6 || i == 8 || i == 10 || i == 12 {
			out = append(out, '-')
		}
		out = append(out, hex[v>>4], hex[v&0x0f])
	}
	return string(out)
}

// ---------------------------------------------------------------------------
// lockAttemptPackage — simpan urutan soal/opsi terekam di attempts.package_json
// (AC-6: urutan stabil sepanjang pengerjaan, seed attempt id).
// ---------------------------------------------------------------------------

func lockAttemptPackage(ctx context.Context, tx pgx.Tx, e *examRecord, attemptID string) error {
	qs, err := loadVersionQuestions(ctx, tx, e.QuestionSetVersionID)
	if err != nil {
		return err
	}
	pkg := attemptPackage{Order: make([]string, 0, len(qs)), OptionsOrder: map[string][]string{}}
	for _, q := range qs {
		pkg.Order = append(pkg.Order, q.ID)
		if e.ShuffleOptions && (q.Type == "mcq" || q.Type == "mcq_complex") {
			var opts []struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(q.Options, &opts); err == nil && len(opts) > 1 {
				ids := make([]string, 0, len(opts))
				for _, o := range opts {
					ids = append(ids, o.ID)
				}
				ids = stableShuffle(ids, attemptID+q.ID)
				pkg.OptionsOrder[q.ID] = ids
			}
		}
	}
	if e.ShuffleQuestions {
		pkg.Order = stableShuffle(pkg.Order, attemptID)
	}
	raw, _ := json.Marshal(pkg)
	_, err = tx.Exec(ctx, `UPDATE attempts SET package_json=$2 WHERE id=$1`, attemptID, raw)
	return err
}
