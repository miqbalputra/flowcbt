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

// Tata letak kartu diukur dari template TKA asli (HTML→PDF Chrome) dalam "unit"
// 869×1229 untuk halaman A4; 1 unit = 210/869 mm.
//
// Geometri per kartu (unit, relatif sudut kiri-atas kartu):
//   - kotak kartu 393×278, garis horizontal di y=53, 76, 99, 123, 147
//   - garis vertikal x=339 hanya pada baris pertama (kotak PANITIA/PESERTA)
//   - lambang 40×40 di (6,6); judul 3 baris dipusatkan, baseline 19/31/43
//   - tabel: label x=5.78, kolon x=133.69, nilai x=146.75, baseline baris+16
//   - foto 82×109 di (11,157); teks bawah x=102.78 (baseline 167/179/253/265)
//   - QR 60×60 di (322,205)
const (
	pageU  = 869.0 // lebar halaman dalam unit template
	cardWU = 393.0
	cardHU = 278.0
	fontU  = 11.0 // ukuran font template (unit)
)

// u mengonversi unit template ke mm.
func u(x float64) float64 { return x * 210.0 / pageU }

// pt mengonversi ukuran font dari unit template ke pt (fpdf bekerja dalam pt).
func pt(sizeU float64) float64 { return u(sizeU) * 72.0 / 25.4 }

// renderCardsPDF — dokumen PDF kartu peserta: 3 peserta per halaman, tiap peserta
// 2 salinan (PANITIA kiri, PESERTA kanan), meniru template kartu TKA.
func (m *Module) renderCardsPDF(meta *examMeta, profile *schoolProfile, rows []cardRow, baseURL string) ([]byte, error) {
	if len(rows) == 0 {
		return nil, httpx.NewErr(http.StatusNotFound, "NO_PARTICIPANTS", "Belum ada peserta untuk ujian ini")
	}
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(0, 0, 0)
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetTitle("Kartu Peserta — "+meta.Name, true)
	pdf.SetCreator("FlowCBT", true)
	if info := pdf.RegisterImageOptionsReader("emblem", fpdf.ImageOptions{ImageType: "PNG"}, bytes.NewReader(emblemPNG)); info == nil {
		return nil, pdf.Error()
	}

	year := meta.OpenAt.Year()
	cardX := [2]float64{u(42), u(443)}
	cardY := [3]float64{u(88), u(374), u(660)}

	for start := 0; start < len(rows); start += 3 {
		end := start + 3
		if end > len(rows) {
			end = len(rows)
		}
		pdf.AddPage()
		pageHeader(pdf, meta, profile, year)
		pageFooter(pdf, meta, baseURL)
		for i, c := range rows[start:end] {
			y := cardY[i]
			for col, role := range [2]string{"PANITIA", "PESERTA"} {
				m.drawCard(pdf, cardX[col], y, meta, profile, c, role,
					fmt.Sprintf("qr-%d-%d-%s", start, i, role), fmt.Sprintf("foto-%d-%d-%s", start, i, role))
			}
		}
	}
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// text menulis satu baris teks dengan baseline persis di (x, y) — seperti Tm pada
// template asli sehingga posisi bisa ditiru apa adanya.
func text(pdf *fpdf.Fpdf, x, y float64, s string) {
	pdf.Text(x, y, s)
}

// textC menulis teks dipusatkan pada cx dengan baseline y.
func textC(pdf *fpdf.Fpdf, cx, y float64, s string) {
	pdf.Text(cx-pdf.GetStringWidth(s)/2, y, s)
}

// pageHeader — kepala halaman 3 baris (baseline 53/65/77 unit), dipusatkan.
func pageHeader(pdf *fpdf.Fpdf, meta *examMeta, profile *schoolProfile, year int) {
	pdf.SetTextColor(0, 0, 0)
	pdf.SetFont("Helvetica", "B", pt(fontU))
	cx := u(pageU / 2)
	textC(pdf, cx, u(53), "KARTU PESERTA "+strings.ToUpper(pdfgenSafe(meta.Name)))
	textC(pdf, cx, u(65), strings.ToUpper(pdfgenSafe(profile.Name)))
	textC(pdf, cx, u(77), fmt.Sprintf("TAHUN PELAJARAN %d", year))
}

// pageFooter — catatan kecil di bawah kartu: kode ujian + token agar kartu
// bisa dipakai login (form tamu mengisi kode ujian, token, dan nomor peserta).
func pageFooter(pdf *fpdf.Fpdf, meta *examMeta, baseURL string) {
	pdf.SetTextColor(0, 0, 0)
	pdf.SetFont("Helvetica", "B", pt(9))
	textC(pdf, u(pageU/2), u(950), fmt.Sprintf("Kode ujian: %s    Token: %s", meta.ExamCode, meta.Token))
	pdf.SetFont("Helvetica", "", pt(9))
	login := "Masuk sebagai tamu: /s/guest"
	if baseURL != "" {
		login = "Masuk sebagai tamu: " + strings.TrimRight(baseURL, "/") + "/s/guest"
	}
	textC(pdf, u(pageU/2), u(962), pdfgenSafe(login+" — isi kode ujian, token, dan nomor peserta dari kartu"))
}

// drawCard — satu kartu peserta, geometri persis seperti template TKA.
func (m *Module) drawCard(pdf *fpdf.Fpdf, x, y float64, meta *examMeta,
	profile *schoolProfile, c cardRow, role, qrName, photoName string) {

	pdf.SetDrawColor(0, 0, 0)
	pdf.SetLineWidth(u(1))
	pdf.Rect(x, y, u(cardWU), u(cardHU), "D")
	// garis horizontal: bawah kepala (53) dan antarbaris tabel (76, 99, 123, 147)
	for _, dy := range []float64{53, 76, 99, 123, 147} {
		pdf.Line(x, y+u(dy), x+u(cardWU), y+u(dy))
	}
	// kotak peran (PANITIA/PESERTA) pada baris pertama tabel
	pdf.Line(x+u(339), y+u(53), x+u(339), y+u(76))

	// ---- kepala kartu: lambang + judul 3 baris ----
	pdf.ImageOptions("emblem", x+u(6), y+u(6), u(40), u(40), false, fpdf.ImageOptions{ImageType: "PNG"}, 0, "")
	pdf.SetTextColor(0, 0, 0)
	pdf.SetFont("Helvetica", "B", pt(fontU))
	cx := x + u(cardWU/2)
	exam := fitC(pdf, strings.ToUpper(pdfgenSafe(meta.Name)), u(cardWU-52), "B", pt(fontU))
	textC(pdf, cx, y+u(19), "KARTU PESERTA")
	textC(pdf, cx, y+u(31), exam)
	textC(pdf, cx, y+u(43), fmt.Sprintf("TAHUN %d", meta.OpenAt.Year()))

	// ---- tabel identitas ----
	rows := [][2]string{
		{"Nomor Peserta", c.Number},
		{"Nama Peserta", strings.ToUpper(pdfgenSafe(c.Name))},
		{"Tmp & Tanggal Lahir", formatBirth(c)},
		{"Asal Sekolah", strings.ToUpper(pdfgenSafe(profile.Name))},
	}
	rowTop := []float64{53, 76, 99, 123}
	maxValW := u(cardWU - 146.75 - 4)
	for i, r := range rows {
		base := y + u(rowTop[i]+16)
		pdf.SetFont("Helvetica", "", pt(fontU))
		text(pdf, x+u(5.78), base, r[0])
		text(pdf, x+u(133.69), base, ":")
		text(pdf, x+u(146.75), base, fitC(pdf, r[1], maxValW, "", pt(fontU)))
	}
	// label peran dipusatkan di dalam kotak kanan baris pertama; ukuran font
	// diperkecil seperlunya agar "PESERTA" tidak terpotong
	roleW := u(cardWU - 339)
	pdf.SetFont("Helvetica", "", pt(fontU))
	roleSize := pt(fontU)
	if w := pdf.GetStringWidth(role); w > roleW-1 {
		roleSize *= (roleW - 1) / w
		pdf.SetFont("Helvetica", "", roleSize)
	}
	textC(pdf, x+u(339)+roleW/2, y+u(69), role)

	// ---- bagian bawah: foto, tempat/tanggal, kepala satuan pendidikan, QR ----
	// kotak foto 82×109
	photoX, photoY := x+u(11), y+u(157)
	photoW, photoH := u(82), u(109)
	m.drawPhoto(pdf, photoX, photoY, photoW, photoH, photoName, c.PhotoURL)

	tx := x + u(102.78)
	pdf.SetFont("Helvetica", "", pt(fontU))
	text(pdf, tx, y+u(167), fitC(pdf, placeDate(profile), u(339-102.78-4), "", pt(fontU)))
	text(pdf, tx, y+u(179), "Kepala Satuan Pendidikan,")
	name := strings.TrimSpace(profile.PrincipalName)
	if name == "" {
		name = "-"
	}
	pdf.SetFont("Helvetica", "", pt(fontU))
	text(pdf, tx, y+u(253), fitC(pdf, pdfgenSafe(name), u(339-102.78-4), "", pt(fontU)))
	pdf.SetFont("Helvetica", "", pt(fontU))
	nip := strings.TrimSpace(profile.PrincipalNIP)
	if nip == "" {
		nip = "-"
	}
	text(pdf, tx, y+u(265), "NIP. "+nip)

	payload := fmt.Sprintf("FLOWCBT|%s|%s|%s", meta.ExamCode, c.Number, c.StudentCode)
	m.drawQR(pdf, x+u(322), y+u(205), u(60), qrName, payload)
}

// placeDate — "Purbalingga, 22 November 2026" (tanggal cetak, zona waktu sekolah).
func placeDate(p *schoolProfile) string {
	city := strings.TrimSpace(p.City)
	if city == "" {
		city = "-"
	}
	loc := jakartaLocation(p.Timezone)
	now := timeNow().In(loc)
	return pdfgenSafe(city) + ", " + now.Format("2") + " " + bulanID[now.Month()] + " " + now.Format("2006")
}

// drawPhoto — foto peserta 3×4 di dalam kotaknya (atau kotak kosong bila tidak ada).
func (m *Module) drawPhoto(pdf *fpdf.Fpdf, x, y, w, h float64, name, url string) {
	pdf.SetDrawColor(0, 0, 0)
	pdf.SetLineWidth(u(1))
	if data, kind, ok := m.photoBytes(url); ok {
		info := pdf.RegisterImageOptionsReader(name, fpdf.ImageOptions{ImageType: kind}, bytes.NewReader(data))
		if info != nil && pdf.Error() == nil {
			iw, ih := info.Width(), info.Height()
			scale := w / iw
			if h/ih < scale {
				scale = h / ih
			}
			dw, dh := iw*scale, ih*scale
			pdf.ImageOptions(name, x+(w-dw)/2, y+(h-dh)/2, dw, dh, false, fpdf.ImageOptions{ImageType: kind}, 0, "")
			pdf.Rect(x, y, w, h, "D")
			return
		}
	}
	pdf.Rect(x, y, w, h, "D")
	pdf.SetTextColor(150, 150, 150)
	pdf.SetFont("Helvetica", "", pt(9))
	textC(pdf, x+w/2, y+h/2+pt(9)*0.35, "FOTO 3x4")
	pdf.SetTextColor(0, 0, 0)
}

// drawQR — kode QR berisi nomor peserta.
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

// fitC memotong teks agar lebar ≤ maxW (font gaya/ukuran tertentu), hasil dipusatkan
// bila lebih pendek dari maxW tidak masalah karena pemanggil memakai posisi eksplisit.
func fitC(pdf *fpdf.Fpdf, s string, maxW float64, style string, size float64) string {
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

// pdfgenSafe menyamakan aturan karakter dengan font core fpdf (Latin-1/cp1252).
func pdfgenSafe(s string) string {
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
