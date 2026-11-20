package students

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ---------- Manajemen guru (FR-1.5, owner saja) ----------
// Tabel users berada di pool Admin (bypass RLS); tenant_id selalu diambil dari
// token dan disertakan pada setiap statement.

type teacherRow struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Email            string   `json:"email"`
	Role             string   `json:"role"`
	Status           string   `json:"status"`
	ClassRestriction []string `json:"class_restriction"`
	EmailVerified    bool     `json:"email_verified"`
}

const teacherCols = `id::text, name, email, role, status, class_restriction, email_verified_at IS NOT NULL`

func scanTeacher(row pgx.Row) (*teacherRow, error) {
	var (
		t   teacherRow
		raw []byte
	)
	if err := row.Scan(&t.ID, &t.Name, &t.Email, &t.Role, &t.Status, &raw, &t.EmailVerified); err != nil {
		return nil, err
	}
	t.ClassRestriction = []string{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &t.ClassRestriction)
	}
	return &t, nil
}

// GET /teachers — daftar user tenant (owner + teacher).
func (m *Module) listTeachers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	out := []*teacherRow{}
	rows, err := m.a.DB.Admin.Query(ctx,
		`SELECT `+teacherCols+` FROM users WHERE tenant_id=$1 AND role IN ('owner','teacher')
		 ORDER BY (role='owner') DESC, created_at`, tenantID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		t, err := scanTeacher(rows)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": out})
}

type createTeacherReq struct {
	Name  string  `json:"name" validate:"required,min=2,max=120"`
	Email *string `json:"email" validate:"omitempty,email"`
	Role  *string `json:"role"` // hanya "teacher" yang didukung saat create
}

// POST /teachers — buat user tenant aktif dengan password acak (plaintext sekali).
func (m *Module) createTeacher(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	actorID := ctxinfo.UserID(ctx)
	var req createTeacherReq
	if err := m.validateReq(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	if req.Email != nil {
		e := normalEmail(*req.Email)
		req.Email = &e
	}
	if req.Role != nil && *req.Role != "" && *req.Role != "teacher" {
		httpx.Error(w, httpx.NewErr(400, "VALIDATION", "Peran baru harus 'teacher'"))
		return
	}
	role := "teacher"

	tempPwd, err := randomPassword()
	if err != nil {
		httpx.Error(w, err)
		return
	}
	hash, err := auth.HashPassword(tempPwd)
	if err != nil {
		httpx.Error(w, err)
		return
	}

	// Email opsional: kosong -> buat placeholder unik (tetap bisa dipakai login).
	email := ""
	if req.Email != nil {
		email = *req.Email
	}
	for i := 0; i < 5 && email == ""; i++ {
		suf, err := randomFrom(codeAlphabet, 6)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		candidate := "guru-" + lowerKey(suf) + "@local"
		var dupe int
		if err := m.a.DB.Admin.QueryRow(ctx,
			`SELECT COUNT(1) FROM users WHERE lower(email)=lower($1)`, candidate).Scan(&dupe); err != nil {
			httpx.Error(w, err)
			return
		}
		if dupe == 0 {
			email = candidate
		}
	}
	if email == "" {
		httpx.Error(w, httpx.NewErr(409, "EMAIL_TAKEN", "Email sudah terdaftar"))
		return
	}

	t, err := scanTeacher(m.a.DB.Admin.QueryRow(ctx, `
		INSERT INTO users(tenant_id, name, email, password_hash, role, status)
		VALUES ($1,$2,$3,$4,$5,'active')
		RETURNING `+teacherCols,
		tenantID, strings.TrimSpace(req.Name), email, hash, role))
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			httpx.Error(w, httpx.NewErr(409, "EMAIL_TAKEN", "Email sudah terdaftar"))
			return
		}
		httpx.Error(w, err)
		return
	}
	m.audit(ctx, tenantID, actorID, "teacher.create", "user", t.ID, map[string]any{"email": email})

	resp := map[string]any{
		"id": t.ID, "name": t.Name, "email": t.Email, "role": t.Role, "status": t.Status,
		"class_restriction": t.ClassRestriction, "email_verified": t.EmailVerified,
		"temp_password": tempPwd,
	}
	httpx.Created(w, map[string]any{"data": resp})
}

type updateTeacherReq struct {
	Role             *string   `json:"role" validate:"omitempty,oneof=owner teacher"`
	ClassRestriction *[]string `json:"class_restriction"`
}

// PUT /teachers/{id} — ubah peran dan/atau batasan kelas guru.
func (m *Module) updateTeacher(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	actorID := ctxinfo.UserID(ctx)
	id := chi.URLParam(r, "id")
	if !isUUID(id) {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	var req updateTeacherReq
	if err := m.validateReq(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}

	// Validasi class_restriction: semua id harus kelas milik tenant ini.
	restrictionJSON := ""
	if req.ClassRestriction != nil {
		ids := []string{}
		for _, cid := range *req.ClassRestriction {
			cid = strings.TrimSpace(cid)
			if cid == "" {
				continue
			}
			if !isUUID(cid) {
				httpx.Error(w, httpx.NewErr(400, "VALIDATION", "class_restriction berisi id kelas tidak valid"))
				return
			}
			ids = append(ids, cid)
		}
		err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
			for _, cid := range ids {
				var ok bool
				if err := tx.QueryRow(ctx, `SELECT true FROM classes WHERE id=$1`, cid).Scan(&ok); err != nil {
					if errors.Is(err, pgx.ErrNoRows) {
						return httpx.NewErr(400, "VALIDATION", "Kelas tidak ditemukan: "+cid)
					}
					return err
				}
			}
			return nil
		})
		if err != nil {
			httpx.Error(w, err)
			return
		}
		raw, err := json.Marshal(ids)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		restrictionJSON = string(raw)
	}

	// Peran sendiri tidak boleh diubah lewat endpoint ini (mencegah admin terkunci).
	if req.Role != nil && id == actorID {
		httpx.Error(w, httpx.NewErr(400, "VALIDATION", "Tidak dapat mengubah peran akun sendiri"))
		return
	}

	var roleArg any
	if req.Role != nil {
		roleArg = *req.Role
	}
	t, err := scanTeacher(m.a.DB.Admin.QueryRow(ctx, `
		UPDATE users SET
		  role = COALESCE($3, role),
		  class_restriction = COALESCE(NULLIF($4,'')::jsonb, class_restriction),
		  updated_at = now()
		WHERE id=$1 AND tenant_id=$2 AND role IN ('owner','teacher')
		RETURNING `+teacherCols,
		id, tenantID, roleArg, restrictionJSON))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, httpx.ErrNotFound)
			return
		}
		httpx.Error(w, err)
		return
	}
	m.audit(ctx, tenantID, actorID, "teacher.update", "user", id, map[string]any{
		"role": t.Role, "class_restriction": t.ClassRestriction,
	})
	httpx.OK(w, map[string]any{"data": t})
}

// DELETE /teachers/{id} — nonaktifkan (status suspended) + cabut sesi aktif.
func (m *Module) deleteTeacher(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	actorID := ctxinfo.UserID(ctx)
	id := chi.URLParam(r, "id")
	if !isUUID(id) {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	if id == actorID {
		httpx.Error(w, httpx.NewErr(400, "VALIDATION", "Tidak dapat menonaktifkan akun sendiri"))
		return
	}
	tag, err := m.a.DB.Admin.Exec(ctx, `
		UPDATE users SET status='suspended', updated_at=now()
		WHERE id=$1 AND tenant_id=$2 AND role IN ('owner','teacher') AND status <> 'suspended'`,
		id, tenantID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := m.a.DB.Admin.QueryRow(ctx,
			`SELECT true FROM users WHERE id=$1 AND tenant_id=$2 AND role IN ('owner','teacher')`, id, tenantID).Scan(&exists); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.Error(w, httpx.ErrNotFound)
				return
			}
			httpx.Error(w, err)
			return
		}
		httpx.OK(w, map[string]any{"data": map[string]any{"id": id, "status": "suspended", "message": "Guru sudah dinonaktifkan sebelumnya"}})
		return
	}
	_, _ = m.a.DB.Admin.Exec(ctx, `UPDATE refresh_tokens SET revoked=true WHERE user_id=$1`, id)
	m.audit(ctx, tenantID, actorID, "teacher.suspend", "user", id, nil)
	httpx.OK(w, map[string]any{"data": map[string]any{"id": id, "status": "suspended", "message": "Guru dinonaktifkan"}})
}
