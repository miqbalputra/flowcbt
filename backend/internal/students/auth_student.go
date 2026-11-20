package students

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// ---------- Auth siswa (FR-1.3) — publik, tanpa middleware, rate limit ketat ----------

type studentLoginReq struct {
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required"`
}

type studentLoginRow struct {
	ID           string
	TenantID     string
	Name         string
	NIS          string
	Gender       string
	Username     string
	ClassID      string
	ClassName    string
	StudentCode  string
	PasswordHash string
}

// POST /student/auth/login {username, password}
// username bisa: username ATAU student_code ATAU nis. Dicari lintas tenant via
// pool Admin (identitas unik global), lalu password diverifikasi per kandidat.
func (m *Module) studentLogin(w http.ResponseWriter, r *http.Request) {
	var req studentLoginReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	if err := m.a.V.Struct(req); err != nil {
		httpx.Error(w, httpx.NewErr(400, "VALIDATION", "Username dan password wajib diisi"))
		return
	}
	ip := httpx.ClientIP(r)
	ident := strings.TrimSpace(req.Username)
	if !m.a.RL.Allow("slogin:"+ip, 15) || !m.a.RL.Allow("slogin:id:"+ident, 10) {
		httpx.Error(w, httpx.ErrRateLimited)
		return
	}

	candidates, err := m.findStudentCandidates(r.Context(), ident)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var s *studentLoginRow
	for _, c := range candidates {
		if c.PasswordHash != "" && auth.VerifyPassword(req.Password, c.PasswordHash) {
			s = c
			break
		}
	}
	if s == nil {
		httpx.Error(w, httpx.NewErr(401, "INVALID_CREDENTIALS", "Username atau password salah"))
		return
	}

	resp, err := m.issueStudentSession(r.Context(), s.ID, s.TenantID, r.Header.Get("User-Agent"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	resp["student"] = map[string]any{
		"id": s.ID, "name": s.Name, "student_code": s.StudentCode, "nis": s.NIS,
		"gender": s.Gender, "username": s.Username, "class_id": s.ClassID,
		"class_name": s.ClassName, "is_guest": false, "tenant_id": s.TenantID,
	}
	httpx.OK(w, resp)
}

// findStudentCandidates: kandidat siswa aktif by username / student_code / nis.
func (m *Module) findStudentCandidates(ctx context.Context, ident string) ([]*studentLoginRow, error) {
	rows, err := m.a.DB.Admin.Query(ctx, `
		SELECT s.id::text, s.tenant_id::text, s.name, COALESCE(s.nis,''), s.gender,
		  COALESCE(s.username,''), COALESCE(s.class_id::text,''), s.student_code, s.password_hash,
		  COALESCE((SELECT c.name FROM classes c WHERE c.id = s.class_id),'')
		FROM students s
		WHERE (s.username = lower($1) OR upper(s.student_code) = upper($1) OR (s.nis IS NOT NULL AND s.nis = $1))
		  AND s.status='active' AND s.is_guest=false AND s.merged_into_id IS NULL
		  AND s.password_hash IS NOT NULL
		ORDER BY CASE WHEN s.username = lower($1) THEN 0
		              WHEN upper(s.student_code) = upper($1) THEN 1
		              ELSE 2 END, s.created_at
		LIMIT 10`, ident)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*studentLoginRow{}
	for rows.Next() {
		var s studentLoginRow
		if err := rows.Scan(&s.ID, &s.TenantID, &s.Name, &s.NIS, &s.Gender,
			&s.Username, &s.ClassID, &s.StudentCode, &s.PasswordHash, &s.ClassName); err != nil {
			return nil, err
		}
		out = append(out, &s)
	}
	return out, rows.Err()
}

type guestLoginReq struct {
	ExamCode  string  `json:"exam_code" validate:"required"`
	Token     string  `json:"token" validate:"required"`
	Name      string  `json:"name" validate:"required,min=2"`
	Gender    string  `json:"gender" validate:"required"`
	ClassID   *string `json:"class_id"`
	ClassName *string `json:"class_name"`
	NIS       *string `json:"nis"`
}

// POST /student/auth/guest — masuk tanpa akun lewat kode ujian + token (FR-1.3).
// Match siswa terdaftar by NIS atau (nama + kelas); jika tidak cocok dibuat
// peserta tamu (is_guest=true). Sesi tamu diikat perangkat via cookie "fdev".
func (m *Module) studentGuest(w http.ResponseWriter, r *http.Request) {
	var req guestLoginReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	if err := m.a.V.Struct(req); err != nil {
		httpx.Error(w, httpx.NewErr(400, "VALIDATION", "Nama, kode ujian, token, dan jenis kelamin wajib diisi"))
		return
	}
	ip := httpx.ClientIP(r)
	examCode := strings.TrimSpace(req.ExamCode)
	// Rate limit ketat anti tebak-tebakan: 20/menit per ip+kode ujian.
	if !m.a.RL.Allow("sguest:"+ip+":"+examCode, 20) {
		httpx.Error(w, httpx.ErrRateLimited)
		return
	}
	gender, ok := normalizeGender(req.Gender)
	if !ok {
		httpx.Error(w, httpx.NewErr(400, "VALIDATION", "Jenis kelamin harus L atau P"))
		return
	}
	name := strings.TrimSpace(req.Name)
	nis := ""
	if req.NIS != nil {
		nis = strings.TrimSpace(*req.NIS)
	}
	if nis == "" && req.NIS != nil {
		// NIS kosong setelah trim: perlakukan sebagai tidak ada.
		req.NIS = nil
	}

	// 1) Cari ujian aktif (lookup publik via pool Admin; tenant belum diketahui).
	var (
		examID, examTenantID, loginMode string
		guestNISRequired                bool
	)
	err := m.a.DB.Admin.QueryRow(r.Context(), `
		SELECT id::text, tenant_id::text, login_mode, guest_nis_required
		FROM exams
		WHERE lower(exam_code) = lower($1) AND lower(token) = lower($2)
		  AND status='published' AND token_active AND NOT paused
		  AND now() >= open_at AND now() <= close_at
		ORDER BY created_at DESC LIMIT 1`, examCode, strings.TrimSpace(req.Token)).
		Scan(&examID, &examTenantID, &loginMode, &guestNISRequired)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, httpx.NewErr(401, "TOKEN_INVALID", "Kode ujian/token salah atau ujian tidak sedang buka"))
			return
		}
		httpx.Error(w, err)
		return
	}
	if loginMode == "account" {
		httpx.Error(w, httpx.NewErr(403, "GUEST_NOT_ALLOWED", "Ujian ini hanya untuk siswa dengan akun"))
		return
	}
	if guestNISRequired && nis == "" {
		httpx.Error(w, httpx.NewErr(400, "VALIDATION", "NIS wajib diisi untuk ujian ini"))
		return
	}

	// 2) Resolusi kelas (opsional): class_id eksplisit atau class_name.
	classID, className := "", ""
	if req.ClassID != nil && strings.TrimSpace(*req.ClassID) != "" {
		cid := strings.TrimSpace(*req.ClassID)
		if !isUUID(cid) {
			httpx.Error(w, httpx.NewErr(400, "VALIDATION", "class_id tidak valid"))
			return
		}
		err := m.a.DB.Admin.QueryRow(r.Context(),
			`SELECT name FROM classes WHERE id=$1::uuid AND tenant_id=$2::uuid`, cid, examTenantID).Scan(&className)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.Error(w, httpx.NewErr(400, "VALIDATION", "Kelas tidak ditemukan"))
				return
			}
			httpx.Error(w, err)
			return
		}
		classID = cid
	} else if req.ClassName != nil && strings.TrimSpace(*req.ClassName) != "" {
		cn := strings.TrimSpace(*req.ClassName)
		var id string
		err := m.a.DB.Admin.QueryRow(r.Context(), `
			SELECT id::text FROM classes WHERE tenant_id=$1::uuid AND lower(name)=lower($2)
			ORDER BY archived ASC, created_at DESC LIMIT 1`, examTenantID, cn).Scan(&id)
		if err == nil {
			classID, className = id, cn
		} else if !errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, err)
			return
		} else {
			className = cn // snapshot nama saja; kelas nyata dicek saat start (wave 2)
		}
	}

	// 3) Cocokkan ke siswa terdaftar: NIS exact, atau nama+kelas ternormalisasi.
	matched, err := m.matchRegisteredStudent(r.Context(), examTenantID, nis, name, classID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if matched == nil && nis != "" && classID != "" {
		// NIS tidak ketemu -> coba nama+kelas (semantik "atau" pada FR-1.3).
		matched, err = m.matchRegisteredStudent(r.Context(), examTenantID, "", name, classID)
		if err != nil {
			httpx.Error(w, err)
			return
		}
	}
	isGuestMatched := matched != nil
	studentID, studentName, studentClassName := "", name, className
	if isGuestMatched {
		studentID, studentName, studentClassName = matched.ID, matched.Name, matched.ClassName
	} else {
		// 4) Tidak cocok -> buat peserta tamu (snapshot nama & gender; kelas saat start).
		studentID, err = m.createGuestStudent(r.Context(), examTenantID, name, gender)
		if err != nil {
			httpx.Error(w, err)
			return
		}
	}

	resp, err := m.issueStudentSession(r.Context(), studentID, examTenantID, r.Header.Get("User-Agent"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	resp["is_guest_matched"] = isGuestMatched
	resp["student"] = map[string]any{
		"id": studentID, "name": studentName, "class_name": studentClassName, "is_guest": !isGuestMatched,
	}

	// 5) Cookie perangkat "fdev" (httpOnly, SameSite=Lax) untuk sesi tamu offline.
	device := ""
	if c, err := r.Cookie("fdev"); err == nil {
		device = c.Value
	}
	if device == "" || len(device) > 64 {
		if device, err = uuidV4(); err != nil {
			httpx.Error(w, err)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "fdev",
		Value:    device,
		Path:     "/",
		MaxAge:   365 * 24 * 3600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	httpx.OK(w, resp)
}

// matchRegisteredStudent: cari siswa terdaftar aktif milik tenant ujian.
func (m *Module) matchRegisteredStudent(ctx context.Context, tenantID, nis, name, classID string) (*studentLoginRow, error) {
	q := `
		SELECT s.id::text, s.tenant_id::text, s.name, COALESCE(s.nis,''), s.gender,
		  COALESCE(s.username,''), COALESCE(s.class_id::text,''), s.student_code, '', COALESCE(c.name,'')
		FROM students s LEFT JOIN classes c ON c.id = s.class_id
		WHERE s.tenant_id=$1::uuid AND s.status='active' AND s.is_guest=false AND s.merged_into_id IS NULL`
	args := []any{tenantID}
	switch {
	case nis != "":
		q += " AND s.nis = $2 ORDER BY s.created_at LIMIT 1"
		args = append(args, nis)
	case classID != "":
		q += " AND lower(trim(s.name)) = lower(trim($2)) AND s.class_id = $3::uuid ORDER BY s.created_at LIMIT 1"
		args = append(args, name, classID)
	default:
		return nil, nil
	}
	rows, err := m.a.DB.Admin.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var s studentLoginRow
		if err := rows.Scan(&s.ID, &s.TenantID, &s.Name, &s.NIS, &s.Gender,
			&s.Username, &s.ClassID, &s.StudentCode, &s.PasswordHash, &s.ClassName); err != nil {
			return nil, err
		}
		return &s, nil
	}
	return nil, rows.Err()
}

// createGuestStudent: siswa tamu (is_guest=true) dengan kode "G-<6>".
func (m *Module) createGuestStudent(ctx context.Context, tenantID, name, gender string) (string, error) {
	var id string
	err := m.a.DB.WithAdminTx(ctx, func(tx pgx.Tx) error {
		suf, err := randomFrom(codeAlphabet, 6)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			INSERT INTO students(tenant_id, student_code, name, gender, is_guest, status)
			VALUES ($1,$2,$3,$4,true,'active')
			RETURNING id::text`, tenantID, "G-"+suf, name, gender).Scan(&id)
	})
	return id, err
}

// issueStudentSession: one active session per siswa + pasangan token (typ='student').
func (m *Module) issueStudentSession(ctx context.Context, studentID, tenantID, ua string) (map[string]any, error) {
	claims := &auth.Claims{
		UserID: studentID, TenantID: tenantID, Role: "student", Typ: "student", SID: studentID,
	}
	accessStr, err := auth.SignAccessToken(m.a.Cfg.JWTSecret, claims, m.a.Cfg.AccessTokenTTL)
	if err != nil {
		return nil, err
	}
	raw, err := auth.RandomToken(32)
	if err != nil {
		return nil, err
	}
	exp := time.Now().Add(m.a.Cfg.RefreshTokenTTL)
	err = m.a.DB.WithAdminTx(ctx, func(tx pgx.Tx) error {
		// Satu sesi aktif per siswa (FR-1.6): cabut sesi student sebelumnya.
		if _, err := tx.Exec(ctx,
			`UPDATE refresh_tokens SET revoked=true WHERE user_id=$1 AND typ='student' AND revoked=false`,
			studentID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO refresh_tokens(tenant_id, user_id, token_hash, typ, sid, user_agent, expires_at)
			VALUES ($1,$2,$3,'student',$4,$5,$6)`,
			tenantID, studentID, auth.SHA256Hex(raw), studentID, ua, exp)
		return err
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"access_token": accessStr, "refresh_token": raw, "expires_at": exp, "token_type": "Bearer",
	}, nil
}

// POST /student/auth/refresh — rotasi refresh token siswa (typ='student').
func (m *Module) studentRefresh(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token" validate:"required"`
	}
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	if !m.a.RL.Allow("srefresh:"+httpx.ClientIP(r), 30) {
		httpx.Error(w, httpx.ErrRateLimited)
		return
	}
	hash := auth.SHA256Hex(req.RefreshToken)
	var sid, tenantID string
	err := m.a.DB.Admin.QueryRow(r.Context(), `
		SELECT COALESCE(sid,''), COALESCE(tenant_id::text,'')
		FROM refresh_tokens
		WHERE token_hash=$1 AND typ='student' AND revoked=false AND expires_at > now()`, hash).
		Scan(&sid, &tenantID)
	if err != nil || sid == "" || tenantID == "" {
		httpx.Error(w, httpx.NewErr(401, "TOKEN_INVALID", "Refresh token tidak valid atau kedaluwarsa"))
		return
	}
	resp, err := m.issueStudentSession(r.Context(), sid, tenantID, r.Header.Get("User-Agent"))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, resp)
}
