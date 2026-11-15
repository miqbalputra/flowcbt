package server

import (
	"context"
	"log/slog"
	"net/http"

	"flowcbt/backend/internal/admin"
	"flowcbt/backend/internal/attempt"
	"flowcbt/backend/internal/audit"
	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/billing"
	"flowcbt/backend/internal/billing/provider/mayar"
	"flowcbt/backend/internal/billing/provider/midtrans"
	"flowcbt/backend/internal/billing/provider/mock"
	"flowcbt/backend/internal/classroom"
	"flowcbt/backend/internal/exam"
	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/notify"
	"flowcbt/backend/internal/platform"
	"flowcbt/backend/internal/questionbank"
	"flowcbt/backend/internal/realtime"
	"flowcbt/backend/internal/report"
	"flowcbt/backend/internal/retention"
	"flowcbt/backend/internal/student"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5"
)

// Deps berisi semua layanan yang di-wire ke router.
type Deps struct {
	Cfg     platform.Config
	Log     *slog.Logger
	DB      *platform.DB
	Storage platform.Storage
	Mailer  platform.Mailer
	Limiter platform.RateLimiter
	Clock   platform.Clock
	Audit   *audit.Writer
	Hub     *realtime.Hub

	Auth         *auth.Service
	Classroom    *classroom.Service
	Student      *student.Service
	QuestionBank *questionbank.Service
	Exam         *exam.Service
	Attempt      *attempt.Service
	Report       *report.Service
	Billing      *billing.Service
	Admin        *admin.Service
	Notify       *notify.Service
	Retention    *retention.Service

	// handler attempt yang dipasang manual (dipisah peran)
	AttemptStart            http.HandlerFunc
	AttemptRegrade          http.HandlerFunc
	AttemptGet              http.HandlerFunc
	AttemptSync             http.HandlerFunc
	AttemptSubmit           http.HandlerFunc
	AttemptViolations       http.HandlerFunc
	AttemptResult           http.HandlerFunc
	AttemptGrading          http.HandlerFunc
	AttemptPutScore         http.HandlerFunc
	AttemptCheatingDecision http.HandlerFunc
}

func NewDeps(cfg platform.Config, log *slog.Logger) *Deps {
	ctx := context.Background()
	clock := platform.NewClock()
	db, err := platform.NewDB(ctx, cfg)
	if err != nil {
		log.Error("db", "err", err)
		return nil
	}
	storage, err := platform.NewStorage(cfg)
	if err != nil {
		log.Error("storage", "err", err)
		return nil
	}
	mailer := platform.NewMailer(cfg, log)
	limiter := platform.NewRateLimiter(cfg.RedisURL)
	aud := audit.New()
	hub := realtime.NewHub()

	issuer := &auth.Issuer{
		DB: db, Clock: clock, Secret: []byte(cfg.JWTSecret),
		AccessTTL: cfg.JWSAccessTTL, RefreshTTL: cfg.JWTRefreshTTL,
	}
	authSvc := &auth.Service{
		DB: db, Clock: clock, Mailer: mailer, Limiter: limiter, Audit: aud,
		Issuer: issuer, Cfg: cfg,
	}
	if cfg.GoogleClientID != "" {
		authSvc.Google = auth.GoogleTokeninfoVerifier{ClientID: cfg.GoogleClientID}
	}

	notifySvc := &notify.Service{DB: db, Mailer: mailer}

	var provider billing.PaymentProvider
	switch cfg.PaymentProvider {
	case "midtrans":
		provider = &midtrans.Provider{ServerKey: cfg.MidtransServerKey, ClientKey: cfg.MidtransClientKey, IsProduction: cfg.MidtransIsProduction}
	case "mayar":
		provider = &mayar.Provider{APIKey: cfg.MayarAPIKey}
	default:
		provider = &mock.Provider{BaseURL: cfg.PublicBaseURL}
	}
	billingSvc := &billing.Service{
		DB: db, Audit: aud, Clock: clock, Mailer: mailer, Provider: provider,
		Notify: func(ctx context.Context, tenantID, userID, typ, title, body string, data map[string]any) {
			notifySvc.NotifyUser(ctx, tenantID, userID, typ, title, body, data)
		},
	}

	studentSvc := &student.Service{DB: db, Audit: aud, Clock: clock, Limits: billingSvc}
	qbSvc := &questionbank.Service{DB: db, Audit: aud, Clock: clock, Media: storage, Quota: billingSvc}
	examSvc := &exam.Service{DB: db, Audit: aud, Clock: clock, Billing: billingSvc}
	attemptSvc := &attempt.Service{DB: db, Audit: aud, Clock: clock}
	reportSvc := &report.Service{DB: db, Hub: hub, Clock: clock}
	adminSvc := &admin.Service{DB: db, Clock: clock}
	retentionSvc := &retention.Service{DB: db, Audit: aud, Mailer: mailer, Storage: storage, Log: log, Clock: clock}

	return &Deps{
		Cfg: cfg, Log: log, DB: db, Storage: storage, Mailer: mailer,
		Limiter: limiter, Clock: clock, Audit: aud, Hub: hub,
		Auth: authSvc, Classroom: &classroom.Service{DB: db, Audit: aud},
		Student: studentSvc, QuestionBank: qbSvc, Exam: examSvc, Attempt: attemptSvc,
		Report: reportSvc, Billing: billingSvc, Admin: adminSvc, Notify: notifySvc, Retention: retentionSvc,
		AttemptStart:            attemptSvc.StartHandler(),
		AttemptRegrade:          attemptSvc.RegradeHandler(),
		AttemptGet:              attemptSvc.GetHandler(),
		AttemptSync:             attemptSvc.SyncHandler(),
		AttemptSubmit:           attemptSvc.SubmitHandler(),
		AttemptViolations:       attemptSvc.ViolationsHandler(),
		AttemptResult:           attemptSvc.ResultHandler(),
		AttemptGrading:          attemptSvc.GradingHandler(),
		AttemptPutScore:         attemptSvc.PutScoreHandler(),
		AttemptCheatingDecision: attemptSvc.CheatingDecisionHandler(),
	}
}

// Router membangun seluruh route API (/api/v1) + healthz (PRD Bagian 9, 11.1).
func Router(d *Deps) http.Handler {
	httpx.SetJWTSecret(d.Cfg.JWTSecret)
	r := chi.NewRouter()
	r.Use(httpx.RequestID())
	r.Use(httpx.Recoverer(d.Log))
	r.Use(httpx.Logger(d.Log))
	// CORS: allowlist origin dari CORS_ALLOWED_ORIGINS (wajib di produksi, lihat platform.Config.Validate).
	// Bearer token dikirim lewat header, bukan cookie → AllowCredentials false; wildcard hanya untuk dev tanpa cookie.
	corsOrigins := d.Cfg.CORSAllowedOrigins
	if len(corsOrigins) == 0 {
		corsOrigins = []string{"*"} // dev: tidak ada cookie, wildcard aman
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   corsOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Idempotency-Key", "X-Requested-With"},
		AllowCredentials: false,
		MaxAge:           600,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"status": "ok", "time": d.Clock.Now()})
	})
	r.Get("/internal/active-exams", d.internalHandler(func(w http.ResponseWriter, r *http.Request) {
		var n int
		_ = d.DB.WithSystemTx(r.Context(), func(tx pgx.Tx) error {
			return tx.QueryRow(r.Context(),
				`SELECT count(*) FROM exams WHERE status='published' AND open_at <= now() AND close_at >= now()`).Scan(&n)
		})
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"active_exams": n})
	}))

	r.Route("/api/v1", func(r chi.Router) {
		d.Auth.Routes(r)
		d.Billing.RoutesPublic(r) // /plans & webhook publik

		// Rute guru/admin tenant
		r.Group(func(r chi.Router) {
			r.Use(httpx.AuthN())
			r.Use(httpx.RequireTenant())
			r.Use(httpx.RequireRole("owner", "teacher"))
			d.Classroom.Routes(r)
			d.Student.Routes(r)
			d.QuestionBank.Routes(r)
			d.Report.Routes(r)
			d.Billing.RoutesAuthed(r)
			r.Get("/notifications", func(w http.ResponseWriter, r *http.Request) {
				rows, err := d.Notify.List(r.Context(), httpx.TenantIDFrom(r.Context()), httpx.ActorIDFrom(r.Context()))
				if err != nil {
					httpx.WriteError(w, err)
					return
				}
				httpx.WriteJSON(w, http.StatusOK, rows)
			})
		})

		// /exams dan /attempts dipasang sekali, dengan pemisahan peran per rute
		r.Route("/exams", func(r chi.Router) {
			r.Use(httpx.AuthN())
			r.Group(func(r chi.Router) {
				r.Use(httpx.RequireRole("student"))
				r.Post("/{id}/start", d.AttemptStart)
			})
			r.Group(func(r chi.Router) {
				r.Use(httpx.RequireTenant())
				r.Use(httpx.RequireRole("owner", "teacher"))
				d.Exam.Routes(r)
				r.Post("/{id}/regrade", d.AttemptRegrade)
				r.Get("/{id}/attempts", d.Report.AttemptsHandler())
			})
		})
		r.Route("/attempts", func(r chi.Router) {
			r.Use(httpx.AuthN())
			// GET /{id} dipakai siswa (pemulihan, cek kepemilikan di handler) dan guru;
			// didaftarkan sekali agar tidak tertimpa grup guru (RequireTenant menolak student).
			r.Group(func(r chi.Router) {
				r.Use(httpx.RequireRole("student", "owner", "teacher"))
				r.Get("/{id}", d.AttemptGet)
			})
			r.Group(func(r chi.Router) {
				r.Use(httpx.RequireRole("student"))
				r.Post("/{id}/answers:sync", d.AttemptSync)
				r.Post("/{id}/submit", d.AttemptSubmit)
				r.Post("/{id}/violations", d.AttemptViolations)
				r.Get("/{id}/result", d.AttemptResult)
			})
			r.Group(func(r chi.Router) {
				r.Use(httpx.RequireTenant())
				r.Use(httpx.RequireRole("owner", "teacher"))
				r.Get("/{id}/grading", d.AttemptGrading)
				r.Put("/{id}/answers/{qid}/score", d.AttemptPutScore)
				r.Put("/{id}/cheating-decision", d.AttemptCheatingDecision)
			})
		})

		// Rute siswa (/me/exams)
		r.Group(func(r chi.Router) {
			r.Use(httpx.AuthN())
			r.Use(httpx.RequireRole("student"))
			d.Attempt.Routes(r)
		})

		// Super Admin
		r.Group(func(r chi.Router) {
			r.Use(httpx.AuthN())
			r.Use(httpx.RequireRole("super_admin"))
			d.Admin.Routes(r)
		})
	})
	return r
}

// internalHandler memproteksi endpoint /internal/*: di produksi wajib bearer INTERNAL_TOKEN
// (dipakai deploy freeze Coolify — PRD 18.7); di dev tanpa token tidak boleh di prod.
func (d *Deps) internalHandler(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if d.Cfg.Env == "production" {
			got := ""
			if h := r.Header.Get("Authorization"); len(h) > 7 && h[:7] == "Bearer " {
				got = h[7:]
			}
			if d.Cfg.InternalToken == "" || got != d.Cfg.InternalToken {
				d.Log.Warn("internal endpoint diakses tanpa token valid", "ip", r.RemoteAddr)
				httpx.WriteError(w, httpx.Unauthorized("token internal tidak valid"))
				return
			}
		}
		next(w, r)
	}
}
