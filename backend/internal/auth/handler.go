package auth

import (
	"net/http"
	"strings"

	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
)

// Routes mendaftarkan endpoint publik auth (base /api/v1).
func (s *Service) Routes(r chi.Router) {
	r.Route("/auth", func(r chi.Router) {
		r.Post("/register", s.handleRegister)
		r.Post("/verify-email", s.handleVerifyEmail)
		r.Post("/login", s.handleLogin)
		r.Post("/refresh", s.handleRefresh)
		r.Post("/logout", s.handleLogout)
		r.Post("/forgot-password", s.handleForgot)
		r.Post("/reset-password", s.handleReset)
		r.Post("/google", s.handleGoogle)
		r.Post("/accept-invite", s.handleAcceptInvite)
		r.With(httpx.AuthN()).Get("/me", s.handleMe)
	})
	r.Route("/student/auth", func(r chi.Router) {
		r.Post("/login", s.handleStudentLogin)
		r.Post("/guest", s.handleGuestLogin)
	})
}

func (s *Service) handleRegister(w http.ResponseWriter, r *http.Request) {
	var in RegisterInput
	if err := httpx.ValidateJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	out, err := s.Register(r.Context(), in, HostOnly(r.RemoteAddr), r.UserAgent())
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, out)
}

func (s *Service) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	if err := s.VerifyEmail(r.Context(), in.Token); err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleLogin(w http.ResponseWriter, r *http.Request) {
	var in LoginInput
	if err := httpx.ValidateJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	pair, user, err := s.Login(r.Context(), in, HostOnly(r.RemoteAddr), r.UserAgent())
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"tokens": pair, "user": user})
}

func (s *Service) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	device := ""
	if c, err := r.Cookie("flowcbt_device"); err == nil {
		device = c.Value
	}
	pair, err := s.RefreshWithDevice(r.Context(), in.RefreshToken, device)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"tokens": pair})
}

func (s *Service) handleLogout(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	_ = httpx.DecodeJSON(r, &in)
	_ = s.Logout(r.Context(), in.RefreshToken)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleForgot(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	_ = httpx.DecodeJSON(r, &in)
	_ = s.ForgotPassword(r.Context(), in.Email)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleReset(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	if err := s.ResetPassword(r.Context(), in.Token, in.Password); err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleGoogle(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDToken string `json:"id_token"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	pair, user, err := s.LoginGoogle(r.Context(), in.IDToken, HostOnly(r.RemoteAddr), r.UserAgent())
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"tokens": pair, "user": user})
}

func (s *Service) handleAcceptInvite(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token    string `json:"token"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	out, err := s.AcceptInvite(r.Context(), in.Token, in.Name, in.Password)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func (s *Service) handleMe(w http.ResponseWriter, r *http.Request) {
	claims := httpx.ClaimsFrom(r.Context())
	if claims == nil || claims.Role == "student" {
		httpx.WriteError(w, httpx.Forbidden("khusus user"))
		return
	}
	out, err := s.Me(r.Context(), claims.Sub)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func (s *Service) handleStudentLogin(w http.ResponseWriter, r *http.Request) {
	var in StudentLoginInput
	if err := httpx.ValidateJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	pair, stu, err := s.StudentLogin(r.Context(), in, HostOnly(r.RemoteAddr), r.UserAgent())
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"tokens": pair, "student": stu})
}

func (s *Service) handleGuestLogin(w http.ResponseWriter, r *http.Request) {
	var in GuestLoginInput
	if err := httpx.ValidateJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	dev := ""
	if c, err := r.Cookie("flowcbt_device"); err == nil {
		dev = c.Value
	}
	pair, stu, err, device := s.GuestLogin(r.Context(), in, HostOnly(r.RemoteAddr), r.UserAgent(), dev)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: "flowcbt_device", Value: device, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, MaxAge: 60 * 60 * 24 * 365,
	})
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"tokens": pair, "student": stu})
}

var _ = strings.TrimSpace
