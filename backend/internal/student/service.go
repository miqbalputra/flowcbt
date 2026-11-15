package student

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

// LimitChecker memeriksa batas jumlah siswa aktif per tenant (FR-3.3b) — diimplementasikan modul billing.
type LimitChecker interface {
	StudentLimit(ctx context.Context, tenantID string) (limit int, active int, err error)
}

type Service struct {
	DB     *platform.DB
	Audit  *audit.Writer
	Limits LimitChecker
	Clock  platform.Clock
}

type Student struct {
	ID           string  `json:"id"`
	StudentCode  string  `json:"student_code"`
	NIS          *string `json:"nis,omitempty"`
	Name         string  `json:"name"`
	Gender       string  `json:"gender"`
	ClassID      *string `json:"class_id,omitempty"`
	ClassName    string  `json:"class_name,omitempty"`
	Username     *string `json:"username,omitempty"`
	HasPassword  bool    `json:"has_password"`
	IsGuest       bool       `json:"is_guest"`
	Status        string     `json:"status"`
	CreatedAt     time.Time  `json:"created_at"`
	PasswordPlain string     `json:"password,omitempty"`
}

func (s *Service) Routes(r chi.Router) {
	r.Route("/students", func(r chi.Router) {
		r.Get("/", s.list)
		r.Post("/", s.create)
		r.Get("/import/template", s.importTemplate)
		r.Post("/import/preview", s.importPreview)
		r.Post("/import/commit", s.importCommit)
		r.Get("/export", s.export)
		r.Post("/move-class", s.moveClass)
		r.Get("/{id}", s.get)
		r.Get("/{id}/track-record", s.trackRecord)
		r.Put("/{id}", s.update)
		r.Delete("/{id}", s.remove)
		r.Post("/{id}/merge-into/{targetId}", s.mergeGuest)
		r.Post("/{id}/reset-password", s.resetPassword)
	})
}

func (s *Service) checkLimit(ctx context.Context, tx pgx.Tx, tenantID string, adding int) error {
	if s.Limits == nil {
		return nil
	}
	limit, active, err := s.Limits.StudentLimit(ctx, tenantID)
	if err != nil {
		return err
	}
	if active+adding > limit {
		return httpx.ErrDetails(httpx.CodeQuotaExceeded,
			fmt.Sprintf("batas jumlah siswa paket Anda tercapai (%d/%d). Silakan upgrade paket.", active, limit),
			409, map[string]any{"active": active, "limit": limit, "upgrade": true})
	}
	return nil
}

func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	q := r.URL.Query().Get("q")
	classID := r.URL.Query().Get("class_id")
	includeGuests := r.URL.Query().Get("guests") == "1"
	var rows []Student
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		query := `SELECT s.id, s.student_code, s.nis, s.name, s.gender, s.class_id, COALESCE(c.name,''), s.username,
		          (s.password_hash IS NOT NULL), s.is_guest, s.status, s.created_at
		   FROM students s LEFT JOIN classes c ON c.id = s.class_id
		   WHERE s.tenant_id=$1 AND s.merged_into_id IS NULL`
		args := []any{tid}
		if !includeGuests {
			query += ` AND s.is_guest = false`
		}
		if classID != "" {
			query += ` AND s.class_id = $` + fmt.Sprint(len(args)+1)
			args = append(args, classID)
		}
		if q != "" {
			query += ` AND (s.name ILIKE '%'||$` + fmt.Sprint(len(args)+1) + `||'%' OR s.student_code ILIKE '%'||$` + fmt.Sprint(len(args)+1) + `||'%' OR s.nis ILIKE '%'||$` + fmt.Sprint(len(args)+1) + `||'%')`
			args = append(args, q)
		}
		query += ` ORDER BY c.name NULLS LAST, s.name LIMIT 500`
		rws, err := tx.Query(r.Context(), query, args...)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var st Student
			if err := rws.Scan(&st.ID, &st.StudentCode, &st.NIS, &st.Name, &st.Gender, &st.ClassID, &st.ClassName, &st.Username, &st.HasPassword, &st.IsGuest, &st.Status, &st.CreatedAt); err != nil {
				return err
			}
			rows = append(rows, st)
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if rows == nil {
		rows = []Student{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

type studentInput struct {
	Name      string  `json:"name"`
	Gender    string  `json:"gender"`
	ClassID   *string `json:"class_id"`
	NIS       *string `json:"nis"`
	NISN      *string `json:"nisn"`
	Email     *string `json:"email"`
	GuardianPhone *string `json:"guardian_phone"`
}

func validGender(g string) bool { return g == "L" || g == "P" }

func (s *Service) create(w http.ResponseWriter, r *http.Request) {
	var in studentInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || !validGender(in.Gender) || in.ClassID == nil || *in.ClassID == "" {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "Nama, Jenis Kelamin (L/P), dan Kelas wajib diisi"))
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	actor := httpx.ActorIDFrom(r.Context())
	var st Student
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		if err := s.checkLimit(r.Context(), tx, tid, 1); err != nil {
			return err
		}
		// username & password awal otomatis (FR-3.3)
		username := strings.ToLower(strings.ReplaceAll(platform.NormalizeName(in.Name), " ", ".")) + "." + strings.ToLower(platform.RandomToken(3))
		rawPass := platform.RandomToken(8)
		pwHash, err := hashPw(rawPass)
		if err != nil {
			return err
		}
		err = tx.QueryRow(r.Context(),
			`INSERT INTO students (tenant_id, student_code, nis, nisn, name, name_normalized, gender, class_id, username, password_hash, email, guardian_phone)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
			 RETURNING id, student_code, name, gender, class_id, username, created_at`,
			tid, platform.StudentCode(), in.NIS, in.NISN, in.Name, platform.NormalizeName(in.Name), in.Gender, *in.ClassID, username, pwHash, in.Email, in.GuardianPhone).
			Scan(&st.ID, &st.StudentCode, &st.Name, &st.Gender, &st.ClassID, &st.Username, &st.CreatedAt)
		if err != nil {
			if strings.Contains(err.Error(), "duplicate") {
				return httpx.Conflict("STUDENT_EXISTS", "NIS atau username sudah terpakai")
			}
			return err
		}
		st.HasPassword = true
		st.Status = "active"
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "student.create", "student", st.ID, map[string]any{"name": in.Name}, "")
		st.PasswordPlain = rawPass
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, st)
}

func (s *Service) get(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	var st Student
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(),
			`SELECT s.id, s.student_code, s.nis, s.name, s.gender, s.class_id, COALESCE(c.name,''), s.username,
			        (s.password_hash IS NOT NULL), s.is_guest, s.status, s.created_at
			 FROM students s LEFT JOIN classes c ON c.id=c.id AND c.id=s.class_id
			 WHERE s.tenant_id=$1 AND s.id=$2 AND s.merged_into_id IS NULL`, tid, id).
			Scan(&st.ID, &st.StudentCode, &st.NIS, &st.Name, &st.Gender, &st.ClassID, &st.ClassName, &st.Username, &st.HasPassword, &st.IsGuest, &st.Status, &st.CreatedAt)
	})
	if err != nil {
		httpx.WriteError(w, httpx.NotFound("siswa tidak ditemukan"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, st)
}

func (s *Service) update(w http.ResponseWriter, r *http.Request) {
	var in studentInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(),
			`UPDATE students SET name=$1, name_normalized=$2, gender=$3, class_id=$4, nis=$5, nisn=$6, email=$7, guardian_phone=$8
			 WHERE tenant_id=$9 AND id=$10`,
			strings.TrimSpace(in.Name), platform.NormalizeName(in.Name), in.Gender, in.ClassID, in.NIS, in.NISN, in.Email, in.GuardianPhone, tid, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("siswa tidak ditemukan")
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "student.update", "student", id, nil, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) remove(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(), `UPDATE students SET status='archived' WHERE tenant_id=$1 AND id=$2`, tid, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("siswa tidak ditemukan")
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// moveClass: aksi massal ubah kelas; riwayat nilai tetap melekat (snapshot kelas di attempt) — FR-3.5.
func (s *Service) moveClass(w http.ResponseWriter, r *http.Request) {
	var in struct {
		StudentIDs []string `json:"student_ids"`
		ClassID    string   `json:"class_id"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	if len(in.StudentIDs) == 0 || in.ClassID == "" {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "student_ids dan class_id wajib"))
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	actor := httpx.ActorIDFrom(r.Context())
	moved := 0
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		// tutup riwayat kelas lama
		if _, err := tx.Exec(r.Context(),
			`UPDATE student_class_history SET to_date = CURRENT_DATE
			 WHERE tenant_id=$1 AND student_id = ANY($2) AND to_date IS NULL`, tid, in.StudentIDs); err != nil {
			return err
		}
		tag, err := tx.Exec(r.Context(), `UPDATE students SET class_id=$1 WHERE tenant_id=$2 AND id = ANY($3)`, in.ClassID, tid, in.StudentIDs)
		if err != nil {
			return err
		}
		moved = int(tag.RowsAffected())
		for _, sid := range in.StudentIDs {
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO student_class_history (tenant_id, student_id, class_id, from_date) VALUES ($1,$2,$3,CURRENT_DATE)
				 ON CONFLICT DO NOTHING`, tid, sid, in.ClassID); err != nil {
				return err
			}
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "student.move_class", "class", in.ClassID, map[string]any{"count": moved}, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"moved": moved})
}

// mergeGuest: gabungkan peserta tamu ke siswa terdaftar (FR-1.3).
func (s *Service) mergeGuest(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	guestID := chi.URLParam(r, "id")
	targetID := chi.URLParam(r, "targetId")
	actor := httpx.ActorIDFrom(r.Context())
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var isGuest bool
		if err := tx.QueryRow(r.Context(), `SELECT is_guest FROM students WHERE tenant_id=$1 AND id=$2`, tid, guestID).Scan(&isGuest); err != nil || !isGuest {
			return httpx.BadRequest(httpx.CodeValidation, "hanya peserta tamu yang bisa digabung")
		}
		// pindahkan attempt & participant ke siswa target, lalu tandai merged
		if _, err := tx.Exec(r.Context(), `UPDATE attempts SET student_id=$1 WHERE tenant_id=$2 AND student_id=$3`, targetID, tid, guestID); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO exam_participants (tenant_id, exam_id, student_id, source)
			 SELECT tenant_id, exam_id, $1, source FROM exam_participants WHERE tenant_id=$2 AND student_id=$3
			 ON CONFLICT (exam_id, student_id) DO NOTHING`, targetID, tid, guestID); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `DELETE FROM exam_participants WHERE tenant_id=$1 AND student_id=$2`, tid, guestID); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE students SET merged_into_id=$1 WHERE tenant_id=$2 AND id=$3`, targetID, tid, guestID); err != nil {
			return err
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "student.merge_guest", "student", guestID, map[string]any{"into": targetID}, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) resetPassword(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	raw := platform.RandomToken(8)
	h, err := hashPw(raw)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	err = s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(), `UPDATE students SET password_hash=$1 WHERE tenant_id=$2 AND id=$3`, h, tid, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("siswa tidak ditemukan")
		}
		s.Audit.Log(r.Context(), tx, tid, "user", httpx.ActorIDFrom(r.Context()), "student.reset_password", "student", id, nil, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"password": raw})
}

// trackRecord: riwayat seluruh ujian siswa (FR-3.7).
func (s *Service) trackRecord(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	var out map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var name, code string
		if err := tx.QueryRow(r.Context(), `SELECT name, student_code FROM students WHERE tenant_id=$1 AND id=$2`, tid, id).Scan(&name, &code); err != nil {
			return httpx.NotFound("siswa tidak ditemukan")
		}
		type attemptRow struct {
			ExamID     string   `json:"exam_id"`
			ExamName   string   `json:"exam_name"`
			Subject    string   `json:"subject"`
			AttemptNo  int      `json:"attempt_no"`
			Status     string   `json:"status"`
			FinalScore  *float64   `json:"final_score"`
			RawScore    *float64   `json:"raw_score"`
			Penalty     float64    `json:"penalty_points"`
			StartedAt   time.Time  `json:"started_at"`
			SubmittedAt *time.Time `json:"submitted_at"`
			ClassSnap   *string    `json:"class_snapshot"`
		}
		var attempts []attemptRow
		rws, err := tx.Query(r.Context(),
			`SELECT a.exam_id, e.name, qs.subject_name, a.attempt_no, a.status, a.final_score, a.raw_score, a.penalty_points, a.started_at, a.submitted_at, a.class_snapshot
			 FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN question_sets qs ON qs.id=e.question_set_id
			 WHERE a.tenant_id=$1 AND a.student_id=$2 ORDER BY a.started_at DESC`, tid, id)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var a attemptRow
			if err := rws.Scan(&a.ExamID, &a.ExamName, &a.Subject, &a.AttemptNo, &a.Status, &a.FinalScore, &a.RawScore, &a.Penalty, &a.StartedAt, &a.SubmittedAt, &a.ClassSnap); err != nil {
				return err
			}
			attempts = append(attempts, a)
		}
		if attempts == nil {
			attempts = []attemptRow{}
		}
		out = map[string]any{"student_id": id, "name": name, "student_code": code, "attempts": attempts}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func hashPw(p string) (string, error) {
	return authHash(p)
}

var _ = time.Now
