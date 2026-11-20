package students

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// ---------- Kelas (FR-3.1) ----------

type classRow struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	AcademicYear      string `json:"academic_year"`
	HomeroomTeacherID string `json:"homeroom_teacher_id"`
	StudentsCount     int    `json:"students_count"`
	Archived          bool   `json:"archived"`
}

const classSelect = `
SELECT c.id::text, c.name, c.academic_year, COALESCE(c.homeroom_teacher_id::text,''), c.archived,
  (SELECT COUNT(1) FROM students s
    WHERE s.class_id = c.id AND s.status='active' AND s.is_guest=false AND s.merged_into_id IS NULL)
FROM classes c`

const classColumns = `id::text, name, academic_year, COALESCE(homeroom_teacher_id::text,''), archived,
  (SELECT COUNT(1) FROM students s WHERE s.class_id=classes.id AND s.status='active' AND s.is_guest=false AND s.merged_into_id IS NULL)`

func scanClassRow(row pgx.Row) (*classRow, error) {
	var c classRow
	err := row.Scan(&c.ID, &c.Name, &c.AcademicYear, &c.HomeroomTeacherID, &c.Archived, &c.StudentsCount)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// GET /classes?q=&include_archived=true
func (m *Module) listClasses(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	includeArchived := r.URL.Query().Get("include_archived") == "true"

	out := []*classRow{}
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		where := " WHERE true"
		args := []any{}
		if q != "" {
			args = append(args, "%"+q+"%")
			where += " AND c.name ILIKE $" + itoa(len(args))
		}
		if !includeArchived {
			where += " AND c.archived = false"
		}
		rows, err := tx.Query(ctx, classSelect+where+" ORDER BY c.name, c.created_at", args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			c, err := scanClassRow(rows)
			if err != nil {
				return err
			}
			out = append(out, c)
		}
		return rows.Err()
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": out})
}

type createClassReq struct {
	Name              string  `json:"name" validate:"required,min=1,max=100"`
	AcademicYear      string  `json:"academic_year"`
	HomeroomTeacherID *string `json:"homeroom_teacher_id"`
}

// POST /classes
func (m *Module) createClass(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	actorID := ctxinfo.UserID(ctx)
	var req createClassReq
	if err := m.validateReq(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.AcademicYear = strings.TrimSpace(req.AcademicYear)
	if req.HomeroomTeacherID != nil && *req.HomeroomTeacherID != "" && !isUUID(*req.HomeroomTeacherID) {
		httpx.Error(w, httpx.NewErr(400, "VALIDATION", "homeroom_teacher_id tidak valid"))
		return
	}

	c := &classRow{}
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		teacherID := ""
		if req.HomeroomTeacherID != nil {
			var err error
			teacherID, err = m.resolveTeacherID(ctx, tx, *req.HomeroomTeacherID)
			if err != nil {
				return err
			}
		}
		var dupe int
		if err := tx.QueryRow(ctx,
			`SELECT COUNT(1) FROM classes WHERE lower(name)=lower($1) AND academic_year=$2`,
			req.Name, req.AcademicYear).Scan(&dupe); err != nil {
			return err
		}
		if dupe > 0 {
			return httpx.NewErr(409, "CLASS_EXISTS", "Kelas dengan nama tersebut sudah ada")
		}
		return tx.QueryRow(ctx, `
			INSERT INTO classes(tenant_id, name, academic_year, homeroom_teacher_id)
			VALUES ($1,$2,$3,NULLIF($4,'')::uuid)
			RETURNING `+classColumns,
			tenantID, req.Name, req.AcademicYear, teacherID).
			Scan(&c.ID, &c.Name, &c.AcademicYear, &c.HomeroomTeacherID, &c.Archived, &c.StudentsCount)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	_ = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return auditTx(ctx, tx, tenantID, actorID, "class.create", "class", c.ID, map[string]any{"name": c.Name})
	})
	httpx.Created(w, map[string]any{"data": c})
}

type updateClassReq struct {
	Name              *string `json:"name" validate:"omitempty,min=1,max=100"`
	AcademicYear      *string `json:"academic_year"`
	HomeroomTeacherID *string `json:"homeroom_teacher_id"`
	Archived          *bool   `json:"archived"`
}

// PUT /classes/{id} — update nama/tahun ajaran/wali kelas/arsip.
func (m *Module) updateClass(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	actorID := ctxinfo.UserID(ctx)
	id := chi.URLParam(r, "id")
	if !isUUID(id) {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	var req updateClassReq
	if err := m.validateReq(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	if req.Name != nil {
		*req.Name = strings.TrimSpace(*req.Name)
		if *req.Name == "" {
			httpx.Error(w, httpx.NewErr(400, "VALIDATION", "Nama kelas tidak boleh kosong"))
			return
		}
	}

	c := &classRow{}
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		cur, err := scanClassRow(tx.QueryRow(ctx, classSelect+" WHERE c.id=$1", id))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.ErrNotFound
			}
			return err
		}

		newName, newYear, newArchived := cur.Name, cur.AcademicYear, cur.Archived
		if req.Name != nil {
			newName = *req.Name
		}
		if req.AcademicYear != nil {
			newYear = strings.TrimSpace(*req.AcademicYear)
		}
		if req.Archived != nil {
			newArchived = *req.Archived
		}
		teacherID := cur.HomeroomTeacherID
		if req.HomeroomTeacherID != nil {
			teacherID, err = m.resolveTeacherID(ctx, tx, *req.HomeroomTeacherID)
			if err != nil {
				return err
			}
		}

		// Nama unik per (tenant, lower(name), academic_year).
		if req.Name != nil || req.AcademicYear != nil {
			var dupe int
			if err := tx.QueryRow(ctx,
				`SELECT COUNT(1) FROM classes WHERE lower(name)=lower($1) AND academic_year=$2 AND id<>$3`,
				newName, newYear, id).Scan(&dupe); err != nil {
				return err
			}
			if dupe > 0 {
				return httpx.NewErr(409, "CLASS_EXISTS", "Kelas dengan nama tersebut sudah ada")
			}
		}

		return tx.QueryRow(ctx, `
			UPDATE classes SET name=$2, academic_year=$3, homeroom_teacher_id=NULLIF($4,'')::uuid, archived=$5
			WHERE id=$1
			RETURNING `+classColumns,
			id, newName, newYear, teacherID, newArchived).
			Scan(&c.ID, &c.Name, &c.AcademicYear, &c.HomeroomTeacherID, &c.Archived, &c.StudentsCount)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	_ = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return auditTx(ctx, tx, tenantID, actorID, "class.update", "class", id, map[string]any{"name": c.Name, "archived": c.Archived})
	})
	httpx.OK(w, map[string]any{"data": c})
}

// DELETE /classes/{id} — masih ada siswa aktif -> arsipkan; kosong -> hapus permanen.
func (m *Module) deleteClass(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	actorID := ctxinfo.UserID(ctx)
	id := chi.URLParam(r, "id")
	if !isUUID(id) {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	var (
		archived bool
		count    int
		message  string
	)
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT true FROM classes WHERE id=$1`, id).Scan(&exists); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.ErrNotFound
			}
			return err
		}
		var n int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(1) FROM students
			WHERE class_id=$1 AND status='active' AND is_guest=false AND merged_into_id IS NULL`, id).Scan(&n); err != nil {
			return err
		}
		count = n
		if n > 0 {
			// Masih ada siswa aktif: arsipkan, jangan hapus (FR-3.1).
			if _, err := tx.Exec(ctx, `UPDATE classes SET archived=true WHERE id=$1`, id); err != nil {
				return err
			}
			archived = true
			message = "Kelas masih memiliki " + itoa(n) + " siswa aktif, sehingga diarsipkan (bukan dihapus)."
			return auditTx(ctx, tx, tenantID, actorID, "class.archive", "class", id, map[string]any{"students": n})
		}
		if _, err := tx.Exec(ctx, `DELETE FROM classes WHERE id=$1`, id); err != nil {
			return err
		}
		message = "Kelas kosong dihapus permanen."
		return auditTx(ctx, tx, tenantID, actorID, "class.delete", "class", id, nil)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{
		"id": id, "archived": archived, "students_count": count, "message": message,
	}})
}

// ---------- Helper kelas ----------

// resolveTeacherID: validasi id wali kelas milik tenant ini.
// "" atau "-" berarti kosongkan (mengembalikan "").
func (m *Module) resolveTeacherID(ctx context.Context, tx pgx.Tx, teacherID string) (string, error) {
	teacherID = strings.TrimSpace(teacherID)
	if teacherID == "" || teacherID == "-" {
		return "", nil
	}
	if !isUUID(teacherID) {
		return "", httpx.NewErr(400, "VALIDATION", "homeroom_teacher_id tidak valid")
	}
	var n int
	if err := tx.QueryRow(ctx,
		`SELECT COUNT(1) FROM users WHERE id=$1::uuid AND role IN ('owner','teacher') AND status='active'`,
		teacherID).Scan(&n); err != nil {
		return "", err
	}
	if n == 0 {
		return "", httpx.NewErr(400, "VALIDATION", "Wali kelas tidak ditemukan di sekolah ini")
	}
	return teacherID, nil
}

func itoa(n int) string { return strconv.Itoa(n) }
