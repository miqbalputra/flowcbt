package billing

// export.go — export data tenant milik owner (PRD 3.2: Export Semua Data).
// ZIP berisi tiga berkas: siswa.xlsx, hasil-ujian.xlsx, soal.xlsx.

import (
	"archive/zip"
	"fmt"
	"net/http"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/xuri/excelize/v2"
)

// sheetXLSX — satu sheet workbook: nama, header, dan baris data (string).
type sheetXLSX struct {
	Nama   string
	Header []string
	Baris  [][]string
}

// buildXLSXFile membuat workbook excelize dari satu definisi sheet.
func buildXLSXFile(s sheetXLSX) (*excelize.File, error) {
	f := excelize.NewFile()
	if err := f.SetSheetName("Sheet1", s.Nama); err != nil {
		return nil, err
	}
	if err := f.SetSheetRow(s.Nama, "A1", &s.Header); err != nil {
		return nil, err
	}
	for i, row := range s.Baris {
		cell, err := excelize.CoordinatesToCellName(1, i+2)
		if err != nil {
			return nil, err
		}
		if err := f.SetSheetRow(s.Nama, cell, &row); err != nil {
			return nil, err
		}
	}
	return f, nil
}

// formatFloat — tampilan angka desimal ringkas utk export.
func formatFloat(v float64) string { return fmt.Sprintf("%.2f", v) }

// exportAll — GET /billing/export-all (owner): ZIP berisi tiga berkas.
func (m *Module) exportAll(w http.ResponseWriter, r *http.Request) {
	c := ctxinfo.Claims(r.Context())
	if c == nil || c.TenantID == "" {
		httpx.Error(w, httpx.NewErr(http.StatusUnauthorized, "UNAUTHORIZED", "Tidak terautentikasi"))
		return
	}

	// 1) Sheet Siswa: id, nama, nis, username, kelas, status.
	shSiswa := sheetXLSX{
		Nama:   "Siswa",
		Header: []string{"ID", "Nama", "NIS", "Username", "Kelas", "Status"},
	}
	rows, err := m.a.DB.Admin.Query(r.Context(), `
		SELECT s.id::text, s.name, COALESCE(s.nis, ''), COALESCE(s.username, ''),
		       s.gender, s.status, COALESCE(cl.name, '')
		FROM students s LEFT JOIN classes cl ON cl.id = s.class_id
		WHERE s.tenant_id = $1 AND s.merged_into_id IS NULL
		ORDER BY s.created_at`, c.TenantID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	for rows.Next() {
		var id, nama, nis, username, gender, status, kelas string
		if err := rows.Scan(&id, &nama, &nis, &username, &gender, &status, &kelas); err != nil {
			httpx.Error(w, err)
			return
		}
		shSiswa.Baris = append(shSiswa.Baris,
			[]string{id, nama, nis, username, gender, kelas, status})
	}
	rows.Close()

	// 2) Sheet HasilUjian: ujian, peserta, nilai, status.
	shHasil := sheetXLSX{
		Nama:   "HasilUjian",
		Header: []string{"Ujian", "Peserta", "Percobaan", "Status", "Nilai", "NilaiAkhir"},
	}
	rowsHasil, err := m.a.DB.Admin.Query(r.Context(), `
		SELECT e.name, a.name_snapshot, a.attempt_no, a.status,
		       COALESCE(a.score, 0), COALESCE(a.final_score, 0)
		FROM attempts a JOIN exams e ON e.id = a.exam_id
		WHERE a.tenant_id = $1
		ORDER BY a.created_at DESC`, c.TenantID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	for rowsHasil.Next() {
		var exam, peserta, status string
		var attemptNo, score, final float64
		if err := rowsHasil.Scan(&exam, &peserta, &attemptNo, &status, &score, &final); err != nil {
			httpx.Error(w, err)
			return
		}
		shHasil.Baris = append(shHasil.Baris, []string{
			exam, peserta, fmt.Sprintf("%d", int(attemptNo)),
			status, formatFloat(score), formatFloat(final),
		})
	}
	rowsHasil.Close()

	// 3) Sheet Soal: kode paket, mapel, judul, status, versi.
	shSoal := sheetXLSX{
		Nama:   "Soal",
		Header: []string{"Kode Ujian", "Mapel", "Judul", "Status", "Versi"},
	}
	rowsSoal, err := m.a.DB.Admin.Query(r.Context(), `
		SELECT qs.exam_code, qs.subject_name, qs.title, qs.status, qs.current_version
		FROM question_sets qs WHERE qs.tenant_id = $1
		ORDER BY qs.exam_code`, c.TenantID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	for rowsSoal.Next() {
		var kode, mapel, judul, status string
		var versi int
		if err := rowsSoal.Scan(&kode, &mapel, &judul, &status, &versi); err != nil {
			httpx.Error(w, err)
			return
		}
		shSoal.Baris = append(shSoal.Baris,
			[]string{kode, mapel, judul, status, fmt.Sprintf("%d", versi)})
	}
	rowsSoal.Close()

	// 4) Bungkus ketiga sheet sebagai berkas xlsx di dalam ZIP dan kirim.
	sheets := []sheetXLSX{shSiswa, shHasil, shSoal}

	zw := zip.NewWriter(w)
	defer zw.Close()
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="export-flowcbt-%s.zip"`, c.TenantID))

	for _, sh := range sheets {
		f, err := buildXLSXFile(sh)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		buf, err := f.WriteToBuffer()
		if err != nil {
			httpx.Error(w, err)
			return
		}
		entry, err := zw.Create(sh.Nama + ".xlsx")
		if err != nil {
			httpx.Error(w, err)
			return
		}
		if _, err := entry.Write(buf.Bytes()); err != nil {
			httpx.Error(w, err)
			return
		}
	}
}
