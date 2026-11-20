package reports

import (
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
	"github.com/xuri/excelize/v2"
)

// exportHeaders sesuai PRD FR-3.6: nilai asli (sementara), penalti, dan nilai
// akhir ditampilkan terpisah (AC-8).
var exportHeaders = []string{"No", "Nama", "Kelas", "Percobaan ke-", "Mulai", "Selesai",
	"Durasi (m:ss)", "Nilai (Sementara)", "Penalti", "Nilai Akhir", "Status", "Kecurangan"}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slug(s string) string {
	return strings.Trim(slugRe.ReplaceAllString(strings.ToLower(s), "-"), "-")
}

func fmtNum(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// durStr memformat detik → "m:ss" (menit tak dibatasi 59).
func durStr(sec int64) string {
	if sec < 0 {
		sec = 0
	}
	return fmt.Sprintf("%d:%02d", sec/60, sec%60)
}

func fmtTime(t *time.Time) string {
	if t == nil {
		return "-"
	}
	return t.Format("02/01/2006 15:04")
}

func contentDisposition(w http.ResponseWriter, filename string) {
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, filename, url.QueryEscape(filename)))
}

// exportRekap — GET /reports/exams/{id}/export?format=xlsx|csv (FR-3.6, FR-9.11)
// File biner rekap nilai seluruh siswa (termasuk yang belum mulai).
func (m *Module) exportRekap(w http.ResponseWriter, r *http.Request) {
	examID, err := urlUUID(r, "examId")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format == "" {
		format = "xlsx"
	}
	if format != "xlsx" && format != "csv" && format != "pdf" {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Parameter format tidak valid (xlsx|csv|pdf)"))
		return
	}
	tenantID, err := tenantOf(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}

	var code, title string
	rows := [][]string{}
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `SELECT exam_code, name FROM exams WHERE id=$1`, examID).
			Scan(&code, &title); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Ujian tidak ditemukan")
			}
			return err
		}
		rs, err := tx.Query(r.Context(), examStudentsSQL, examID, nil)
		if err != nil {
			return err
		}
		i := 0
		return scanAttemptRows(rs, func(a attemptRow) {
			i++
			cheat := "-"
			if a.CheatingStatus != "" && a.CheatingStatus != "none" {
				cheat = strings.ReplaceAll(a.CheatingStatus, "_", " ")
			}
			rows = append(rows, []string{
				strconv.Itoa(i), a.Name, a.Class, strconv.Itoa(a.AttemptNo),
				fmtTime(a.StartedAt), fmtTime(a.SubmittedAt), durStr(a.DurationSeconds),
				numVal(a.Score), numVal(a.PenaltyPoints), numVal(a.FinalScore),
				a.Status, cheat,
			})
		})
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}

	filename := fmt.Sprintf("rekap-%s-%s.%s", slug(code), slug(title), format)
	switch format {
	case "csv":
		writeCSV(w, filename, exportHeaders, rows)
	case "pdf":
		m.pdfRekap(w, filename, code, title, rows)
	default:
		writeXLSX(w, filename, exportHeaders, rows)
	}
}

// numVal: nilai numerik → teks; NULL (belum dinilai) → "-".
func numVal(p *float64) string {
	if p == nil {
		return "-"
	}
	return fmtNum(*p)
}

// ---- xlsx (excelize) ----

func writeXLSX(w http.ResponseWriter, filename string, header []string, data [][]string) {
	f := excelize.NewFile()
	sheet := "Rekap"
	if err := f.SetSheetName("Sheet1", sheet); err != nil {
		httpx.Error(w, err)
		return
	}
	if err := f.SetSheetRow(sheet, "A1", &header); err != nil {
		httpx.Error(w, err)
		return
	}
	for i, row := range data {
		cell, err := excelize.CoordinatesToCellName(1, i+2)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		if err := f.SetSheetRow(sheet, cell, &row); err != nil {
			httpx.Error(w, err)
			return
		}
	}
	if styleID, err := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Bold: true},
		Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"#EAF0F8"}},
	}); err == nil {
		_ = f.SetCellStyle(sheet, "A1", "L1", styleID)
	}
	for i, width := range []float64{5, 30, 16, 14, 18, 18, 12, 16, 10, 12, 14, 12} {
		col, err := excelize.ColumnNumberToName(i + 1)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		_ = f.SetColWidth(sheet, col, col, width)
	}
	_ = f.SetPanes(sheet, &excelize.Panes{
		Freeze: true, XSplit: 0, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft",
	})
	buf, err := f.WriteToBuffer()
	if err != nil {
		httpx.Error(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	contentDisposition(w, filename)
	_, _ = w.Write(buf.Bytes())
}

// ---- csv (BOM UTF-8 agar Excel membaca dengan benar) ----

func writeCSV(w http.ResponseWriter, filename string, header []string, data [][]string) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	contentDisposition(w, filename)
	_, _ = w.Write([]byte("\xEF\xBB\xBF"))
	cw := csv.NewWriter(w)
	_ = cw.Write(header)
	_ = cw.WriteAll(data)
	cw.Flush()
}
