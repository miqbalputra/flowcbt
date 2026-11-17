package questionbank

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/audit"
	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/platform"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// QuotaGate memeriksa kuota langganan saat publish (AC-7) — diimplementasikan modul billing.
// Pada Fase 1 (S8) bisa nil (stub); penuh di S27.
type QuotaGate interface {
	EnsurePublishable(ctx context.Context, tenantID string) error
}

type Service struct {
	DB    *platform.DB
	Audit *audit.Writer
	Quota QuotaGate
	Clock platform.Clock
	Media MediaStorage
}

type QuestionSet struct {
	ID               string   `json:"id"`
	SubjectName      string   `json:"subject_name"`
	Title            string   `json:"title"`
	Description      *string  `json:"description,omitempty"`
	ExamCode         string   `json:"exam_code"`
	LevelTags        []string `json:"level_tags"`
	Status           string   `json:"status"`
	SharedWithTenant bool     `json:"shared_with_tenant"`
	QuestionCount    int      `json:"question_count"`
	MaxPoints        float64  `json:"max_points"`
	// X-02: bantu klien membedakan konten tampilan vs draft yang sedang diedit.
	EditableVersionID     *string   `json:"editable_version_id,omitempty"`
	HasUnpublishedChanges bool      `json:"has_unpublished_changes,omitempty"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

func (s *Service) Routes(r chi.Router) {
	r.Route("/question-sets", func(r chi.Router) {
		r.Get("/", s.list)
		r.Post("/", s.create)
		r.Get("/import/template", s.importTemplate)
		r.Post("/import", s.importSet)
		r.Get("/{id}", s.get)
		r.Put("/{id}", s.update)
		r.Delete("/{id}", s.archive)
		r.Post("/{id}/duplicate", s.duplicate)
		r.Get("/{id}/export", s.exportSet)
		r.Post("/{id}/publish", s.publish)
		r.Post("/{id}/unpublish", s.unpublish)
		r.Get("/{id}/questions", s.listQuestions)
		r.Post("/{id}/questions", s.addQuestion)
		r.Get("/{id}/stimuli", s.listStimuli)
		r.Post("/{id}/stimuli", s.addStimulus)
	})
	r.Route("/questions", func(r chi.Router) {
		r.Put("/{id}", s.updateQuestion)
		r.Delete("/{id}", s.deleteQuestion)
		r.Post("/reorder", s.reorder)
	})
	r.Route("/stimuli", func(r chi.Router) {
		r.Put("/{id}", s.updateStimulus)
		r.Delete("/{id}", s.deleteStimulus)
	})
	r.Post("/media/upload", s.uploadMedia)
}

func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	q := r.URL.Query().Get("q")
	status := r.URL.Query().Get("status")
	var rows []QuestionSet
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		query := `SELECT qs.id, qs.subject_name, qs.title, qs.description, qs.exam_code, qs.level_tags, qs.status,
		          qs.shared_with_tenant, COALESCE(v.question_count,0), COALESCE(v.max_points,0), qs.created_at, qs.updated_at
		   FROM question_sets qs
		   LEFT JOIN question_set_versions v ON v.id = COALESCE(qs.published_version_id, qs.draft_version_id)
		   WHERE qs.tenant_id=$1 AND qs.archived_at IS NULL`
		args := []any{tid}
		if status != "" {
			query += ` AND qs.status=$2`
			args = append(args, status)
		}
		if q != "" {
			query += ` AND (qs.title || ' ' || qs.subject_name) ILIKE '%'||$` + fmt.Sprint(len(args)+1) + `||'%'`
			args = append(args, q)
		}
		query += ` ORDER BY qs.updated_at DESC LIMIT 200`
		rws, err := tx.Query(r.Context(), query, args...)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var s2 QuestionSet
			if err := rws.Scan(&s2.ID, &s2.SubjectName, &s2.Title, &s2.Description, &s2.ExamCode, &s2.LevelTags, &s2.Status, &s2.SharedWithTenant, &s2.QuestionCount, &s2.MaxPoints, &s2.CreatedAt, &s2.UpdatedAt); err != nil {
				return err
			}
			rows = append(rows, s2)
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if rows == nil {
		rows = []QuestionSet{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

type setInput struct {
	SubjectName string   `json:"subject_name"`
	Title       string   `json:"title"`
	Description *string  `json:"description"`
	ExamCode    string   `json:"exam_code"`
	LevelTags   []string `json:"level_tags"`
}

// create membuat paket soal draft + versi draft (FR-4.1).
func (s *Service) create(w http.ResponseWriter, r *http.Request) {
	var in setInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	in.SubjectName = strings.TrimSpace(in.SubjectName)
	in.Title = strings.TrimSpace(in.Title)
	if in.SubjectName == "" || in.Title == "" {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "nama mata pelajaran dan judul paket wajib diisi"))
		return
	}
	if in.LevelTags == nil {
		in.LevelTags = []string{}
	}
	if in.ExamCode == "" {
		in.ExamCode = strings.ToUpper(platform.RandomToken(6))
	}
	in.ExamCode = strings.ToUpper(strings.TrimSpace(in.ExamCode))
	tid := httpx.TenantIDFrom(r.Context())
	actor := httpx.ActorIDFrom(r.Context())
	var qs QuestionSet
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var setID, verID string
		if err := tx.QueryRow(r.Context(),
			`INSERT INTO question_sets (tenant_id, subject_name, title, description, exam_code, level_tags, status, created_by)
			 VALUES ($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING id`,
			tid, in.SubjectName, in.Title, in.Description, in.ExamCode, in.LevelTags, actor).Scan(&setID); err != nil {
			if strings.Contains(err.Error(), "duplicate") {
				return httpx.Conflict("EXAM_CODE_TAKEN", "kode ujian sudah dipakai paket lain di sekolah ini")
			}
			return err
		}
		if err := tx.QueryRow(r.Context(),
			`INSERT INTO question_set_versions (tenant_id, question_set_id, version_no, status) VALUES ($1,$2,1,'draft') RETURNING id`,
			tid, setID).Scan(&verID); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE question_sets SET draft_version_id=$1 WHERE id=$2`, verID, setID); err != nil {
			return err
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "question_set.create", "question_set", setID, map[string]any{"title": in.Title}, "")
		qs = QuestionSet{ID: setID, SubjectName: in.SubjectName, Title: in.Title, Description: in.Description, ExamCode: in.ExamCode, LevelTags: in.LevelTags, Status: "draft"}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, qs)
}

// X-02/B-01: satu helper dipakai untuk dua semantik yang berbeda — "versi editable"
// dan "konten tampilan". Setelah publish, soal dipindah ke versi published sementara
// draft lama dikosongkan; mengutamakan draft membuat daftar soal jadi kosong.
// Pisahkan menjadi dua helper dengan semantik eksplisit.

// displayVersionID mengembalikan konten resmi yang tampil/ diekspor/ disalin:
// published bila ada, baru draft untuk paket yang belum pernah publish.
func displayVersionID(ctx context.Context, tx pgx.Tx, tenantID, setID string) (string, error) {
	draft, pub, err := repoSelectVersions(ctx, tx, tenantID, setID)
	if err != nil {
		return "", httpx.NotFound("paket tidak ditemukan")
	}
	if pub != nil {
		return *pub, nil
	}
	if draft != nil {
		return *draft, nil
	}
	return "", httpx.NotFound("paket tidak punya versi")
}

// draftVersionID mengembalikan versi yang boleh di-publish. Versi draft lama memang
// sengaja dikosongkan saat publish, jadi ini tidak boleh jatuh ke versi published.
func draftVersionID(ctx context.Context, tx pgx.Tx, tenantID, setID string) (string, error) {
	id, status, err := repoSelectDraftVersion(ctx, tx, tenantID, setID)
	if err != nil {
		return "", httpx.NotFound("paket tidak ditemukan")
	}
	if status != "draft" {
		return "", httpx.BadRequest(httpx.CodeValidation, "draft_version_id tidak menunjuk versi draft")
	}
	return id, nil
}

// versionForRequest: ?version=draft memilih versi editable, selain itu konten tampilan.
func versionForRequest(r *http.Request, ctx context.Context, tx pgx.Tx, tenantID, setID string) (string, error) {
	if r.URL.Query().Get("version") == "draft" {
		return draftVersionID(ctx, tx, tenantID, setID)
	}
	return displayVersionID(ctx, tx, tenantID, setID)
}

func (s *Service) get(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	var qs QuestionSet
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		// X-02: metadata paket published harus mengikuti versi published, bukan draft lama yang dikosongkan.
		if err := tx.QueryRow(r.Context(),
			`SELECT qs.id, qs.subject_name, qs.title, qs.description, qs.exam_code, qs.level_tags, qs.status, qs.shared_with_tenant,
			        COALESCE(v.question_count,0), COALESCE(v.max_points,0), qs.created_at, qs.updated_at
			 FROM question_sets qs LEFT JOIN question_set_versions v ON v.id=COALESCE(qs.published_version_id, qs.draft_version_id)
			 WHERE qs.tenant_id=$1 AND qs.id=$2`, tid, id).
			Scan(&qs.ID, &qs.SubjectName, &qs.Title, &qs.Description, &qs.ExamCode, &qs.LevelTags, &qs.Status, &qs.SharedWithTenant, &qs.QuestionCount, &qs.MaxPoints, &qs.CreatedAt, &qs.UpdatedAt); err != nil {
			return err
		}
		var draftVer *string
		if err := tx.QueryRow(r.Context(), `SELECT draft_version_id FROM question_sets WHERE tenant_id=$1 AND id=$2`, tid, id).Scan(&draftVer); err != nil {
			return err
		}
		qs.EditableVersionID = draftVer
		if qs.Status == "published" && draftVer != nil {
			// Draft terisi berarti ada perubahan yang belum di-publish (editableVersion meng-clone konten saat edit pertama).
			var draftCount int
			if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM questions WHERE set_version_id=$1`, *draftVer).Scan(&draftCount); err != nil {
				return err
			}
			qs.HasUnpublishedChanges = draftCount > 0
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, httpx.NotFound("paket soal tidak ditemukan"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, qs)
}

func (s *Service) update(w http.ResponseWriter, r *http.Request) {
	var in setInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(),
			`UPDATE question_sets SET subject_name=$1, title=$2, description=$3, level_tags=$4, shared_with_tenant=$5 WHERE tenant_id=$6 AND id=$7 AND status='draft'`,
			strings.TrimSpace(in.SubjectName), strings.TrimSpace(in.Title), in.Description, in.LevelTags, r.URL.Query().Get("shared") == "1", tid, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.BadRequest(httpx.CodeValidation, "paket tidak ditemukan atau sudah dipublish (ubah via versi baru)")
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "question_set.update", "question_set", id, nil, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) archive(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(), `UPDATE question_sets SET archived_at=COALESCE(archived_at, now()), status='archived' WHERE tenant_id=$1 AND id=$2`, tid, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("paket tidak ditemukan")
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// duplicate: salin paket + soal ke paket baru (FR-4.1).
func (s *Service) duplicate(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	var newID string
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var src QuestionSet
		if err := tx.QueryRow(r.Context(),
			`SELECT subject_name, title, description, level_tags, shared_with_tenant FROM question_sets WHERE tenant_id=$1 AND id=$2`, tid, id).
			Scan(&src.SubjectName, &src.Title, &src.Description, &src.LevelTags, &src.SharedWithTenant); err != nil {
			return httpx.NotFound("paket tidak ditemukan")
		}
		newCode := strings.ToUpper(platform.RandomToken(6))
		if err := tx.QueryRow(r.Context(),
			`INSERT INTO question_sets (tenant_id, subject_name, title, description, exam_code, level_tags, status, created_by)
			 VALUES ($1,$2,$3||' (salinan)',$4,$5,$6,'draft',$7) RETURNING id`,
			tid, src.SubjectName, src.Title, src.Description, newCode, src.LevelTags, actor).Scan(&newID); err != nil {
			return err
		}
		var verID string
		if err := tx.QueryRow(r.Context(),
			`INSERT INTO question_set_versions (tenant_id, question_set_id, version_no, status) VALUES ($1,$2,1,'draft') RETURNING id`, tid, newID).Scan(&verID); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE question_sets SET draft_version_id=$1 WHERE id=$2`, verID, newID); err != nil {
			return err
		}
		// X-02: salin dari konten tampilan (published bila ada), bukan draft lama yang sudah dikosongkan.
		srcVer, err := displayVersionID(r.Context(), tx, tid, id)
		if err == nil {
			_, err = tx.Exec(r.Context(),
				`INSERT INTO questions (tenant_id, set_version_id, order_no, type, stimulus_id, body_html, options_json, answer_key_json, rubric_json, points, scoring_mode, partial_wrong_penalty, shuffle_options, explanation_html, media_ids)
				 SELECT $1, $2, order_no, type, NULL, body_html, options_json, answer_key_json, rubric_json, points, scoring_mode, partial_wrong_penalty, shuffle_options, explanation_html, media_ids
				 FROM questions WHERE set_version_id=$3`, tid, verID, srcVer)
			if err != nil {
				return err
			}
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "question_set.duplicate", "question_set", newID, map[string]any{"from": id}, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": newID})
}

// publish: validasi kelengkapan → beku versi draft jadi published (versi baru) — FR-4.7/4.8.
func (s *Service) publish(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	if s.Quota != nil {
		if err := s.Quota.EnsurePublishable(r.Context(), tid); err != nil {
			httpx.WriteError(w, err)
			return
		}
	}
	var verID string
	var maxPoints float64
	var qcount int
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var status string
		if err := tx.QueryRow(r.Context(), `SELECT status FROM question_sets WHERE tenant_id=$1 AND id=$2`, tid, id).Scan(&status); err != nil {
			return httpx.NotFound("paket tidak ditemukan")
		}
		if status == "archived" {
			return httpx.BadRequest(httpx.CodeValidation, "paket sudah diarsipkan")
		}
		// X-02: publish wajib mengunci versi draft yang benar, bukan "versi apa pun".
		draftVer, err := draftVersionID(r.Context(), tx, tid, id)
		if err != nil {
			return httpx.BadRequest(httpx.CodeValidation, "paket belum punya versi draft")
		}
		// validasi kelengkapan: tiap soal punya kunci (kecuali uraian pakai rubrik) & poin > 0 (FR-4.7)
		var missing int
		if err := tx.QueryRow(r.Context(),
			`SELECT count(*) FROM questions q WHERE q.set_version_id=$1 AND
			   (q.points <= 0 OR (q.type <> 'essay' AND (q.answer_key_json IS NULL OR q.answer_key_json = 'null' OR q.answer_key_json = '{}')))`,
			draftVer).Scan(&missing); err != nil {
			return err
		}
		if missing > 0 {
			return httpx.ErrDetails(httpx.CodeValidation, fmt.Sprintf("%d soal belum lengkap (kunci jawaban/poin belum diisi)", missing), 422,
				map[string]any{"missing": missing})
		}
		if err := tx.QueryRow(r.Context(), `SELECT count(*), COALESCE(sum(points),0) FROM questions WHERE set_version_id=$1`, draftVer).Scan(&qcount, &maxPoints); err != nil {
			return err
		}
		if qcount == 0 {
			return httpx.BadRequest(httpx.CodeValidation, "paket belum memiliki soal")
		}
		// versi berikutnya: bekukan draft sebagai published
		var maxVer int
		if err := tx.QueryRow(r.Context(), `SELECT COALESCE(max(version_no),0) FROM question_set_versions WHERE question_set_id=$1`, id).Scan(&maxVer); err != nil {
			return err
		}
		newVer := maxVer + 1
		if err := tx.QueryRow(r.Context(),
			`INSERT INTO question_set_versions (tenant_id, question_set_id, version_no, status, question_count, max_points, published_at, published_by)
			 VALUES ($1,$2,$3,'published',$4,$5, now(), $6) RETURNING id`,
			tid, id, newVer, qcount, maxPoints, actor).Scan(&verID); err != nil {
			return err
		}
		// pindahkan soal draft -> versi published (bekukan)
		if _, err := tx.Exec(r.Context(),
			`UPDATE questions SET set_version_id=$1 WHERE set_version_id=$2`, verID, draftVer); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(),
			`UPDATE stimuli SET set_version_id=$1 WHERE set_version_id=$2`, verID, draftVer); err != nil {
			return err
		}
		// draft lama kini kosong dan tetap dipakai sebagai draft aktif. Saat guru mengedit,
		// editableVersion meng-clone konten published ke draft ini (FR-4.8), lalu publish
		// berikutnya memindahkannya lagi. Konten tampilan selalu published_version_id.
		if _, err := tx.Exec(r.Context(),
			`UPDATE question_sets SET status='published', published_version_id=$1, draft_version_id=$2 WHERE id=$3`, verID, draftVer, id); err != nil {
			return err
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "question_set.publish", "question_set", id, map[string]any{"version_id": verID, "questions": qcount}, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "published_version_id": verID, "questions": qcount, "max_points": maxPoints})
}

// unpublish diperbolehkan selama belum ada pengerjaan (FR-4.7).
func (s *Service) unpublish(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var pubVer *string
		if err := tx.QueryRow(r.Context(), `SELECT published_version_id FROM question_sets WHERE tenant_id=$1 AND id=$2`, tid, id).Scan(&pubVer); err != nil {
			return httpx.NotFound("paket tidak ditemukan")
		}
		if pubVer == nil {
			return httpx.BadRequest(httpx.CodeValidation, "paket belum dipublish")
		}
		var used int
		if err := tx.QueryRow(r.Context(),
			`SELECT count(*) FROM exams WHERE tenant_id=$1 AND question_set_id=$2 AND set_version_id=$3 AND status NOT IN ('draft','cancelled')`,
			tid, id, *pubVer).Scan(&used); err != nil {
			return err
		}
		if used > 0 {
			return httpx.Conflict("ALREADY_USED", "versi ini sudah dipakai ujian aktif; tidak bisa unpublish")
		}
		// kembalikan konten versi published ke draft agar bisa dipublish ulang
		var draftVer *string
		_ = tx.QueryRow(r.Context(), `SELECT draft_version_id FROM question_sets WHERE tenant_id=$1 AND id=$2`, tid, id).Scan(&draftVer)
		if draftVer != nil {
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO questions (tenant_id, set_version_id, order_no, type, stimulus_id, body_html, options_json, answer_key_json, rubric_json, points, scoring_mode, partial_wrong_penalty, shuffle_options, explanation_html, media_ids)
				 SELECT tenant_id, $1, order_no, type, NULL, body_html, options_json, answer_key_json, rubric_json, points, scoring_mode, partial_wrong_penalty, shuffle_options, explanation_html, media_ids
				 FROM questions WHERE set_version_id=$2`, *draftVer, *pubVer); err != nil {
				return err
			}
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO stimuli (tenant_id, set_version_id, order_no, title, content_html, media_ids)
				 SELECT tenant_id, $1, order_no, title, content_html, media_ids FROM stimuli WHERE set_version_id=$2`, *draftVer, *pubVer); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(r.Context(),
			`UPDATE question_sets SET status='draft', published_version_id=NULL WHERE tenant_id=$1 AND id=$2`, tid, id); err != nil {
			return err
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "question_set.unpublish", "question_set", id, nil, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}
