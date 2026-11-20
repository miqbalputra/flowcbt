package questionsets

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// ---- Soal ----

type questionPayload struct {
	Type           string          `json:"type" validate:"required"`
	Body           string          `json:"body" validate:"required,min=1"`
	Options        json.RawMessage `json:"options"`
	AnswerKey      json.RawMessage `json:"answer_key"`
	Points         *float64        `json:"points"`
	ScoringMode    string          `json:"scoring_mode"`
	Explanation    string          `json:"explanation"`
	ShuffleOptions *bool           `json:"shuffle_options"`
	StimulusID     string          `json:"stimulus_id" validate:"omitempty,uuid"`
}

// normalize merapikan payload sebelum validasi/disimpan:
// options/answer_key jadi raw JSON, points default 1, scoring default all_or_nothing.
func (p *questionPayload) normalize() (optionsRaw, keyRaw string, points float64, scoringMode string) {
	optionsRaw = normalizeOptions(string(p.Options))
	keyRaw = normalizeOptions(string(p.AnswerKey))
	points = 1
	if p.Points != nil {
		points = *p.Points
	}
	scoringMode = p.ScoringMode
	if scoringMode == "" {
		scoringMode = modeAllOrNothing
	}
	return
}

// normalizeOptions memformat ulang options/answer_key agar indent konsisten.
func normalizeOptions(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return "null"
	}
	var v any
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&v); err != nil {
		return raw // biarkan validator yang menolak bila hancur
	}
	b, err := json.Marshal(v)
	if err != nil {
		return raw
	}
	return string(b)
}

// POST /question-sets/{id}/questions — validasi bentuk per tipe (400 VALIDATION
// bila hancur); order_no = max+1.
func (m *Module) addQuestion(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	setID := chiSetID(r)
	var payload questionPayload
	if !m.decode(w, r, &payload) {
		return
	}
	optionsRaw, keyRaw, points, scoringMode := payload.normalize()
	if _, _, err := validateQuestion(payload.Type, optionsRaw, keyRaw, points, scoringMode); err != nil {
		httpx.Error(w, err)
		return
	}
	body, explanation := sanitizeVar(payload.Body), sanitizeVar(payload.Explanation)
	var stimulusID *string
	var q questionFull
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if payload.StimulusID != "" {
			var n int
			if err := tx.QueryRow(r.Context(),
				`SELECT COUNT(1) FROM stimuli WHERE id=$1 AND question_set_id=$2`,
				payload.StimulusID, setID).Scan(&n); err != nil {
				return err
			}
			if n == 0 {
				return httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Stimulus tidak ada di paket ini")
			}
			sid := payload.StimulusID
			stimulusID = &sid
		}
		err := tx.QueryRow(r.Context(), `
			INSERT INTO questions(tenant_id, question_set_id, order_no, type, stimulus_id, body, options,
				answer_key, points, scoring_mode, explanation, shuffle_options)
			VALUES ($1,$2,(SELECT COALESCE(MAX(order_no),0)+1 FROM questions
				WHERE question_set_id=$2 AND set_version_id IS NULL), $3,$4,$5,$6,$7,$8,$9,$10,$11)
			RETURNING id, question_set_id, set_version_id, order_no, type, stimulus_id, body, options,
				answer_key, points, scoring_mode, explanation, shuffle_options, updated_at`,
			tenantID, setID, payload.Type, stimulusID, body, optionsRaw, keyRaw,
			points, scoringMode, explanation, payload.ShuffleOptions != nil && *payload.ShuffleOptions).
			Scan(&q.ID, &q.QuestionSetID, &q.SetVersionID, &q.OrderNo, &q.Type, &q.StimulusID, &q.Body,
				&q.Options, &q.AnswerKey, &q.Points, &q.ScoringMode, &q.Explanation,
				&q.ShuffleOptions, &q.UpdatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.ErrNotFound
		}
		return err
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	q.StimulusID = stimulusID
	okCreate(w, q)
}

// PUT /questions/{id} — hanya baris kerja; salinan versi terbit terkunci.
func (m *Module) updateQuestion(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	questionID := chi.URLParam(r, "questionID")
	var payload questionPayload
	if !m.decode(w, r, &payload) {
		return
	}
	optionsRaw, keyRaw, points, scoringMode := payload.normalize()
	if _, _, err := validateQuestion(payload.Type, optionsRaw, keyRaw, points, scoringMode); err != nil {
		httpx.Error(w, err)
		return
	}
	body, explanation := sanitizeVar(payload.Body), sanitizeVar(payload.Explanation)
	var q questionFull
	var stimulusID *string
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		var setID string
		var versionID *string
		if err := tx.QueryRow(r.Context(),
			`SELECT question_set_id, set_version_id FROM questions WHERE id=$1`, questionID).
			Scan(&setID, &versionID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.ErrNotFound
			}
			return err
		}
		if versionID != nil {
			return httpx.NewErr(http.StatusConflict, "QUESTION_LOCKED",
				"Soal salinan versi terbit tidak bisa diubah")
		}
		if payload.StimulusID != "" {
			var n int
			if err := tx.QueryRow(r.Context(),
				`SELECT COUNT(1) FROM stimuli WHERE id=$1 AND question_set_id=$2`,
				payload.StimulusID, setID).Scan(&n); err != nil {
				return err
			}
			if n == 0 {
				return httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Stimulus tidak ada di paket ini")
			}
			sid := payload.StimulusID
			stimulusID = &sid
		}
		return tx.QueryRow(r.Context(), `
			UPDATE questions SET type=$2, stimulus_id=$3, body=$4, options=$5, answer_key=$6,
				points=$7, scoring_mode=$8, explanation=$9, shuffle_options=$10, updated_at=now()
			WHERE id=$1
			RETURNING id, question_set_id, set_version_id, order_no, type, stimulus_id, body, options,
				answer_key, points, scoring_mode, explanation, shuffle_options, updated_at`,
			questionID, payload.Type, stimulusID, body, optionsRaw, keyRaw,
			points, scoringMode, explanation, payload.ShuffleOptions != nil && *payload.ShuffleOptions).
			Scan(&q.ID, &q.QuestionSetID, &q.SetVersionID, &q.OrderNo, &q.Type, &q.StimulusID, &q.Body,
				&q.Options, &q.AnswerKey, &q.Points, &q.ScoringMode, &q.Explanation,
				&q.ShuffleOptions, &q.UpdatedAt)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	q.StimulusID = stimulusID
	okList(w, q)
}

// DELETE /questions/{id}
func (m *Module) deleteQuestion(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	questionID := chi.URLParam(r, "questionID")
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		var versionID *string
		if err := tx.QueryRow(r.Context(),
			`SELECT set_version_id FROM questions WHERE id=$1`, questionID).Scan(&versionID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.ErrNotFound
			}
			return err
		}
		if versionID != nil {
			return httpx.NewErr(http.StatusConflict, "QUESTION_LOCKED",
				"Soal salinan versi terbit tidak bisa dihapus")
		}
		_, err := tx.Exec(r.Context(), `DELETE FROM questions WHERE id=$1`, questionID)
		return err
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{"id": questionID, "deleted": true}})
}

// POST /question-sets/{id}/reorder {order:[question_id,...]} — set order_no
// sesuai urutan array; hanya baris kerja.
func (m *Module) reorderQuestions(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	setID := chiSetID(r)
	var req struct {
		Order []string `json:"order" validate:"required,min=1"`
	}
	if !m.decode(w, r, &req) {
		return
	}
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		for i, qid := range req.Order {
			var n int
			if err := tx.QueryRow(r.Context(), `
				SELECT COUNT(1) FROM questions
				WHERE id=$1 AND question_set_id=$2 AND set_version_id IS NULL`, qid, setID).Scan(&n); err != nil {
				return err
			}
			if n == 0 {
				return httpx.NewErr(http.StatusBadRequest, "VALIDATION",
					"Soal urutan ke-"+strconv.Itoa(i+1)+" tidak ada di paket ini")
			}
		}
		for i, qid := range req.Order {
			if _, err := tx.Exec(r.Context(), `
				UPDATE questions SET order_no=$2, updated_at=now()
				WHERE id=$1 AND question_set_id=$3 AND set_version_id IS NULL`, qid, i+1, setID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{"set_id": setID, "reordered": len(req.Order)}})
}

// ---- Stimulus ----

// POST /question-sets/{id}/stimuli {title,content,media?}
func (m *Module) addStimulus(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	setID := chiSetID(r)
	var req struct {
		Title   string          `json:"title" validate:"required,min=2,max=200"`
		Content string          `json:"content" validate:"max=20000"`
		Media   json.RawMessage `json:"media"`
	}
	if !m.decode(w, r, &req) {
		return
	}
	var s stimulusSummary
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(), `
			INSERT INTO stimuli(tenant_id, question_set_id, title, content, media)
			VALUES ($1,$2,$3,$4,COALESCE($5,'{}'::jsonb))
			RETURNING id, title, content`,
			tenantID, setID, strings.TrimSpace(req.Title), sanitizeVar(req.Content), req.Media).
			Scan(&s.ID, &s.Title, &s.Content)
		return err
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	okCreate(w, s)
}

// DELETE /stimuli/{id} — soal yang merujuk akan kehilangan stimulus (SET NULL).
func (m *Module) deleteStimulus(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	stimulusID := chi.URLParam(r, "stimulusID")
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(r.Context(), `DELETE FROM stimuli WHERE id=$1`, stimulusID)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return httpx.ErrNotFound
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{"id": stimulusID, "deleted": true}})
}
