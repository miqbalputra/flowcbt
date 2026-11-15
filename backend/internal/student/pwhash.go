package student

import "flowcbt/backend/internal/auth"

// authHash meneruskan ke hash argon2id modul auth (satu sumber hash password).
func authHash(p string) (string, error) { return auth.HashPassword(p) }
