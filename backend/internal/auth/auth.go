package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/argon2"
)

// ---------- Password (argon2id) ----------

type argonParams struct {
	memory      uint32
	iterations  uint32
	parallelism uint8
	saltLength  uint32
	keyLength   uint32
}

func p() argonParams {
	return argonParams{memory: 64 * 1024, iterations: 2, parallelism: 2, saltLength: 16, keyLength: 32}
}
func HashPassword(password string) (string, error) {
	c := p()
	salt := make([]byte, c.saltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, c.iterations, c.memory, c.parallelism, c.keyLength)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, c.memory, c.iterations, c.parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

func VerifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false
	}
	var mem, iter uint32
	var par uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &mem, &iter, &par); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	calc := argon2.IDKey([]byte(password), salt, iter, mem, par, uint32(len(key)))
	return subtle.ConstantTimeCompare(calc, key) == 1
}

// RandomToken menghasilkan token acak hex sepanjang n byte.
func RandomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func SHA256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// ---------- JWT ----------

type Claims struct {
	UserID   string `json:"sub"`
	TenantID string `json:"tid,omitempty"`
	Role     string `json:"role"` // superadmin|owner|teacher|student
	Typ      string `json:"typ"`  // staff|student
	SID      string `json:"sid,omitempty"`
	jwt.RegisteredClaims
}

func SignAccessToken(secret string, c *Claims, ttl time.Duration) (string, error) {
	now := time.Now()
	c.RegisteredClaims = jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		IssuedAt:  jwt.NewNumericDate(now),
		Issuer:    "flowcbt",
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(secret))
}

func VerifyAccessToken(secret, tokenStr string) (*Claims, error) {
	tok, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("metode signing tak terduga: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := tok.Claims.(*Claims); ok && tok.Valid {
		return claims, nil
	}
	return nil, fmt.Errorf("token tidak valid")
}

// ---------- Rate limiter in-memory per kunci (IP / akun) ----------

// (ambang eviksi) batas jumlah bucket sebelum pembersihan entri usang.
const maxRateBuckets = 10000

// usia bucket yang dihapus saat eviksi (tidak aktif lebih dari ini).
const rateBucketTTL = time.Hour

type bucket struct {
	tokens    float64
	last      time.Time
	maxTokens float64
	refill    float64 // token per detik
}

type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
}

func NewRateLimiter() *RateLimiter {
	return &RateLimiter{buckets: map[string]*bucket{}}
}

// Allow mencoba mengambil 1 token untuk kunci: max per menit.
func (r *RateLimiter) Allow(key string, maxPerMinute int) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	if len(r.buckets) > maxRateBuckets {
		r.evictStaleLocked(now)
	}
	refillPerSec := float64(maxPerMinute) / 60.0
	b, ok := r.buckets[key]
	if !ok {
		r.buckets[key] = &bucket{tokens: float64(maxPerMinute) - 1, last: now, maxTokens: float64(maxPerMinute), refill: refillPerSec}
		return true
	}
	elapsed := now.Sub(b.last).Seconds()
	b.tokens = min64(b.maxTokens, b.tokens+elapsed*b.refill)
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}

// evictStaleLocked menghapus bucket usang (> rateBucketTTL) agar map
// rate-limiter tidak tumbuh tak terbatas dari IP/token acak.
// Dipanggil pada jalur Allow hanya ketika ambang terlewati — biaya
// iterasi tidak membebani jalur normal.
func (r *RateLimiter) evictStaleLocked(now time.Time) {
	for k, b := range r.buckets {
		if now.Sub(b.last) > rateBucketTTL {
			delete(r.buckets, k)
		}
	}
}

func min64(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
