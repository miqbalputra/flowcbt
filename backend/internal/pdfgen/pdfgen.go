// Package pdfgen — generator PDF tabel sederhana (bersama lintas modul).
//
// Dipakai reports (rekap nilai — FR-9.11) dan students (track record — FR-3.7).
// Font core Helvetica (cp1252): karakter di luar Latin-1 diganti '?' agar
// render tidak gagal. Satuan mm, kertas A4 portrait.
package pdfgen

import (
	"bytes"
	"strings"

	"github.com/go-pdf/fpdf"
)

const (
	Margin   = 12
	PageW    = 210 // A4 mm
	ContentW = PageW - 2*Margin
	RowH     = 7
)

// Opts konfigurasi dokumen/tabel.
type Opts struct {
	Title    string
	Subtitle string
	Footer   string
	Widths   []float64 // bobot relatif kolom (dinormalisasi)
	Aligns   []string  // "L"|"C"|"R" per kolom (default "L")
}

// Safe buang karakter di luar Latin-1/cp1252 (font core PDF).
func Safe(s string) string {
	r := make([]rune, 0, len(s))
	for _, c := range s {
		if c == '\n' || c == '\r' || c == '\t' {
			c = ' '
		}
		if c < 0x20 || (c > 0x7E && c > 0xFF) {
			r = append(r, '?')
			continue
		}
		r = append(r, c)
	}
	return string(r)
}

// NowStamp label tanggal-nilai cetak untuk footer/subtitle.
func NowStamp() string { return stampNow() }

// New dokumen A4 baru dengan margin & auto page break.
func New() *fpdf.Fpdf {
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(Margin, 12, Margin)
	pdf.SetAutoPageBreak(true, 16)
	return pdf
}

// Header judul dokumen + footer halaman (nomor & label).
func Header(pdf *fpdf.Fpdf, o Opts) {
	pdf.SetFooterFunc(func() {
		pdf.SetY(-14)
		pdf.SetFont("Helvetica", "", 8)
		pdf.SetTextColor(120, 120, 120)
		pdf.CellFormat(0, 6, Safe(o.Footer), "", 0, "C", false, 0, "")
		pdf.SetTextColor(0, 0, 0)
	})
	pdf.AddPage()
	pdf.SetFont("Helvetica", "B", 14)
	pdf.CellFormat(0, 9, Safe(o.Title), "", 1, "L", false, 0, "")
	if o.Subtitle != "" {
		pdf.SetFont("Helvetica", "", 10)
		pdf.SetTextColor(90, 90, 90)
		pdf.CellFormat(0, 6, Safe(o.Subtitle), "", 1, "L", false, 0, "")
		pdf.SetTextColor(0, 0, 0)
	}
	pdf.Ln(2)
}

// Table gambar tabel; header diulang otomatis di halaman baru.
func Table(pdf *fpdf.Fpdf, header []string, rows [][]string, o Opts) {
	n := len(header)
	if n == 0 {
		return
	}
	total := 0.0
	ws := make([]float64, n)
	for i := 0; i < n; i++ {
		if i < len(o.Widths) && o.Widths[i] > 0 {
			ws[i] = o.Widths[i]
		} else {
			ws[i] = 1
		}
		total += ws[i]
	}
	for i := range ws {
		ws[i] = ws[i] / total * ContentW
	}
	align := func(i int) string {
		if i < len(o.Aligns) && o.Aligns[i] != "" {
			return o.Aligns[i]
		}
		return "L"
	}
	trunc := func(s string, w float64) string {
		max := int(w / 2.1) // perkiraan lebar huruf ~2.1mm @8.5pt
		if max < 3 {
			return s
		}
		r := []rune(s)
		if len(r) > max {
			s = string(r[:max-1]) + "…"
		}
		return s
	}

	drawHeader := func() {
		pdf.SetFont("Helvetica", "B", 8.5)
		pdf.SetFillColor(38, 90, 160)
		pdf.SetTextColor(255, 255, 255)
		for i, h := range header {
			pdf.CellFormat(ws[i], 7, Safe(h), "1", 0, "C", true, 0, "")
		}
		pdf.Ln(-1)
		pdf.SetTextColor(0, 0, 0)
	}
	drawHeader()

	pdf.SetFont("Helvetica", "", 8.5)
	for ri, row := range rows {
		if pdf.GetY() > 280 { // sistem page-break menyelsipkan header ulang
			drawHeader()
			pdf.SetFont("Helvetica", "", 8.5)
		}
		fill := ri%2 == 1
		for i, cell := range row {
			if i >= n {
				break
			}
			pdf.CellFormat(ws[i], RowH, trunc(Safe(cell), ws[i]), "1", 0, align(i), fill, 0, "")
		}
		pdf.Ln(-1)
	}
}

// Notes tulis daftar butir setelah tabel (ringkasan/catatan).
func Notes(pdf *fpdf.Fpdf, title string, items []string) {
	if len(items) == 0 && title == "" {
		return
	}
	pdf.Ln(4)
	if title != "" {
		pdf.SetFont("Helvetica", "B", 10)
		pdf.CellFormat(0, 6, Safe(title), "", 1, "L", false, 0, "")
	}
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(60, 60, 60)
	for _, s := range items {
		pdf.CellFormat(0, 5.5, Safe("• "+s), "", 1, "L", false, 0, "")
	}
	pdf.SetTextColor(0, 0, 0)
}

// Render hasilkan bytes PDF.
func Render(pdf *fpdf.Fpdf) ([]byte, error) {
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// OrDash kosong → "-".
func OrDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "-"
	}
	return s
}
