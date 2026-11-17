package platform

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env                  string
	HTTPAddr             string
	PublicBaseURL        string
	DatabaseURL          string // koneksi superuser/owner untuk migrasi & role sistem
	AppDBUser            string // flowcbt_app (RLS)
	AppDBPassword        string
	SystemDBUser         string // flowcbt_system (BYPASSRLS)
	SystemDBPass         string
	JWTSecret            string
	JWSAccessTTL         time.Duration
	JWTRefreshTTL        time.Duration
	RedisURL             string
	StorageKind          string // "local" | "s3"
	StorageDir           string
	S3Endpoint           string
	S3Bucket             string
	S3AccessKey          string
	S3SecretKey          string
	S3Region             string
	MailerKind           string // "log" | "smtp"
	SMTPHost             string
	SMTPPort             int
	SMTPUser             string
	SMTPPass             string
	SMTPFrom             string
	AppURL               string // untuk tautan verifikasi email
	StudentAppURL        string
	GoogleClientID       string
	PaymentProvider      string // "midtrans" | "mayar" | "mock"
	MidtransServerKey    string
	MidtransClientKey    string
	MidtransIsProduction bool
	MayarAPIKey          string
	WebhookBaseURL       string
	// Keamanan produksi
	CORSAllowedOrigins []string // allowlist origin; WAJIB di-set di produksi (CORS_ALLOWED_ORIGINS)
	InternalToken      string   // bearer token /internal/* (deploy freeze); WAJIB di-set di produksi
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getint(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func getbool(k string, def bool) bool {
	if v := os.Getenv(k); v != "" {
		return v == "true" || v == "1"
	}
	return def
}

func LoadConfig() Config {
	return Config{
		Env:                  getenv("APP_ENV", "dev"),
		HTTPAddr:             getenv("HTTP_ADDR", ":8080"),
		PublicBaseURL:        getenv("PUBLIC_BASE_URL", "http://localhost:8080"),
		DatabaseURL:          getenv("DATABASE_URL", "postgres://postgres:postgres@127.0.0.1:5432/flowcbt?sslmode=disable"),
		AppDBUser:            getenv("APP_DB_USER", "flowcbt_app"),
		AppDBPassword:        getenv("APP_DB_PASSWORD", "flowcbt_app"),
		SystemDBUser:         getenv("SYSTEM_DB_USER", "flowcbt_system"),
		SystemDBPass:         getenv("SYSTEM_DB_PASSWORD", "flowcbt_system"),
		JWTSecret:            getenv("JWT_SECRET", "dev-insecure-secret-change-me"),
		JWSAccessTTL:         time.Duration(getint("JWT_ACCESS_TTL_MIN", 15)) * time.Minute,
		JWTRefreshTTL:        time.Duration(getint("JWT_REFRESH_TTL_DAYS", 30)) * 24 * time.Hour,
		RedisURL:             getenv("REDIS_URL", ""),
		StorageKind:          getenv("STORAGE_KIND", "local"),
		StorageDir:           getenv("STORAGE_DIR", "./data/storage"),
		S3Endpoint:           getenv("S3_ENDPOINT", ""),
		S3Bucket:             getenv("S3_BUCKET", "flowcbt"),
		S3AccessKey:          getenv("S3_ACCESS_KEY", ""),
		S3SecretKey:          getenv("S3_SECRET_KEY", ""),
		S3Region:             getenv("S3_REGION", "us-east-1"),
		MailerKind:           getenv("MAILER_KIND", "log"),
		SMTPHost:             getenv("SMTP_HOST", ""),
		SMTPPort:             getint("SMTP_PORT", 587),
		SMTPUser:             getenv("SMTP_USER", ""),
		SMTPPass:             getenv("SMTP_PASS", ""),
		SMTPFrom:             getenv("SMTP_FROM", "no-reply@flowcbt.local"),
		AppURL:               getenv("APP_URL", "http://localhost:5173"),
		StudentAppURL:        getenv("STUDENT_APP_URL", "http://localhost:5174"),
		GoogleClientID:       getenv("GOOGLE_CLIENT_ID", ""),
		PaymentProvider:      getenv("PAYMENT_PROVIDER", "mock"),
		MidtransServerKey:    getenv("MIDTRANS_SERVER_KEY", ""),
		MidtransClientKey:    getenv("MIDTRANS_CLIENT_KEY", ""),
		MidtransIsProduction: getbool("MIDTRANS_IS_PRODUCTION", false),
		MayarAPIKey:          getenv("MAYAR_API_KEY", ""),
		WebhookBaseURL:       getenv("WEBHOOK_BASE_URL", "http://localhost:8080"),
		CORSAllowedOrigins:   splitNonEmpty(os.Getenv("CORS_ALLOWED_ORIGINS")),
		InternalToken:        getenv("INTERNAL_TOKEN", ""),
	}
}

func splitNonEmpty(s string) []string {
	if s == "" {
		return nil
	}
	var out []string
	for _, p := range strings.Split(s, ",") {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func isHTTPS(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && strings.EqualFold(u.Scheme, "https") && u.Host != ""
}

// Validate menolak konfigurasi lemah secara fail-fast (bagian dengan risiko tinggi).
// Dev tetap bisa jalan dengan default; produksi (APP_ENV=production) wajib eksplisit.
func (c Config) Validate() error {
	// C-17: APP_ENV sendiri harus valid — jika salah ketik, kode bisa jalan dengan
	// default "dev" dan endpoint /internal/* terbuka di server publik.
	if c.Env != "dev" && c.Env != "staging" && c.Env != "production" {
		return fmt.Errorf("APP_ENV tidak dikenal: %q (izin: dev, staging, production)", c.Env)
	}
	if c.Env != "production" {
		return nil
	}
	var errs []error
	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL wajib di-set di produksi"))
	}
	if c.RedisURL == "" {
		errs = append(errs, errors.New("REDIS_URL wajib di-set di produksi (rate limiter & SSE multi-replica)"))
	}
	for name, raw := range map[string]string{
		"PUBLIC_BASE_URL": c.PublicBaseURL, "APP_URL": c.AppURL,
		"STUDENT_APP_URL": c.StudentAppURL, "WEBHOOK_BASE_URL": c.WebhookBaseURL,
	} {
		if !isHTTPS(raw) {
			errs = append(errs, fmt.Errorf("%s wajib HTTPS di produksi (dapat %q)", name, raw))
		}
	}
	if c.StorageKind == "s3" {
		if c.S3Endpoint == "" || c.S3Bucket == "" || c.S3AccessKey == "" || c.S3SecretKey == "" {
			errs = append(errs, errors.New("STORAGE_KIND=s3 wajib S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY"))
		} else if !isHTTPS(c.S3Endpoint) {
			errs = append(errs, errors.New("S3_ENDPOINT wajib HTTPS di produksi"))
		}
	}
	if c.MailerKind == "smtp" && (c.SMTPHost == "" || c.SMTPFrom == "") {
		errs = append(errs, errors.New("MAILER_KIND=smtp wajib SMTP_HOST & SMTP_FROM"))
	}
	switch c.PaymentProvider {
	case "midtrans":
		if c.MidtransServerKey == "" {
			errs = append(errs, errors.New("MIDTRANS_SERVER_KEY wajib di produksi"))
		}
	case "mayar":
		if c.MayarAPIKey == "" {
			errs = append(errs, errors.New("MAYAR_API_KEY wajib di produksi"))
		}
	}
	if c.JWTSecret == "dev-insecure-secret-change-me" || len(c.JWTSecret) < 32 {
		errs = append(errs, errors.New("JWT_SECRET tidak aman: wajib >= 32 karakter acak dan bukan nilai default"))
	}
	if c.AppDBPassword == "flowcbt_app" || c.SystemDBPass == "flowcbt_system" {
		errs = append(errs, errors.New("password DB role masih nilai default: set APP_DB_PASSWORD & SYSTEM_DB_PASSWORD"))
	}
	if len(c.CORSAllowedOrigins) == 0 {
		errs = append(errs, errors.New("CORS_ALLOWED_ORIGINS wajib di-set (allowlist origin aplikasi web)"))
	}
	if c.InternalToken == "" || len(c.InternalToken) < 32 {
		errs = append(errs, errors.New("INTERNAL_TOKEN wajib di-set (>= 32 karakter) untuk proteksi /internal/*"))
	}
	if c.PaymentProvider == "mock" {
		errs = append(errs, errors.New("PAYMENT_PROVIDER=mock tidak boleh di produksi (webhook mock mengaktifkan paket tanpa pembayaran)"))
	}
	if len(errs) == 0 {
		return nil
	}
	return fmt.Errorf("konfigurasi produksi tidak valid: %w", errors.Join(errs...))
}
