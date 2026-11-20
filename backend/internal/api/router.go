package api

import (
	"context"
	"net/http"
	"time"

	"flowcbt/backend/internal/app"
	"flowcbt/backend/internal/billing"
	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/users"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func NewRouter(a *app.App) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(logger)
	r.Use(recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// /healthz — liveness ringan (tanpa DB): hanya memastikan proses hidup.
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.OK(w, map[string]any{"status": "ok", "time": time.Now()})
	})

	// /readyz — readiness nyata: SIAP melayani hanya bila kedua pool
	// (Admin & App/RLS) merespons ping. Dipakai orchestrator (Coolify /
	// nginx upstream check) untuk menahan traffic saat deploy atau
	// recovery DB; gagal → 503 (bukan 200 dangkal seperti liveness).
	r.Get("/readyz", readyzHandler(a))

	// CATATAN TIMPAAN — sengaja TANPA middleware timeout global
	// (httpmw.WithRequestTimeout / http.TimeoutHandler pada grup /api/v1):
	// SSE /reports/live/stream (FR-9.3) menahan koneksi hingga 30 menit,
	// dan chi tidak punya mekanisme exclude per-route. Budget waktu
	// per-handler sudah dijaga internal (query timeout DB, WithTenant,
	// batas body per-request). Timeout transport dikendalikan di
	// cmd/api/main.go (ReadHeaderTimeout/ReadTimeout; WriteTimeout=0
	// agar SSE tidak terpotong).
	v1 := chi.NewRouter()
	users.Init(a).Routes(v1)
	billing.Init(a).Routes(v1)
	mountModules(a, v1) // modul fitur (dibangun bertahap)

	r.Route("/api/v1", func(r chi.Router) {
		r.Mount("/", v1)
	})

	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		httpx.Error(w, httpx.ErrNotFound)
	})
	return r
}

// readyzHandler ping kedua pool dengan timeout 1 detik per pool.
// Gagal satu pun pool → 503; kedua sehat → 200 {"status":"ready"}.
func readyzHandler(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		adminCtx, cancelAdmin := context.WithTimeout(r.Context(), 1*time.Second)
		defer cancelAdmin()
		if err := a.DB.Admin.Ping(adminCtx); err != nil {
			httpx.JSON(w, http.StatusServiceUnavailable,
				&httpx.APIError{Status: http.StatusServiceUnavailable, Code: "NOT_READY",
					Message: "Pool admin belum siap"})
			return
		}
		appCtx, cancelApp := context.WithTimeout(r.Context(), 1*time.Second)
		defer cancelApp()
		if err := a.DB.App.Ping(appCtx); err != nil {
			httpx.JSON(w, http.StatusServiceUnavailable,
				&httpx.APIError{Status: http.StatusServiceUnavailable, Code: "NOT_READY",
					Message: "Pool app (RLS) belum siap"})
			return
		}
		httpx.OK(w, map[string]any{"status": "ready", "time": time.Now()})
	}
}
