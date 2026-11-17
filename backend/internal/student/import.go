package student

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/platform"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/xuri/excelize/v2"
)

// Template kolom import siswa (PRD 18.1): Nama, Jenis Kelamin, Kelas, NIS (opsional).
var importHeaders = []string{"Nama", "Jenis Kelamin", "Kelas", "NIS"}

type importError struct {
	Row    int    `json:"row"`
	Reason string `json:"reason"`
}

type importRow struct {
	Name   string
	Gender string
	Class  string
	NIS    string
}

// C-12: ekspos parser produksi agar integration test tidak memakai re-implementasi.
type ImportRow = importRow
type ImportError = importError

func ParseImport(r io.Reader, filename string) ([]ImportRow, []ImportError) {
	return parseImport(r, filename)
}

func (s *Service) importTemplate(w http.ResponseWriter, r *http.Request) {
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	for i, h := range importHeaders {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue(sheet, cell, h)
	}
	examples := [][]string{
		{"Ahmad Fauzi", "L", "X IPA 1", "12345"},
		{"Siti Aisyah", "P", "X IPA 1", "12346"},
	}
	for ri, row := range examples {
		for ci, v := range row {
			cell, _ := excelize.CoordinatesToCellName(ci+1, ri+2)
			f.SetCellValue(sheet, cell, v)
		}
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="template-import-siswa.xlsx"`)
	if err := f.Write(w); err != nil {
		httpx.WriteError(w, err)
	}
}

// parseImport membaca xlsx/CSV dari body multipart atau raw, mengembalikan baris valid + error per baris (AC-10).
func parseImport(r io.Reader, filename string) ([]importRow, []importError) {
	var rows []importRow
	var errs []importError
	if strings.HasSuffix(strings.ToLower(filename), ".csv") {
		data, _ := io.ReadAll(r)
		lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
		start := 0
		if len(lines) > 0 && strings.Contains(lines[0], "Nama") {
			start = 1
		}
		for i := start; i < len(lines); i++ {
			line := strings.TrimSpace(lines[i])
			if line == "" {
				continue
			}
			parts := strings.Split(line, ",")
			rowNo := i + 1
			row, errMsg := validateRow(rowNo, parts)
			if errMsg != "" {
				errs = append(errs, importError{Row: rowNo, Reason: errMsg})
				continue
			}
			rows = append(rows, row)
		}
		return rows, errs
	}
	f, err := excelize.OpenReader(r)
	if err != nil {
		return nil, []importError{{Row: 0, Reason: "file bukan .xlsx/.csv yang valid: " + err.Error()}}
	}
	sheet := f.GetSheetName(0)
	all, err := f.GetRows(sheet)
	if err != nil {
		return nil, []importError{{Row: 0, Reason: err.Error()}}
	}
	for i, line := range all {
		rowNo := i + 1
		if rowNo == 1 {
			continue // header
		}
		row, errMsg := validateRow(rowNo, line)
		if errMsg != "" {
			errs = append(errs, importError{Row: rowNo, Reason: errMsg})
			continue
		}
		rows = append(rows, row)
	}
	return rows, errs
}

func validateRow(rowNo int, cols []string) (importRow, string) {
	get := func(i int) string {
		if i < len(cols) {
			return strings.TrimSpace(cols[i])
		}
		return ""
	}
	name, gender, className, nis := get(0), strings.ToUpper(get(1)), get(2), get(3)
	if name == "" {
		return importRow{}, "Nama kosong"
	}
	if gender != "L" && gender != "P" {
		return importRow{}, "Jenis Kelamin harus L atau P (diterima: " + get(1) + ")"
	}
	if className == "" {
		return importRow{}, "Kelas kosong"
	}
	return importRow{Name: name, Gender: gender, Class: className, NIS: nis}, ""
}

// importPreview: upload -> preview & validasi (AC-10). hasil disimpan sebagai file_job (awaiting_commit).
func (s *Service) importPreview(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	actor := httpx.ActorIDFrom(r.Context())
	mr, err := r.MultipartReader()
	if err != nil {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "unggah file .xlsx/.csv via multipart 'file'"))
		return
	}
	part, err := mr.NextPart()
	if err != nil {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "file tidak ditemukan"))
		return
	}
	rows, errs := parseImport(part, part.FileName())
	if len(rows) == 0 && len(errs) > 0 && errs[0].Row == 0 {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, errs[0].Reason))
		return
	}
	// simpan payload preview ke file_jobs (summary) agar commit bisa menggunakannya
	summary := map[string]any{"valid": len(rows), "errors": errs, "rows": rows}
	var jobID string
	err = s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(),
			`INSERT INTO file_jobs (tenant_id, kind, status, summary, created_by, expires_at)
			 VALUES ($1,'student_import','awaiting_commit',$2,$3, now() + interval '24 hours') RETURNING id`,
			tid, summary, actor).Scan(&jobID)
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"job_id": jobID, "valid": len(rows), "invalid": len(errs), "errors": errs,
	})
}

// importCommit: simpan baris valid; buat kelas otomatis bila belum ada; cek batas tier (FR-3.3b).
func (s *Service) importCommit(w http.ResponseWriter, r *http.Request) {
	var in struct {
		JobID string `json:"job_id"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	actor := httpx.ActorIDFrom(r.Context())
	type rowT struct {
		Name, Gender, Class, NIS string
	}
	var rows []rowT
	var jobID, summaryJSON string
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(),
			`SELECT id, summary::text FROM file_jobs WHERE tenant_id=$1 AND id=$2 AND kind='student_import' AND status='awaiting_commit'`,
			tid, in.JobID).Scan(&jobID, &summaryJSON)
	})
	if err != nil {
		httpx.WriteError(w, httpx.NotFound("sesi import tidak ditemukan/kedaluwarsa"))
		return
	}
	if err := jsonUnmarshal([]byte(summaryJSON), &struct {
		Rows *[]rowT `json:"rows"`
	}{&rows}); err != nil {
		httpx.WriteError(w, err)
		return
	}
	created := 0
	var firstCreds []map[string]string
	err = s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		if err := s.checkLimit(r.Context(), tx, tid, len(rows)); err != nil {
			return err
		}
		classCache := map[string]string{}
		for _, row := range rows {
			cid, ok := classCache[row.Class]
			if !ok {
				if err := tx.QueryRow(r.Context(),
					`SELECT id FROM classes WHERE tenant_id=$1 AND name=$2 AND archived_at IS NULL`, tid, row.Class).Scan(&cid); err != nil {
					// buat kelas otomatis (opsi FR-3.3)
					year := fmt.Sprintf("%d/%d", time.Now().Year(), time.Now().Year()+1)
					if err := tx.QueryRow(r.Context(),
						`INSERT INTO classes (tenant_id, name, academic_year) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
						tid, row.Class, year).Scan(&cid); err != nil {
						return err
					}
				}
				classCache[row.Class] = cid
			}
			username := strings.ToLower(strings.ReplaceAll(platform.NormalizeName(row.Name), " ", ".")) + "." + strings.ToLower(platform.RandomToken(3))
			rawPass := platform.RandomToken(8)
			pwHash, err := hashPw(rawPass)
			if err != nil {
				return err
			}
			var sid string
			var nis any
			if row.NIS != "" {
				nis = row.NIS
			}
			err = tx.QueryRow(r.Context(),
				`INSERT INTO students (tenant_id, student_code, nis, name, name_normalized, gender, class_id, username, password_hash)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
				 ON CONFLICT (tenant_id, nis) WHERE nis IS NOT NULL AND NOT is_guest DO NOTHING
				 RETURNING id`,
				tid, platform.StudentCode(), nis, row.Name, platform.NormalizeName(row.Name), row.Gender, cid, username, pwHash).Scan(&sid)
			if err != nil {
				continue // duplikat NIS dilewati
			}
			created++
			if len(firstCreds) < 5 {
				firstCreds = append(firstCreds, map[string]string{"name": row.Name, "username": username, "password": rawPass})
			}
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "student.import_commit", "file_job", jobID, map[string]any{"created": created}, "")
		if _, err := tx.Exec(r.Context(), `UPDATE file_jobs SET status='done', finished_at=now(), summary = jsonb_set(summary,'{created}',$1) WHERE id=$2`, created, jobID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"created": created, "sample_credentials": firstCreds})
}

// export: daftar siswa ke .xlsx atau .csv (filter kelas) — FR-3.4.
func (s *Service) export(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	classID := r.URL.Query().Get("class_id")
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "xlsx"
	}
	var rows [][]string
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		query := `SELECT s.name, s.gender, COALESCE(c.name,''), COALESCE(s.nis,''), COALESCE(s.username,'')
		          FROM students s LEFT JOIN classes c ON c.id=s.class_id
		          WHERE s.tenant_id=$1 AND s.merged_into_id IS NULL AND s.is_guest=false`
		args := []any{tid}
		if classID != "" {
			query += ` AND s.class_id=$2`
			args = append(args, classID)
		}
		query += ` ORDER BY c.name NULLS LAST, s.name`
		rws, err := tx.Query(r.Context(), query, args...)
		if err != nil {
			return err
		}
		defer rws.Close()
		rows = append(rows, []string{"Nama", "Jenis Kelamin", "Kelas", "NIS", "Username"})
		for rws.Next() {
			var name, gender, class, nis, username string
			if err := rws.Scan(&name, &gender, &class, &nis, &username); err != nil {
				return err
			}
			rows = append(rows, []string{name, gender, class, nis, username})
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if format == "csv" {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="daftar-siswa.csv"`)
		for _, row := range rows {
			w.Write([]byte(strings.Join(csvEscape(row), ",") + "\n"))
		}
		return
	}
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	for ri, row := range rows {
		for ci, v := range row {
			cell, _ := excelize.CoordinatesToCellName(ci+1, ri+1)
			f.SetCellValue(sheet, cell, v)
		}
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="daftar-siswa.xlsx"`)
	_ = f.Write(w)
}

func csvEscape(row []string) []string {
	out := make([]string, len(row))
	for i, v := range row {
		if strings.ContainsAny(v, ",\"\n") {
			out[i] = "\"" + strings.ReplaceAll(v, "\"", "\"\"") + "\""
		} else {
			out[i] = v
		}
	}
	return out
}

func jsonUnmarshal(b []byte, v any) error { return jsonUnmarshalImpl(b, v) }
