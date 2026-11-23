package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPPort string
	Env      string

	DatabaseURL    string // admin/superuser pool (auth, migrasi, superadmin)
	DatabaseAppURL string // pool tenant (role flowcbt_app, RLS enforced)

	JWTSecret       string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration

	SeedSuperAdminEmail string
	SeedSuperAdminPass  string

	// PublicBaseURL alamat publik aplikasi (tautan di pesan WhatsApp/QR); opsional.
	PublicBaseURL string

	UploadDir string
	// Penyimpanan media per tenant default 1 GB (konfigurasi PRD 3.2)
	StorageMediaPerTenantBytes int64
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func Load() *Config {
	accessTTL := 15 * time.Minute
	if m, err := strconv.Atoi(env("ACCESS_TTL_MIN", "15")); err == nil && m > 0 {
		accessTTL = time.Duration(m) * time.Minute
	}
	refreshTTL := 30 * 24 * time.Hour
	if d, err := strconv.Atoi(env("REFRESH_TTL_DAYS", "30")); err == nil && d > 0 {
		refreshTTL = time.Duration(d) * 24 * time.Hour
	}
	return &Config{
		HTTPPort:                   env("HTTP_PORT", "8080"),
		Env:                        env("APP_ENV", "development"),
		DatabaseURL:                env("DATABASE_URL", "postgres://flowcbt:flowcbt_dev@127.0.0.1:5433/flowcbt"),
		DatabaseAppURL:             env("DATABASE_APP_URL", "postgres://flowcbt_app:app_user_dev@127.0.0.1:5433/flowcbt"),
		JWTSecret:                  env("JWT_SECRET", "dev-secret-change-me-in-production"),
		AccessTokenTTL:             accessTTL,
		RefreshTokenTTL:            refreshTTL,
		SeedSuperAdminEmail:        env("SEED_SUPERADMIN_EMAIL", "superadmin@flowcbt.id"),
		SeedSuperAdminPass:         env("SEED_SUPERADMIN_PASS", "Admin#12345"),
		PublicBaseURL:              env("PUBLIC_BASE_URL", ""),
		UploadDir:                  env("UPLOAD_DIR", "./data/uploads"),
		StorageMediaPerTenantBytes: 1 << 30, // 1 GB default
	}
}

// Default yang BERBAHAYA bila dipakai di production (audit 2026-11-23).
const (
	defaultJWTSecret = "dev-secret-change-me-in-production"
	defaultSeedPass  = "Admin#12345"
	defaultAdminDNS  = "postgres://flowcbt:flowcbt_dev@127.0.0.1:5433/flowcbt"
	defaultAppDNS    = "postgres://flowcbt_app:app_user_dev@127.0.0.1:5433/flowcbt"
)

// FailFast memastikan konfigurasi BERBAHAYA tidak lolos di production.
// Dijalankan cmd/api & cmd/worker SEBELUM listen: secret default JWT
// berarti siapa pun bisa memalsukan token; password seed default berarti
// superadmin mudah diambil alih; password DB default berarti kredensial
// produksi sama dengan kredensial yang terbuka di repositori publik.
// Di development (env default) validasi dilewati agar alur lokal tak rusak.
func (c *Config) FailFast() error {
	if c.Env != "production" {
		return nil
	}
	problems := []string{}
	if c.JWTSecret == defaultJWTSecret {
		problems = append(problems, "JWT_SECRET masih default (dev-secret-change-me-in-production)")
	}
	if c.SeedSuperAdminPass == defaultSeedPass {
		problems = append(problems, "SEED_SUPERADMIN_PASS masih default (Admin#12345)")
	}
	if c.DatabaseURL == defaultAdminDNS {
		problems = append(problems, "DATABASE_URL masih memakai password default flowcbt_dev")
	}
	if c.DatabaseAppURL == defaultAppDNS {
		problems = append(problems, "DATABASE_APP_URL masih memakai password default app_user_dev")
	}
	if len(problems) > 0 {
		return fmt.Errorf("konfigurasi produksi tidak aman: %s — set variabel lingkungan sebelum menjalankan", strings.Join(problems, "; "))
	}
	return nil
}
