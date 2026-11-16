package auth

import (
	"encoding/json"

	"flowcbt/backend/internal/httpx"
)

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

// validatePassword menegakkan kebijakan panjang password minimal (FR-1.2) —
// tag `validate:` tidak dieksekusi oleh DecodeJSON, jadi dicek eksplisit di service (H-1).
func validatePassword(p string) error {
	if n := len(p); n < 8 {
		return httpx.BadRequest(httpx.CodeValidation, "password minimal 8 karakter")
	} else if n > 72 {
		return httpx.BadRequest(httpx.CodeValidation, "password maksimal 72 karakter")
	}
	return nil
}
