package classroom

import (
	"net/http"
	"time"
	"strings"

	"flowcbt/backend/internal/audit"
	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/platform"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// Service: CRUD kelas (FR-3.1).
type Service struct {
	DB    *platform.DB
	Audit *audit.Writer
}

type Class struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	AcademicYear    string     `json:"academic_year"`
	HomeroomTeacher *string    `json:"homeroom_teacher_id,omitempty"`
	ArchivedAt      *time.Time `json:"archived_at,omitempty"`
	StudentCount    int        `json:"student_count,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

func (s *Service) Routes(r chi.Router) {
	r.Route("/classes", func(r chi.Router) {
		r.Get("/", s.list)
		r.Post("/", s.create)
		r.Get("/{id}", s.get)
		r.Put("/{id}", s.update)
		r.Delete("/{id}", s.archive)
	})
}

func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	q := r.URL.Query().Get("q")
	includeArchived := r.URL.Query().Get("archived") == "1"
	var rows []Class
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var query string
		args := []any{tid}
		if includeArchived {
			query = `SELECT c.id, c.name, c.academic_year, c.homeroom_teacher_id, c.archived_at, c.created_at,
			        (SELECT count(*) FROM students st WHERE st.class_id=c.id AND st.status='active')
			 FROM classes c WHERE c.tenant_id=$1`
		} else {
			query = `SELECT c.id, c.name, c.academic_year, c.homeroom_teacher_id, c.archived_at, c.created_at,
			        (SELECT count(*) FROM students st WHERE st.class_id=c.id AND st.status='active')
			 FROM classes c WHERE c.tenant_id=$1 AND c.archived_at IS NULL`
		}
		if q != "" {
			query += ` AND (c.name ILIKE '%'||$2||'%' )`
			args = append(args, q)
		}
		query += ` ORDER BY c.name`
		rws, err := tx.Query(r.Context(), query, args...)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var c Class
			if err := rws.Scan(&c.ID, &c.Name, &c.AcademicYear, &c.HomeroomTeacher, &c.ArchivedAt, &c.CreatedAt, &c.StudentCount); err != nil {
				return err
			}
			rows = append(rows, c)
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if rows == nil {
		rows = []Class{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

type classInput struct {
	Name         string `json:"name"`
	AcademicYear string `json:"academic_year"`
}

func (s *Service) create(w http.ResponseWriter, r *http.Request) {
	var in classInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.AcademicYear = strings.TrimSpace(in.AcademicYear)
	if in.Name == "" || in.AcademicYear == "" {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "nama kelas dan tahun ajaran wajib diisi"))
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	actor := httpx.ActorIDFrom(r.Context())
	var c Class
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(),
			`INSERT INTO classes (tenant_id, name, academic_year) VALUES ($1,$2,$3)
			 RETURNING id, name, academic_year, created_at`, tid, in.Name, in.AcademicYear).
			Scan(&c.ID, &c.Name, &c.AcademicYear, &c.CreatedAt)
		if err != nil {
			if strings.Contains(err.Error(), "duplicate") {
				return httpx.Conflict("CLASS_EXISTS", "kelas dengan nama & tahun ajaran ini sudah ada")
			}
			return err
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "class.create", "class", c.ID, map[string]any{"name": in.Name}, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, c)
}

func (s *Service) get(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	var c Class
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(),
			`SELECT c.id, c.name, c.academic_year, c.homeroom_teacher_id, c.archived_at, c.created_at,
			   (SELECT count(*) FROM students st WHERE st.class_id=c.id AND st.status='active')
			 FROM classes c WHERE c.tenant_id=$1 AND c.id=$2`, tid, id).
			Scan(&c.ID, &c.Name, &c.AcademicYear, &c.HomeroomTeacher, &c.ArchivedAt, &c.CreatedAt, &c.StudentCount)
	})
	if err != nil {
		httpx.WriteError(w, httpx.NotFound("kelas tidak ditemukan"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, c)
}

func (s *Service) update(w http.ResponseWriter, r *http.Request) {
	var in classInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(),
			`UPDATE classes SET name=$1, academic_year=$2 WHERE tenant_id=$3 AND id=$4`,
			strings.TrimSpace(in.Name), strings.TrimSpace(in.AcademicYear), tid, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("kelas tidak ditemukan")
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "class.update", "class", id, map[string]any{"name": in.Name}, "")
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
	actor := httpx.ActorIDFrom(r.Context())
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(),
			`UPDATE classes SET archived_at = COALESCE(archived_at, now()) WHERE tenant_id=$1 AND id=$2`, tid, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("kelas tidak ditemukan")
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "class.archive", "class", id, nil, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}
