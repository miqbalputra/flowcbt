package httpx

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
)

type ctxKey string

const (
	ctxRequestID ctxKey = "request_id"
	ctxClaims    ctxKey = "claims"
	ctxTenantID  ctxKey = "tenant_id"
	ctxActorType ctxKey = "actor_type"
	ctxActorID   ctxKey = "actor_id"
	ctxDeviceHash ctxKey = "device_hash"
)

// Claims adalah payload JWT (FR-1.6).
type Claims struct {
	Sub       string `json:"sub"`       // user id atau student id
	Role      string `json:"role"`      // super_admin | owner | teacher | student
	TenantID  string `json:"tid,omitempty"`
	TokenType string `json:"typ"`       // "access"
	Device    string `json:"dev,omitempty"`
	jwt.RegisteredClaims
}

func JWTSecret() []byte {
	// di-set dari main via package var (dihindari import cycle)
	return []byte(jwtSecretVar)
}

var jwtSecretVar string

func SetJWTSecret(s string) { jwtSecretVar = s }

func ParseToken(tokenStr string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, Unauthorized("metode signing tidak valid")
		}
		return JWTSecret(), nil
	})
	if err != nil {
		return nil, Unauthorized("token tidak valid atau kedaluwarsa")
	}
	if claims.TokenType != "access" {
		return nil, Unauthorized("tipe token tidak valid")
	}
	return claims, nil
}

func RequestID() func(http.Handler) http.Handler { return middleware.RequestID }

func Recoverer(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic", "err", rec)
					WriteError(w, Internal(http.ErrAbortHandler))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func Logger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			log.Info("http",
				"method", r.Method, "path", r.URL.Path,
				"status", ww.Status(), "bytes", ww.BytesWritten(),
				"dur_ms", time.Since(start).Milliseconds(),
				"rid", middleware.GetReqID(r.Context()),
			)
		})
	}
}

// AuthN memverifikasi Bearer JWT dan menyimpan claims di context.
func AuthN() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			if !strings.HasPrefix(auth, "Bearer ") {
				WriteError(w, Unauthorized("token tidak ditemukan"))
				return
			}
			claims, err := ParseToken(strings.TrimPrefix(auth, "Bearer "))
			if err != nil {
				WriteError(w, err)
				return
			}
			ctx := context.WithValue(r.Context(), ctxClaims, claims)
			ctx = context.WithValue(ctx, ctxActorID, claims.Sub)
			ctx = context.WithValue(ctx, ctxActorType, claims.Role)
			if claims.TenantID != "" {
				ctx = context.WithValue(ctx, ctxTenantID, claims.TenantID)
			}
			if claims.Device != "" {
				ctx = context.WithValue(ctx, ctxDeviceHash, claims.Device)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func ClaimsFrom(ctx context.Context) *Claims {
	c, _ := ctx.Value(ctxClaims).(*Claims)
	return c
}

func TenantIDFrom(ctx context.Context) string {
	v, _ := ctx.Value(ctxTenantID).(string)
	return v
}

func ActorIDFrom(ctx context.Context) string {
	v, _ := ctx.Value(ctxActorID).(string)
	return v
}

func ActorTypeFrom(ctx context.Context) string {
	v, _ := ctx.Value(ctxActorType).(string)
	return v
}

func DeviceHashFrom(ctx context.Context) string {
	v, _ := ctx.Value(ctxDeviceHash).(string)
	return v
}

// RequireRole membatasi akses per peran (matriks hak akses PRD Bagian 2.1).
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c := ClaimsFrom(r.Context())
			if c == nil {
				WriteError(w, Unauthorized("token tidak ditemukan"))
				return
			}
			for _, role := range roles {
				if c.Role == role {
					next.ServeHTTP(w, r)
					return
				}
			}
			WriteError(w, Forbidden("tidak memiliki hak akses untuk aksi ini"))
		})
	}
}

// RequireTenant memastikan endpoint tenant-scoped hanya dipakai user dalam tenant (bukan super_admin/student).
func RequireTenant() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c := ClaimsFrom(r.Context())
			tid := TenantIDFrom(r.Context())
			if c == nil || tid == "" || c.Role == "student" || c.Role == "super_admin" {
				WriteError(w, Forbidden("endpoint ini hanya untuk pengguna tenant"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RateLimit membungkus RateLimiter per pola route.
func RateLimit(rl RateLimiterFunc, keyFn func(r *http.Request) string, limit int, window time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := keyFn(r)
			ok, retry := rl(r.Context(), key, limit, window)
			if !ok {
				w.Header().Set("Retry-After", itoa(int(retry.Seconds())+1))
				WriteError(w, TooManyRequests("terlalu banyak percobaan, coba lagi nanti"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

type RateLimiterFunc func(ctx context.Context, key string, limit int, window time.Duration) (bool, time.Duration)

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

func Path(r *http.Request) string { return chi.RouteContext(r.Context()).RoutePattern() }
