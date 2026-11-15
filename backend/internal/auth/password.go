package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"golang.org/x/crypto/argon2"
)

// HashPassword memakai argon2id (Bagian 6 Keamanan).
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=1,p=4$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}

func VerifyPassword(password, encoded string) bool {
	var m, saltB64, hashB64 string
	var ver int
	if _, err := fmt.Sscanf(encoded, "$argon2id$v=%d$m=%s$t=%*d$p=%*d$%s$%s", &ver, &m, &saltB64, &hashB64); err != nil {
		// fallback parse manual
		parts := splitDollar(encoded)
		if len(parts) != 6 {
			return false
		}
		saltB64, hashB64 = parts[4], parts[5]
	}
	salt, err := base64.RawStdEncoding.DecodeString(saltB64)
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(hashB64)
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
	return subtleEqual(got, want)
}

func splitDollar(s string) []string {
	out := []string{}
	cur := ""
	for _, r := range s {
		if r == '$' {
			out = append(out, cur)
			cur = ""
			continue
		}
		cur += string(r)
	}
	out = append(out, cur)
	return out
}

func subtleEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := range a {
		v |= a[i] ^ b[i]
	}
	return v == 0
}
