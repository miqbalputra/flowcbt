// Package reports — modul laporan FlowCBT (PRD M9: FR-9.1..9.11, FR-3.6, FR-11 §10.4).
//
// Paket ini READ-ONLY: tidak mengubah data. Semua query tabel data tenant
// dijalankan lewat m.a.DB.WithTenant agar RLS aktif. Query agregat ditulis
// sebagai satu SQL besar (LATERAL/COUNT) agar efisien; indeks yang dipakai
// sudah ada di 0001_init.up.sql.
package reports

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"flowcbt/backend/internal/app"
	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpmw"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
)

// Module modul laporan: monitor live, riwayat ujian, rekap & analisis butir, export.
type Module struct{ a *app.App }

func Init(a *app.App) *Module { return &Module{a: a} }

// Routes dipasang di bawah /api/v1 (lihat internal/api/modules.go).
func (m *Module) Routes(r chi.Router) {
	r.Route("/reports", func(r chi.Router) {
		// SSE real-time (FR-9.3): token via query (?token=) karena EventSource
		// tidak bisa mengirim header. Static path "/live/stream" menang atas
		// "/live/{examId}" di chi.
		sse := httpmw.RequireAuthQueryOrHeader(
			m.a.Cfg.JWTSecret, "owner", "teacher", "superadmin")(http.HandlerFunc(m.liveStream))
		r.Get("/live/stream", func(w http.ResponseWriter, r *http.Request) { sse.ServeHTTP(w, r) })

		r.Group(func(r chi.Router) {
			r.Use(httpmw.RequireAuth(m.a.Cfg.JWTSecret, "owner", "teacher"))
			r.Get("/live", m.liveList)
			r.Get("/live/{examId}", m.liveDetail)
			r.Get("/history", m.historyList)
			r.Get("/exams/{examId}", m.examReport)
			r.Get("/exams/{examId}/item-analysis", m.itemAnalysis)
			r.Get("/exams/{examId}/export", m.exportRekap)
		})
	})
}

// ---- helper bersama ----

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// urlUUID mengambil param path UUID; selain itu 404 (AC-9: ID tenant lain → 404).
func urlUUID(r *http.Request, name string) (string, error) {
	v := chi.URLParam(r, name)
	if !uuidRe.MatchString(v) {
		return "", httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Data tidak ditemukan")
	}
	return v, nil
}

// tenantOf mengambil tenant dari JWT; tanpa tenant → tolak.
func tenantOf(r *http.Request) (string, error) {
	t := ctxinfo.TenantID(r.Context())
	if t == "" {
		return "", httpx.NewErr(http.StatusBadRequest, "NO_TENANT", "Akun tanpa tenant")
	}
	return t, nil
}

// parseLimit: default def, dibatasi max.
func parseLimit(s string, def, max int) int {
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return def
	}
	if n > max {
		return max
	}
	return n
}

// Status attempt yang dihitung "selesai" (PRD FR-9.2).
const doneStatuses = `'submitted','graded','pending_sync','expired'`

// participantsExpr menghitung peserta ditugaskan satu ujian: assignment
// (kelas ∪ siswa); bila tidak ada assignment → seluruh siswa aktif tenant.
// %s diganti alias tabel exams pada query pemanggil.
func participantsExpr(examAlias string) string {
	ea := fmt.Sprintf("(SELECT COUNT(1) FROM exam_assignments ea WHERE ea.exam_id = %s.id)", examAlias)
	sa := fmt.Sprintf(`(SELECT 1 FROM exam_assignments ea2 WHERE ea2.exam_id = %s.id AND ea2.target_type='student' AND ea2.student_id = s.id)`, examAlias)
	ca := fmt.Sprintf("(SELECT ea.class_id FROM exam_assignments ea WHERE ea.exam_id = %s.id AND ea.target_type='class')", examAlias)
	return fmt.Sprintf(`CASE WHEN %s > 0 THEN
	(SELECT COUNT(DISTINCT s.id) FROM students s WHERE s.status='active' AND (EXISTS %s OR s.class_id IN %s))
	ELSE (SELECT COUNT(1) FROM students s2 WHERE s2.status='active') END`, ea, sa, ca)
}

// pageCursor: keyset pagination (close_at DESC, id DESC) untuk respons besar.
type pageCursor struct {
	CloseAt time.Time `json:"ca"`
	ID      string    `json:"id"`
}

func encodeCursor(c pageCursor) string {
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(s string) (pageCursor, error) {
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(s))
	if err != nil {
		return pageCursor{}, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Parameter cursor tidak valid")
	}
	var c pageCursor
	if err := json.Unmarshal(b, &c); err != nil || c.ID == "" {
		return pageCursor{}, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Parameter cursor tidak valid")
	}
	return c, nil
}

// optArg: string kosong → nil (SQL NULL) untuk filter opsional.
func optArg(s string) any {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return s
}

// nilPtr: pointer → any (nil tetap null di JSON).
func nilPtr[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}
