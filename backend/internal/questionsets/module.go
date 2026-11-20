package questionsets

import (
	"encoding/json"
	"net/http"
	"time"

	"flowcbt/backend/internal/app"
	"flowcbt/backend/internal/httpmw"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
)

// Module bank soal AKM (PRD M4: FR-4.1..4.9, §18.2).
type Module struct{ a *app.App }

func Init(a *app.App) *Module { return &Module{a: a} }

// Routes dipasang di bawah /api/v1.
func (m *Module) Routes(r chi.Router) {
	r.Route("/question-sets", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(httpmw.RequireAuth(m.a.Cfg.JWTSecret, "owner", "teacher", "superadmin"))
			r.Get("/", m.listSets)
			r.Post("/", m.createSet)
			r.Get("/import/template", m.importTemplate)
			r.Post("/import", m.importSets)
			r.Route("/{setID}", func(r chi.Router) {
				r.Get("/", m.getSet)
				r.Put("/", m.updateSet)
				r.Delete("/", m.deleteSet)
				r.Post("/questions", m.addQuestion)
				r.Post("/reorder", m.reorderQuestions)
				r.Post("/publish", m.publish)
				r.Post("/unpublish", m.unpublish)
				r.Post("/stimuli", m.addStimulus)
				r.Get("/export", m.exportSet)
			})
		})
	})
	r.Route("/questions", func(r chi.Router) {
		r.Use(httpmw.RequireAuth(m.a.Cfg.JWTSecret, "owner", "teacher", "superadmin"))
		r.Put("/{questionID}", m.updateQuestion)
		r.Delete("/{questionID}", m.deleteQuestion)
	})
	r.Route("/stimuli", func(r chi.Router) {
		r.Use(httpmw.RequireAuth(m.a.Cfg.JWTSecret, "owner", "teacher", "superadmin"))
		r.Delete("/{stimulusID}", m.deleteStimulus)
	})
	r.Route("/media", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(httpmw.RequireAuth(m.a.Cfg.JWTSecret, "owner", "teacher", "superadmin"))
			r.Post("/upload", m.uploadMedia)
		})
		// Gambar/audio soal ikut dimuat attempt siswa.
		r.Group(func(r chi.Router) {
			r.Use(httpmw.RequireAuth(m.a.Cfg.JWTSecret, "owner", "teacher", "superadmin", "student"))
			r.Get("/*", m.serveMedia)
		})
	})
}

// ---------- Bentuk data (kontrak FE) ----------

type questionSet struct {
	ID             string    `json:"id"`
	SubjectName    string    `json:"subject_name"`
	Title          string    `json:"title"`
	Description    string    `json:"description"`
	ExamCode       string    `json:"exam_code"`
	LevelTag       string    `json:"level_tag"`
	Status         string    `json:"status"`
	CurrentVersion int       `json:"current_version"`
	QuestionCount  int       `json:"question_count"`
	CreatedBy      string    `json:"created_by,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`

	Questions []questionFull    `json:"questions,omitempty"`
	Stimuli   []stimulusSummary `json:"stimuli,omitempty"`
}

type stimulusSummary struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

// questionFull — lengkap termasuk answer_key (kunci hanya utk guru).
type questionFull struct {
	ID             string          `json:"id"`
	QuestionSetID  string          `json:"question_set_id"`
	SetVersionID   *string         `json:"set_version_id,omitempty"`
	OrderNo        int             `json:"order_no"`
	Type           string          `json:"type"`
	StimulusID     *string         `json:"stimulus_id,omitempty"`
	Body           string          `json:"body"`
	Options        json.RawMessage `json:"options"`
	AnswerKey      json.RawMessage `json:"answer_key"`
	Points         float64         `json:"points"`
	ScoringMode    string          `json:"scoring_mode"`
	Explanation    string          `json:"explanation"`
	ShuffleOptions bool            `json:"shuffle_options"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

type mediaInfo struct {
	URL         string `json:"url"`
	Filename    string `json:"filename"`
	Size        int64  `json:"size"`
	ContentType string `json:"content_type"`
}

func okList(w http.ResponseWriter, data any)   { httpx.OK(w, map[string]any{"data": data}) }
func okCreate(w http.ResponseWriter, data any) { httpx.Created(w, map[string]any{"data": data}) }
