// export_pdf.go — export PDF rekap nilai (PRD FR-9.11, FR-3.6).
// Generator tabel ada di internal/pdfgen (dipakai bersama students).
package reports

import "flowcbt/backend/internal/pdfgen"

import (
	"fmt"
	"net/http"
)

// pdfRekap — PDF rekap nilai satu ujian (dipakai exportRekap format=pdf).
func (m *Module) pdfRekap(w http.ResponseWriter, filename, code, title string, rows [][]string) {
	pdf := pdfgen.New()
	pdfgen.Header(pdf, pdfgen.Opts{
		Title:    "Rekap Nilai — " + title,
		Subtitle: fmt.Sprintf("Kode ujian: %s · Dicetak %s", code, pdfgen.NowStamp()),
		Footer:   "FlowCBT — Rekap Nilai",
		Widths:   []float64{0.6, 3, 1.8, 1.1, 1.5, 1.5, 1.1, 1.3, 0.9, 1.2, 1.3, 1.2},
		Aligns:   []string{"C", "L", "L", "C", "L", "L", "R", "R", "R", "R", "L", "L"},
	})
	pdfgen.Table(pdf, exportHeaders, rows, pdfgen.Opts{
		Widths: []float64{0.6, 3, 1.8, 1.1, 1.5, 1.5, 1.1, 1.3, 0.9, 1.2, 1.3, 1.2},
		Aligns: []string{"C", "L", "L", "C", "L", "L", "R", "R", "R", "R", "L", "L"},
	})
	pdfgen.Notes(pdf, "", []string{fmt.Sprintf("%d baris", len(rows))})

	buf, err := pdfgen.Render(pdf)
	if err != nil {
		http.Error(w, "Gagal membuat PDF", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	contentDisposition(w, filename)
	_, _ = w.Write(buf)
}
