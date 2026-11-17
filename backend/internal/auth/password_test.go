package auth

import (
	"testing"

	"encoding/base64"
	"fmt"
	"golang.org/x/crypto/argon2"
)

// C-17: hash baru t=2 dan hash lama t=1 harus sama-sama terverifikasi.
func TestVerifyPasswordBackwardCompatible(t *testing.T) {
	newHash, err := HashPassword("password123")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword("password123", newHash) {
		t.Fatal("hash baru gagal diverifikasi")
	}
	if VerifyPassword("salah", newHash) {
		t.Fatal("password salah diterima")
	}

	// Simulasikan hash lama (t=1) yang dibuat sebelum perubahan.
	salt := []byte("1234567890abcdef")
	old := argon2.IDKey([]byte("password123"), salt, 1, 64*1024, 4, 32)
	oldEncoded := fmt.Sprintf("$argon2id$v=19$m=65536,t=1,p=4$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(old))
	if !VerifyPassword("password123", oldEncoded) {
		t.Fatal("hash lama t=1 gagal diverifikasi (regresi login)")
	}
}
