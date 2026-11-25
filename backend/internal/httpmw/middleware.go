package httpmw

import (
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"
)

// isFullSession menolak token pra-2FA: token bertipe "pre2fa" hanya boleh
// dipakai di POST /auth/2fa/login, bukan untuk mengakses resource aplikasi.
// Tanpa pengecekan ini, siapa pun yang tahu email+password bisa memakai
// pre2fa_token sebagai sesi penuh dan 2FA menjadi tidak efektif.
func isFullSession(c *auth.Claims) bool { return c != nil && c.Typ != "pre2fa" }

// RequireAuth memverifikasi Bearer JWT dan membatasi role.
// roles kosong = semua role boleh kecuali anonim.
func RequireAuth(secret string, roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if !strings.HasPrefix(header, "Bearer ") {
				httpx.Error(w, httpx.ErrUnauthorized)
				return
			}
			claims, err := auth.VerifyAccessToken(secret, strings.TrimPrefix(header, "Bearer "))
			if err != nil || !isFullSession(claims) || claims.ExpiresAt != nil && claims.ExpiresAt.Before(time.Now()) {
				httpx.Error(w, httpx.ErrUnauthorized)
				return
			}
			if len(roles) > 0 {
				ok := false
				for _, role := range roles {
					if claims.Role == role {
						ok = true
						break
					}
				}
				if !ok {
					httpx.Error(w, httpx.ErrForbidden)
					return
				}
			}
			next.ServeHTTP(w, r.WithContext(ctxinfo.WithClaims(r.Context(), claims)))
		})
	}
}

// OptionalAuth mem-parsing token jika ada, tanpa menolak anonim.
func OptionalAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if header := r.Header.Get("Authorization"); strings.HasPrefix(header, "Bearer ") {
				if claims, err := auth.VerifyAccessToken(secret, strings.TrimPrefix(header, "Bearer ")); err == nil && isFullSession(claims) {
					r = r.WithContext(ctxinfo.WithClaims(r.Context(), claims))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAuthQueryOrHeader seperti RequireAuth, tetapi token juga diterima
// dari query `?token=` — untuk EventSource (SSE) yang tidak bisa mengirim
// header Authorization (PRD FR-9.3).
func RequireAuthQueryOrHeader(secret string, roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := ""
			if header := r.Header.Get("Authorization"); strings.HasPrefix(header, "Bearer ") {
				token = strings.TrimPrefix(header, "Bearer ")
			} else {
				token = r.URL.Query().Get("token")
			}
			if token == "" {
				httpx.Error(w, httpx.ErrUnauthorized)
				return
			}
			claims, err := auth.VerifyAccessToken(secret, token)
			if err != nil || !isFullSession(claims) || claims.ExpiresAt != nil && claims.ExpiresAt.Before(time.Now()) {
				httpx.Error(w, httpx.ErrUnauthorized)
				return
			}
			if len(roles) > 0 {
				ok := false
				for _, role := range roles {
					if claims.Role == role {
						ok = true
						break
					}
				}
				if !ok {
					httpx.Error(w, httpx.ErrForbidden)
					return
				}
			}
			next.ServeHTTP(w, r.WithContext(ctxinfo.WithClaims(r.Context(), claims)))
		})
	}
}

func RequireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c := ctxinfo.Claims(r.Context())
			if c == nil {
				httpx.Error(w, httpx.ErrUnauthorized)
				return
			}
			for _, role := range roles {
				if c.Role == role {
					next.ServeHTTP(w, r)
					return
				}
			}
			httpx.Error(w, httpx.ErrForbidden)
		})
	}
}

func WithRequestTimeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.TimeoutHandler(next, d, `{"code":"TIMEOUT","message":"Permintaan melebihi batas waktu"}`)
	}
}
