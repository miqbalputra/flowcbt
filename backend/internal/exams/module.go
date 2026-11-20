// Package exams — modul Ujian & Pengerjaan FlowCBT (PRD M5, M6, M7, M8).
//
// M5  Pengaturan & penjadwalan ujian: CRUD staf, publish (kuota billing),
//
//	token, penugasan (exam_assignments), rilis nilai.
//
// M6  Klien CBT siswa: daftar ujian, start/resume attempt, paket soal
//
//	tanpa kunci jawaban, submit idempoten.
//
// M7  Offline & sinkronisasi: antrean jawaban per client_event_id (AC-3).
// M8  Penilaian otomatis via internal/grading, regrade, laporan & keputusan
//
//	kecurangan (FR-5.8, FR-8.4).
//
// Aturan penting:
//   - Semua query tabel data tenant WAJIB lewat m.a.DB.WithTenant agar RLS
//     (app.tenant_id) aktif. Pool Admin hanya untuk jalur billing (kuota &
//     kredit ujian) seperti pada modul billing.
//   - Penilaian soal WAJIB lewat internal/grading (Grade/FinalScore/ApplyPenalty).
//   - ID pada request path divalidasi UUID (ID tenant lain → 404, AC-9).
package exams

import (
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/app"
	"flowcbt/backend/internal/billing"
	"flowcbt/backend/internal/httpmw"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
)

// Module modul ujian & pengerjaan (M5–M8).
type Module struct {
	a       *app.App
	billing *billing.Module
}

// Init menghubungkan modul ke container dependency aplikasi.
func Init(a *app.App) *Module {
	return &Module{a: a, billing: billing.Init(a)}
}

// Routes memasang semua endpoint modul ujian pada router /api/v1.
func (m *Module) Routes(r chi.Router) {
	// ---- Staf: kelola ujian & pemantauan (owner/teacher/superadmin) ----
	r.Route("/exams", func(r chi.Router) {
		r.Use(httpmw.RequireAuth(m.a.Cfg.JWTSecret, "owner", "teacher", "superadmin"))

		r.Get("/", m.listExams)
		r.Post("/", m.createExam)

		r.Route("/{examID}", func(r chi.Router) {
			r.Get("/", m.getExam)
			r.Put("/", m.updateExam)
			r.Delete("/", m.deleteExam)
			r.Post("/publish", m.publishExam)
			r.Post("/unpublish", m.unpublishExam)
			r.Post("/token/regenerate", m.regenerateToken)
			r.Put("/assignments", m.setAssignments)
			r.Put("/release-scores", m.releaseScores)

			// Pemantauan & aksi pengawas (FR-5.7, FR-8.4, FR-5.8C)
			r.Get("/attempts", m.listAttempts)
			r.Post("/regrade", m.regrade)
			r.Get("/cheating-report", m.cheatingReport)
			r.Put("/cheating-decision", m.cheatingDecision)

			r.Route("/participants/{studentID}", func(r chi.Router) {
				r.Post("/extend-time", m.extendTime)
				r.Post("/reset-attempt", m.resetAttempt)
				r.Post("/force-submit", m.forceSubmit)
			})

			// Penilaian guru (FR-8.3/8.4, alias staf juga di /attempts)
			r.Get("/attempts/{attemptID}/grading", m.getGrading)
			r.Put("/attempts/{attemptID}/answers/{questionID}/score", m.putAnswerScore)
			r.Put("/attempts/{attemptID}/cheating-decision", m.attemptCheatingDecision)

			// Snapshot proktor (lihat foto, staf-only).
			r.Get("/snapshots/{attemptID}/{snapID}", m.serveSnapshot)
		})
	})

	// ---- Alias top-level /attempts (PRD §9): klien CBT siswa ----
	r.Route("/attempts", func(r chi.Router) {
		r.Use(httpmw.RequireAuth(m.a.Cfg.JWTSecret, "student", "owner", "teacher", "superadmin"))
		r.Route("/{attemptID}", func(r chi.Router) {
			r.Get("/", m.getAttempt)
			r.Post("/answers:sync", m.syncAnswers)
			r.Post("/submit", m.submitAttempt)
			r.Post("/violations", m.reportViolation)
			r.Post("/snapshots", m.uploadSnapshot)
			r.Get("/result", m.getResult)
			// staf:
			r.Get("/grading", m.getGrading)
			r.Put("/answers/{questionID}/score", m.putAnswerScore)
			r.Put("/cheating-decision", m.attemptCheatingDecision)
		})
	})

	// ---- Siswa: klien CBT (M6/M7) ----
	r.Route("/student", func(r chi.Router) {
		r.Use(httpmw.RequireAuth(m.a.Cfg.JWTSecret, "student"))

		r.Get("/me/exams", m.myExams)
		r.Get("/me/history", m.myHistory)
		r.Post("/exams/{examID}/start", m.studentStart)
		r.Get("/exams/{examID}", m.studentExam)

		r.Route("/attempts/{attemptID}", func(r chi.Router) {
			r.Get("/", m.getAttempt)
			r.Post("/answers:sync", m.syncAnswers)
			r.Post("/submit", m.submitAttempt)
			r.Post("/violations", m.reportViolation)
			r.Post("/snapshots", m.uploadSnapshot)
			r.Get("/result", m.getResult)
		})
	})
}

// ---- Helper kecil yang dipakai beberapa handler ----

// nowTS waktu server (dipisah agar mudah diuji).
func nowTS() time.Time { return time.Now() }

// normalizeToken membuang spasi dan uppercase token ujian (case-insensitive).
func normalizeToken(s string) string {
	return strings.ToUpper(strings.TrimSpace(s))
}

// statusOK shorthand respons sukses.
func ok(w http.ResponseWriter, data any) { httpx.OK(w, map[string]any{"data": data}) }
