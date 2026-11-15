package platform

import "github.com/google/uuid"

func NewID() uuid.UUID { return uuid.New() }

func NewIDString() string { return uuid.NewString() }

// RandomToken mengembalikan token alfanumerik huruf besar (mis. 6 karakter) untuk token ujian (FR-4.9).
func RandomToken(n int) string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // tanpa huruf/angka yang mirip (I,O,0,1)
	b := make([]byte, n)
	raw := uuid.New()
	for i := 0; i < n; i++ {
		b[i] = alphabet[int(raw[i])%len(alphabet)]
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
