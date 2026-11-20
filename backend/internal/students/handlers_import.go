package students

import (
	"bytes"
	"context"
	"encoding/csv"
	"io"
	"net/http"
	"strings"

	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
	"github.com/xuri/excelize/v2"
)

// ---------- Import siswa (FR-3.3, FR-3.3b) ----------

const importMaxRows = 1000

var importHeaders = []string{"Nama", "Jenis Kelamin", "Kelas", "NIS"}

// GET /students/import/template — template .xlsx dengan 2 baris contoh.
func (m *Module) importTemplate(w http.ResponseWriter, r *http.Request) {
	f := excelize.NewFile()
	defer f.Close()
	const sheet = "Siswa"
	_ = f.SetSheetName("Sheet1", sheet)
	for i, h := range importHeaders {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellValue(sheet, cell, h)
	}
	samples := [][]string{
		{"Budi Santoso", "L", "X IPA 1", "2024001"},
		{"Siti Aminah", "P", "X IPA 2", "2024002"},
	}
	for rIdx, row := range samples {
		for cIdx, v := range row {
			cell, _ := excelize.CoordinatesToCellName(cIdx+1, rIdx+2)
			_ = f.SetCellValue(sheet, cell, v)
		}
	}
	_ = f.SetColWidth(sheet, "A", "D", 22)

	buf, err := f.WriteToBuffer()
	if err != nil {
		httpx.Error(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="template_import_siswa.xlsx"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}

type importRowOut struct {
	Line      int      `json:"line"`
	Name      string   `json:"name"`
	Gender    string   `json:"gender"`
	ClassName string   `json:"class_name"`
	NIS       string   `json:"nis"`
	OK        bool     `json:"ok"`
	Errors    []string `json:"errors"`
}

// POST /students/import/preview (multipart "file") — parse xlsx/csv & validasi baris.
func (m *Module) importPreview(w http.ResponseWriter, r *http.Request) {
	rows, err := readImportFile(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	parsed := parseImportRows(rows)
	valid, invalid := 0, 0
	for _, row := range parsed {
		if row.OK {
			valid++
		} else {
			invalid++
		}
	}
	httpx.OK(w, map[string]any{"data": map[string]any{
		"rows": parsed, "valid_count": valid, "error_count": invalid,
	}})
}

type importCommitRow struct {
	Name      string `json:"name"`
	Gender    string `json:"gender"`
	ClassName string `json:"class_name"`
	NIS       string `json:"nis"`
}

type importCommitReq struct {
	Rows []importCommitRow `json:"rows"`
}

type loginCard struct {
	Name         string `json:"name"`
	ClassName    string `json:"class_name"`
	Username     string `json:"username"`
	TempPassword string `json:"temp_password"`
}

// POST /students/import/commit — baris valid saja: auto-buat kelas, cek kuota total,
// buat siswa + kartu login (username & password awal plaintext, sekali).
func (m *Module) importCommit(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	actorID := ctxinfo.UserID(ctx)
	var req importCommitReq
	if err := m.validateReq(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	if len(req.Rows) > importMaxRows {
		httpx.Error(w, httpx.NewErr(400, "VALIDATION", "Maksimal "+itoa(importMaxRows)+" baris per import"))
		return
	}

	// Kuota & status sewa (pool admin via billing).
	q, err := m.billing.Quota(ctx, tenantID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if q.ReadOnly {
		httpx.Error(w, httpx.NewErr(403, "READ_ONLY", "Sekolah sedang dalam mode baca-saja"))
		return
	}

	var (
		created    int
		skipped    int
		loginCards []loginCard
	)
	err = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		// Hitung ulang di dalam transaksi (konsisten dengan RLS tenant).
		var current int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(1) FROM students
			WHERE status='active' AND is_guest=false AND merged_into_id IS NULL`).Scan(&current); err != nil {
			return err
		}
		remaining := q.MaxStudents - current

		// Validasi ulang di server; baris tidak valid dihitung "skipped".
		valid := make([]importCommitRow, 0, len(req.Rows))
		dc := newDupChecker()
		for _, row := range req.Rows {
			name := strings.TrimSpace(row.Name)
			gender, okGender := normalizeGender(row.Gender)
			className := strings.TrimSpace(row.ClassName)
			nis := strings.TrimSpace(row.NIS)
			if len([]rune(name)) < 3 || !okGender || className == "" {
				skipped++
				continue
			}
			if _, dup := dc.check(name, className, nis); dup {
				skipped++
				continue
			}
			valid = append(valid, importCommitRow{Name: name, Gender: gender, ClassName: className, NIS: nis})
		}
		if len(valid) > remaining {
			return quotaExceededErr(remaining, len(valid))
		}

		// Pastikan kelas tersedia (buat otomatis bila belum ada).
		classIDs := map[string]string{} // lower(name) -> id
		for _, row := range valid {
			key := lowerKey(row.ClassName)
			if _, ok := classIDs[key]; ok {
				continue
			}
			id, err := ensureClassTx(ctx, tx, tenantID, row.ClassName)
			if err != nil {
				return err
			}
			classIDs[key] = id
		}

		// Duplikat yang sudah ada di database -> dilewati (skipped).
		type target struct {
			row   importCommitRow
			class string
		}
		targets := make([]target, 0, len(valid))
		for _, row := range valid {
			classID := classIDs[lowerKey(row.ClassName)]
			var dup bool
			var err error
			if row.NIS != "" {
				err = tx.QueryRow(ctx, `
					SELECT EXISTS(SELECT 1 FROM students
						WHERE nis=$1 AND status='active' AND is_guest=false AND merged_into_id IS NULL)`,
					row.NIS).Scan(&dup)
			} else {
				err = tx.QueryRow(ctx, `
					SELECT EXISTS(SELECT 1 FROM students
						WHERE lower(trim(name))=lower(trim($1)) AND class_id=$2
						  AND status='active' AND is_guest=false AND merged_into_id IS NULL)`,
					row.Name, classID).Scan(&dup)
			}
			if err != nil {
				return err
			}
			if dup {
				skipped++
				continue
			}
			targets = append(targets, target{row: row, class: classID})
		}

		for _, t := range targets {
			card, err := insertImportStudentSafe(ctx, tx, tenantID, t.row, t.class)
			if err != nil {
				return err
			}
			created++
			loginCards = append(loginCards, *card)
		}
		return auditTx(ctx, tx, tenantID, actorID, "student.import", "student", "",
			map[string]any{"created": created, "skipped": skipped})
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if loginCards == nil {
		loginCards = []loginCard{}
	}
	httpx.OK(w, map[string]any{"data": map[string]any{
		"created": created, "skipped": skipped, "login_cards": loginCards,
	}})
}

// insertImportStudentSafe: siswa hasil import; savepoint menangani bentrok
// indeks unik global (kode/username lintas tenant) dengan regenerasi.
func insertImportStudentSafe(ctx context.Context, tx pgx.Tx, tenantID string, row importCommitRow, classID string) (*loginCard, error) {
	for attempt := 0; attempt < 3; attempt++ {
		sp := "sp_imp_" + itoa(attempt)
		if _, err := tx.Exec(ctx, "SAVEPOINT "+sp); err != nil {
			return nil, err
		}
		card, err := insertImportStudent(ctx, tx, tenantID, row, classID)
		if err == nil {
			if _, err := tx.Exec(ctx, "RELEASE SAVEPOINT "+sp); err != nil {
				return nil, err
			}
			return card, nil
		}
		if isUniqueViolation(err) {
			if _, rbErr := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT "+sp); rbErr != nil {
				return nil, rbErr
			}
			continue // coba kode/username baru
		}
		return nil, err
	}
	return nil, httpx.NewErr(409, "CONFLICT", "Gagal menghasilkan kode/username unik, coba lagi")
}

// insertImportStudent: satu siswa hasil import (+ baris awal riwayat kelas).
func insertImportStudent(ctx context.Context, tx pgx.Tx, tenantID string, row importCommitRow, classID string) (*loginCard, error) {
	suf, err := randomFrom(codeAlphabet, 6)
	if err != nil {
		return nil, err
	}
	code := "S-" + suf
	base := slugName(row.Name)
	if base == "" {
		base = "siswa"
	}
	if len(base) > 30 {
		base = base[:30]
	}
	sufU, err := randomFrom("abcdefghjkmnpqrstuvwxyz23456789", 3)
	if err != nil {
		return nil, err
	}
	username := base + sufU
	tempPwd, err := randomPassword()
	if err != nil {
		return nil, err
	}
	hash, err := auth.HashPassword(tempPwd)
	if err != nil {
		return nil, err
	}
	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO students(tenant_id, student_code, nis, name, gender, class_id, username, password_hash)
		VALUES ($1,$2,NULLIF($3,''),$4,$5,NULLIF($6,'')::uuid,$7,$8)
		RETURNING id::text`, tenantID, code, row.NIS, row.Name, row.Gender, classID, username, hash).Scan(&id); err != nil {
		return nil, err
	}
	if classID != "" {
		if _, err := tx.Exec(ctx,
			`INSERT INTO student_class_history(tenant_id, student_id, class_id) VALUES ($1,$2,$3)`,
			tenantID, id, classID); err != nil {
			return nil, err
		}
	}
	return &loginCard{Name: row.Name, ClassName: row.ClassName, Username: username, TempPassword: tempPwd}, nil
}

// ensureClassTx: ambil kelas by nama (yang tidak diarsip diprioritaskan) atau buat baru.
func ensureClassTx(ctx context.Context, tx pgx.Tx, tenantID, name string) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
		SELECT id::text FROM classes WHERE lower(name)=lower($1)
		ORDER BY archived ASC, created_at DESC LIMIT 1`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != pgx.ErrNoRows {
		return "", err
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO classes(tenant_id, name) VALUES ($1,$2)
		ON CONFLICT DO NOTHING
		RETURNING id::text`, tenantID, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != pgx.ErrNoRows {
		return "", err
	}
	// Kalah race dengan operasi lain -> ambil yang sudah ada.
	err = tx.QueryRow(ctx, `
		SELECT id::text FROM classes WHERE lower(name)=lower($1)
		ORDER BY archived ASC, created_at DESC LIMIT 1`, name).Scan(&id)
	return id, err
}

// ---------- Util baca berkas ----------

// readImportFile: baca multipart "file" (xlsx atau csv) menjadi baris-baris mentah.
func readImportFile(r *http.Request) ([][]string, error) {
	file, header, err := r.FormFile("file")
	if err != nil {
		return nil, httpx.NewErr(400, "VALIDATION", "Berkas 'file' wajib diunggah")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 10<<20))
	if err != nil {
		return nil, httpx.NewErr(400, "BAD_REQUEST", "Gagal membaca berkas")
	}
	name := strings.ToLower(header.Filename)
	switch {
	case strings.HasSuffix(name, ".csv"):
		return parseCSVRows(data)
	case strings.HasSuffix(name, ".xlsx") || isZip(data):
		return parseXLSXRows(data)
	default:
		return parseCSVRows(data)
	}
}

func isZip(b []byte) bool {
	return len(b) > 4 && b[0] == 'P' && b[1] == 'K' && (b[2] == 3 || b[2] == 5 || b[2] == 7)
}

func parseXLSXRows(data []byte) ([][]string, error) {
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, httpx.NewErr(400, "VALIDATION", "Berkas Excel tidak dapat dibaca")
	}
	defer f.Close()
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, httpx.NewErr(400, "VALIDATION", "Berkas Excel tidak memiliki sheet")
	}
	rows, err := f.GetRows(sheets[0])
	if err != nil {
		return nil, httpx.NewErr(400, "VALIDATION", "Berkas Excel tidak dapat dibaca")
	}
	if len(rows) > importMaxRows+1 {
		return nil, httpx.NewErr(400, "VALIDATION", "Maksimal "+itoa(importMaxRows)+" baris per import")
	}
	return rows, nil
}

func parseCSVRows(data []byte) ([][]string, error) {
	data = trimBOM(data)
	// Deteksi delimiter pada baris pertama: titik-koma (Excel locale ID) atau koma.
	head := data
	if i := indexByte(head, '\n'); i >= 0 {
		head = head[:i]
	}
	sep := ','
	if countByte(head, ';') > countByte(head, ',') {
		sep = ';'
	}
	r := csv.NewReader(bytes.NewReader(data))
	r.Comma = sep
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	rows, err := r.ReadAll()
	if err != nil {
		return nil, httpx.NewErr(400, "VALIDATION", "Berkas CSV tidak dapat dibaca")
	}
	if len(rows) > importMaxRows+1 {
		return nil, httpx.NewErr(400, "VALIDATION", "Maksimal "+itoa(importMaxRows)+" baris per import")
	}
	return rows, nil
}

func trimBOM(b []byte) []byte {
	if len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		return b[3:]
	}
	return b
}

func indexByte(b []byte, c byte) int {
	for i := range b {
		if b[i] == c {
			return i
		}
	}
	return -1
}

func countByte(b []byte, c byte) int {
	n := 0
	for _, v := range b {
		if v == c {
			n++
		}
	}
	return n
}

func lowerKey(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// dupChecker: deteksi duplikat dalam satu batch impor.
// Dua baris dianggap duplikat bila NIS sama (dua-duanya terisi), atau
// nama+kelas sama ketika salah satu NIS kosong.
type dupChecker struct {
	nis map[string]bool
	nc  map[string]string // "nama|kelas" -> NIS baris pertama ("" bila tanpa NIS)
}

func newDupChecker() *dupChecker {
	return &dupChecker{nis: map[string]bool{}, nc: map[string]string{}}
}

func (d *dupChecker) check(name, className, nis string) (string, bool) {
	key := lowerKey(name) + "|" + lowerKey(className)
	if nis != "" {
		if d.nis[nis] {
			return "NIS duplikat dalam berkas", true
		}
		if prev, ok := d.nc[key]; ok && prev == "" {
			return "Duplikat nama+kelas dalam berkas", true
		}
		d.nis[nis] = true
		if _, ok := d.nc[key]; !ok {
			d.nc[key] = nis
		}
		return "", false
	}
	if _, ok := d.nc[key]; ok {
		return "Duplikat nama+kelas dalam berkas", true
	}
	d.nc[key] = ""
	return "", false
}

// parseImportRows: deteksi header, validasi tiap baris, deteksi duplikat dalam berkas.
func parseImportRows(rows [][]string) []importRowOut {
	// Default: urutan kolom template (Nama;Jenis Kelamin;Kelas;NIS), tanpa header.
	colName, colGender, colClass, colNIS := 0, 1, 2, 3
	start := 0
	if len(rows) > 0 {
		hits, cn, cg, cc, cnis := 0, -1, -1, -1, -1
		for i, c := range rows[0] {
			cl := lowerKey(c)
			switch {
			case cn < 0 && cl != "" && strings.Contains(cl, "nama"):
				cn, hits = i, hits+1
			case cg < 0 && (strings.Contains(cl, "kelamin") || cl == "jk"):
				cg, hits = i, hits+1
			case cc < 0 && (strings.Contains(cl, "kelas") || strings.Contains(cl, "class")):
				cc, hits = i, hits+1
			case cnis < 0 && strings.Contains(cl, "nis"):
				cnis, hits = i, hits+1
			}
		}
		if hits >= 2 && cn >= 0 {
			// Header terdeteksi: pakai kolom yang ditemukan (fallback posisi standar).
			colName, colGender, colClass, colNIS = cn, cg, cc, cnis
			if colGender < 0 {
				colGender = 1
			}
			if colClass < 0 {
				colClass = 2
			}
			if colNIS < 0 {
				colNIS = 3
			}
			start = 1
		}
	}

	out := []importRowOut{}
	dc := newDupChecker()
	for i := start; i < len(rows); i++ {
		row := rows[i]
		cell := func(idx int) string {
			if idx >= 0 && idx < len(row) {
				return strings.TrimSpace(row[idx])
			}
			return ""
		}
		name := cell(colName)
		genderRaw := cell(colGender)
		className := cell(colClass)
		nis := cell(colNIS)
		if name == "" && genderRaw == "" && className == "" && nis == "" {
			continue
		}
		errs := []string{}
		if len([]rune(name)) < 3 {
			errs = append(errs, "Nama minimal 3 karakter")
		}
		gender := genderRaw
		if g, ok := normalizeGender(genderRaw); ok {
			gender = g
		} else {
			errs = append(errs, "Jenis kelamin harus L atau P")
		}
		if className == "" {
			errs = append(errs, "Kelas tidak boleh kosong")
		}
		if className != "" && len([]rune(name)) >= 3 {
			if reason, dup := dc.check(name, className, nis); dup {
				errs = append(errs, reason)
			}
		}
		out = append(out, importRowOut{
			Line: i + 1, Name: name, Gender: gender, ClassName: className, NIS: nis,
			OK: len(errs) == 0, Errors: errs,
		})
	}
	return out
}
