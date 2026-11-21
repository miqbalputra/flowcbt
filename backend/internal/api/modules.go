package api

import (
	"log/slog"
	"net/http"
	"runtime"
	"time"

	"flowcbt/backend/internal/app"
	"flowcbt/backend/internal/cards"
	"flowcbt/backend/internal/exams"
	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/questionsets"
	"flowcbt/backend/internal/reports"
	"flowcbt/backend/internal/students"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// mountModules memasang modul fitur sesuai progres pembangunan.
// Setiap modul mengekspos Init(a *app.App).Routes(r chi.Router).
// CATATAN: parameter r adalah router /api/v1 (dipasang oleh router.go).
func mountModules(a *app.App, r chi.Router) {
	// - students
	// - questionsets
	// - exams
	// - attempts
	questionsets.Init(a).Routes(r) // bank soal AKM (PRD M4) + media
	students.Init(a).Routes(r)     // kelas, siswa, import/export, auth siswa (PRD M3, M1.3)
	exams.Init(a).Routes(r)        // ujian & pengerjaan (PRD M5–M8)
	reports.Init(a).Routes(r)
	cards.Init(a).Routes(r) // kartu ujian (kartu peserta TKA) + identitas sekolah
	registered := []string{"questionsets", "students", "exams", "reports", "cards"}
	_ = registered
}

func logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		slog.Info("request",
			"method", r.Method, "path", r.URL.Path, "status", ww.Status(),
			"bytes", ww.BytesWritten(), "dur", time.Since(start).String(), "ip", r.RemoteAddr,
			"req_id", middleware.GetReqID(r.Context()))
	})
}

func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				// Stack penuh & request-id hanya di log server (korelasi
				// investigasi) — JANGAN pernah dikirim ke klien.
				reqID := middleware.GetReqID(r.Context())
				stack := make([]byte, 8192)
				n := runtime.Stack(stack, false)
				slog.Error("panic pulih oleh recoverer",
					"err", rec, "req_id", reqID,
					"method", r.Method, "path", r.URL.Path, "ip", r.RemoteAddr,
					"stack", string(stack[:n]))
				httpx.JSON(w, http.StatusInternalServerError,
					&httpx.APIError{Status: http.StatusInternalServerError,
						Code: "INTERNAL", Message: "Terjadi kesalahan internal"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}
