package students

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ---------- Siswa (FR-3.2, FR-3.3b, FR-3.5, FR-3.7) ----------

type studentRow struct {
	ID          string `json:"id"`
	StudentCode string `json:"student_code"`
	NIS         string `json:"nis"`
	Name        string `json:"name"`
	Gender      string `json:"gender"`
	ClassID     string `json:"class_id"`
	ClassName   string `json:"class_name"`
	Username    string `json:"username"`
	Status      string `json:"status"`
	IsGuest     bool   `json:"is_guest"`
}

type studentDetail struct {
	studentRow
	Email       string `json:"email"`
	ParentPhone string `json:"parent_phone"`
	Phone       string `json:"phone"`
	BirthPlace  string `json:"birth_place"`
	BirthDate   string `json:"birth_date"` // YYYY-MM-DD / kosong
}

const studentSelect = `
SELECT s.id::text, s.student_code, COALESCE(s.nis,''), s.name, s.gender,
  COALESCE(s.class_id::text,''), COALESCE(c.name,''), COALESCE(s.username,''), s.status, s.is_guest
FROM students s LEFT JOIN classes c ON c.id = s.class_id`

func scanStudent(row pgx.Row) (*studentRow, error) {
	var s studentRow
	err := row.Scan(&s.ID, &s.StudentCode, &s.NIS, &s.Name, &s.Gender,
		&s.ClassID, &s.ClassName, &s.Username, &s.Status, &s.IsGuest)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// GET /students/{id} — detail (404 bila milik tenant lain, AC-9).
func (m *Module) getStudent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	id := chi.URLParam(r, "id")
	if id == "" || !isUUID(id) {
		// ID tak-valid diperlakukan seperti milik tenant lain (AC-9: 404).
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	var s *studentDetail
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		// studentDetailByID memakai WHERE — jangan menambahkan `AND s.id=$1`
		// pada studentDetailSelect karena klausa itu akan menempel ke ON milik
		// JOIN dan tidak menyaring apa pun.
		s, err = scanStudentDetail(tx.QueryRow(ctx, studentDetailByID, id))
		if err == pgx.ErrNoRows {
			return httpx.ErrNotFound
		}
		return err
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out := map[string]any{
		"id": s.ID, "student_code": s.StudentCode, "nis": s.NIS, "name": s.Name,
		"gender": s.Gender, "class_id": s.ClassID, "class_name": s.ClassName,
		"username": s.Username, "status": s.Status, "is_guest": s.IsGuest,
		"email": s.Email, "parent_phone": s.ParentPhone, "phone": s.Phone,
		"birth_place": s.BirthPlace, "birth_date": s.BirthDate,
	}
	httpx.OK(w, map[string]any{"data": out})
}

// GET /students?class_id=&q=&guest=&limit=30&cursor=0
// guest: "true" -> hanya tamu, "" / "false" -> sembunyikan tamu, "all" -> semua.
func (m *Module) listStudents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	q := r.URL.Query()

	classID := strings.TrimSpace(q.Get("class_id"))
	if classID != "" && !isUUID(classID) {
		httpx.Error(w, httpx.NewErr(400, "VALIDATION", "class_id tidak valid"))
		return
	}
	search := strings.TrimSpace(q.Get("q"))
	guestParam := strings.TrimSpace(q.Get("guest"))

	limit := parseIntDefault(q.Get("limit"), 30, 1, 200)
	cursor := parseIntDefault(q.Get("cursor"), 0, 0, 1_000_000_000)

	where := " WHERE s.merged_into_id IS NULL"
	args := []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		where += " AND " + cond + " $" + itoa(len(args))
	}
	switch guestParam {
	case "true", "1":
		add("s.is_guest =", true)
	case "all":
		// tanpa filter
	default: // "", "false", "0"
		add("s.is_guest =", false)
	}
	if classID != "" {
		add("s.class_id =", classID)
	}
	if search != "" {
		args = append(args, "%"+search+"%")
		n := len(args)
		where += fmt.Sprintf(" AND (s.name ILIKE $%d OR s.nis ILIKE $%d OR s.student_code ILIKE $%d OR s.username ILIKE $%d)", n, n, n, n)
	}
	args = append(args, limit, cursor)
	where += " ORDER BY s.name, s.id LIMIT $" + itoa(len(args)-1) + " OFFSET $" + itoa(len(args))

	items := []*studentRow{}
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, studentSelect+where, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			s, err := scanStudent(rows)
			if err != nil {
				return err
			}
			items = append(items, s)
		}
		return rows.Err()
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	resp := map[string]any{"data": items}
	if len(items) == limit {
		next := cursor + len(items)
		resp["next_cursor"] = next
	}
	httpx.OK(w, resp)
}

type createStudentReq struct {
	Name        string  `json:"name" validate:"required,min=2,max=120"`
	Gender      string  `json:"gender" validate:"required"`
	ClassID     string  `json:"class_id" validate:"required,uuid"`
	NIS         *string `json:"nis"`
	Email       *string `json:"email"`
	ParentPhone *string `json:"parent_phone"`
	Phone       *string `json:"phone" validate:"omitempty,max=30"`
	BirthPlace  *string `json:"birth_place" validate:"omitempty,max=80"`
	BirthDate   *string `json:"birth_date" validate:"omitempty,datetime=2006-01-02"`
}

// POST /students — cek kuota (billing.Quota), buat kode siswa + username + password awal.
func (m *Module) createStudent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	actorID := ctxinfo.UserID(ctx)
	var req createStudentReq
	if err := m.validateReq(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	gender, ok := normalizeGender(req.Gender)
	if !ok {
		httpx.Error(w, httpx.NewErr(400, "VALIDATION", "Jenis kelamin harus L atau P"))
		return
	}
	name := strings.TrimSpace(req.Name)
	nis, email, phone := trimPtr(req.NIS), trimPtr(req.Email), trimPtr(req.ParentPhone)
	phoneSelf, birthPlace, birthDate := trimPtr(req.Phone), trimPtr(req.BirthPlace), trimPtr(req.BirthDate)

	// Kuota siswa (pool admin via billing) — cek sebelum menulis.
	q, err := m.billing.Quota(ctx, tenantID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if q.ReadOnly {
		httpx.Error(w, httpx.NewErr(403, "READ_ONLY", "Sekolah sedang dalam mode baca-saja"))
		return
	}
	if q.StudentsCount >= q.MaxStudents {
		httpx.Error(w, quotaExceededErr(q.MaxStudents-q.StudentsCount, 1))
		return
	}

	var (
		created *studentDetail
		tempPwd string
		classID = req.ClassID
	)
	// Coba beberapa kali: kode siswa & username dijaga idx unik (kode unik global).
	for attempt := 0; attempt < 5; attempt++ {
		created, tempPwd, err = m.insertStudentTx(ctx, tenantID, actorID, &insertStudentArgs{
			name: name, gender: gender, classID: classID, nis: nis, email: email, phone: phone,
			phoneSelf: phoneSelf, birthPlace: birthPlace, birthDate: birthDate,
		})
		if err == nil {
			break
		}
		if !isUniqueViolation(err) {
			httpx.Error(w, err)
			return
		}
	}
	if err != nil {
		httpx.Error(w, httpx.NewErr(500, "CONFLICT", "Gagal menghasilkan kode/username unik, coba lagi"))
		return
	}
	httpx.Created(w, map[string]any{"data": created.withPassword(tempPwd)})
}

type insertStudentArgs struct {
	name, gender, classID, nis, email, phone string
	phoneSelf, birthPlace, birthDate         string
}

// insertStudentTx: insert siswa + baris awal student_class_history (dalam satu trx tenant).
func (m *Module) insertStudentTx(ctx context.Context, tenantID, actorID string, a *insertStudentArgs) (*studentDetail, string, error) {
	var (
		out     *studentDetail
		tempPwd string
	)
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		// Kelas harus milik tenant ini.
		if a.classID != "" {
			var ok bool
			if err := tx.QueryRow(ctx, `SELECT true FROM classes WHERE id=$1`, a.classID).Scan(&ok); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return httpx.NewErr(400, "VALIDATION", "Kelas tidak ditemukan")
				}
				return err
			}
		}
		code, err := m.newStudentCode()
		if err != nil {
			return err
		}
		username, err := m.newUsername(a.name)
		if err != nil {
			return err
		}
		tempPwd, err = randomPassword()
		if err != nil {
			return err
		}
		hash, err := auth.HashPassword(tempPwd)
		if err != nil {
			return err
		}
		out = &studentDetail{}
		err = tx.QueryRow(ctx, `
			INSERT INTO students(tenant_id, student_code, nis, name, gender, class_id, username, password_hash,
			  email, parent_phone, phone, birth_place, birth_date)
			VALUES ($1,$2,NULLIF($3,''),$4,$5,NULLIF($6,'')::uuid,$7,$8,NULLIF($9,''),NULLIF($10,''),
			  NULLIF($11,''),$12,NULLIF($13,'')::date)
			RETURNING `+studentDetailColumns,
			tenantID, code, a.nis, a.name, a.gender, a.classID, username, hash, a.email, a.phone,
			a.phoneSelf, a.birthPlace, a.birthDate).
			Scan(&out.ID, &out.StudentCode, &out.NIS, &out.Name, &out.Gender,
				&out.ClassID, &out.ClassName, &out.Username, &out.Status, &out.IsGuest,
				&out.Email, &out.ParentPhone, &out.Phone, &out.BirthPlace, &out.BirthDate)
		if err != nil {
			return err
		}
		if a.classID != "" {
			if _, err := tx.Exec(ctx,
				`INSERT INTO student_class_history(tenant_id, student_id, class_id) VALUES ($1,$2,$3)`,
				tenantID, out.ID, a.classID); err != nil {
				return err
			}
		}
		return auditTx(ctx, tx, tenantID, actorID, "student.create", "student", out.ID,
			map[string]any{"name": a.name, "class_id": a.classID})
	})
	if err != nil {
		return nil, "", err
	}
	return out, tempPwd, nil
}

type updateStudentReq struct {
	Name        *string `json:"name" validate:"omitempty,min=2,max=120"`
	Gender      *string `json:"gender"`
	ClassID     *string `json:"class_id"` // "" = keluarkan dari kelas
	NIS         *string `json:"nis"`
	Email       *string `json:"email"`
	ParentPhone *string `json:"parent_phone"`
	Phone       *string `json:"phone" validate:"omitempty,max=30"`
	BirthPlace  *string `json:"birth_place" validate:"omitempty,max=80"`
	BirthDate   *string `json:"birth_date" validate:"omitempty,datetime=2006-01-02"`
}

// PUT /students/{id} — perubahan kelas menulis riwayat student_class_history (FR-3.5).
func (m *Module) updateStudent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	actorID := ctxinfo.UserID(ctx)
	id := chi.URLParam(r, "id")
	if !isUUID(id) {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	var req updateStudentReq
	if err := m.validateReq(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	if req.Gender != nil {
		g, ok := normalizeGender(*req.Gender)
		if !ok {
			httpx.Error(w, httpx.NewErr(400, "VALIDATION", "Jenis kelamin harus L atau P"))
			return
		}
		req.Gender = &g
	}
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		req.Name = &n
	}
	newClassID := ""
	hasClass := false
	if req.ClassID != nil {
		newClassID = strings.TrimSpace(*req.ClassID)
		if newClassID != "" && !isUUID(newClassID) {
			httpx.Error(w, httpx.NewErr(400, "VALIDATION", "class_id tidak valid"))
			return
		}
		hasClass = true
	}

	updated := &studentDetail{}
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		cur, err := scanStudentDetail(tx.QueryRow(ctx, studentDetailByID, id))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.ErrNotFound
			}
			return err
		}
		name, gender := cur.Name, cur.Gender
		if req.Name != nil {
			name = *req.Name
		}
		if req.Gender != nil {
			gender = *req.Gender
		}
		nis, email, phone := cur.NIS, cur.Email, cur.ParentPhone
		phoneSelf, birthPlace, birthDate := cur.Phone, cur.BirthPlace, cur.BirthDate
		if req.NIS != nil {
			nis = *req.NIS
		}
		if req.Email != nil {
			email = *req.Email
		}
		if req.ParentPhone != nil {
			phone = *req.ParentPhone
		}
		if req.Phone != nil {
			phoneSelf = strings.TrimSpace(*req.Phone)
		}
		if req.BirthPlace != nil {
			birthPlace = strings.TrimSpace(*req.BirthPlace)
		}
		if req.BirthDate != nil {
			birthDate = strings.TrimSpace(*req.BirthDate)
		}
		classID := cur.ClassID
		if hasClass {
			// Kelas berubah? -> validasi + tulis riwayat (tutup lama, buka baru).
			if newClassID != cur.ClassID {
				if newClassID != "" {
					var ok bool
					if err := tx.QueryRow(ctx, `SELECT true FROM classes WHERE id=$1`, newClassID).Scan(&ok); err != nil {
						if errors.Is(err, pgx.ErrNoRows) {
							return httpx.NewErr(400, "VALIDATION", "Kelas tidak ditemukan")
						}
						return err
					}
				}
				if cur.ClassID != "" {
					if _, err := tx.Exec(ctx,
						`UPDATE student_class_history SET to_date=now() WHERE student_id=$1 AND to_date IS NULL`, id); err != nil {
						return err
					}
				}
				if newClassID != "" {
					if _, err := tx.Exec(ctx,
						`INSERT INTO student_class_history(tenant_id, student_id, class_id) VALUES ($1,$2,$3)`,
						tenantID, id, newClassID); err != nil {
						return err
					}
				}
			}
			classID = newClassID
		}
		return tx.QueryRow(ctx, `
			UPDATE students SET name=$2, gender=$3, class_id=NULLIF($4,'')::uuid,
			  nis=NULLIF($5,''), email=NULLIF($6,''), parent_phone=NULLIF($7,''),
			  phone=$8, birth_place=$9, birth_date=NULLIF($10,'')::date
			WHERE id=$1
			RETURNING `+studentDetailColumns,
			id, name, gender, classID, nis, email, phone, phoneSelf, birthPlace, birthDate).
			Scan(&updated.ID, &updated.StudentCode, &updated.NIS, &updated.Name, &updated.Gender,
				&updated.ClassID, &updated.ClassName, &updated.Username, &updated.Status, &updated.IsGuest,
				&updated.Email, &updated.ParentPhone, &updated.Phone, &updated.BirthPlace, &updated.BirthDate)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	_ = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return auditTx(ctx, tx, tenantID, actorID, "student.update", "student", id, map[string]any{"class_id": updated.ClassID})
	})
	httpx.OK(w, map[string]any{"data": updated})
}

// DELETE /students/{id} — soft delete (status='inactive').
func (m *Module) deleteStudent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	actorID := ctxinfo.UserID(ctx)
	id := chi.URLParam(r, "id")
	if !isUUID(id) {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT true FROM students WHERE id=$1 AND status='active'`, id).Scan(&exists); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Sudah nonaktif dianggap sukses (idempoten); belum pernah ada -> 404.
				var any bool
				if err := tx.QueryRow(ctx, `SELECT true FROM students WHERE id=$1`, id).Scan(&any); err != nil {
					return httpx.ErrNotFound
				}
				return nil
			}
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE students SET status='inactive' WHERE id=$1`, id); err != nil {
			return err
		}
		return auditTx(ctx, tx, tenantID, actorID, "student.deactivate", "student", id, nil)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{"id": id, "status": "inactive", "message": "Siswa dinonaktifkan"}})
}

// POST /students/{id}/reset-password — password acak baru, plaintext dikirim sekali.
func (m *Module) resetStudentPassword(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	actorID := ctxinfo.UserID(ctx)
	id := chi.URLParam(r, "id")
	if !isUUID(id) {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
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
	var username string
	err = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			UPDATE students SET password_hash=$2
			WHERE id=$1 AND is_guest=false AND merged_into_id IS NULL
			RETURNING COALESCE(username,'')`, id, hash).Scan(&username)
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.ErrNotFound
		}
		if err != nil {
			return err
		}
		return auditTx(ctx, tx, tenantID, actorID, "student.reset_password", "student", id, nil)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{"id": id, "username": username, "temp_password": tempPwd}})
}

// GET /students/{id}/track-record — rekap seluruh percobaan ujian siswa (FR-3.7).
func (m *Module) trackRecord(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)
	id := chi.URLParam(r, "id")
	if !isUUID(id) {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	student, err := m.studentWithClass(ctx, tenantID, id)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	attempts := []map[string]any{}
	err = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT a.id::text, a.exam_id::text, e.name, e.subject_name, a.attempt_no,
			  a.started_at, a.submitted_at,
			  CASE WHEN a.started_at IS NULL THEN NULL
			    ELSE EXTRACT(EPOCH FROM (COALESCE(a.submitted_at, now()) - a.started_at))::bigint END,
			  a.score, a.final_score, a.status, a.cheating_status
			FROM attempts a JOIN exams e ON e.id = a.exam_id
			WHERE a.student_id = $1
			ORDER BY a.started_at DESC NULLS LAST, a.created_at DESC`, id)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var (
				idRaw, examID, examName, subjectName string
				attemptNo                            int
				startedAt, submittedAt               *time.Time
				durationSec                          *int64
				score, finalScore                    *float64
				status, cheating                     string
			)
			if err := rows.Scan(&idRaw, &examID, &examName, &subjectName, &attemptNo,
				&startedAt, &submittedAt, &durationSec, &score, &finalScore, &status, &cheating); err != nil {
				return err
			}
			attempts = append(attempts, map[string]any{
				"id":               idRaw,
				"exam_id":          examID,
				"exam_name":        examName,
				"subject_name":     subjectName,
				"attempt_no":       attemptNo,
				"started_at":       startedAt,
				"submitted_at":     submittedAt,
				"duration_seconds": durationSec,
				"score":            score,
				"final_score":      finalScore,
				"status":           status,
				"cheating_status":  cheating,
			})
		}
		return rows.Err()
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	// Export PDF (FR-3.7): profil + riwayat + ringkasan.
	if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("format")), "pdf") {
		filename := "track-record-" + slugName(student.StudentCode) + ".pdf"
		m.pdfTrackRecord(w, filename, student, attempts)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{"student": student, "attempts": attempts}})
}

// ---------- Helper siswa ----------

const studentDetailSelect = `
SELECT s.id::text, s.student_code, COALESCE(s.nis,''), s.name, s.gender,
  COALESCE(s.class_id::text,''), COALESCE(c.name,''), COALESCE(s.username,''), s.status, s.is_guest,
  COALESCE(s.email,''), COALESCE(s.parent_phone,''), COALESCE(s.phone,''), s.birth_place,
  COALESCE(to_char(s.birth_date,'YYYY-MM-DD'),'')
FROM students s LEFT JOIN classes c ON c.id = s.class_id`

// studentDetailByID — WAJIB memakai WHERE: studentDetailSelect berakhir dengan
// klausa JOIN ... ON, sehingga menambahkan `AND s.id=$1` hanya memperluas ON
// dan detail malah mengembalikan siswa pertama di tenant.
const studentDetailByID = studentDetailSelect + ` WHERE s.id=$1`

const studentDetailColumns = `id::text, student_code, COALESCE(nis,''), name, gender,
  COALESCE(class_id::text,''), COALESCE((SELECT name FROM classes c WHERE c.id=students.class_id),''),
  COALESCE(username,''), status, is_guest, COALESCE(email,''), COALESCE(parent_phone,''),
  COALESCE(phone,''), birth_place, COALESCE(to_char(birth_date,'YYYY-MM-DD'),'')`

func scanStudentDetail(row pgx.Row) (*studentDetail, error) {
	var s studentDetail
	err := row.Scan(&s.ID, &s.StudentCode, &s.NIS, &s.Name, &s.Gender,
		&s.ClassID, &s.ClassName, &s.Username, &s.Status, &s.IsGuest, &s.Email, &s.ParentPhone,
		&s.Phone, &s.BirthPlace, &s.BirthDate)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (m *Module) studentWithClass(ctx context.Context, tenantID, id string) (*studentDetail, error) {
	var s *studentDetail
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		s, err = scanStudentDetail(tx.QueryRow(ctx, studentDetailByID, id))
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.ErrNotFound
		}
		return err
	})
	return s, err
}

// newStudentCode: "S-" + 6 karakter acak (unik per tenant; indeks global menjamin lintas tenant).
func (m *Module) newStudentCode() (string, error) {
	suf, err := randomFrom(codeAlphabet, 6)
	if err != nil {
		return "", err
	}
	return "S-" + suf, nil
}

// newUsername: slug(nama) + 3 karakter acak, diharapkan unik global (idx_students_username).
func (m *Module) newUsername(name string) (string, error) {
	base := slugName(name)
	if base == "" {
		base = "siswa"
	}
	if len(base) > 30 {
		base = base[:30]
	}
	suf, err := randomFrom("abcdefghjkmnpqrstuvwxyz23456789", 3)
	if err != nil {
		return "", err
	}
	return base + suf, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func trimPtr(p *string) string {
	if p == nil {
		return ""
	}
	return strings.TrimSpace(*p)
}

func parseIntDefault(s string, def, min, max int) int {
	if s == "" {
		return def
	}
	n := 0
	ok := true
	for _, c := range s {
		if c < '0' || c > '9' {
			ok = false
			break
		}
		n = n*10 + int(c-'0')
		if n > max {
			return max
		}
	}
	if !ok {
		return def
	}
	if n < min {
		return min
	}
	return n
}

// withPassword: salinan respons dengan password sementara (dikirim SEKALI).
func (s *studentDetail) withPassword(tempPwd string) map[string]any {
	return map[string]any{
		"id": s.ID, "student_code": s.StudentCode, "nis": s.NIS, "name": s.Name,
		"gender": s.Gender, "class_id": s.ClassID, "class_name": s.ClassName,
		"username": s.Username, "status": s.Status, "is_guest": s.IsGuest,
		"email": s.Email, "parent_phone": s.ParentPhone,
		"temp_password": tempPwd,
	}
}
