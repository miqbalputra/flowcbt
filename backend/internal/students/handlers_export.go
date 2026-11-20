package students

import (
	"bytes"
	"encoding/csv"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
	"github.com/xuri/excelize/v2"
)

// ---------- Export siswa (FR-3.4) ----------

var exportHeaders = []string{"Nama", "Jenis Kelamin", "Kelas", "NIS", "Username", "Email", "HP Wali", "Status"}

// GET /students/export?class_id=&q=&guest=&format=xlsx|csv
func (m *Module) exportStudents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	q := r.URL.Query()

	classID := strings.TrimSpace(q.Get("class_id"))
	if classID != "" && !isUUID(classID) {
		httpx.Error(w, httpx.NewErr(400, "VALIDATION", "class_id tidak valid"))
		return
	}
	format := strings.ToLower(strings.TrimSpace(q.Get("format")))
	if format == "" {
		format = "xlsx"
	}
	if format != "xlsx" && format != "csv" {
		httpx.Error(w, httpx.NewErr(400, "VALIDATION", "format harus xlsx atau csv"))
		return
	}

	where := " WHERE s.merged_into_id IS NULL"
	args := []any{}
	switch guestParam := strings.TrimSpace(q.Get("guest")); guestParam {
	case "true", "1":
		args = append(args, true)
		where += " AND s.is_guest = $" + itoa(len(args))
	case "all":
		// tanpa filter tamu
	default:
		args = append(args, false)
		where += " AND s.is_guest = $" + itoa(len(args))
	}
	if classID != "" {
		args = append(args, classID)
		where += " AND s.class_id = $" + itoa(len(args))
	}
	if search := strings.TrimSpace(q.Get("q")); search != "" {
		args = append(args, "%"+search+"%")
		n := len(args)
		where += " AND (s.name ILIKE $" + itoa(n) + " OR s.nis ILIKE $" + itoa(n) +
			" OR s.student_code ILIKE $" + itoa(n) + " OR s.username ILIKE $" + itoa(n) + ")"
	}

	data := [][]string{}
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT s.name, s.gender, COALESCE(c.name,''), COALESCE(s.nis,''), COALESCE(s.username,''),
			  COALESCE(s.email,''), COALESCE(s.parent_phone,''), s.status
			FROM students s LEFT JOIN classes c ON c.id = s.class_id`+where+`
			ORDER BY c.name NULLS LAST, s.name, s.id`, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var name, gender, className, nis, username, email, phone, status string
			if err := rows.Scan(&name, &gender, &className, &nis, &username, &email, &phone, &status); err != nil {
				return err
			}
			data = append(data, []string{name, gender, className, nis, username, email, phone, status})
		}
		return rows.Err()
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}

	stamp := time.Now().Format("20060102")
	filename := "siswa_" + stamp + "." + format
	if format == "csv" {
		body, err := csvBytes(exportHeaders, data)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
		return
	}

	f := excelize.NewFile()
	defer f.Close()
	const sheet = "Siswa"
	_ = f.SetSheetName("Sheet1", sheet)
	for i, h := range exportHeaders {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellValue(sheet, cell, h)
	}
	for rIdx, row := range data {
		for cIdx, v := range row {
			cell, _ := excelize.CoordinatesToCellName(cIdx+1, rIdx+2)
			_ = f.SetCellValue(sheet, cell, v)
		}
	}
	_ = f.SetColWidth(sheet, "A", "H", 22)
	buf, err := f.WriteToBuffer()
	if err != nil {
		httpx.Error(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}

// csvBytes: CSV + BOM, delimiter titik-koma agar langsung rapi di Excel locale ID.
func csvBytes(header []string, rows [][]string) ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteString("\xEF\xBB\xBF")
	w := csv.NewWriter(&buf)
	w.Comma = ';'
	if err := w.Write(header); err != nil {
		return nil, err
	}
	for _, row := range rows {
		if err := w.Write(row); err != nil {
			return nil, err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
