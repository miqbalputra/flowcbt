package cards

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"flowcbt/backend/internal/httpx"

	"github.com/go-pdf/fpdf"
	qrcode "github.com/skip2/go-qrcode"
)

// Tata letak kartu (mm, A4 210×297) — meniru kartu peserta TKA:
// 2 kolom (PANITIA & PESERTA), 3 peserta per halaman.
const (
	pageW  = 210.0
	margin = 10.0
	cardW  = 92.0
	cardH  = 78.0
	gapX   = 6.0
	gapY   = 5.0
	startY = 26.0
	perPag = 3
	rowH   = 7.0
)

// renderCardsPDF — dokumen PDF kartu peserta (3 baris × 2 kolom per halaman).
func (m *Module) renderCardsPDF(meta *examMeta, profile *schoolProfile, rows []cardRow, baseURL string) ([]byte, error) {
	if len(rows) == 0 {
		return nil, httpx.NewErr(http.StatusNotFound, "NO_PARTICIPANTS", "Belum ada peserta untuk ujian ini")
	}
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(0, 0, 0)
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetTitle("Kartu Peserta — "+meta.Name, true)
	pdf.SetCreator("FlowCBT", true)

	year := meta.OpenAt.Year()
	for start := 0; start < len(rows); start += perPag {
		end := start + perPag
		if end > len(rows) {
			end = len(rows)
		}
		pdf.AddPage()
		pageHeader(pdf, meta, profile, year)
		for i, c := range rows[start:end] {
			y := startY + float64(i)*(cardH+gapY)
			m.drawCard(pdf, margin, y, meta, profile, c, "PANITIA",
				fmt.Sprintf("qr-%d-%d-a", start, i), fmt.Sprintf("foto-%d-%d-a", start, i))
			m.drawCard(pdf, margin+cardW+gapX, y, meta, profile, c, "PESERTA",
				fmt.Sprintf("qr-%d-%d-b", start, i), fmt.Sprintf("foto-%d-%d-b", start, i))
		}
	}
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// pageHeader — kepala halaman (judul ujian, sekolah, tahun pelajaran).
func pageHeader(pdf *fpdf.Fpdf, meta *examMeta, profile *schoolProfile, year int) {
	pdf.SetTextColor(0, 0, 0)
	pdf.SetFont("Helvetica", "B", 8.5)
	line(pdf, 9, "KARTU PESERTA "+strings.ToUpper(pdfgenSafe(meta.Name)))
	pdf.SetFont("Helvetica", "B", 8.5)
	line(pdf, 13, strings.ToUpper(pdfgenSafe(profile.Name)))
	pdf.SetFont("Helvetica", "B", 7.5)
	line(pdf, 17, fmt.Sprintf("TAHUN PELAJARAN %d", year))
}

func line(pdf *fpdf.Fpdf, y float64, s string) {
	pdf.SetXY(0, y)
	pdf.CellFormat(pageW, 4, s, "", 1, "C", false, 0, "")
}

// drawCard — satu kartu peserta lengkap (kepala, tabel identitas, foto, ttd, QR).
func (m *Module) drawCard(pdf *fpdf.Fpdf, x, y float64, meta *examMeta,
	profile *schoolProfile, c cardRow, role, qrName, photoName string) {

	pdf.SetDrawColor(0, 0, 0)
	pdf.SetLineWidth(0.25)
	pdf.Rect(x, y, cardW, cardH, "D")

	// ---- kepala kartu ----
	const headH = 18.0
	emblem(pdf, profile, x+3.5, y+2.5, 13)
	titleX, titleW := x+18.5, cardW-18.5-23
	pdf.SetTextColor(0, 0, 0)
	pdf.SetFont("Helvetica", "B", 7.5)
	cell(pdf, titleX, y+2.2, titleW, 4, "KARTU PESERTA", "C")
	cell(pdf, titleX, y+6.2, titleW, 4, fit(pdf, strings.ToUpper(pdfgenSafe(meta.Name)), titleW-2, "B", 7.5), "C")
	cell(pdf, titleX, y+10.2, titleW, 4, fmt.Sprintf("TAHUN %d", meta.OpenAt.Year()), "C")

	// kotak peran (PANITIA / PESERTA)
	roleW := 19.0
	pdf.Rect(x+cardW-roleW, y+2.5, roleW, 5.5, "D")
	pdf.SetFont("Helvetica", "B", 6.2)
	cell(pdf, x+cardW-roleW, y+3.1, roleW, 4.3, role, "C")

	pdf.SetLineWidth(0.2)
	pdf.Line(x, y+headH, x+cardW, y+headH)

	// ---- tabel identitas ----
	tableY := y + headH
	pdf.Line(x, tableY+float64(4)*rowH, x+cardW, tableY+float64(4)*rowH)
	for i := 1; i < 4; i++ {
		pdf.SetDrawColor(190, 190, 190)
		pdf.SetLineWidth(0.15)
		pdf.Line(x, tableY+float64(i)*rowH, x+cardW, tableY+float64(i)*rowH)
	}
	pdf.SetDrawColor(0, 0, 0)
	labelW := 33.0
	pdf.SetLineWidth(0.15)
	pdf.Line(x+labelW, tableY, x+labelW, tableY+float64(4)*rowH)

	rows := [][2]string{
		{"Nomor Peserta", c.Number},
		{"Nama Peserta", strings.ToUpper(pdfgenSafe(c.Name))},
		{"Tmp & Tanggal Lahir", formatBirth(c)},
		{"Asal Sekolah", strings.ToUpper(pdfgenSafe(profile.Name))},
	}
	for i, r := range rows {
		ry := tableY + float64(i)*rowH + 1.4
		pdf.SetFont("Helvetica", "", 7)
		cell(pdf, x+3, ry, labelW-6, 4.2, r[0], "L")
		cell(pdf, x+labelW-3, ry, 4, 4.2, ":", "C")
		pdf.SetFont("Helvetica", "B", 7)
		cell(pdf, x+labelW+1.5, ry, cardW-labelW-4.5, 4.2, fit(pdf, r[1], cardW-labelW-5, "B", 7), "L")
	}

	// ---- foto, tanda tangan, QR ----
	bottomY := tableY + float64(4)*rowH
	photoW, photoH := 15.0, 20.0
	photoX, photoY := x+3, bottomY+9
	m.drawPhoto(pdf, photoX, photoY, photoW, photoH, photoName, c.PhotoURL)

	qrSize := 18.0
	qrX, qrY := x+cardW-qrSize-3, bottomY+9

	sigX := photoX + photoW + 3
	sigW := qrX - sigX - 3
	sigY := bottomY + 4
	pdf.SetFont("Helvetica", "", 6.4)
	cell(pdf, sigX, sigY, sigW, 3.4, fit(pdf, placeDate(profile), sigW, "", 6.4), "C")
	cell(pdf, sigX, sigY+3.4, sigW, 3.4, "Kepala Satuan Pendidikan,", "C")

	name := strings.ToUpper(strings.TrimSpace(profile.PrincipalName))
	if name == "" {
		name = "-"
	}
	pdf.SetFont("Helvetica", "B", 6.4)
	name = fit(pdf, pdfgenSafe(name), sigW, "B", 6.4)
	nameW := pdf.GetStringWidth(name) + 3
	cell(pdf, sigX, sigY+11.5, sigW, 3.4, name, "C")
	pdf.SetDrawColor(0, 0, 0)
	pdf.SetLineWidth(0.2)
	midX := sigX + sigW/2
	pdf.Line(midX-nameW/2, sigY+14.9, midX+nameW/2, sigY+14.9)

	pdf.SetFont("Helvetica", "", 6.4)
	nip := strings.TrimSpace(profile.PrincipalNIP)
	if nip == "" {
		nip = "-"
	}
	cell(pdf, sigX, sigY+15.2, sigW, 3.4, fit(pdf, "NIP. "+nip, sigW, "", 6.4), "C")

	payload := fmt.Sprintf("FLOWCBT|%s|%s|%s", meta.ExamCode, c.Number, c.StudentCode)
	m.drawQR(pdf, qrX, qrY, qrSize, qrName, payload)
}

// placeDate — "Purbalingga, 22 November 2026" (tanggal cetak, zona sekolah).
func placeDate(p *schoolProfile) string {
	city := strings.TrimSpace(p.City)
	if city == "" {
		city = "-"
	}
	loc := jakartaLocation(p.Timezone)
	now := timeNow().In(loc)
	return pdfgenSafe(city) + ", " + now.Format("02") + " " + bulanID[now.Month()] + " " + now.Format("2006")
}

// emblem — lambang sederhana (lingkaran + inisial sekolah).
func emblem(pdf *fpdf.Fpdf, profile *schoolProfile, x, y, size float64) {
	cx, cy, r := x+size/2, y+size/2, size/2-0.4
	pdf.SetDrawColor(0, 0, 0)
	pdf.SetLineWidth(0.35)
	pdf.Circle(cx, cy, r, "D")
	pdf.SetLineWidth(0.15)
	pdf.Circle(cx, cy, r-1.4, "D")
	initials := schoolInitials(profile.Name)
	pdf.SetFont("Helvetica", "B", 6.5)
	cell(pdf, x, cy-2, size, 4, initials, "C")
}

func schoolInitials(name string) string {
	fields := strings.Fields(strings.ToUpper(name))
	var b strings.Builder
	for _, f := range fields {
		if len(f) == 0 {
			continue
		}
		b.WriteRune(rune(f[0]))
		if b.Len() >= 3 {
			break
		}
	}
	if b.Len() == 0 {
		return "FC"
	}
	return b.String()
}

// drawPhoto — foto peserta 3×4 (atau kotak kosong bila tidak ada).
func (m *Module) drawPhoto(pdf *fpdf.Fpdf, x, y, w, h float64, name, url string) {
	pdf.SetDrawColor(120, 120, 120)
	pdf.SetLineWidth(0.2)
	if data, kind, ok := m.photoBytes(url); ok {
		info := pdf.RegisterImageOptionsReader(name, fpdf.ImageOptions{ImageType: kind}, bytes.NewReader(data))
		if info != nil && pdf.Error() == nil {
			// "contain": gambar utuh di dalam kotak (tanpa menimpa elemen lain)
			iw, ih := info.Width(), info.Height()
			scale := w / iw
			if h/ih < scale {
				scale = h / ih
			}
			dw, dh := iw*scale, ih*scale
			ox, oy := x+(w-dw)/2, y+(h-dh)/2
			pdf.ImageOptions(name, ox, oy, dw, dh, false, fpdf.ImageOptions{ImageType: kind}, 0, "")
			pdf.SetDrawColor(120, 120, 120)
			pdf.Rect(x, y, w, h, "D")
			return
		}
	}
	pdf.Rect(x, y, w, h, "D")
	pdf.SetFont("Helvetica", "", 6)
	pdf.SetTextColor(110, 110, 110)
	cell(pdf, x, y+h/2-3.2, w, 3.4, "FOTO", "C")
	cell(pdf, x, y+h/2+0.2, w, 3.4, "3 x 4", "C")
	pdf.SetTextColor(0, 0, 0)
}

// drawQR — QR berisi nomor peserta (dicetak bila pustaka berhasil membuatnya).
func (m *Module) drawQR(pdf *fpdf.Fpdf, x, y, size float64, name, payload string) {
	png, err := qrcode.Encode(payload, qrcode.Medium, 256)
	if err != nil {
		return
	}
	info := pdf.RegisterImageOptionsReader(name, fpdf.ImageOptions{ImageType: "PNG"}, bytes.NewReader(png))
	if info == nil || pdf.Error() != nil {
		return
	}
	pdf.ImageOptions(name, x, y, size, size, false, fpdf.ImageOptions{ImageType: "PNG"}, 0, "")
}

// photoBytes membaca foto siswa dari penyimpanan media lokal.
// Hanya pola /api/v1/media/{tenant}/{file} untuk tenant ini (tanpa jaringan).
func (m *Module) photoBytes(url string) ([]byte, string, bool) {
	const prefix = "/api/v1/media/"
	if !strings.HasPrefix(url, prefix) {
		return nil, "", false
	}
	rest := strings.TrimPrefix(url, prefix)
	parts := strings.Split(rest, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return nil, "", false
	}
	tenant, file := parts[0], parts[1]
	if strings.Contains(file, "..") || strings.Contains(file, "\\") {
		return nil, "", false
	}
	switch strings.ToLower(filepath.Ext(file)) {
	case ".png", ".jpg", ".jpeg", ".gif":
	default:
		return nil, "", false
	}
	path := filepath.Join(m.a.Cfg.UploadDir, tenant, file)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, "", false
	}
	if _, _, err := image.DecodeConfig(bytes.NewReader(data)); err != nil {
		return nil, "", false
	}
	kind := "PNG"
	switch strings.ToLower(filepath.Ext(file)) {
	case ".jpg", ".jpeg":
		kind = "JPG"
	case ".gif":
		kind = "GIF"
	}
	return data, kind, true
}

// ---------------- bantuan teks ----------------

// cell menulis teks pada kotak tertentu (posisi eksplisit).
func cell(pdf *fpdf.Fpdf, x, y, w, h float64, s, align string) {
	pdf.SetXY(x, y)
	pdf.CellFormat(w, h, s, "", 0, align, false, 0, "")
}

// fit memotong teks agar lebar ≤ maxW (font gaya/ukuran tertentu).
func fit(pdf *fpdf.Fpdf, s string, maxW float64, style string, size float64) string {
	pdf.SetFont("Helvetica", style, size)
	if pdf.GetStringWidth(s) <= maxW {
		return s
	}
	r := []rune(s)
	for len(r) > 3 {
		r = r[:len(r)-1]
		cand := string(r) + "..."
		if pdf.GetStringWidth(cand) <= maxW {
			return cand
		}
	}
	return string(r)
}

// pdfgenSafe menyamakan aturan karakter dengan paket pdfgen (font core Latin-1).
func pdfgenSafe(s string) string {
	// fpdf cp1252: karakter di luar Latin-1 jadi '?' agar tidak gagal encode.
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r == '\n' || r == '\r' || r == '\t' {
			r = ' '
		}
		if r < 0x20 || (r > 0x7E && r > 0xFF) {
			r = '?'
		}
		out = append(out, r)
	}
	return string(out)
}
