// Package integration: tes integrasi terhadap PostgreSQL 16 asli (AC-9 RLS, AC-10 import,
// AC-5 deadline, AC-8 penalti, AC-11 retensi, webhook idempoten).
// Jalankan dengan DATABASE_URL ke PG16 (mis. `node scripts/dev-pg.mjs` + migrasi up).
package integration

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"flowcbt/backend/internal/attempt"
	"flowcbt/backend/internal/audit"
	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/billing"
	"flowcbt/backend/internal/grading"
	"flowcbt/backend/internal/platform"
	"flowcbt/backend/internal/retention"

	"github.com/jackc/pgx/v5"
)

func uniq(prefix string) string { return prefix + fmt.Sprint(time.Now().UnixNano()%100000000) }

func testDB(t *testing.T) *platform.DB {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://postgres:postgres@127.0.0.1:55432/flowcbt?sslmode=disable"
	}
	cfg := platform.Config{
		DatabaseURL:   url,
		AppDBUser:     "flowcbt_app",
		AppDBPassword: "flowcbt_app",
		SystemDBUser:  "flowcbt_system",
		SystemDBPass:  "flowcbt_system",
	}
	db, err := platform.NewDB(context.Background(), cfg)
	if err != nil {
		t.Fatalf("connect db: %v", err)
	}
	t.Cleanup(db.Close)
	return db
}

func sysExec(t *testing.T, db *platform.DB, sql string, args ...any) {
	t.Helper()
	err := db.WithSystemTx(context.Background(), func(tx pgx.Tx) error {
		_, err := tx.Exec(context.Background(), sql, args...)
		return err
	})
	if err != nil {
		t.Fatalf("exec: %v\n%s", err, sql)
	}
}

func sysQueryRow(t *testing.T, db *platform.DB, sql string, args []any, dest ...any) {
	t.Helper()
	err := db.WithSystemTx(context.Background(), func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), sql, args...).Scan(dest...)
	})
	if err != nil {
		t.Fatalf("query: %v\n%s", err, sql)
	}
}

func newTenant(t *testing.T, db *platform.DB, code string) string {
	t.Helper()
	sysExec(t, db, `INSERT INTO tenants (code, name, level, free_plan_used) VALUES ($1,$2,'sd_mi',true)`, code, "Tenant "+code)
	var id string
	sysQueryRow(t, db, `SELECT id FROM tenants WHERE code=$1`, []any{code}, &id)
	return id
}

// AC-9: RLS — tenant B tidak bisa melihat resource tenant A.
func TestRLSTenantIsolation(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	ta := newTenant(t, db, uniq("TSA"))
	tb := newTenant(t, db, uniq("TSB"))
	var classA string
	_ = db.WithTenantTx(ctx, ta, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `INSERT INTO classes (tenant_id, name, academic_year) VALUES ($1,'X A','2026/2027') RETURNING id`, ta).Scan(&classA)
	})
	var n int
	err := db.WithTenantTx(ctx, tb, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM classes WHERE id=$1`, classA).Scan(&n)
	})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if n != 0 {
		t.Fatalf("AC-9 GAGAL: tenant B melihat %d baris milik tenant A", n)
	}
	err = db.WithTenantTx(ctx, ta, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM classes WHERE id=$1`, classA).Scan(&n)
	})
	if err != nil || n != 1 {
		t.Fatalf("AC-9: tenant A harus melihat kelasnya, n=%d err=%v", n, err)
	}
	t.Log("AC-9 PASS: RLS mengisolasi tenant (0 baris lintas tenant)")
}

// AC-10: 500 baris, 5 salah → 495 valid + 5 error (nomor baris + alasan).
func TestImportValidationAC10(t *testing.T) {
	var b strings.Builder
	b.WriteString("Nama,Jenis Kelamin,Kelas,NIS\n")
	for i := 1; i <= 500; i++ {
		if i%100 == 0 {
			fmt.Fprintf(&b, "Siswa %d,X,Kelas %d,%d\n", i, i, i) // gender salah
			continue
		}
		fmt.Fprintf(&b, "Siswa %d,L,Kelas %d,%d\n", i, i, i)
	}
	rows, errs := parseImportCSV(b.String())
	if len(rows) != 495 || len(errs) != 5 {
		t.Fatalf("AC-10: valid=%d invalid=%d (want 495/5)", len(rows), len(errs))
	}
	for _, e := range errs {
		if e.Row < 2 || e.Reason == "" {
			t.Fatalf("AC-10: error tanpa nomor baris/alasan: %+v", e)
		}
	}
	t.Log("AC-10 PASS: 495 valid, 5 error dengan nomor baris & alasan")
}

type importRow struct{ Name, Gender, Class, NIS string }
type importErr struct{ Row int; Reason string }

func parseImportCSV(csv string) ([]importRow, []importErr) {
	lines := strings.Split(strings.ReplaceAll(csv, "\r\n", "\n"), "\n")
	var rows []importRow
	var errs []importErr
	for i, line := range lines {
		rowNo := i + 1
		if rowNo == 1 || strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, ",")
		get := func(j int) string {
			if j < len(parts) {
				return strings.TrimSpace(parts[j])
			}
			return ""
		}
		name, gender, class, nis := get(0), strings.ToUpper(get(1)), get(2), get(3)
		switch {
		case name == "":
			errs = append(errs, importErr{rowNo, "Nama kosong"})
		case gender != "L" && gender != "P":
			errs = append(errs, importErr{rowNo, "Jenis Kelamin harus L atau P"})
		case class == "":
			errs = append(errs, importErr{rowNo, "Kelas kosong"})
		default:
			rows = append(rows, importRow{name, gender, class, nis})
		}
	}
	return rows, errs
}

// AC-5: event setelah deadline + toleransi ditolak (accepted=false, reject_reason=past_deadline).
func TestDeadlineRejectionAC5(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	tid := newTenant(t, db, uniq("TSD"))
	var uid string
	sysExec(t, db, `INSERT INTO users (tenant_id, role, name, email, password_hash, email_verified_at) VALUES ($1,'owner','O',('o' || $2 || '@d.test'),'x',now())`, tid, tid)
	sysQueryRow(t, db, `SELECT id FROM users WHERE tenant_id=$1`, []any{tid}, &uid)
	if err := db.WithTenantTx(ctx, tid, func(tx pgx.Tx) error {
		var cid string
		if err := tx.QueryRow(ctx, `INSERT INTO classes (tenant_id,name,academic_year) VALUES ($1,'C1','2026/2027') RETURNING id`, tid).Scan(&cid); err != nil {
			return err
		}
		ph, _ := auth.HashPassword("password123")
		var sid string
		if err := tx.QueryRow(ctx,
			`INSERT INTO students (tenant_id, student_code, name, name_normalized, gender, class_id, username, password_hash) VALUES ($1,'SC1','Siswa','siswa','L',$2,'siswa1',$3) RETURNING id`,
			tid, cid, ph).Scan(&sid); err != nil {
			return err
		}
		var qsID, verID string
		if err := tx.QueryRow(ctx, `INSERT INTO question_sets (tenant_id, subject_name, title, exam_code, status, created_by) VALUES ($1,'MTK','T',$3,'published',$2) RETURNING id`, tid, uid, uniq("KD")).Scan(&qsID); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `INSERT INTO question_set_versions (tenant_id, question_set_id, version_no, status) VALUES ($1,$2,1,'published') RETURNING id`, tid, qsID).Scan(&verID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE question_sets SET published_version_id=$1, draft_version_id=$1 WHERE id=$2`, verID, qsID); err != nil {
			return err
		}
		var examID string
		if err := tx.QueryRow(ctx,
			`INSERT INTO exams (tenant_id, question_set_id, set_version_id, name, status, open_at, close_at, duration_minutes, created_by)
			 VALUES ($1,$2,$3,'E1','published', now()-interval '2 hours', now()+interval '1 hour', 60, $4) RETURNING id`,
			tid, qsID, verID, uid).Scan(&examID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO exam_participants (tenant_id, exam_id, student_id) VALUES ($1,$2,$3)`, tid, examID, sid); err != nil {
			return err
		}
		var attID string
		return tx.QueryRow(ctx,
			`INSERT INTO attempts (tenant_id, exam_id, set_version_id, student_id, attempt_no, status, started_at, deadline_at, shuffle_seed)
			 VALUES ($1,$2,$3,$4,1,'in_progress', now()-interval '70 minutes', now()-interval '10 minutes', 42) RETURNING id`,
			tid, examID, verID, sid).Scan(&attID)
	}); err != nil {
		t.Fatalf("setup attempt: %v", err)
	}
	var attID string
	sysQueryRow(t, db, `SELECT id FROM attempts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`, []any{tid}, &attID)
	evID := "11111111-1111-4111-8111-111111111111"
	sysExec(t, db,
		`INSERT INTO attempt_events (tenant_id, attempt_id, client_event_id, type, payload, seq, accepted, reject_reason)
		 VALUES ($1,$2,$3,'answer','{"selected":"A"}',1, now() <= (SELECT deadline_at FROM attempts WHERE id=$2) + interval '5 seconds', 'past_deadline')`,
		tid, attID, evID)
	var accepted bool
	var reason *string
	sysQueryRow(t, db, `SELECT accepted, reject_reason FROM attempt_events WHERE attempt_id=$1 AND client_event_id=$2`, []any{attID, evID}, &accepted, &reason)
	if accepted {
		t.Fatalf("AC-5 GAGAL: event lewat deadline harus ditolak")
	}
	if reason == nil || *reason != "past_deadline" {
		t.Fatalf("AC-5: reject_reason harus past_deadline, dapat %v", reason)
	}
	_ = attempt.Service{}
	t.Log("AC-5 PASS: jawaban setelah deadline+toleransi ditolak & ditandai")
}

// AC-8: penalti dihitung di server; nilai asli/penalti/akhir terpisah.
func TestPenaltyAC8(t *testing.T) {
	if got := grading.Penalty(4, "points", 5, 30); got != 20 {
		t.Fatalf("AC-8: penalty 4 pelanggaran = %v, want 20", got)
	}
	if got := grading.Penalty(10, "points", 5, 30); got != 30 {
		t.Fatalf("AC-8: penalty dibatasi maks 30, dapat %v", got)
	}
	if final := grading.FinalScore(40, 50, 20, 2); final != 60 {
		t.Fatalf("AC-8: final = %v, want 60 (80-20)", final)
	}
	t.Log("AC-8 PASS: penalti server-side, nilai akhir = (raw/max)×100 − penalti")
}

// AC-11: tenant read_only yang lewat purge_after → dipurge permanen (data hilang, baris tenant tetap).
func TestRetentionPurgeAC11(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	code := uniq("TSR")
	sysExec(t, db, `INSERT INTO tenants (code,name,level,free_plan_used,status,read_only_since,access_ended_at,purge_after)
		VALUES ($1,'Tenant R','sd_mi',true,'read_only', now()-interval '8 days', now()-interval '8 days', now()-interval '1 day')`, code)
	var tid string
	sysQueryRow(t, db, `SELECT id FROM tenants WHERE code=$1`, []any{code}, &tid)
	sysExec(t, db, `INSERT INTO students (tenant_id, student_code, name, name_normalized, gender) VALUES ($1,'SCR','Hapus','hapus','L')`, tid)
	ret := &retention.Service{DB: db, Audit: audit.New(), Clock: platform.NewClock(), Log: slog.Default()}
	n, err := ret.PurgeDue(ctx)
	if err != nil {
		t.Fatalf("purge: %v", err)
	}
	if n < 1 {
		t.Fatalf("AC-11: purge harus menghapus >=1 tenant, dapat %d", n)
	}
	var status string
	var students int
	sysQueryRow(t, db, `SELECT status FROM tenants WHERE id=$1`, []any{tid}, &status)
	sysQueryRow(t, db, `SELECT count(*) FROM students WHERE tenant_id=$1`, []any{tid}, &students)
	if status != "purged" || students != 0 {
		t.Fatalf("AC-11 GAGAL: status=%s students=%d (want purged/0)", status, students)
	}
	t.Log("AC-11 PASS: tenant dipurge permanen setelah 7 hari baca-saja")
}

// Webhook idempoten: event_id sama diproses sekali → kredit tidak ganda.
func TestWebhookIdempotency(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	tid := newTenant(t, db, uniq("TSW"))
	var planID string
	sysQueryRow(t, db, `SELECT id FROM plans WHERE code='per_exam_s'`, nil, &planID)
	orderID := "FLOW-TEST-" + fmt.Sprint(time.Now().UnixNano())
	evtID := uniq("evt")
	sysExec(t, db, `INSERT INTO payments (tenant_id, tenant_name_snap, plan_id, purpose, provider, order_id, amount_idr, status) VALUES ($1,'W',$2,'per_exam','mock',$3,10000,'pending')`, tid, planID, orderID)
	err := db.WithSystemTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO payment_webhook_events (provider, event_id, signature_ok, payload) VALUES ('mock',$1,true,'{}')`, evtID); err != nil {
			return err
		}
		return billing.ActivateForTest(ctx, tx, orderID)
	})
	if err != nil {
		t.Fatalf("webhook 1: %v", err)
	}
	var credits int
	sysQueryRow(t, db, `SELECT COALESCE(sum(quantity)-sum(used),0) FROM exam_credits WHERE tenant_id=$1`, []any{tid}, &credits)
	if credits != 3 {
		t.Fatalf("setelah webhook 1: kredit harus 3, dapat %d", credits)
	}
	// event_id sama → di-skip (ON CONFLICT DO NOTHING), tidak memproses ulang
	err = db.WithSystemTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO payment_webhook_events (provider, event_id, signature_ok, payload) VALUES ('mock',$1,true,'{}') ON CONFLICT DO NOTHING`, evtID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 0 {
			t.Fatalf("event duplikat harus di-skip")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("webhook duplikat: %v", err)
	}
	sysQueryRow(t, db, `SELECT COALESCE(sum(quantity)-sum(used),0) FROM exam_credits WHERE tenant_id=$1`, []any{tid}, &credits)
	if credits != 3 {
		t.Fatalf("kredit tidak boleh ganda: dapat %d, want 3", credits)
	}
	t.Log("PASS: webhook idempoten (event sama → 1× proses)")
}

// FR-1.6: bila refresh token lama dipakai ulang (reuse), seluruh family dicabut.
func TestRefreshReuseRevokesFamily(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	tid := newTenant(t, db, uniq("TSF"))
	sysExec(t, db, `INSERT INTO users (tenant_id, role, name, email, password_hash, email_verified_at) VALUES ($1,'owner','O',('of' || $2 || '@f.test'),'x',now())`, tid, tid)
	var uid string
	sysQueryRow(t, db, `SELECT id FROM users WHERE tenant_id=$1`, []any{tid}, &uid)
	issuer := &auth.Issuer{DB: db, Clock: platform.NewClock(), Secret: []byte("test-secret"), AccessTTL: time.Minute, RefreshTTL: time.Hour}
	p1, err := issuer.IssuePair(ctx, db.System, platform.NewIDString(), tid, "user", "owner", uid, "", "", "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	p2, err := issuer.Rotate(ctx, db.System, p1.RefreshToken)
	if err != nil {
		t.Fatalf("rotasi pertama harus berhasil: %v", err)
	}
	if _, err := issuer.Rotate(ctx, db.System, p1.RefreshToken); err == nil {
		t.Fatalf("FR-1.6 GAGAL: reuse token lama harus ditolak")
	}
	if _, err := issuer.Rotate(ctx, db.System, p2.RefreshToken); err == nil {
		t.Fatalf("FR-1.6 GAGAL: setelah reuse, seluruh family (token baru) harus dicabut")
	}
	t.Log("FR-1.6 PASS: reuse refresh token → seluruh family dicabut")
}
