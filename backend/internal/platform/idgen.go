package platform

import (
	"crypto/rand"

	"github.com/google/uuid"
)

func NewID() uuid.UUID { return uuid.New() }

func NewIDString() string { return uuid.NewString() }

// RandomToken mengembalikan token alfanumerik huruf besar (mis. 6 karakter) untuk token ujian (FR-4.9).
func RandomToken(n int) string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // tanpa huruf/angka yang mirip (I,O,0,1)
	// C-17: crypto/rand + rejection sampling — uuid.New() & modulo menghasilkan bias
	// dan hanya 16 byte entropi untuk seluruh karakter token.
	limit := 256 - (256 % len(alphabet))
	b := make([]byte, n)
	buf := make([]byte, n*2)
	for i := 0; i < n; {
		if _, err := rand.Read(buf); err != nil {
			panic("crypto/rand gagal: " + err.Error())
		}
		for _, v := range buf {
			if int(v) >= limit {
				continue // buang sampel bias
			}
			b[i] = alphabet[int(v)%len(alphabet)]
			i++
			if i == n {
				break
			}
		}
	}
	return string(b)
}

func StudentCode() string { return "S-" + uuid.NewString()[:8] }

func NormalizeName(s string) string {
	out := make([]rune, 0, len(s))
	space := false
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' {
			space = true
			continue
		}
		if space && len(out) > 0 {
			out = append(out, ' ')
		}
		space = false
		out = append(out, r)
	}
	return string(toLowerRunes(out))
}

func toLowerRunes(s []rune) []rune {
	out := make([]rune, len(s))
	for i, r := range s {
		if r >= 'A' && r <= 'Z' {
			r += 32
		}
		out[i] = r
	}
	return out
}
