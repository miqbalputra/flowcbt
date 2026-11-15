package questionbank

import (
	"context"
	"time"
		"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/platform"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

var questionTypes = map[string]bool{
	"mcq": true, "mcq_complex": true, "matching": true, "short_answer": true, "essay": true,
}

// QuestionDTO sesuai FR-4.3.
type QuestionDTO struct {
	ID            string          `json:"id,omitempty"`
	OrderNo       int             `json:"order_no"`
	Type          string          `json:"type"`
	StimulusID    *string         `json:"stimulus_id,omitempty"`
	BodyHTML      string          `json:"body_html"`
	OptionsJSON   json.RawMessage `json:"options_json"`
	AnswerKeyJSON json.RawMessage `json:"answer_key_json"`
	RubricJSON    json.RawMessage `json:"rubric_json"`
	Points        float64         `json:"points"`
	ScoringMode   string          `json:"scoring_mode"`
	PartialWrongPenalty bool        `json:"partial_wrong_penalty"`
	ShuffleOptions bool           `json:"shuffle_options"`
	ExplanationHTML string        `json:"explanation_html"`
	MediaIDs      []string        `json:"media_ids"`
}

// editableVersion: bila paket published, clone versi published ke draft baru agar soal bisa diubah (FR-4.8).
func editableVersion(ctx context.Context, tx pgx.Tx, tenantID, setID string) (string, error) {
	var status string
	var draftVer, pubVer *string
	if err := tx.QueryRow(ctx,
		`SELECT status, draft_version_id, published_version_id FROM question_sets WHERE tenant_id=$1 AND id=$2`,
		tenantID, setID).Scan(&status, &draftVer, &pubVer); err != nil {
		return "", httpx.NotFound("paket soal tidak ditemukan")
	}
	if status == "archived" {
		return "", httpx.BadRequest(httpx.CodeValidation, "paket sudah diarsipkan")
	}
	if status == "draft" {
		if draftVer == nil {
			return "", httpx.BadRequest(httpx.CodeValidation, "paket belum punya versi draft")
		}
		return *draftVer, nil
	}
	// published: pakai draft bila sudah berisi soal; jika masih kosong, clone dari published
	var cnt int
	if draftVer != nil {
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM questions WHERE set_version_id=$1`, *draftVer).Scan(&cnt); err != nil {
			return "", err
		}
	}
	if draftVer != nil {
		// sudah ada draft: bila masih kosong, clone konten published ke draft itu (jangan buat draft baru — ada unique index satu draft)
		if cnt == 0 && pubVer != nil {
			if _, err := tx.Exec(ctx,
				`INSERT INTO questions (tenant_id, set_version_id, order_no, type, stimulus_id, body_html, options_json, answer_key_json, rubric_json, points, scoring_mode, partial_wrong_penalty, shuffle_options, explanation_html, media_ids)
				 SELECT tenant_id, $1, order_no, type, NULL, body_html, options_json, answer_key_json, rubric_json, points, scoring_mode, partial_wrong_penalty, shuffle_options, explanation_html, media_ids
				 FROM questions WHERE set_version_id=$2`, *draftVer, *pubVer); err != nil {
				return "", err
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO stimuli (tenant_id, set_version_id, order_no, title, content_html, media_ids)
				 SELECT tenant_id, $1, order_no, title, content_html, media_ids FROM stimuli WHERE set_version_id=$2`, *draftVer, *pubVer); err != nil {
				return "", err
			}
		}
		return *draftVer, nil
	}
	if pubVer == nil {
		return "", httpx.BadRequest(httpx.CodeValidation, "tidak ada versi published untuk di-clone")
	}
	var maxVer int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(max(version_no),0) FROM question_set_versions WHERE question_set_id=$1`, setID).Scan(&maxVer); err != nil {
		return "", err
	}
	var newDraft string
	if err := tx.QueryRow(ctx,
		`INSERT INTO question_set_versions (tenant_id, question_set_id, version_no, status) VALUES ($1,$2,$3,'draft') RETURNING id`,
		tenantID, setID, maxVer+1).Scan(&newDraft); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO questions (tenant_id, set_version_id, order_no, type, stimulus_id, body_html, options_json, answer_key_json, rubric_json, points, scoring_mode, partial_wrong_penalty, shuffle_options, explanation_html, media_ids)
		 SELECT tenant_id, $1, order_no, type, NULL, body_html, options_json, answer_key_json, rubric_json, points, scoring_mode, partial_wrong_penalty, shuffle_options, explanation_html, media_ids
		 FROM questions WHERE set_version_id=$2`, newDraft, *pubVer); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO stimuli (tenant_id, set_version_id, order_no, title, content_html, media_ids)
		 SELECT tenant_id, $1, order_no, title, content_html, media_ids FROM stimuli WHERE set_version_id=$2`, newDraft, *pubVer); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `UPDATE question_sets SET draft_version_id=$1 WHERE id=$2`, newDraft, setID); err != nil {
		return "", err
	}
	return newDraft, nil
}

func (s *Service) listQuestions(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	setID := chi.URLParam(r, "id")
	var out []map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		verID, _, err := currentVersionID(r.Context(), tx, tid, setID)
		if err != nil {
			return httpx.NotFound("paket tidak ditemukan")
		}
		rws, err := tx.Query(r.Context(),
			`SELECT id, order_no, type, stimulus_id, body_html, options_json, answer_key_json, rubric_json, points, scoring_mode, partial_wrong_penalty, shuffle_options, explanation_html, media_ids, updated_at
			 FROM questions WHERE set_version_id=$1 ORDER BY order_no`, verID)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var q QuestionDTO
			var stim *string
			var expl *string
			var media []string
			var upd time.Time
			if err := rws.Scan(&q.ID, &q.OrderNo, &q.Type, &stim, &q.BodyHTML, &q.OptionsJSON, &q.AnswerKeyJSON, &q.RubricJSON, &q.Points, &q.ScoringMode, &q.PartialWrongPenalty, &q.ShuffleOptions, &expl, &media, &upd); err != nil {
				return err
			}
			q.StimulusID = stim
			if expl != nil {
				q.ExplanationHTML = *expl
			}
			q.MediaIDs = media
			out = append(out, map[string]any{
				"id": q.ID, "order_no": q.OrderNo, "type": q.Type, "stimulus_id": q.StimulusID,
				"body_html": q.BodyHTML, "options_json": rawOrEmpty(q.OptionsJSON), "answer_key_json": rawOrNull(q.AnswerKeyJSON),
				"rubric_json": rawOrNull(q.RubricJSON), "points": q.Points, "scoring_mode": q.ScoringMode,
				"partial_wrong_penalty": q.PartialWrongPenalty, "shuffle_options": q.ShuffleOptions,
				"explanation_html": q.ExplanationHTML, "media_ids": q.MediaIDs, "updated_at": upd,
			})
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if out == nil {
		out = []map[string]any{}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func rawOrEmpty(b json.RawMessage) json.RawMessage {
	if len(b) == 0 || string(b) == "null" {
		return json.RawMessage("[]")
	}
	return b
}

func rawOrNull(b json.RawMessage) json.RawMessage {
	if len(b) == 0 {
		return nil
	}
	return b
}

func validateQuestion(in *QuestionDTO) error {
	if !questionTypes[in.Type] {
		return fmt.Errorf("tipe soal tidak dikenal: %s", in.Type)
	}
	if strings.TrimSpace(stripTags(in.BodyHTML)) == "" {
		return fmt.Errorf("pertanyaan wajib diisi")
	}
	if in.Points <= 0 {
		return fmt.Errorf("poin harus lebih dari 0")
	}
	switch in.Type {
	case "mcq":
		var opts []map[string]any
		if err := json.Unmarshal(rawOrEmpty(in.OptionsJSON), &opts); err != nil || len(opts) < 2 {
			return fmt.Errorf("pilihan ganda butuh minimal 2 opsi")
		}
		var key map[string]any
		if err := json.Unmarshal(rawOrNull(in.AnswerKeyJSON), &key); err != nil || key["correct"] == nil {
			return fmt.Errorf("kunci jawaban wajib diisi")
		}
	case "mcq_complex":
		var key map[string]any
		if err := json.Unmarshal(rawOrNull(in.AnswerKeyJSON), &key); err != nil {
			return fmt.Errorf("kunci jawaban wajib diisi")
		}
		if arr, ok := key["correct"].([]any); !ok || len(arr) < 1 {
			return fmt.Errorf("PG kompleks butuh minimal 1 kunci benar")
		}
	case "matching":
		var opts struct {
			Left  []map[string]any `json:"left"`
			Right []map[string]any `json:"right"`
		}
		if err := json.Unmarshal(rawOrEmpty(in.OptionsJSON), &opts); err != nil || len(opts.Left) < 2 || len(opts.Right) < 2 {
			return fmt.Errorf("menjodohkan butuh minimal 2 item kiri & kanan")
		}
		var key map[string]any
		if err := json.Unmarshal(rawOrNull(in.AnswerKeyJSON), &key); err != nil {
			return fmt.Errorf("kunci pasangan wajib diisi")
		}
	case "short_answer":
		var key map[string]any
		if err := json.Unmarshal(rawOrNull(in.AnswerKeyJSON), &key); err != nil {
			return fmt.Errorf("kunci jawaban wajib diisi")
		}
		if arr, ok := key["accepted"].([]any); !ok || len(arr) < 1 {
			return fmt.Errorf("isian singkat butuh minimal 1 variasi kunci (accepted)")
		}
	case "essay":
		if len(rawOrNull(in.RubricJSON)) == 0 {
			return fmt.Errorf("uraian butuh rubrik penilaian")
		}
	}
	if in.ScoringMode == "" {
		in.ScoringMode = "all_or_nothing"
	}
	return nil
}

func stripTags(s string) string {
	var b strings.Builder
	inTag := false
	for _, r := range s {
		if r == '<' {
			inTag = true
			continue
		}
		if r == '>' {
			inTag = false
			continue
		}
		if !inTag {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func (s *Service) addQuestion(w http.ResponseWriter, r *http.Request) {
	var in QuestionDTO
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	if err := validateQuestion(&in); err != nil {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, err.Error()))
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	setID := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	in.BodyHTML = httpx.SanitizeHTML(in.BodyHTML)
	in.ExplanationHTML = httpx.SanitizeHTML(in.ExplanationHTML)
	var qid string
	var orderNo int
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		verID, err := editableVersion(r.Context(), tx, tid, setID)
		if err != nil {
			return err
		}
		if in.MediaIDs == nil {
			in.MediaIDs = []string{}
		}
		if in.OrderNo <= 0 {
			if err := tx.QueryRow(r.Context(), `SELECT COALESCE(max(order_no),0)+1 FROM questions WHERE set_version_id=$1`, verID).Scan(&orderNo); err != nil {
				return err
			}
		} else {
			orderNo = in.OrderNo
		}
		err = tx.QueryRow(r.Context(),
			`INSERT INTO questions (tenant_id, set_version_id, order_no, type, stimulus_id, body_html, options_json, answer_key_json, rubric_json, points, scoring_mode, partial_wrong_penalty, shuffle_options, explanation_html, media_ids)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULLIF($14,''),$15) RETURNING id`,
			tid, verID, orderNo, in.Type, in.StimulusID, in.BodyHTML, rawOrEmpty(in.OptionsJSON), rawOrNull(in.AnswerKeyJSON), rawOrNull(in.RubricJSON),
			in.Points, in.ScoringMode, in.PartialWrongPenalty, in.ShuffleOptions, in.ExplanationHTML, in.MediaIDs).Scan(&qid)
		if err != nil {
			return err
		}
		s.refreshCounts(r.Context(), tx, verID)
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "question.create", "question", qid, map[string]any{"type": in.Type}, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": qid, "order_no": orderNo})
}

func (s *Service) updateQuestion(w http.ResponseWriter, r *http.Request) {
	var in QuestionDTO
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	if err := validateQuestion(&in); err != nil {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, err.Error()))
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	qid := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	in.BodyHTML = httpx.SanitizeHTML(in.BodyHTML)
	in.ExplanationHTML = httpx.SanitizeHTML(in.ExplanationHTML)
	if in.MediaIDs == nil {
		in.MediaIDs = []string{}
	}
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var setID, verID string
		var verStatus string
		if err := tx.QueryRow(r.Context(),
			`SELECT q.set_version_id, qs.id, v.status FROM questions q
			 JOIN question_set_versions v ON v.id=q.set_version_id
			 JOIN question_sets qs ON qs.id=v.question_set_id
			 WHERE q.tenant_id=$1 AND q.id=$2`, tid, qid).Scan(&verID, &setID, &verStatus); err != nil {
			return httpx.NotFound("soal tidak ditemukan")
		}
		targetVer := verID
		if verStatus == "published" {
			// clone ke draft baru (FR-4.8)
			tv, err := editableVersion(r.Context(), tx, tid, setID)
			if err != nil {
				return err
			}
			targetVer = tv
			// salin soal yang diedit ke versi draft
			if err := tx.QueryRow(r.Context(),
				`INSERT INTO questions (tenant_id, set_version_id, order_no, type, stimulus_id, body_html, options_json, answer_key_json, rubric_json, points, scoring_mode, partial_wrong_penalty, shuffle_options, explanation_html, media_ids)
				 SELECT tenant_id, $1, order_no, type, stimulus_id, body_html, options_json, answer_key_json, rubric_json, points, scoring_mode, partial_wrong_penalty, shuffle_options, explanation_html, media_ids
				 FROM questions WHERE id=$2 ON CONFLICT (set_version_id, order_no) DO NOTHING RETURNING id`, targetVer, qid).Scan(new(string)); err != nil {
				// bila sudah ada (order_no sama), update saja
			}
			// cari id soal hasil clone di draft
			if err := tx.QueryRow(r.Context(),
				`SELECT id FROM questions WHERE set_version_id=$1 AND order_no=(SELECT order_no FROM questions WHERE id=$2)`, targetVer, qid).Scan(&qid); err != nil {
				return err
			}
		}
		tag, err := tx.Exec(r.Context(),
			`UPDATE questions SET order_no=$1, type=$2, stimulus_id=$3, body_html=$4, options_json=$5, answer_key_json=$6, rubric_json=$7, points=$8, scoring_mode=$9, partial_wrong_penalty=$10, shuffle_options=$11, explanation_html=NULLIF($12,'') WHERE tenant_id=$13 AND id=$14`,
			in.OrderNo, in.Type, in.StimulusID, in.BodyHTML, rawOrEmpty(in.OptionsJSON), rawOrNull(in.AnswerKeyJSON), rawOrNull(in.RubricJSON),
			in.Points, in.ScoringMode, in.PartialWrongPenalty, in.ShuffleOptions, in.ExplanationHTML, tid, qid)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("soal tidak ditemukan")
		}
		s.refreshCounts(r.Context(), tx, targetVer)
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "question.update", "question", qid, map[string]any{"answer_key_changed": true}, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) deleteQuestion(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	qid := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var setID, verID, verStatus string
		if err := tx.QueryRow(r.Context(),
			`SELECT q.set_version_id, qs.id, v.status FROM questions q
			 JOIN question_set_versions v ON v.id=q.set_version_id JOIN question_sets qs ON qs.id=v.question_set_id
			 WHERE q.tenant_id=$1 AND q.id=$2`, tid, qid).Scan(&verID, &setID, &verStatus); err != nil {
			return httpx.NotFound("soal tidak ditemukan")
		}
		targetVer := verID
		if verStatus == "published" {
			tv, err := editableVersion(r.Context(), tx, tid, setID)
			if err != nil {
				return err
			}
			targetVer = tv
		}
		tag, err := tx.Exec(r.Context(), `DELETE FROM questions WHERE tenant_id=$1 AND id=$2 AND set_version_id=$3`, tid, qid, targetVer)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			if verStatus == "published" {
				// hapus dari hasil clone draft
				tag, err = tx.Exec(r.Context(),
					`DELETE FROM questions q USING questions src WHERE q.tenant_id=$1 AND src.id=$2 AND q.set_version_id=$3 AND q.order_no=src.order_no`, tid, qid, targetVer)
				if err != nil {
					return err
				}
			}
			if tag.RowsAffected() == 0 {
				return httpx.NotFound("soal tidak ditemukan")
			}
		}
		s.refreshCounts(r.Context(), tx, targetVer)
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "question.delete", "question", qid, nil, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// reorder: urutan soal via drag & drop (FR-4.4).
func (s *Service) reorder(w http.ResponseWriter, r *http.Request) {
	var in struct {
		SetID     string   `json:"set_id"`
		Order     []string `json:"question_ids"` // urutan baru
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	actor := httpx.ActorIDFrom(r.Context())
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		verID, err := editableVersion(r.Context(), tx, tid, in.SetID)
		if err != nil {
			return err
		}
		for i, qid := range in.Order {
			if _, err := tx.Exec(r.Context(),
				`UPDATE questions SET order_no=$1 WHERE tenant_id=$2 AND id=$3 AND set_version_id=$4`,
				i+1, tid, qid, verID); err != nil {
				return err
			}
		}
		s.refreshCounts(r.Context(), tx, verID)
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "question.reorder", "question_set", in.SetID, map[string]any{"order": in.Order}, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) refreshCounts(ctx context.Context, tx pgx.Tx, verID string) {
	_, _ = tx.Exec(ctx,
		`UPDATE question_set_versions SET question_count=(SELECT count(*) FROM questions WHERE set_version_id=$1),
		 max_points=(SELECT COALESCE(sum(points),0) FROM questions WHERE set_version_id=$1) WHERE id=$1`, verID)
}

// --- Stimulus (teks wacana bersama, khas AKM) ---

func (s *Service) listStimuli(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	setID := chi.URLParam(r, "id")
	var out []map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		verID, _, err := currentVersionID(r.Context(), tx, tid, setID)
		if err != nil {
			return httpx.NotFound("paket tidak ditemukan")
		}
		rws, err := tx.Query(r.Context(), `SELECT id, order_no, title, content_html, media_ids FROM stimuli WHERE set_version_id=$1 ORDER BY order_no`, verID)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var id, orderNo, content string
			var title *string
			var media []string
			if err := rws.Scan(&id, &orderNo, &title, &content, &media); err != nil {
				return err
			}
			out = append(out, map[string]any{"id": id, "order_no": orderNo, "title": title, "content_html": content, "media_ids": media})
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if out == nil {
		out = []map[string]any{}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func (s *Service) addStimulus(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title       *string  `json:"title"`
		ContentHTML string   `json:"content_html"`
		MediaIDs    []string `json:"media_ids"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	setID := chi.URLParam(r, "id")
	var id string
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		verID, err := editableVersion(r.Context(), tx, tid, setID)
		if err != nil {
			return err
		}
		var order int
		if err := tx.QueryRow(r.Context(), `SELECT COALESCE(max(order_no),0)+1 FROM stimuli WHERE set_version_id=$1`, verID).Scan(&order); err != nil {
			return err
		}
		return tx.QueryRow(r.Context(),
			`INSERT INTO stimuli (tenant_id, set_version_id, order_no, title, content_html, media_ids) VALUES ($1,$2,$3,$4,$5,COALESCE($6::uuid[],'{}'::uuid[])) RETURNING id`,
			tid, verID, order, in.Title, httpx.SanitizeHTML(in.ContentHTML), in.MediaIDs).Scan(&id)
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (s *Service) updateStimulus(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title       *string  `json:"title"`
		ContentHTML string   `json:"content_html"`
		MediaIDs    []string `json:"media_ids"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(),
			`UPDATE stimuli SET title=$1, content_html=$2, media_ids=$3::uuid[] WHERE tenant_id=$4 AND id=$5`,
			in.Title, httpx.SanitizeHTML(in.ContentHTML), in.MediaIDs, tid, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("stimulus tidak ditemukan")
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) deleteStimulus(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(), `DELETE FROM stimuli WHERE tenant_id=$1 AND id=$2`, tid, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("stimulus tidak ditemukan")
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- Media upload (gambar/audio soal) ---

func (s *Service) uploadMedia(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	actor := httpx.ActorIDFrom(r.Context())
	mr, err := r.MultipartReader()
	if err != nil {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "unggah via multipart"))
		return
	}
	part, err := mr.NextPart()
	if err != nil {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "file tidak ditemukan"))
		return
	}
	const maxSize = 10 << 20 // 10 MB
	limited := http.MaxBytesReader(w, part, maxSize)
	data, err := readAll(limited)
	if err != nil {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "file terlalu besar (maks 10MB)"))
		return
	}
	kind := "image"
	if strings.HasPrefix(part.Header.Get("Content-Type"), "audio/") {
		kind = "audio"
	}
	objKey := platform.TenantKey(tid, "media", part.FileName())
	var mediaID string
	storage := s.Media
	if storage == nil {
		httpx.WriteError(w, httpx.Internal(fmt.Errorf("storage belum dikonfigurasi")))
		return
	}
	if err := storage.Put(r.Context(), objKey, &byteReader{data}, int64(len(data)), part.Header.Get("Content-Type")); err != nil {
		httpx.WriteError(w, err)
		return
	}
	err = s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		// kuota penyimpanan tenant (FR 3.2)
		var used, quota int64
		if err := tx.QueryRow(r.Context(), `SELECT storage_used_bytes, storage_quota_bytes FROM tenants WHERE id=$1`, tid).Scan(&used, &quota); err != nil {
			return err
		}
		if used+int64(len(data)) > quota {
			return httpx.Err(httpx.CodeQuotaExceeded, "kuota penyimpanan media 1 GB terlampaui", 409)
		}
		if err := tx.QueryRow(r.Context(),
			`INSERT INTO media_assets (tenant_id, kind, object_key, mime, size_bytes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
			tid, kind, objKey, part.Header.Get("Content-Type"), len(data), actor).Scan(&mediaID); err != nil {
			return err
		}
		_, err := tx.Exec(r.Context(), `UPDATE tenants SET storage_used_bytes = storage_used_bytes + $1 WHERE id=$2`, len(data), tid)
		return err
	})
	if err != nil {
		_ = storage.Delete(r.Context(), objKey)
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": mediaID, "object_key": objKey})
}

type byteReader struct{ b []byte }

func (r *byteReader) Read(p []byte) (int, error) {
	if len(r.b) == 0 {
		return 0, io.EOF
	}
	n := copy(p, r.b)
	r.b = r.b[n:]
	return n, nil
}

func readAll(r interface{ Read([]byte) (int, error) }) ([]byte, error) {
	var out []byte
	buf := make([]byte, 32*1024)
	for {
		n, err := r.Read(buf)
		out = append(out, buf[:n]...)
		if err != nil {
			if errors.Is(err, io.EOF) {
				return out, nil
			}
			return out, err
		}
	}
}
