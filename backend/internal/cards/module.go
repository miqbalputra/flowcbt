// Package cards — Kartu Ujian (kartu peserta gaya TKA) + identitas sekolah.
//
// Fitur:
//   - nomor peserta stabil per ujian (tabel exam_cards, dibuat sekali),
//   - daftar peserta + data yang tercetak di kartu,
//   - PDF kartu: 2 kolom (PANITIA & PESERTA), 3 peserta per halaman A4,
//     unduh semua sekaligus atau per siswa,
//   - teks WhatsApp siap kirim per siswa (nomor HP siswa/orang tua),
//   - identitas sekolah (kota, kepala satuan pendidikan, NIP, kode wilayah/
//     sekolah) yang dipakai kepala kartu & blok tanda tangan.
//
// Semua query data tenant lewat m.a.DB.WithTenant agar RLS aktif.
package cards

import (
	"net/http"
	"strings"

	"flowcbt/backend/internal/app"
	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpmw"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
)

// Module modul kartu ujian.
type Module struct {
	a *app.App
}

// Init menghubungkan modul ke container dependency aplikasi.
func Init(a *app.App) *Module { return &Module{a: a} }

// Routes memasang endpoint kartu ujian pada router /api/v1.
func (m *Module) Routes(r chi.Router) {
	staff := httpmw.RequireAuth(m.a.Cfg.JWTSecret, "owner", "teacher", "superadmin")

	r.Route("/school-profile", func(r chi.Router) {
		r.Use(staff)
		r.Get("/", m.getSchoolProfile)
		r.Put("/", m.updateSchoolProfile)
	})

	r.Route("/exams/{examID}/cards", func(r chi.Router) {
		r.Use(staff)
		r.Get("/", m.listCards)
		r.Get("/pdf", m.pdfCards)
		r.Post("/renumber", m.renumberCards)
		r.Get("/{studentID}/pdf", m.pdfCards)
	})
}

func (m *Module) tenant(w http.ResponseWriter, r *http.Request) (string, bool) {
	tenantID := ctxinfo.TenantID(r.Context())
	if tenantID == "" {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "NO_TENANT", "Akun tanpa tenant"))
		return "", false
	}
	return tenantID, true
}

// isUUID — validasi sederhana id path (bukan format UUID → 404).
func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
				return false
			}
		}
	}
	return true
}

// trimPtr mengembalikan nilai pointer yang sudah di-trim, atau string kosong.
func trimPtr(p *string) string {
	if p == nil {
		return ""
	}
	return strings.TrimSpace(*p)
}
