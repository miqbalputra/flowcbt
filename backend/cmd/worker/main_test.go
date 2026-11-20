package main

import (
	"context"
	"testing"

	"flowcbt/backend/internal/app"
	"flowcbt/backend/internal/config"
)

// TestSanitizeHeader — CR/LF dibuang (anti header injection, #8).
func TestSanitizeHeader(t *testing.T) {
	cases := map[string]string{
		"Halo dunia":      "Halo dunia",
		"  spasi  ":       "spasi",
		"bocor\r\nBcc: x": "bocor  Bcc: x",
		"":                "",
	}
	for in, want := range cases {
		if got := sanitizeHeader(in); got != want {
			t.Errorf("sanitizeHeader(%q)=%q, mau %q", in, got, want)
		}
	}
}

// TestProcessEmailJobLogOnly — tanpa SMTP_HOST: payload valid → sukses
// (log-only), tanpa error (#8).
func TestProcessEmailJobLogOnly(t *testing.T) {
	t.Setenv("SMTP_HOST", "")
	a := app.New(&config.Config{Env: "development"}, nil)
	err := processEmailJob(context.Background(), a, jobItem{
		ID:      1,
		Payload: []byte(`{"to":"siswa@cbt.id","subject":"Jadwal Ujian","body":"Isi pesan"}`),
	})
	if err != nil {
		t.Fatalf("log-only seharusnya sukses, dapat err=%v", err)
	}
}

// TestProcessEmailJobAliases — alias field (email, text) tetap terbaca.
func TestProcessEmailJobAliases(t *testing.T) {
	t.Setenv("SMTP_HOST", "")
	a := app.New(&config.Config{Env: "development"}, nil)
	err := processEmailJob(context.Background(), a, jobItem{
		ID:      2,
		Payload: []byte(`{"email":"guru@cbt.id","subject":"Sambutan","text":"Halo"}`),
	})
	if err != nil {
		t.Fatalf("alias payload seharusnya sukses, dapat err=%v", err)
	}
}

// TestProcessEmailJobInvalid — payload rusak / tanpa penerima → gagal
// (memantik retry model, #8).
func TestProcessEmailJobInvalid(t *testing.T) {
	t.Setenv("SMTP_HOST", "")
	a := app.New(&config.Config{Env: "development"}, nil)
	for name, payload := range map[string]string{
		"payload-rusak":      `bukan-json`,
		"tanpa-penerima":     `{"subject":"x"}`,
		"penerima-tak-valid": `{"to":"bukanemail","subject":"x"}`,
	} {
		if err := processEmailJob(context.Background(), a, jobItem{ID: 3, Payload: []byte(payload)}); err == nil {
			t.Errorf("%s seharusnya error", name)
		}
	}
}

// TestEmailPayloadParsing — bentuk payload lama (field lain) tidak dianggap
// rusak; hanya JSON tak valid yang gagal.
func TestEmailPayloadParsing(t *testing.T) {
	t.Setenv("SMTP_HOST", "")
	a := app.New(&config.Config{Env: "development"}, nil)
	if err := processEmailJob(context.Background(), a, jobItem{
		ID:      4,
		Payload: []byte(`{"to":"a@b.c","subject":"x","body":"y","extra":42}`),
	}); err != nil {
		t.Fatalf("field ekstra seharusnya diabaikan, dapat err=%v", err)
	}
}
