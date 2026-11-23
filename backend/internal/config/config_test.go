package config

import (
	"strings"
	"testing"
)

func TestFailFastBlocksProductionWithDefaults(t *testing.T) {
	c := &Config{
		Env:                "production",
		JWTSecret:          defaultJWTSecret,
		SeedSuperAdminPass: defaultSeedPass,
		DatabaseURL:        defaultAdminDNS,
		DatabaseAppURL:     defaultAppDNS,
	}
	err := c.FailFast()
	if err == nil {
		t.Fatal("harus menolak secret default di production")
	}
	for _, want := range []string{"JWT_SECRET", "SEED_SUPERADMIN_PASS", "DATABASE_URL", "DATABASE_APP_URL"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("pesan tegas harus menyebut %s; dapat: %s", want, err)
		}
	}
}

func TestFailFastPassesProductionWithRealSecrets(t *testing.T) {
	c := &Config{
		Env:                   "production",
		JWTSecret:             "kunci-rahasia-nyata-64byte",
		SeedSuperAdminPass:    "BukanDefault123!",
		DatabaseURL:           "postgres://flowcbt:s3cret@db:5433/flowcbt",
		DatabaseAppURL:        "postgres://flowcbt_app:s3cret@db:5433/flowcbt",
		SnapshotEncryptionKey: strings.Repeat("ab", 32),
	}
	if err := c.FailFast(); err != nil {
		t.Fatalf("production dengan secret nyata harus lolos; dapat: %s", err)
	}
}

func TestFailFastRejectsBadSnapshotKey(t *testing.T) {
	base := Config{
		Env:                   "production",
		JWTSecret:             "kunci-rahasia-nyata-64byte",
		SeedSuperAdminPass:    "BukanDefault123!",
		DatabaseURL:           "postgres://flowcbt:s3cret@db:5433/flowcbt",
		DatabaseAppURL:        "postgres://flowcbt_app:s3cret@db:5433/flowcbt",
		SnapshotEncryptionKey: strings.Repeat("ab", 32),
	}
	if err := base.FailFast(); err != nil {
		t.Fatalf("baseline harus lolos: %s", err)
	}
	for _, tc := range []struct{ key, want string }{
		{"", "SNAPSHOT_ENCRYPTION_KEY belum diset"},
		{"abczz", "tidak valid"},
		{strings.Repeat("41", 31), "tidak valid"}, // 62 hex ≈ 31 byte
	} {
		c := base
		c.SnapshotEncryptionKey = tc.key
		err := c.FailFast()
		if err == nil {
			t.Fatalf("key %q harus ditolak", tc.key)
		}
		if !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("key %q: pesan harus memuat %q; dapat: %s", tc.key, tc.want, err)
		}
	}
}

func TestFailFastSkippedInDevelopment(t *testing.T) {
	c := &Config{Env: "development"} // semua default tetap boleh untuk dev
	if err := c.FailFast(); err != nil {
		t.Fatalf("development tidak boleh divalidasi keras; dapat: %s", err)
	}
}
