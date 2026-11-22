// Package students: modul Manajemen Siswa & Kelas (PRD M3) + manajemen guru
// (PRD FR-1.5) + autentikasi siswa (PRD FR-1.3).
//
// Semua query tabel data tenant wajib lewat m.a.DB.WithTenant (pool App, RLS).
// Pool Admin hanya untuk: login/refresh siswa (lookup lintas tenant),
// manajemen user (tabel users), cek kuota (billing), dan lookup publik
// (cari exam by kode/token sebelum tenant diketahui).
package students

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"strings"

	"flowcbt/backend/internal/app"
	"flowcbt/backend/internal/billing"
	"flowcbt/backend/internal/httpmw"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5"
)

type Module struct {
	a       *app.App
	billing *billing.Module
}

func Init(a *app.App) *Module {
	return &Module{a: a, billing: billing.Init(a)}
}

// Routes dipasang di bawah /api/v1 (lihat internal/api).
func (m *Module) Routes(r chi.Router) {
	// ---- Publik: auth siswa (TANPA middleware, rate limit ketat) ----
	r.Route("/student/auth", func(r chi.Router) {
		r.Post("/login", m.studentLogin)
		r.Post("/guest", m.studentGuest)
		r.Post("/card-lookup", m.cardLookup)
		r.Post("/refresh", m.studentRefresh)
	})

	// ---- Staf (owner/teacher) ----
	r.Group(func(r chi.Router) {
		r.Use(httpmw.RequireAuth(m.a.Cfg.JWTSecret, "owner", "teacher"))

		r.Get("/dashboard", m.dashboard)

		r.Get("/classes", m.listClasses)
		r.Post("/classes", m.createClass)
		r.Put("/classes/{id}", m.updateClass)
		r.Delete("/classes/{id}", m.deleteClass)

		r.Get("/students", m.listStudents)
		r.Post("/students", m.createStudent)
		r.Get("/students/import/template", m.importTemplate)
		r.Post("/students/import/preview", m.importPreview)
		r.Post("/students/import/commit", m.importCommit)
		r.Get("/students/export", m.exportStudents)
		r.Get("/students/{id}", m.getStudent)
		r.Put("/students/{id}", m.updateStudent)
		r.Delete("/students/{id}", m.deleteStudent)
		r.Get("/students/{id}/track-record", m.trackRecord)
		r.Post("/students/{id}/reset-password", m.resetStudentPassword)

		// Manajemen guru: owner saja (FR-1.5).
		r.Group(func(r chi.Router) {
			r.Use(httpmw.RequireRole("owner"))
			r.Get("/teachers", m.listTeachers)
			r.Post("/teachers", m.createTeacher)
			r.Put("/teachers/{id}", m.updateTeacher)
			r.Delete("/teachers/{id}", m.deleteTeacher)
		})
	})
}

// ---------- Helper umum ----------

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func isUUID(s string) bool { return uuidRe.MatchString(s) }

func validationDetails(err error) []map[string]string {
	out := []map[string]string{}
	if verrs, ok := err.(validator.ValidationErrors); ok {
		for _, fe := range verrs {
			out = append(out, map[string]string{"field": fe.Field(), "rule": fe.Tag()})
		}
	}
	return out
}

// validateReq: decode body JSON + validasi struct request.
func (m *Module) validateReq(r *http.Request, dst any) error {
	if err := httpx.Decode(r, dst); err != nil {
		return err
	}
	if err := m.a.V.Struct(dst); err != nil {
		return &httpx.APIError{Status: 400, Code: "VALIDATION", Message: "Validasi gagal", Details: validationDetails(err)}
	}
	return nil
}

// slugName: nama -> slug lowercase [a-z0-9-] untuk basis username.
func slugName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	dash := false
	for _, r := range s {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			dash = false
		default:
			if !dash && b.Len() > 0 {
				b.WriteByte('-')
				dash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

const (
	codeAlphabet    = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" // tanpa 0/O/1/I/L (mudah dibaca)
	passwordCharset = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
	digitCharset    = "23456789"
)

// randomFrom: n karakter acak dari alfabet (crypto/rand).
func randomFrom(alphabet string, n int) (string, error) {
	out := make([]byte, n)
	max := big.NewInt(int64(len(alphabet)))
	for i := range out {
		idx, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = alphabet[idx.Int64()]
	}
	return string(out), nil
}

// randomPassword: password sementara 8 karakter (ada huruf kecil, besar, dan digit).
func randomPassword() (string, error) {
	low, err := randomFrom("abcdefghjkmnpqrstuvwxyz", 1)
	if err != nil {
		return "", err
	}
	up, err := randomFrom("ABCDEFGHJKMNPQRSTUVWXYZ", 1)
	if err != nil {
		return "", err
	}
	dig, err := randomFrom(digitCharset, 1)
	if err != nil {
		return "", err
	}
	rest, err := randomFrom(passwordCharset, 5)
	if err != nil {
		return "", err
	}
	b := []byte(low + up + dig + rest)
	// Fisher-Yates shuffle dengan crypto/rand.
	for i := len(b) - 1; i > 0; i-- {
		jBig, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			return "", err
		}
		j := int(jBig.Int64())
		b[i], b[j] = b[j], b[i]
	}
	return string(b), nil
}

// uuidV4: UUID acak (untuk device token cookie "fdev").
func uuidV4() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

// normalizeGender: "l", "L", "laki-laki", "P", "perempuan", "pria", "wanita" -> L/P.
func normalizeGender(s string) (string, bool) {
	s = strings.ToUpper(strings.TrimSpace(s))
	if s == "" {
		return "", false
	}
	switch {
	case strings.HasPrefix(s, "W"):
		return "P", true // wanita
	case strings.HasPrefix(s, "L"):
		return "L", true // laki-laki
	case strings.HasPrefix(s, "P"):
		return "P", true // perempuan/pria
	}
	return "", false
}

// auditTx: catat aksi sensitif ke audit_logs (dipanggil DI DALAM transaksi tenant).
func auditTx(ctx context.Context, tx pgx.Tx, tenantID, actorID, action, entity, entityID string, meta map[string]any) error {
	if meta == nil {
		meta = map[string]any{}
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		raw = []byte("{}")
	}
	_, err = tx.Exec(ctx, `INSERT INTO audit_logs(tenant_id, actor_id, actor_role, action, entity, entity_id, meta)
		VALUES ($1,NULLIF($2,'')::uuid,'staff',$3,$4,$5,$6)`,
		tenantID, actorID, action, entity, entityID, raw)
	return err
}

// audit: varian di luar transaksi (untuk aksi yang berjalan di pool Admin).
func (m *Module) audit(ctx context.Context, tenantID, actorID, action, entity, entityID string, meta map[string]any) {
	_ = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return auditTx(ctx, tx, tenantID, actorID, action, entity, entityID, meta)
	})
}

// quotaExceededErr: error kuota dengan info sisa kuota (PRD FR-3.3b).
func quotaExceededErr(remaining, requested int) *httpx.APIError {
	if requested > 0 {
		return httpx.NewErr(402, "QUOTA_EXCEEDED",
			fmt.Sprintf("Kuota siswa tidak cukup. Sisa kuota: %d, permintaan: %d. Silakan upgrade paket.", remaining, requested))
	}
	return httpx.NewErr(402, "QUOTA_EXCEEDED", "Kuota siswa habis. Silakan upgrade paket.")
}

// normalEmail: trim + lowercase untuk pencocokan email.
func normalEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }
