package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"flowcbt/backend/internal/audit"
	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/platform"

	"github.com/jackc/pgx/v5"
)

type Service struct {
	DB      *platform.DB
	Clock   platform.Clock
	Mailer  platform.Mailer
	Limiter platform.RateLimiter
	Audit   *audit.Writer
	Issuer  *Issuer
	Cfg     platform.Config
	Google  GoogleVerifier
}

func hashOTT(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}



type RegisterInput struct {
	Name         string `json:"name" validate:"required,min=2,max=120"`
	Email        string `json:"email" validate:"required,email"`
	Phone        string `json:"phone"`
	Password     string `json:"password" validate:"required,min=8,max=72"`
	TenantName   string `json:"tenant_name" validate:"required,min=2,max=120"`
	Level        string `json:"level" validate:"required,oneof=paud_tk sd_mi smp_mts sma_smk_ma perguruan_tinggi kursus_bimbel lainnya"`
}

// Register membuat tenant baru + owner + paket trial (FR-1.1, FR-3.2: trial otomatis, sekali per tenant).
func (s *Service) Register(ctx context.Context, in RegisterInput, ip, ua string) (map[string]any, error) {
	email := strings.ToLower(strings.TrimSpace(in.Email))
	// anti-penyalahgunaan paket gratis: deteksi duplikasi email/nama/HP (PRD 3.2)
	var dup int
	err := s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		emailHash := hashOTT(email)
		return tx.QueryRow(ctx,
			`SELECT count(*) FROM tenants WHERE owner_email_hash = $1
			   OR name_normalized = $2
			   OR (phone_normalized IS NOT NULL AND phone_normalized = $3)`,
			emailHash, platform.NormalizeName(in.TenantName), normalizePhone(in.Phone)).Scan(&dup)
	})
	if err != nil {
		return nil, err
	}
	if dup > 0 {
		return nil, httpx.BadRequest("DUPLICATE_FREE_PLAN", "paket gratis hanya bisa dipakai sekali per email/nama lembaga/nomor HP")
	}

	pwHash, err := HashPassword(in.Password)
	if err != nil {
		return nil, err
	}
	ott := randomToken()
	tenantCode := strings.ToUpper(platform.RandomToken(6))
	devAutoVerify := s.Cfg.Env == "dev"

	var tenantID, userID string
	err = s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx,
			`INSERT INTO tenants (code, name, level, phone, free_plan_used, name_normalized, phone_normalized, owner_email_hash)
			 VALUES ($1,$2,$3,$4,true,$5,$6,$7) RETURNING id`,
			tenantCode, in.TenantName, in.Level, nullStr(in.Phone),
			platform.NormalizeName(in.TenantName), normalizePhone(in.Phone), hashOTT(email)).Scan(&tenantID); err != nil {
			return err
		}
		verified := any(nil)
		if devAutoVerify {
			verified = s.Clock.Now()
		}
		if err := tx.QueryRow(ctx,
			`INSERT INTO users (tenant_id, role, name, email, phone, password_hash, email_verified_at, status)
			 VALUES ($1,'owner',$2,$3,$4,$5,$6,'active') RETURNING id`,
			tenantID, in.Name, email, nullStr(in.Phone), pwHash, verified).Scan(&userID); err != nil {
			return err
		}
		// paket trial otomatis: plan free_trial, 1 ujian, 14 hari (PRD 3.1/3.2)
		var planID string
		var quota int
		var days int
		if err := tx.QueryRow(ctx, `SELECT id, exam_quota, duration_days FROM plans WHERE code='free_trial'`).Scan(&planID, &quota, &days); err != nil {
			return err
		}
		starts := s.Clock.Now()
		if _, err := tx.Exec(ctx,
			`INSERT INTO subscriptions (tenant_id, plan_id, type, status, student_limit, exam_quota, exams_used, starts_at, ends_at)
			 VALUES ($1,$2,'trial','active',10,$3,0,$4,$5)`,
			tenantID, planID, quota, starts, starts.AddDate(0, 0, days)); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`INSERT INTO one_time_tokens (tenant_id, user_id, email, purpose, token_hash, expires_at)
			 VALUES ($1,$2,$3,'verify_email',$4,$5)`,
			tenantID, userID, email, hashOTT(ott), s.Clock.Now().Add(48*time.Hour))
		return err
	})
	if err != nil {
		if strings.Contains(err.Error(), "users_email_key") || strings.Contains(err.Error(), "duplicate") {
			return nil, httpx.Conflict("EMAIL_TAKEN", "email sudah terdaftar")
		}
		return nil, err
	}
	link := fmt.Sprintf("%s/verify-email?token=%s", s.Cfg.AppURL, ott)
	_ = s.Mailer.Send(ctx, platform.Mail{
		To: email, Subject: "Verifikasi email FlowCBT",
		Body: fmt.Sprintf("Halo %s,\n\nVerifikasi email Anda: %s\n\nJika bukan Anda, abaikan email ini.", in.Name, link),
	})
	s.Audit.Log(ctx, s.DB.System, tenantID, "user", userID, "auth.register", "tenant", tenantID, map[string]any{"email": email}, ip)
	return map[string]any{"tenant_id": tenantID, "user_id": userID, "email": email, "auto_verified_dev": devAutoVerify}, nil
}

func normalizePhone(p string) any {
	p = strings.TrimSpace(p)
	if p == "" {
		return nil
	}
	var b strings.Builder
	for _, r := range p {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// VerifyEmail memverifikasi token sekali pakai (FR-1.1).
func (s *Service) VerifyEmail(ctx context.Context, raw string) error {
	return s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		var id, userID string
		var usedAt *time.Time
		var exp time.Time
		err := tx.QueryRow(ctx,
			`SELECT id, user_id, used_at, expires_at FROM one_time_tokens WHERE token_hash=$1 AND purpose='verify_email'`,
			hashOTT(raw)).Scan(&id, &userID, &usedAt, &exp)
		if err != nil {
			return httpx.BadRequest("TOKEN_INVALID", "token verifikasi tidak ditemukan")
		}
		if usedAt != nil || time.Now().After(exp) {
			return httpx.BadRequest("TOKEN_EXPIRED", "token sudah dipakai atau kedaluwarsa")
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET email_verified_at = now() WHERE id=$1`, userID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE one_time_tokens SET used_at = now() WHERE id=$1`, id)
		return err
	})
}

type LoginInput struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
}

// Login user (lintas tenant, karena itu system tx). Rate limit + lockout sementara (FR-1.2).
func (s *Service) Login(ctx context.Context, in LoginInput, ip, ua string) (*TokenPair, map[string]any, error) {
	email := strings.ToLower(strings.TrimSpace(in.Email))
	key := "login:" + email + "|" + ip
	ok, _ := s.Limiter.Allow(ctx, key, 10, 10*time.Minute)
	if !ok {
		return nil, nil, httpx.TooManyRequests("terlalu banyak percobaan login, coba lagi nanti")
	}
	var (
		userID, role, pwHash, status string
		tenantID                       *string // NULL untuk super_admin
		verified                       *time.Time
		failed                         int
		lockedUntil                    *time.Time
	)
	err := s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT id, tenant_id, role, password_hash, status, email_verified_at, failed_login_count, locked_until
			 FROM users WHERE email = $1`, email).
			Scan(&userID, &tenantID, &role, &pwHash, &status, &verified, &failed, &lockedUntil)
	})
	if err != nil {
		return nil, nil, httpx.Unauthorized("email atau password salah")
	}
	if lockedUntil != nil && s.Clock.Now().Before(*lockedUntil) {
		return nil, nil, httpx.TooManyRequests("akun terkunci sementara karena percobaan gagal berulang")
	}
	if !VerifyPassword(in.Password, pwHash) {
		_ = s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
			failed++
			var lock any
			if failed >= 5 {
				lock = s.Clock.Now().Add(15 * time.Minute)
			}
			_, err := tx.Exec(ctx, `UPDATE users SET failed_login_count=$1, locked_until=$2 WHERE id=$3`, failed, lock, userID)
			return err
		})
		return nil, nil, httpx.Unauthorized("email atau password salah")
	}
	if status != "active" {
		return nil, nil, httpx.Forbidden("akun tidak aktif")
	}
	if verified == nil {
		return nil, nil, httpx.Err("EMAIL_NOT_VERIFIED", "verifikasi email terlebih dahulu", 403)
	}
	_ = s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE users SET failed_login_count=0, locked_until=NULL, last_login_at=now() WHERE id=$1`, userID)
		return err
	})
	tid := ""
	if tenantID != nil {
		tid = *tenantID
	}
	pair, err := s.Issuer.IssuePair(ctx, s.DB.System, platform.NewIDString(), tid, "user", role, userID, "", ip, ua)
	if err != nil {
		return nil, nil, err
	}
	return pair, map[string]any{"id": userID, "tenant_id": tid, "role": role}, nil
}

func (s *Service) Refresh(ctx context.Context, rawRefresh string) (*TokenPair, error) {
	var pair *TokenPair
	err := s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		var err error
		pair, err = s.Issuer.Rotate(ctx, tx, rawRefresh)
		return err
	})
	return pair, err
}

func (s *Service) Logout(ctx context.Context, rawRefresh string) error {
	return s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		return s.Issuer.Revoke(ctx, tx, rawRefresh)
	})
}

func (s *Service) ForgotPassword(ctx context.Context, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	ott := randomToken()
	return s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		var userID, tenantID string
		err := tx.QueryRow(ctx, `SELECT id, tenant_id FROM users WHERE email=$1`, email).Scan(&userID, &tenantID)
		if err != nil {
			return nil // jangan bocorkan eksistensi email
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO one_time_tokens (tenant_id, user_id, email, purpose, token_hash, expires_at)
			 VALUES ($1,$2,$3,'reset_password',$4,$5)`,
			tenantID, userID, email, hashOTT(ott), s.Clock.Now().Add(time.Hour)); err != nil {
			return err
		}
		link := fmt.Sprintf("%s/reset-password?token=%s", s.Cfg.AppURL, ott)
		_ = s.Mailer.Send(ctx, platform.Mail{To: email, Subject: "Reset password FlowCBT", Body: "Reset password: " + link})
		return nil
	})
}

func (s *Service) ResetPassword(ctx context.Context, raw, newPassword string) error {
	pwHash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	return s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		var id, userID string
		var usedAt *time.Time
		var exp time.Time
		if err := tx.QueryRow(ctx,
			`SELECT id, user_id, used_at, expires_at FROM one_time_tokens WHERE token_hash=$1 AND purpose='reset_password'`,
			hashOTT(raw)).Scan(&id, &userID, &usedAt, &exp); err != nil {
			return httpx.BadRequest("TOKEN_INVALID", "token tidak ditemukan")
		}
		if usedAt != nil || time.Now().After(exp) {
			return httpx.BadRequest("TOKEN_EXPIRED", "token sudah dipakai atau kedaluwarsa")
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET password_hash=$1, failed_login_count=0, locked_until=NULL WHERE id=$2`, pwHash, userID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, userID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE one_time_tokens SET used_at=now() WHERE id=$1`, id)
		return err
	})
}

// GoogleVerifier memverifikasi id_token Google (bisa di-mock pada test).
type GoogleVerifier interface {
	Verify(ctx context.Context, idToken string) (sub, email string, err error)
}

func (s *Service) LoginGoogle(ctx context.Context, idToken, ip, ua string) (*TokenPair, map[string]any, error) {
	if s.Google == nil {
		return nil, nil, httpx.BadRequest("GOOGLE_DISABLED", "login Google belum dikonfigurasi")
	}
	sub, email, err := s.Google.Verify(ctx, idToken)
	if err != nil {
		return nil, nil, httpx.Unauthorized("token Google tidak valid")
	}
	var userID, role string
	var tenantID *string
	err = s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT id, tenant_id, role FROM users WHERE google_sub=$1`, sub).Scan(&userID, &tenantID, &role)
		if err == nil {
			return nil
		}
		err = tx.QueryRow(ctx, `SELECT id, tenant_id, role FROM users WHERE email=$1`, strings.ToLower(email)).Scan(&userID, &tenantID, &role)
		if err != nil {
			return httpx.NotFound("akun belum terdaftar; silakan daftar via form")
		}
		_, err = tx.Exec(ctx, `UPDATE users SET google_sub=$1, email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$2`, sub, userID)
		return err
	})
	if err != nil {
		return nil, nil, err
	}
	tid := ""
	if tenantID != nil {
		tid = *tenantID
	}
	pair, err := s.Issuer.IssuePair(ctx, s.DB.System, platform.NewIDString(), tid, "user", role, userID, "", ip, ua)
	if err != nil {
		return nil, nil, err
	}
	return pair, map[string]any{"id": userID, "tenant_id": tid, "role": role}, nil
}

// --- Login siswa ---

type StudentLoginInput struct {
	TenantCode string `json:"tenant_code" validate:"required"`
	Username   string `json:"username" validate:"required"`
	Password   string `json:"password" validate:"required"`
}

func (s *Service) StudentLogin(ctx context.Context, in StudentLoginInput, ip, ua string) (*TokenPair, map[string]any, error) {
	key := "slogin:" + strings.ToUpper(in.TenantCode) + ":" + in.Username + "|" + ip
	ok, _ := s.Limiter.Allow(ctx, key, 10, 10*time.Minute)
	if !ok {
		return nil, nil, httpx.TooManyRequests("terlalu banyak percobaan, coba lagi nanti")
	}
	var tenantID, studentID, pwHash, status string
	err := s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT id FROM tenants WHERE code=$1 AND status <> 'purged'`, strings.ToUpper(in.TenantCode)).Scan(&tenantID); err != nil {
			return httpx.Unauthorized("kode sekolah atau kredensial salah")
		}
		return tx.QueryRow(ctx,
			`SELECT id, password_hash, status FROM students WHERE tenant_id=$1 AND username=$2 AND is_guest=false`,
			tenantID, strings.ToLower(in.Username)).Scan(&studentID, &pwHash, &status)
	})
	if err != nil {
		return nil, nil, httpx.Unauthorized("kode sekolah atau kredensial salah")
	}
	if status != "active" || !VerifyPassword(in.Password, pwHash) {
		return nil, nil, httpx.Unauthorized("kode sekolah atau kredensial salah")
	}
	pair, err := s.Issuer.IssuePair(ctx, s.DB.System, platform.NewIDString(), tenantID, "student", "student", studentID, "", ip, ua)
	if err != nil {
		return nil, nil, err
	}
	return pair, map[string]any{"student_id": studentID, "tenant_id": tenantID, "role": "student"}, nil
}

// --- Login tanpa akun (peserta tamu) — FR-1.3 ---

type GuestLoginInput struct {
	ExamCode  string `json:"exam_code" validate:"required"`
	Token     string `json:"token" validate:"required"`
	Name      string `json:"name" validate:"required,min=2"`
	Gender    string `json:"gender" validate:"required,oneof=L P"`
	ClassName string `json:"class_name" validate:"required"`
	NIS       string `json:"nis"`
}

// GuestLogin: kode ujian + token -> tenant via token global; cocokkan siswa (NIS / nama+kelas); bila tidak cocok buat peserta tamu.
func (s *Service) GuestLogin(ctx context.Context, in GuestLoginInput, ip, ua, deviceCookie string) (*TokenPair, map[string]any, error, string) {
	key := "guest:" + strings.ToUpper(in.Token) + "|" + ip
	ok, _ := s.Limiter.Allow(ctx, key, 20, 10*time.Minute)
	if !ok {
		return nil, nil, httpx.TooManyRequests("terlalu banyak percobaan token, coba lagi nanti"), ""
	}
	in.Token = strings.ToUpper(strings.TrimSpace(in.Token))
	var tenantID, examID string
	err := s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT tenant_id, exam_id FROM exam_tokens WHERE token=$1 AND is_active=true`, in.Token).
			Scan(&tenantID, &examID)
	})
	if err != nil {
		return nil, nil, httpx.Err(httpx.CodeTokenInvalid, "token ujian tidak valid", 401), ""
	}
	var loginMode, examCode, examStatus string
	var setID string
	err = s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT e.login_mode, e.status, qs.exam_code, e.question_set_id FROM exams e JOIN question_sets qs ON qs.id=e.question_set_id WHERE e.id=$1`, examID).
			Scan(&loginMode, &examStatus, &examCode, &setID); err != nil {
			return err
		}
		if loginMode == "account" {
			return httpx.Forbidden("ujian ini hanya untuk login dengan akun")
		}
		if examStatus != "published" {
			return httpx.Err(httpx.CodeExamNotOpen, "ujian belum dibuka", 409)
		}
		if !strings.EqualFold(examCode, in.ExamCode) {
			return httpx.Err(httpx.CodeTokenInvalid, "kode ujian tidak cocok dengan token", 401)
		}
		return nil
	})
	if err != nil {
		return nil, nil, err, ""
	}

	// pencocokan siswa: NIS dulu, lalu nama+kelas ternormalisasi (FR-1.3)
	var studentID string
	nameNorm := platform.NormalizeName(in.Name)
	err = s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if in.NIS != "" {
			if err := tx.QueryRow(ctx,
				`SELECT id FROM students WHERE tenant_id=$1 AND nis=$2 AND is_guest=false AND status='active'`,
				tenantID, in.NIS).Scan(&studentID); err == nil {
				return nil
			}
		}
		return tx.QueryRow(ctx,
			`SELECT s.id FROM students s JOIN classes c ON c.id = s.class_id
			 WHERE s.tenant_id=$1 AND s.name_normalized=$2 AND c.name=$3 AND s.is_guest=false AND s.status='active' LIMIT 1`,
			tenantID, nameNorm, in.ClassName).Scan(&studentID)
	})
	isGuest := false
	if err != nil {
		// buat peserta tamu, periksa batas tier (FR-3.3b)
		isGuest = true
		err = s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
			var active int
			var limit int
			if err := tx.QueryRow(ctx,
				`SELECT count(*) FROM students WHERE tenant_id=$1 AND status='active' AND merged_into_id IS NULL`, tenantID).Scan(&active); err != nil {
				return err
			}
			if err := tx.QueryRow(ctx,
				`SELECT COALESCE(max(student_limit),10) FROM (
				   SELECT student_limit FROM subscriptions WHERE tenant_id=$1 AND status='active' AND ends_at > now()
				   UNION ALL SELECT student_limit FROM exam_credits WHERE tenant_id=$1 AND used < quantity
				 ) t`, tenantID).Scan(&limit); err != nil {
				return err
			}
			if active+1 > limit {
				return httpx.Err(httpx.CodeQuotaExceeded, fmt.Sprintf("batas siswa paket tercapai (%d/%d); hubungi admin untuk upgrade", active, limit), 409)
			}
			var classID any
			_ = tx.QueryRow(ctx, `SELECT id FROM classes WHERE tenant_id=$1 AND name=$2 LIMIT 1`, tenantID, in.ClassName).Scan(&classID)
			pw, _ := HashPassword(platform.RandomToken(12))
			return tx.QueryRow(ctx,
				`INSERT INTO students (tenant_id, student_code, nis, name, name_normalized, gender, class_id, username, password_hash, is_guest, status)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,true,'active') RETURNING id`,
				tenantID, platform.StudentCode(), nullStr(in.NIS), in.Name, nameNorm, in.Gender, classID, pw).Scan(&studentID)
		})
		if err != nil {
			return nil, nil, err, ""
		}
	}
	// pastikan terdaftar sebagai peserta ujian (source=guest)
	_ = s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`INSERT INTO exam_participants (tenant_id, exam_id, student_id, source) VALUES ($1,$2,$3,'guest')
			 ON CONFLICT (exam_id, student_id) DO UPDATE SET source = CASE WHEN exam_participants.source='assignment' THEN 'assignment' ELSE 'guest' END`,
			tenantID, examID, studentID)
		return err
	})
	device := deviceCookie
	if device == "" {
		device = platform.NewIDString()
	}
	pair, err := s.Issuer.IssuePair(ctx, s.DB.System, platform.NewIDString(), tenantID, "student", "student", studentID, hashDevice(device), ip, ua)
	if err != nil {
		return nil, nil, err, ""
	}
	return pair, map[string]any{"student_id": studentID, "tenant_id": tenantID, "role": "student", "is_guest": isGuest}, nil, device
}

func hashDevice(d string) string {
	sum := sha256.Sum256([]byte("dev:" + d))
	return hex.EncodeToString(sum[:])
}

// --- Undangan guru (FR-1.5) ---

func (s *Service) InviteTeacher(ctx context.Context, tenantID, actorID, email, role string, classIDs []string) error {
	ott := randomToken()
	payload := map[string]any{"role": role, "class_ids": classIDs}
	return s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`INSERT INTO one_time_tokens (tenant_id, email, purpose, token_hash, payload, expires_at)
			 VALUES ($1,$2,'teacher_invite',$3,$4,$5)`,
			tenantID, strings.ToLower(email), hashOTT(ott), payload, s.Clock.Now().Add(7*24*time.Hour)); err != nil {
			return err
		}
		link := fmt.Sprintf("%s/accept-invite?token=%s", s.Cfg.AppURL, ott)
		_ = s.Mailer.Send(ctx, platform.Mail{To: email, Subject: "Undangan guru FlowCBT", Body: "Anda diundang sebagai " + role + ": " + link})
		s.Audit.Log(ctx, tx, tenantID, "user", actorID, "teacher.invite", "user", nil, map[string]any{"email": email, "role": role}, "")
		return nil
	})
}

func (s *Service) AcceptInvite(ctx context.Context, raw, name, password string) (map[string]any, error) {
	pwHash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	var tenantID, email, role string
	var classIDs []string
	var userID string
	err = s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		var id string
		var usedAt *time.Time
		var exp time.Time
		var payload []byte
		if err := tx.QueryRow(ctx,
			`SELECT id, tenant_id, email, used_at, expires_at, payload FROM one_time_tokens WHERE token_hash=$1 AND purpose='teacher_invite'`,
			hashOTT(raw)).Scan(&id, &tenantID, &email, &usedAt, &exp, &payload); err != nil {
			return httpx.BadRequest("TOKEN_INVALID", "undangan tidak ditemukan")
		}
		if usedAt != nil || time.Now().After(exp) {
			return httpx.BadRequest("TOKEN_EXPIRED", "undangan kedaluwarsa")
		}
		if err := jsonUnmarshal(payload, &struct {
			Role     *string   `json:"role"`
			ClassIDs *[]string `json:"class_ids"`
		}{&role, &classIDs}); err != nil {
			return err
		}
		if role == "" {
			role = "teacher"
		}
		if err := tx.QueryRow(ctx,
			`INSERT INTO users (tenant_id, role, name, email, password_hash, email_verified_at, status)
			 VALUES ($1,$2,$3,$4,$5,now(),'active') RETURNING id`,
			tenantID, role, name, email, pwHash).Scan(&userID); err != nil {
			return err
		}
		for _, cid := range classIDs {
			if _, err := tx.Exec(ctx,
				`INSERT INTO teacher_class_assignments (tenant_id, user_id, class_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
				tenantID, userID, cid); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `UPDATE one_time_tokens SET used_at=now() WHERE id=$1`, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"user_id": userID, "tenant_id": tenantID, "role": role}, nil
}

// Me mengembalikan profil user yang sedang login.
func (s *Service) Me(ctx context.Context, userID string) (map[string]any, error) {
	var out map[string]any
	err := s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		var tenantID *string
		var role, name, email, status string
		var phone, theme *string
		var verified *time.Time
		if err := tx.QueryRow(ctx,
			`SELECT tenant_id, role, name, email, phone, status, email_verified_at, theme_pref FROM users WHERE id=$1`, userID).
			Scan(&tenantID, &role, &name, &email, &phone, &status, &verified, &theme); err != nil {
			return httpx.NotFound("user tidak ditemukan")
		}
		out = map[string]any{
			"id": userID, "role": role, "name": name,
			"email": email, "phone": phone, "status": status, "theme_pref": theme,
		}
		if tenantID != nil {
			out["tenant_id"] = *tenantID
			var tname, tcode, tstatus, tz string
			if err := tx.QueryRow(ctx, `SELECT name, code, status, timezone FROM tenants WHERE id=$1`, *tenantID).Scan(&tname, &tcode, &tstatus, &tz); err == nil {
				out["tenant"] = map[string]any{"id": *tenantID, "name": tname, "code": tcode, "status": tstatus, "timezone": tz}
			}
		}
		if verified != nil {
			out["email_verified"] = true
		}
		return nil
	})
	return out, err
}
