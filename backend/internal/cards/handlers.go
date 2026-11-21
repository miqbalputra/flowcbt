package cards

import (
	"net/http"
	"strings"

	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// ---------------- identitas sekolah ----------------

// GET /school-profile
func (m *Module) getSchoolProfile(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	var p *schoolProfile
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		var err error
		p, err = loadSchoolProfile(r.Context(), tx, tenantID)
		return err
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": p})
}

type profileReq struct {
	Address       *string `json:"address" validate:"omitempty,max=300"`
	City          *string `json:"city" validate:"omitempty,max=80"`
	PrincipalName *string `json:"principal_name" validate:"omitempty,max=120"`
	PrincipalNIP  *string `json:"principal_nip" validate:"omitempty,max=40"`
	RegionCode    *string `json:"region_code" validate:"omitempty,max=20"`
	SchoolCode    *string `json:"school_code" validate:"omitempty,max=20"`
}

// PUT /school-profile — hanya field yang dikirim yang diubah.
func (m *Module) updateSchoolProfile(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	var req profileReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	if err := m.a.V.Struct(req); err != nil {
		httpx.Error(w, &httpx.APIError{Status: http.StatusBadRequest, Code: "VALIDATION",
			Message: "Validasi gagal"})
		return
	}
	var p *schoolProfile
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(r.Context(), `
			UPDATE tenants SET
				address        = COALESCE($2, address),
				city           = COALESCE($3, city),
				principal_name = COALESCE($4, principal_name),
				principal_nip  = COALESCE($5, principal_nip),
				region_code    = COALESCE($6, region_code),
				school_code    = COALESCE($7, school_code),
				updated_at     = now()
			WHERE id = $1`,
			tenantID, strPtrOrNil(req.Address), strPtrOrNil(req.City),
			strPtrOrNil(req.PrincipalName), strPtrOrNil(req.PrincipalNIP),
			strPtrOrNil(req.RegionCode), strPtrOrNil(req.SchoolCode))
		if err != nil {
			return err
		}
		p, err = loadSchoolProfile(r.Context(), tx, tenantID)
		return err
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": p})
}

// strPtrOrNil — pointer string → nilai (trim) atau nil bila tidak dikirim.
func strPtrOrNil(p *string) any {
	if p == nil {
		return nil
	}
	return strings.TrimSpace(*p)
}

// ---------------- daftar kartu ----------------

// GET /exams/{examID}/cards — peserta + nomor peserta + teks WhatsApp.
func (m *Module) listCards(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	examID := chi.URLParam(r, "examID")
	if !isUUID(examID) {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	var meta *examMeta
	var profile *schoolProfile
	rows := []cardRow{}
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		var err error
		if meta, err = loadExam(r.Context(), tx, examID); err != nil {
			return err
		}
		if profile, err = loadSchoolProfile(r.Context(), tx, tenantID); err != nil {
			return err
		}
		if rows, err = loadParticipants(r.Context(), tx, tenantID, examID); err != nil {
			return err
		}
		if err = ensureNumbers(r.Context(), tx, tenantID, examID, meta, profile, rows, false); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	base := m.publicBaseURL()
	for i := range rows {
		rows[i].School = profile.Name
		rows[i].WhatsApp = waText(meta, profile, rows[i], base)
	}
	httpx.OK(w, map[string]any{"data": map[string]any{
		"exam":    meta,
		"profile": profile,
		"cards":   rows,
		"total":   len(rows),
	}})
}

// POST /exams/{examID}/cards/renumber — susun ulang nomor peserta (hapus lalu buat lagi).
func (m *Module) renumberCards(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	examID := chi.URLParam(r, "examID")
	if !isUUID(examID) {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	var meta *examMeta
	var profile *schoolProfile
	rows := []cardRow{}
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		var err error
		if meta, err = loadExam(r.Context(), tx, examID); err != nil {
			return err
		}
		if profile, err = loadSchoolProfile(r.Context(), tx, tenantID); err != nil {
			return err
		}
		if rows, err = loadParticipants(r.Context(), tx, tenantID, examID); err != nil {
			return err
		}
		return ensureNumbers(r.Context(), tx, tenantID, examID, meta, profile, rows, true)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{"total": len(rows), "renumbered": true}})
}

// ---------------- PDF ----------------

// GET /exams/{examID}/cards.pdf          → semua peserta
// GET /exams/{examID}/cards/{id}/pdf     → satu peserta (2 salinan: PANITIA & PESERTA)
func (m *Module) pdfCards(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	examID := chi.URLParam(r, "examID")
	if !isUUID(examID) {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	studentID := chi.URLParam(r, "studentID")
	if studentID != "" && !isUUID(studentID) {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	var meta *examMeta
	var profile *schoolProfile
	rows := []cardRow{}
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		var err error
		if meta, err = loadExam(r.Context(), tx, examID); err != nil {
			return err
		}
		if profile, err = loadSchoolProfile(r.Context(), tx, tenantID); err != nil {
			return err
		}
		if rows, err = loadParticipants(r.Context(), tx, tenantID, examID); err != nil {
			return err
		}
		if err = ensureNumbers(r.Context(), tx, tenantID, examID, meta, profile, rows, false); err != nil {
			return err
		}
		if studentID == "" {
			return nil
		}
		for _, c := range rows {
			if c.StudentID == studentID {
				rows = []cardRow{c}
				return nil
			}
		}
		return httpx.ErrNotFound
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	for i := range rows {
		rows[i].School = profile.Name
	}
	if len(rows) == 0 {
		httpx.Error(w, httpx.NewErr(http.StatusNotFound, "NO_PARTICIPANTS", "Belum ada peserta untuk ujian ini"))
		return
	}

	buf, err := m.renderCardsPDF(meta, profile, rows, m.publicBaseURL())
	if err != nil {
		httpx.Error(w, err)
		return
	}
	filename := "kartu-" + safeCode(meta.ExamCode)
	if studentID != "" {
		filename += "-" + safeCode(rows[0].StudentCode)
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	contentDisposition(w, filename+".pdf")
	_, _ = w.Write(buf)
}

func safeCode(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.NewReplacer(" ", "-", "/", "-", "\\", "-").Replace(s)
	if s == "" {
		return "ujian"
	}
	return s
}

// publicBaseURL — alamat aplikasi untuk tautan di pesan WhatsApp (opsional).
func (m *Module) publicBaseURL() string { return strings.TrimRight(m.a.Cfg.PublicBaseURL, "/") }
