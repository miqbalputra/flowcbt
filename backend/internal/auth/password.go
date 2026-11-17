package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

// HashPassword memakai argon2id (Bagian 6 Keamanan).
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	// C-17: t=1 terlalu rendah; naik ke t=2. Hash lama (t=1) tetap diverifikasi
	// karena VerifyPassword membaca parameter dari string yang tersimpan.
	hash := argon2.IDKey([]byte(password), salt, 2, 64*1024, 4, 32)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=2,p=4$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}

func VerifyPassword(password, encoded string) bool {
	parts := splitDollar(encoded)
	if len(parts) != 6 {
		return false
	}
	// parts[3] = "m=65536,t=2,p=4". Default t=1 untuk hash lama.
	timeCost := uint32(1)
	for _, kv := range strings.Split(parts[3], ",") {
		if strings.HasPrefix(kv, "t=") {
			if n, err := strconv.ParseUint(strings.TrimPrefix(kv, "t="), 10, 32); err == nil {
				timeCost = uint32(n)
			}
		}
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, timeCost, 64*1024, 4, 32)
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
