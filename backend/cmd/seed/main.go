package main

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand"
	"strconv"
	"time"

	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/config"
	"flowcbt/backend/internal/db"
)

// Seeder demo data FlowCBT — jalankan: go run ./cmd/seed
func main() {
	cfg := config.Load()
	ctx := context.Background()
	if err := db.Migrate(ctx, cfg.DatabaseURL, db.EmbeddedMigrations(), slog.Default()); err != nil {
		slog.Error("migrasi", "err", err)
		return
	}
	d, err := db.Connect(ctx, cfg.DatabaseURL, cfg.DatabaseAppURL)
	if err != nil {
		slog.Error("db", "err", err)
		return
	}
	defer d.Close()

	// idempoten: tenant demo tanda "SMA Demo CBT"
	var tenantID string
	err = d.Admin.QueryRow(ctx, `SELECT id FROM tenants WHERE name='SMA Demo CBT'`).Scan(&tenantID)
	if err == nil {
		fmt.Println("demo sudah ada; selesai (idempoten).")
		return
	}
	hash, _ := auth.HashPassword("Guru#12345")
	verif, _ := auth.RandomToken(24)
	_ = verif

	// gunakan pgx langsung (simple, seeder sekali jalan)
	tx, err := d.Admin.Begin(ctx)
	if err != nil {
		panic(err)
	}
	defer tx.Rollback(ctx)

	err = tx.QueryRow(ctx, `
		INSERT INTO tenants(name, school_level, status, trial_ends_at)
		VALUES ('SMA Demo CBT','SMA/SMK/MA','active', now() + interval '14 days')
		RETURNING id`).Scan(&tenantID)
	if err != nil {
		panic(err)
	}
	var guruID string
	err = tx.QueryRow(ctx, `
		INSERT INTO users(tenant_id, name, email, phone, password_hash, role, status, email_verified_at)
		VALUES ($1,'Pak Guru Demoo','guru@demo.cbt',$2,$3,'owner','active', now())
		RETURNING id`, tenantID, "08123456789", hash).Scan(&guruID)
	if err != nil {
		panic(err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO subscriptions(tenant_id, plan_id, kind, starts_at, ends_at, status)
		SELECT $1, id, 'trial', now(), now() + interval '14 days', 'active' FROM plans WHERE code='free_trial'`, tenantID)
	if err != nil {
		panic(err)
	}
	// Demo: naikkan ke paket per_ujian besar (71-100 siswa) + 12 kredit ujian,
	// agar 30 siswa demo sesuai tier dan alur publish/kuota bisa dicoba.
	_, err = tx.Exec(ctx, `
		INSERT INTO exam_credits(tenant_id, quantity)
		SELECT $1, greatest(exam_quota, 12) FROM plans WHERE code='per_exam_large'`, tenantID)
	if err != nil {
		panic(err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO subscriptions(tenant_id, plan_id, kind, starts_at, ends_at, status)
		SELECT $1, id, 'per_exam', now(), NULL, 'active' FROM plans WHERE code='per_exam_large'`, tenantID)
	if err != nil {
		panic(err)
	}

	// kelas
	classIDs := map[string]string{}
	for _, nm := range []string{"X-1", "X-2", "XI IPA 1"} {
		var cid string
		if err := tx.QueryRow(ctx, `
			INSERT INTO classes(tenant_id, name, academic_year, homeroom_teacher_id)
			VALUES ($1,$2,'2026/2027',$3) RETURNING id`, tenantID, nm, guruID).Scan(&cid); err != nil {
			panic(err)
		}
		classIDs[nm] = cid
	}

	// siswa
	namaL := []string{"Ahmad Fauzi", "Bima Prakoso", "Candra Wijaya", "Dimas Saputra", "Eko Nugroho", "Fajar Ramadhan", "Galih Pratama", "Hendar Setiawan", "Iqbal Maulana", "Joko Santoso"}
	namaP := []string{"Aisyah Putri", "Bunga Lestari", "Citra Dewi", "Dian Hanifah", "Elsa Maharani", "Fitri Handayani", "Gita Ayu", "Hana Salsabila", "Intan Permatasari", "Julia Anggraini"}
	r := rand.New(rand.NewSource(7))
	passHashDefault, _ := auth.HashPassword("Siswa#123")
	count := 0
	for _, cid := range classIDs {
		for i := 0; i < 10 && count < 30; i++ {
			count++
			gender := "L"
			name := namaL[i]
			if i%2 == 1 {
				gender = "P"
				name = namaP[i]
			}
			nis := strconv.Itoa(2000 + count)
			var sid string
			if err := tx.QueryRow(ctx, `
				INSERT INTO students(tenant_id, student_code, nis, name, gender, class_id, username, password_hash)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
				tenantID, "S-"+randCode(r), nis, name, gender, cid, "siswa"+nis, passHashDefault).Scan(&sid); err != nil {
				panic(err)
			}
			_ = sid
		}
	}

	// paket soal AKM — literasi matematika
	var setID string
	err = tx.QueryRow(ctx, `
		INSERT INTO question_sets(tenant_id, subject_name, title, description, exam_code, level_tag, status, current_version, created_by)
		VALUES ($1,'Matematika','AKM Numerasi — Bilangan','Latihan asesmen kompetensi minimum','DEMO01','SMA','draft',0,$2)
		RETURNING id`, tenantID, guruID).Scan(&setID)
	if err != nil {
		panic(err)
	}
	soal := []struct {
		tipe    string
		body    string
		options string
		key     string
		points  string
		mode    string
	}{
		{"mcq", "<p>Ibu kota Provinsi Jawa Barat adalah ...</p>",
			`[{"id":"A","text":"Bandung"},{"id":"B","text":"Semarang"},{"id":"C","text":"Surabaya"},{"id":"D","text":"Serang"}]`,
			`{"correct":"A"}`, "2", "all_or_nothing"},
		{"mcq_complex", "<p>Pilih semua bilangan prima berikut:</p>",
			`[{"id":"A","text":"2"},{"id":"B","text":"4"},{"id":"C","text":"5"},{"id":"D","text":"9"},{"id":"E","text":"11"}]`,
			`{"correct":["A","C","E"]}`, "3", "partial"},
		{"matching", "<p>Pasangkan negara dengan ibu kotanya:</p>",
			`{"left":["Indonesia","Jepang","Mesir"],"right":["Kairo","Jakarta","Tokyo"]}`,
			`{"pairs":[{"left":"Indonesia","right":"Jakarta"},{"left":"Jepang","right":"Tokyo"},{"left":"Mesir","right":"Kairo"}]}`,
			"4", "partial"},
		{"short_answer", "<p>Hasil dari 7 + 8 = ...</p>",
			`[]`, `{"answers":["15","15.0"]}`, "2", "all_or_nothing"},
		{"essay", "<p>Jelaskan langkah-langkah menghitung luas persegi panjang dengan panjang 12 cm dan lebar 7 cm!</p>",
			`[]`, `{"rubric":"p = 12, l = 7 (1 pt); rumus p×l (2 pt); hasil 84 cm² (2 pt)"}`, "5", "all_or_nothing"},
		{"mcq", "<p>Nilai dari 25% × 80 adalah ...</p>",
			`[{"id":"A","text":"15"},{"id":"B","text":"20"},{"id":"C","text":"25"},{"id":"D","text":"30"}]`,
			`{"correct":"B"}`, "2", "all_or_nothing"},
		{"short_answer", "<p>Median dari data: 3, 7, 5, 9, 11 adalah ...</p>",
			`[]`, `{"answers":["7"]}`, "2", "all_or_nothing"},
	}
	for i, q := range soal {
		_, err = tx.Exec(ctx, `
			INSERT INTO questions(tenant_id, question_set_id, order_no, type, body, options, answer_key, points, scoring_mode)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			tenantID, setID, i+1, q.tipe, q.body, q.options, q.key, q.points, q.mode)
		if err != nil {
			panic(err)
		}
	}

	// publish versi 1
	var versionID string
	err = tx.QueryRow(ctx, `
		INSERT INTO question_set_versions(question_set_id, tenant_id, version, created_by)
		SELECT id, tenant_id, 1, $2 FROM question_sets WHERE id=$1
		RETURNING id`, setID, guruID).Scan(&versionID)
	if err != nil {
		panic(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO questions(tenant_id, question_set_id, set_version_id, order_no, type, body, options, answer_key, points, scoring_mode)
		SELECT tenant_id, question_set_id, $2::uuid, order_no, type, body, options, answer_key, points, scoring_mode
		FROM questions WHERE question_set_id=$1::uuid AND set_version_id IS NULL`, setID, versionID); err != nil {
		panic(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE question_sets SET status='published', current_version=1 WHERE id=$1`, setID); err != nil {
		panic(err)
	}

	// ujian aktif: buka sekarang
	// (kolom opsional yang mungkin ditambahkan modul lain — pastikan ada, idempoten)
	if _, err := tx.Exec(ctx, `ALTER TABLE exams ADD COLUMN IF NOT EXISTS score_released BOOLEAN NOT NULL DEFAULT true`); err != nil {
		panic(err)
	}
	if _, err := tx.Exec(ctx, `ALTER TABLE attempts ADD COLUMN IF NOT EXISTS package_json JSONB NOT NULL DEFAULT '{}'::jsonb`); err != nil {
		panic(err)
	}
	token, _ := auth.RandomToken(3)
	token = "DEMO"[:0] + upper(token)
	var examID string
	err = tx.QueryRow(ctx, `
		INSERT INTO exams(tenant_id, question_set_id, question_set_version_id, name, subject_name, exam_code, token,
			open_at, close_at, duration_minutes, max_attempts, show_score_immediately, anti_cheat, status, score_released)
		VALUES ($1,$2,$3,'Tryout Numerasi #1','Matematika','DEMO01',$4,
			now(), now() + interval '4 hours', 45, 1, true,
			'{"enabled":true,"tolerance_seconds":3,"penalty_points":5,"max_penalty":30,"flag_threshold":3,"auto_submit":false,"camera_enabled":false}'::jsonb,
			'published', true)
		RETURNING id`, tenantID, setID, versionID, token).Scan(&examID)
	if err != nil {
		panic(err)
	}
	// assignment: semua kelas demo
	for _, cid := range classIDs {
		_, err = tx.Exec(ctx, `INSERT INTO exam_assignments(tenant_id, exam_id, target_type, class_id) VALUES ($1,$2,'class',$3)`, tenantID, examID, cid)
		if err != nil {
			panic(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		panic(err)
	}
	fmt.Printf(`DEMO SIAP:
  Tenant : SMA Demo CBT (%s)
  Guru   : guru@demo.cbt / Guru#12345
  Siswa  : siswaXXXX / Siswa#123 (contoh lihat DB) 
  Ujian  : Kode DEMO01, Token %s (buka 4 jam)
`, tenantID, token)
}

func randCode(r *rand.Rand) string {
	const letters = "abcdefghjkmnpqrstuvwxyz23456789"
	b := make([]byte, 6)
	for i := range b {
		b[i] = letters[r.Intn(len(letters))]
	}
	return string(b)
}

func upper(s string) string {
	out := []rune(s)
	for i, c := range out {
		if c >= 'a' && c <= 'z' {
			out[i] = c - 32
		}
	}
	return string(out)
}

var _ = time.Now
