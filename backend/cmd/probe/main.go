// main — util sementara smoke test modul exams (DIHAPUS setelah uji).
// Menyiapkan: kelas + siswa pada tenant ujian (11c96089), lalu mencetak
// token siswa yang dipakai curl.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"flowcbt/backend/internal/auth"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	dsn    = "postgres://flowcbt:flowcbt_dev@127.0.0.1:5433/flowcbt"
	tenant = "11c96089-5518-451e-b0e0-a74d22bf796b" // tenant ujian smoke
	secret = "dev-secret-change-me-in-production"
)

func main() {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		fmt.Println("pool:", err)
		os.Exit(1)
	}
	defer pool.Close()

	// Kelas XI IPA 1 (tenant smoke) — buat bila belum ada.
	var classID string
	err = pool.QueryRow(ctx, `
		INSERT INTO classes(tenant_id, name, academic_year)
		SELECT $1,'XI IPA 1','2025/2026'
		WHERE NOT EXISTS (
			SELECT 1 FROM classes
			WHERE tenant_id=$1 AND name='XI IPA 1')
		RETURNING id::text`, tenant).Scan(&classID)
	if err != nil {
		// Kemungkinan kelas sudah ada → ambil.
		if e2 := pool.QueryRow(ctx, `
			SELECT id::text FROM classes
			WHERE tenant_id=$1 AND name='XI IPA 1'`, tenant).Scan(&classID); e2 != nil {
			fmt.Println("class:", e2)
			os.Exit(1)
		}
	}

	// Siswa smoke (unique tenant+code) — aman dipanggil ulang.
	var stuID string
	err = pool.QueryRow(ctx, `
		INSERT INTO students(tenant_id, student_code, nis, name, gender, username, status, class_id)
		SELECT $1,'S-TEST-11C1','2025001','Budi Siswa','L','budisiswa11c','active',$2
		RETURNING id::text`, tenant, classID).Scan(&stuID)
	if err != nil {
		if e2 := pool.QueryRow(ctx, `
			SELECT id::text FROM students
			WHERE tenant_id=$1 AND student_code='S-TEST-11C1'`, tenant).Scan(&stuID); e2 != nil {
			fmt.Println("student:", e2)
			os.Exit(1)
		}
	}

	// Token siswa (role=student, TTL 2 jam).
	at, terr := auth.SignAccessToken(secret, &auth.Claims{
		UserID: stuID, TenantID: tenant, Role: "student", Typ: "student", SID: stuID,
	}, 2*time.Hour)
	if terr != nil {
		fmt.Println("token:", terr)
		os.Exit(1)
	}
	out, _ := json.Marshal(map[string]string{
		"tenant": tenant, "class_id": classID, "student_id": stuID, "student_token": at,
	})
	fmt.Println(string(out))
}
