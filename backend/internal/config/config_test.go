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
		Env:                "production",
		JWTSecret:          "kunci-rahasia-nyata-64byte",
		SeedSuperAdminPass: "BukanDefault123!",
		DatabaseURL:        "postgres://flowcbt:s3cret@db:5433/flowcbt",
		DatabaseAppURL:     "postgres://flowcbt_app:s3cret@db:5433/flowcbt",
	}
	if err := c.FailFast(); err != nil {
		t.Fatalf("production dengan secret nyata harus lolos; dapat: %s", err)
	}
}

func TestFailFastSkippedInDevelopment(t *testing.T) {
	c := &Config{Env: "development"} // semua default tetap boleh untuk dev
	if err := c.FailFast(); err != nil {
		t.Fatalf("development tidak boleh divalidasi keras; dapat: %s", err)
	}
}
