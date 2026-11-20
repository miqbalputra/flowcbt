package questionsets

import (
	"errors"
	"net/http"
	"strings"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ---- Paket soal ----

type saveSetReq struct {
	SubjectName string `json:"subject_name" validate:"required,min=2,max=100"`
	Title       string `json:"title" validate:"required,min=3,max=200"`
	Description string `json:"description" validate:"max=2000"`
	LevelTag    string `json:"level_tag" validate:"max=60"`
	ExamCode    string `json:"exam_code" validate:"omitempty,max=40"`
}

var allowedStatus = map[string]bool{"draft": true, "published": true, "archived": true}

// GET /question-sets?status=&q=&subject=
func (m *Module) listSets(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	status, search, subject := strings.TrimSpace(q.Get("status")), strings.TrimSpace(q.Get("q")), strings.TrimSpace(q.Get("subject"))
	if status != "" && !allowedStatus[status] {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "VALIDATION", "status harus draft|published|archived"))
		return
	}
	var sets []questionSet
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), `
			SELECT qs.id, qs.subject_name, qs.title, qs.description, qs.exam_code, qs.level_tag, qs.status,
				qs.current_version,
				(SELECT COUNT(1)::int FROM questions qq
				 WHERE qq.question_set_id = qs.id AND qq.set_version_id IS NULL),
				qs.updated_at
			FROM question_sets qs
			WHERE ($1 = '' OR qs.status = $1)
			  AND ($2 = '' OR qs.title ILIKE '%'||$2||'%' OR qs.subject_name ILIKE '%'||$2||'%')
			  AND ($3 = '' OR qs.subject_name = $3)
			ORDER BY qs.updated_at DESC LIMIT 200`, status, search, subject)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var s questionSet
			if err := rows.Scan(&s.ID, &s.SubjectName, &s.Title, &s.Description, &s.ExamCode, &s.LevelTag,
				&s.Status, &s.CurrentVersion, &s.QuestionCount, &s.UpdatedAt); err != nil {
				return err
			}
			sets = append(sets, s)
		}
		return rows.Err()
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	okList(w, sets)
}

// POST /question-sets — exam_code kosong digenerate otomatis "KD-"+6 (unik per tenant).
func (m *Module) createSet(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	var req saveSetReq
	if !m.decode(w, r, &req) {
		return
	}
	c := ctxinfo.Claims(r.Context())
	code := strings.TrimSpace(req.ExamCode)
	var set questionSet
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if code != "" {
			var dupe int
			if err := tx.QueryRow(r.Context(),
				`SELECT COUNT(1) FROM question_sets WHERE tenant_id=$1 AND exam_code=$2`,
				tenantID, code).Scan(&dupe); err != nil {
				return err
			}
			if dupe > 0 {
				return httpx.NewErr(http.StatusConflict, "EXAM_CODE_TAKEN", "Kode ujian sudah dipakai paket lain")
			}
		}
		var lastErr error
		for attempt := 0; attempt < 8; attempt++ {
			if code == "" {
				tok, err := generateExamCode()
				if err != nil {
					return err
				}
				code = tok
			}
			err := tx.QueryRow(r.Context(), `
				INSERT INTO question_sets(tenant_id, subject_name, title, description, exam_code, level_tag, status, created_by)
				VALUES ($1,$2,$3,$4,$5,$6,'draft',$7)
				RETURNING id, created_at, updated_at`,
				tenantID, strings.TrimSpace(req.SubjectName), strings.TrimSpace(req.Title),
				strings.TrimSpace(req.Description), code, strings.TrimSpace(req.LevelTag), c.UserID).
				Scan(&set.ID, &set.CreatedAt, &set.UpdatedAt)
			if err == nil {
				break
			}
			var pgErr *pgconn.PgError
			if code != "" || !errors.As(err, &pgErr) || pgErr.Code != "23505" {
				return err
			}
			lastErr, code = err, "" // tabrakan kode otomatis: coba lagi
		}
		return lastErr
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	set.SubjectName, set.Title, set.Description, set.ExamCode, set.LevelTag =
		strings.TrimSpace(req.SubjectName), strings.TrimSpace(req.Title),
		strings.TrimSpace(req.Description), code, strings.TrimSpace(req.LevelTag)
	set.Status, set.CurrentVersion, set.QuestionCount = "draft", 0, 0
	okCreate(w, set)
}

// GET /question-sets/{id} — detail + soal kerja (urut order_no) + stimuli.
func (m *Module) getSet(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	setID := chi.URLParam(r, "setID")
	var set questionSet
	var stim []stimulusSummary
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(), `
			SELECT id, subject_name, title, description, exam_code, level_tag, status, current_version,
				(SELECT COUNT(1)::int FROM questions qq
				 WHERE qq.question_set_id = qs.id AND qq.set_version_id IS NULL),
				created_by, created_at, updated_at
			FROM question_sets qs WHERE qs.id = $1`, setID).
			Scan(&set.ID, &set.SubjectName, &set.Title, &set.Description, &set.ExamCode, &set.LevelTag,
				&set.Status, &set.CurrentVersion, &set.QuestionCount, &set.CreatedBy, &set.CreatedAt, &set.UpdatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.ErrNotFound
		}
		if err != nil {
			return err
		}
		stim, err = stimuliOf(r, tx, setID)
		if err != nil {
			return err
		}
		set.Stimuli = stim
		set.Questions, err = workingQuestions(r, tx, setID)
		return err
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	okList(w, set)
}

// PUT /question-sets/{id}
func (m *Module) updateSet(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	setID := chi.URLParam(r, "setID")
	var req saveSetReq
	if !m.decode(w, r, &req) {
		return
	}
	code := strings.TrimSpace(req.ExamCode)
	var set questionSet
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if code != "" {
			var dupe int
			if err := tx.QueryRow(r.Context(),
				`SELECT COUNT(1) FROM question_sets WHERE tenant_id=$1 AND exam_code=$2 AND id<>$3`,
				tenantID, code, setID).Scan(&dupe); err != nil {
				return err
			}
			if dupe > 0 {
				return httpx.NewErr(http.StatusConflict, "EXAM_CODE_TAKEN", "Kode ujian sudah dipakai paket lain")
			}
		}
		err := tx.QueryRow(r.Context(), `
			UPDATE question_sets SET subject_name=$2, title=$3, description=$4, level_tag=$5,
				exam_code=$6, updated_at=now()
			WHERE id=$1
			RETURNING id, subject_name, title, description, exam_code, level_tag, status, current_version,
				(SELECT COUNT(1)::int FROM questions qq
				 WHERE qq.question_set_id = question_sets.id AND qq.set_version_id IS NULL),
				created_at, updated_at`,
			setID, strings.TrimSpace(req.SubjectName), strings.TrimSpace(req.Title),
			strings.TrimSpace(req.Description), strings.TrimSpace(req.LevelTag), code).
			Scan(&set.ID, &set.SubjectName, &set.Title, &set.Description, &set.ExamCode, &set.LevelTag,
				&set.Status, &set.CurrentVersion, &set.QuestionCount, &set.CreatedAt, &set.UpdatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.ErrNotFound
		}
		return err
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	okList(w, set)
}

// DELETE /question-sets/{id} — draft: hard delete; lainnya: arsip.
func (m *Module) deleteSet(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	setID := chi.URLParam(r, "setID")
	c := ctxinfo.Claims(r.Context())
	var status, message string
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(),
			`SELECT status FROM question_sets WHERE id=$1`, setID).Scan(&status); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.ErrNotFound
			}
			return err
		}
		if status == "draft" {
			if _, err := tx.Exec(r.Context(), `DELETE FROM question_sets WHERE id=$1`, setID); err != nil {
				return err
			}
			message = "Paket soal dihapus permanen."
		} else {
			if _, err := tx.Exec(r.Context(),
				`UPDATE question_sets SET status='archived', updated_at=now() WHERE id=$1`, setID); err != nil {
				return err
			}
			message = "Paket soal diarsipkan."
		}
		return m.audit(r, tx, tenantID, c, "question_set."+map[bool]string{true: "delete", false: "archive"}[status == "draft"], setID, status, nil)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{"id": setID, "status": status, "message": message}})
}
