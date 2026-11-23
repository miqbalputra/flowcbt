package users

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/app"
	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpmw"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Module struct{ a *app.App }

func Init(a *app.App) *Module { return &Module{a: a} }

// Routes dipasang di bawah /api/v1.
func (m *Module) Routes(r chi.Router) {
	r.Route("/auth", func(r chi.Router) {
		r.Post("/register", m.register)
		r.Post("/login", m.login)
		r.Post("/refresh", m.refresh)
		r.Post("/verify-email", m.verifyEmail)
		r.Post("/forgot-password", m.forgotPassword)
		r.Post("/reset-password", m.resetPassword)

		r.Group(func(r chi.Router) {
			r.Use(httpmw.RequireAuth(m.a.Cfg.JWTSecret))
			r.Post("/logout", m.logout)
			r.Get("/me", m.me)
			r.Put("/me", m.updateMe)
			r.Post("/change-email", m.changeEmail)
		})
	})
}

// ---- Admin/Guru ----

type registerReq struct {
	FullName    string `json:"full_name" validate:"required,min=3"`
	Email       string `json:"email" validate:"required,email"`
	Phone       string `json:"phone"`
	Password    string `json:"password" validate:"required,min=8"`
	SchoolName  string `json:"school_name" validate:"required,min=3"`
	SchoolLevel string `json:"school_level" validate:"required"`
}

func (m *Module) register(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	if err := m.a.V.Struct(req); err != nil {
		httpx.JSON(w, http.StatusBadRequest, &httpx.APIError{Status: 400, Code: "VALIDATION", Message: "Validasi gagal", Details: validationDetails(err)})
		return
	}
	if !m.a.RL.Allow("register:"+httpx.ClientIP(r), 6) {
		httpx.Error(w, httpx.ErrRateLimited)
		return
	}
	email := normalEmail(req.Email)

	var tenantID, userID, verifyToken string
	// Transaksi lintas-tenant (pembuatan tenant baru) di pool admin.
	err := m.a.DB.WithAdminTx(r.Context(), func(tx pgx.Tx) error {
		var dupe int
		if err := tx.QueryRow(r.Context(),
			`SELECT COUNT(1) FROM users WHERE lower(email)=$1`, email).Scan(&dupe); err != nil {
			return err
		}
		if dupe > 0 {
			return httpx.NewErr(http.StatusConflict, "EMAIL_TAKEN", "Email sudah terdaftar")
		}
		var dupeTenant int
		if err := tx.QueryRow(r.Context(),
			`SELECT COUNT(1) FROM tenants WHERE lower(name)=lower($1)`, strings.TrimSpace(req.SchoolName)).Scan(&dupeTenant); err != nil {
			return err
		}
		if dupeTenant > 0 {
			// anti-penyalahgunaan (PRD 3.2): deteksi duplikasi nama lembaga
			return httpx.NewErr(http.StatusConflict, "SCHOOL_TAKEN", "Nama lembaga sudah terdaftar")
		}
		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			return err
		}
		verifyToken, err = auth.RandomToken(24)
		if err != nil {
			return err
		}
		err = tx.QueryRow(r.Context(), `
			INSERT INTO tenants(name, school_level, status, trial_ends_at)
			VALUES ($1,$2,'active', now() + interval '14 days')
			RETURNING id`, strings.TrimSpace(req.SchoolName), req.SchoolLevel).Scan(&tenantID)
		if err != nil {
			return err
		}
		return tx.QueryRow(r.Context(), `
			INSERT INTO users(tenant_id, name, email, phone, password_hash, role, status, email_verify_token)
			VALUES ($1,$2,$3,$4,$5,'owner','pending_verification',$6)
			RETURNING id`,
			tenantID, req.FullName, email, req.Phone, hash, verifyToken).Scan(&userID)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	// Trial otomatis saat registrasi (PRD 3.1)
	_, _ = m.a.DB.Admin.Exec(r.Context(), `
		INSERT INTO subscriptions(tenant_id, plan_id, kind, starts_at, ends_at, status)
		SELECT $1, id, 'trial', now(), now() + interval '14 days', 'active'
		FROM plans WHERE code='free_trial'`, tenantID)

	// Pengiriman email verifikasi via job queue; di mode dev token dikembalikan agar dapat diuji.
	resp := map[string]any{"message": "Registrasi berhasil. Silakan verifikasi email Anda.", "data": map[string]any{}}
	if m.a.Cfg.Env == "development" {
		resp["data"] = map[string]any{"verify_token": verifyToken}
	}
	httpx.Created(w, resp)
}

type loginReq struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
}

func (m *Module) login(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	ip := httpx.ClientIP(r)
	email := normalEmail(req.Email)
	if !m.a.RL.Allow("login:"+ip, 20) || !m.a.RL.Allow("login:acct:"+email, 10) {
		httpx.Error(w, httpx.ErrRateLimited)
		return
	}
	var (
		id, tenantID, hash, status, role string
		lockedUntil                      *time.Time
	)
	err := m.a.DB.Admin.QueryRow(r.Context(), `
		SELECT id, COALESCE(tenant_id::text,''), password_hash, role, status, failed_locked_until
		FROM users WHERE lower(email)=$1`, email).
		Scan(&id, &tenantID, &hash, &role, &status, &lockedUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Error(w, httpx.NewErr(http.StatusUnauthorized, "INVALID_CREDENTIALS", "Email atau password salah"))
		return
	}
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		httpx.Error(w, httpx.NewErr(http.StatusLocked, "ACCOUNT_LOCKED", "Akun terkunci sementara akibat percobaan gagal berulang. Coba lagi nanti."))
		return
	}
	if !auth.VerifyPassword(req.Password, hash) {
		_, _ = m.a.DB.Admin.Exec(r.Context(), `
			UPDATE users SET failed_attempts = failed_attempts + 1,
			failed_locked_until = CASE WHEN failed_attempts + 1 >= 10 THEN now() + interval '15 minutes' ELSE failed_locked_until END
			WHERE id=$1`, id)
		httpx.Error(w, httpx.NewErr(http.StatusUnauthorized, "INVALID_CREDENTIALS", "Email atau password salah"))
		return
	}
	if status == "suspended" {
		httpx.Error(w, httpx.NewErr(http.StatusForbidden, "ACCOUNT_SUSPENDED", "Akun ditangguhkan. Hubungi dukungan."))
		return
	}
	_, _ = m.a.DB.Admin.Exec(r.Context(), `UPDATE users SET failed_attempts=0, failed_locked_until=NULL WHERE id=$1`, id)

	claims := &auth.Claims{UserID: id, TenantID: tenantID, Role: role, Typ: "staff"}
	resp, err := m.issueTokens(r.Context(), id, r.Header.Get("User-Agent"), claims)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	// Refresh token kini hidup di cookie httpOnly — DILUAR dari body agar
	// XSS tidak bisa membacanya dari localStorage (audit P1-10).
	if rt, ok := resp["refresh_token"].(string); ok && rt != "" {
		m.setRTCookie(w, rt, m.a.Cfg.RefreshTokenTTL)
	}
	delete(resp, "refresh_token")
	resp["refresh_in_cookie"] = true
	resp["user"] = map[string]any{"id": id, "name": email2name(email), "email": email, "role": role, "tenant_id": tenantID}
	httpx.OK(w, resp)
}

type refreshReq struct {
	// Opsional: FE lama mengirim body; FE baru cukup memakai cookie httpOnly.
	RefreshToken string `json:"refresh_token"`
}

// rtCookie — cookie httpOnly pembawa refresh token staf. Path dibatasi ke
// /api/v1/auth sehingga tidak terkirim ke endpoint lain; HttpOnly menutup
// akses JS (XSS tak bisa mencuri token refresh 30-hari). Flag Secure
// otomatis bila PUBLIC_BASE_URL https:// (VPS ujicoba masih http://IP).
func (m *Module) rtCookie(name, value string, maxAge int) *http.Cookie {
	c := &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/api/v1/auth",
		MaxAge:   maxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	}
	if base := m.a.Cfg.PublicBaseURL; strings.HasPrefix(strings.ToLower(base), "https://") {
		c.Secure = true
	}
	return c
}

// setRTCookie kirim cookie refresh baru.
func (m *Module) setRTCookie(w http.ResponseWriter, value string, ttl time.Duration) {
	http.SetCookie(w, m.rtCookie("flowcbt_rt", value, int(ttl.Seconds())))
}

// clearRTCookie hapus cookie refresh (logout).
func (m *Module) clearRTCookie(w http.ResponseWriter) {
	http.SetCookie(w, m.rtCookie("flowcbt_rt", "", -1))
}

func (m *Module) refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshReq
	_ = httpx.Decode(r, &req) // body opsional (FE lama); FE baru rely cookie
	// fallback: refresh dari cookie httpOnly
	if req.RefreshToken == "" {
		if c, err := r.Cookie("flowcbt_rt"); err == nil && c.Value != "" {
			req.RefreshToken = c.Value
		}
	}
	if req.RefreshToken == "" {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "REFRESH_REQUIRED",
			"Refresh token wajib (cookie httpOnly atau body)"))
		return
	}
	// RL per-IP (5/menit): endpoint token inti auth, membatasi probing
	// token refresh secara massal (pola yang sama dengan login).
	if !m.a.RL.Allow("refresh:"+httpx.ClientIP(r), 5) {
		httpx.Error(w, httpx.ErrRateLimited)
		return
	}
	hash := auth.SHA256Hex(req.RefreshToken)
	var userID, tenantID, role, typ, sid string
	var expires time.Time
	err := m.a.DB.Admin.QueryRow(r.Context(), `
		SELECT u.id, COALESCE(u.tenant_id::text,''), u.role, rt.typ, COALESCE(rt.sid,''), rt.expires_at
		FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
		WHERE rt.token_hash=$1 AND rt.revoked=false AND rt.expires_at > now()`, hash).
		Scan(&userID, &tenantID, &role, &typ, &sid, &expires)
	if err != nil {
		httpx.Error(w, httpx.NewErr(http.StatusUnauthorized, "TOKEN_INVALID", "Refresh token tidak valid atau kedaluwarsa"))
		return
	}
	ctx := r.Context()
	tx, err := m.a.DB.Admin.Begin(ctx)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "UPDATE refresh_tokens SET revoked=true WHERE token_hash=$1", hash); err != nil {
		httpx.Error(w, err)
		return
	}
	claims := &auth.Claims{UserID: userID, TenantID: tenantID, Role: role, Typ: typ, SID: sid}
	resp, err := m.issueTokensTx(ctx, tx, userID, r.Header.Get("User-Agent"), claims)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpx.Error(w, err)
		return
	}
	// rotasi: cookie refresh baru; body hanya access token
	if rt, ok := resp["refresh_token"].(string); ok && rt != "" {
		m.setRTCookie(w, rt, m.a.Cfg.RefreshTokenTTL)
	}
	delete(resp, "refresh_token")
	resp["refresh_in_cookie"] = true
	httpx.OK(w, resp)
}

func (m *Module) logout(w http.ResponseWriter, r *http.Request) {
	var req refreshReq
	_ = httpx.Decode(r, &req) // body opsional (FE lama); FE baru rely cookie
	// Cabut refresh token dari body ATAU cookie httpOnly (audit P2 #2b:
	// sejak token pindah ke cookie, logout tanpa baca cookie meninggalkan
	// sesi 30-hari tetap hidup di browser=kotak kredensial kosong).
	tok := req.RefreshToken
	if tok == "" {
		if c, err := r.Cookie("flowcbt_rt"); err == nil && c.Value != "" {
			tok = c.Value
		}
	}
	if tok != "" {
		m.a.DB.Admin.Exec(r.Context(), `UPDATE refresh_tokens SET revoked=true WHERE token_hash=$1`,
			auth.SHA256Hex(tok))
	}
	m.clearRTCookie(w)
	httpx.OK(w, map[string]string{"message": "Logout berhasil"})
}

func (m *Module) verifyEmail(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token" validate:"required"`
	}
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	// RL per-IP (5/menit): mencegah brute-force token verifikasi.
	if !m.a.RL.Allow("verify-email:"+httpx.ClientIP(r), 5) {
		httpx.Error(w, httpx.ErrRateLimited)
		return
	}
	ct, err := m.a.DB.Admin.Exec(r.Context(), `
		UPDATE users SET status='active', email_verified_at=now(), email_verify_token=NULL
		WHERE email_verify_token=$1 AND email_verified_at IS NULL`, req.Token)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if ct.RowsAffected() == 0 {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "TOKEN_INVALID", "Token verifikasi tidak valid atau sudah dipakai"))
		return
	}
	httpx.OK(w, map[string]string{"message": "Email terverifikasi. Silakan login."})
}

func (m *Module) forgotPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email" validate:"required,email"`
	}
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	// RL per-IP (5/menit): menekan biaya flood email reset & pengintip
	// token dev (pola sama dengan login).
	if !m.a.RL.Allow("forgot-password:"+httpx.ClientIP(r), 5) {
		httpx.Error(w, httpx.ErrRateLimited)
		return
	}
	token, _ := auth.RandomToken(24)
	// anti user-enumeration: respons tetap sama
	m.a.DB.Admin.Exec(r.Context(), `
		UPDATE users SET reset_token=$1, reset_token_expires_at=now()+interval '1 hour'
		WHERE lower(email)=$2 AND status<>'suspended'`, token, normalEmail(req.Email))
	resp := map[string]any{"message": "Jika email terdaftar, tautan reset password telah dikirim."}
	if m.a.Cfg.Env == "development" {
		resp["data"] = map[string]any{"reset_token": token}
	}
	httpx.OK(w, resp)
}

func (m *Module) resetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token       string `json:"token" validate:"required"`
		NewPassword string `json:"new_password" validate:"required,min=8"`
	}
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	// RL per-IP (5/menit): mencegah brute-force token reset password.
	if !m.a.RL.Allow("reset-password:"+httpx.ClientIP(r), 5) {
		httpx.Error(w, httpx.ErrRateLimited)
		return
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	ct, err := m.a.DB.Admin.Exec(r.Context(), `
		UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires_at=NULL,
			failed_attempts=0, failed_locked_until=NULL
		WHERE reset_token=$2 AND reset_token_expires_at > now()`, hash, req.Token)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if ct.RowsAffected() == 0 {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "TOKEN_INVALID", "Token reset tidak valid atau kedaluwarsa"))
		return
	}
	httpx.OK(w, map[string]string{"message": "Password berhasil direset."})
}

func (m *Module) me(w http.ResponseWriter, r *http.Request) {
	c := ctxinfo.Claims(r.Context())
	var id, name, email, phone, role, status string
	var verifiedAt *time.Time
	var tenantName, tenantLevel, tz *string
	err := m.a.DB.Admin.QueryRow(r.Context(), `
		SELECT u.id, u.name, u.email, COALESCE(u.phone,''), u.role, u.status, u.email_verified_at,
			t.name, t.school_level, t.timezone
		FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
		WHERE u.id=$1`, c.UserID).
		Scan(&id, &name, &email, &phone, &role, &status, &verifiedAt, &tenantName, &tenantLevel, &tz)
	if err != nil {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	httpx.OK(w, map[string]any{
		"id": id, "name": name, "email": email, "phone": phone, "role": role, "status": status,
		"email_verified": verifiedAt != nil,
		"tenant":         map[string]any{"id": c.TenantID, "name": tenantName, "school_level": tenantLevel, "timezone": tz},
	})
}

func (m *Module) updateMe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string `json:"name" validate:"required,min=2"`
		Phone    string `json:"phone"`
		Password string `json:"password" validate:"omitempty,min=8"`
	}
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	if req.Password != "" {
		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		_, err = m.a.DB.Admin.Exec(r.Context(), `UPDATE users SET name=$1, phone=$2, password_hash=$3, updated_at=now() WHERE id=$4`,
			req.Name, req.Phone, hash, ctxinfo.UserID(r.Context()))
	} else {
		_, err := m.a.DB.Admin.Exec(r.Context(), `UPDATE users SET name=$1, phone=$2, updated_at=now() WHERE id=$3`,
			req.Name, req.Phone, ctxinfo.UserID(r.Context()))
		_ = err
	}
	httpx.OK(w, map[string]string{"message": "Profil diperbarui"})
}

func (m *Module) changeEmail(w http.ResponseWriter, r *http.Request) {
	var req struct {
		NewEmail string `json:"new_email" validate:"required,email"`
	}
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	newEmail := normalEmail(req.NewEmail)
	var dupe int
	if err := m.a.DB.Admin.QueryRow(r.Context(), `SELECT COUNT(1) FROM users WHERE lower(email)=$1 AND id<>$2`, newEmail, ctxinfo.UserID(r.Context())).Scan(&dupe); err != nil {
		httpx.Error(w, err)
		return
	}
	if dupe > 0 {
		httpx.Error(w, httpx.NewErr(http.StatusConflict, "EMAIL_TAKEN", "Email sudah dipakai akun lain"))
		return
	}
	token, _ := auth.RandomToken(24)
	_, err := m.a.DB.Admin.Exec(r.Context(), `
		UPDATE users SET pending_new_email=$1, email_verify_token=$2, email_verified_at=NULL WHERE id=$3`,
		newEmail, token, ctxinfo.UserID(r.Context()))
	if err != nil {
		httpx.Error(w, err)
		return
	}
	resp := map[string]string{"message": "Tautan verifikasi dikirim ke email baru."}
	if m.a.Cfg.Env == "development" {
		resp["verify_token"] = token
	}
	httpx.OK(w, resp)
}

// ---- Helper ----

type tokenPair struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
}

func (m *Module) issueTokens(ctx context.Context, userID, ua string, claims *auth.Claims) (map[string]any, error) {
	return m.issueTx(ctx, m.a.DB.Admin, userID, ua, claims)
}

func (m *Module) issueTokensTx(ctx context.Context, tx pgx.Tx, userID, ua string, claims *auth.Claims) (map[string]any, error) {
	return m.issueTx(ctx, tx, userID, ua, claims)
}

func (m *Module) issueTx(ctx context.Context, exec interface {
	Exec(ctx context.Context, sql string, args ...any) (commandTag pgconn.CommandTag, err error)
}, userID, ua string, claims *auth.Claims) (map[string]any, error) {
	// 1 sesi aktif: cabut refresh token lama milik user (single-session staff).
	_, _ = exec.Exec(ctx, "UPDATE refresh_tokens SET revoked=true WHERE user_id=$1 AND typ='staff'", userID)
	accessStr, err := auth.SignAccessToken(m.a.Cfg.JWTSecret, claims, m.a.Cfg.AccessTokenTTL)
	if err != nil {
		return nil, err
	}
	raw, err := auth.RandomToken(32)
	if err != nil {
		return nil, err
	}
	exp := time.Now().Add(m.a.Cfg.RefreshTokenTTL)
	if _, err := exec.Exec(ctx, `
		INSERT INTO refresh_tokens(user_id, token_hash, expires_at, user_agent, typ, sid)
		VALUES ($1,$2,$3,$4,$5,$6)`, userID, auth.SHA256Hex(raw), exp, ua, claims.Typ, claims.SID); err != nil {
		return nil, err
	}
	pair := tokenPair{AccessToken: accessStr, RefreshToken: raw, ExpiresAt: exp}
	return map[string]any{"access_token": pair.AccessToken, "refresh_token": pair.RefreshToken,
		"expires_at": pair.ExpiresAt, "token_type": "Bearer"}, nil
}

func normalEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

func email2name(e string) string {
	parts := strings.SplitN(e, "@", 2)
	return parts[0]
}

func validationDetails(err error) []map[string]string {
	out := []map[string]string{}
	if verrs, ok := err.(validator.ValidationErrors); ok {
		for _, fe := range verrs {
			out = append(out, map[string]string{"field": fe.Field(), "rule": fe.Tag()})
		}
	}
	return out
}
