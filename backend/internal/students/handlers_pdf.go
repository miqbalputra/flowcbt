// handlers_pdf.go — export PDF track record siswa (PRD FR-3.7):
// profil + riwayat seluruh percobaan ujian + ringkasan.
package students

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"flowcbt/backend/internal/pdfgen"
)

// trackRecordHeaders kolom tabel riwayat (urut). Nilai asli & akhir terpisah
// sesuai AC-8.
var trackRecordHeaders = []string{"Mata Pelajaran", "Ujian", "Perc.", "Tanggal", "Durasi", "Nilai", "Akhir", "Status"}

func durPDFFormat(sec *int64) string {
	if sec == nil || *sec < 0 {
		return "-"
	}
	s := *sec
	return fmt.Sprintf("%d:%02d", s/60, s%60)
}

func numPDFFormat(p *float64) string {
	if p == nil {
		return "-"
	}
	return strconv.FormatFloat(*p, 'f', -1, 64)
}

// pdfTrackRecord kirim PDF profil + riwayat ujian siswa.
func (m *Module) pdfTrackRecord(w http.ResponseWriter, filename string, s *studentDetail, attempts []map[string]any) {
	pdf := pdfgen.New()
	ident := s.Name
	if s.NIS != "" {
		ident += " (NIS " + s.NIS + ")"
	}
	pdfgen.Header(pdf, pdfgen.Opts{
		Title:    "Track Record Siswa — " + ident,
		Subtitle: fmt.Sprintf("Kode: %s · Kelas: %s · Dicetak %s", s.StudentCode, pdfgen.OrDash(s.ClassName), pdfgen.NowStamp()),
		Footer:   "FlowCBT — Track Record Siswa",
	})
	o := pdfgen.Opts{
		Widths: []float64{2.4, 2.6, 0.8, 1.8, 1.1, 1.0, 1.0, 1.3},
		Aligns: []string{"L", "L", "C", "L", "R", "R", "R", "L"},
	}
	rows := make([][]string, 0, len(attempts))
	var nDone, nScored int
	var sumScore float64
	for _, a := range attempts {
		subject, _ := a["subject_name"].(string)
		examName, _ := a["exam_name"].(string)
		attemptNo := 0
		if v, ok := a["attempt_no"].(int); ok {
			attemptNo = v
		}
		started, _ := a["started_at"].(*time.Time)
		submitted, _ := a["submitted_at"].(*time.Time)
		dur, _ := a["duration_seconds"].(*int64)
		score, _ := a["score"].(*float64)
		finalScore, _ := a["final_score"].(*float64)
		status, _ := a["status"].(string)
		date := "-"
		if started != nil {
			date = started.Format("02/01/2006")
		}
		rows = append(rows, []string{
			subject, examName, strconv.Itoa(attemptNo), date,
			durPDFFormat(dur), numPDFFormat(score), numPDFFormat(finalScore), status,
		})
		if finalScore != nil {
			nScored++
			sumScore += *finalScore
		}
		if submitted != nil {
			nDone++
		}
	}
	pdfgen.Table(pdf, trackRecordHeaders, rows, o)

	summary := []string{
		fmt.Sprintf("Total ujian diikuti: %d percobaan", len(attempts)),
	}
	if nScored > 0 {
		avg := sumScore / float64(nScored)
		summary = append(summary, fmt.Sprintf("Rata-rata nilai akhir (yang sudah keluar): %.2f dari %d percobaan", avg, nScored))
	}
	summary = append(summary, fmt.Sprintf("Selesai dikumpulkan: %d percobaan", nDone))
	pdfgen.Notes(pdf, "Ringkasan", summary)

	buf, err := pdfgen.Render(pdf)
	if err != nil {
		http.Error(w, "Gagal membuat PDF", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, filename, filename))
	_, _ = w.Write(buf)
}
