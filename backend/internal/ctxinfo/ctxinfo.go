package ctxinfo

import (
	"context"

	"flowcbt/backend/internal/auth"
)

type key int

const (
	claimsKey key = iota
)

func WithClaims(ctx context.Context, c *auth.Claims) context.Context {
	return context.WithValue(ctx, claimsKey, c)
}

func Claims(ctx context.Context) *auth.Claims {
	if v, ok := ctx.Value(claimsKey).(*auth.Claims); ok {
		return v
	}
	return nil
}

func TenantID(ctx context.Context) string {
	if c := Claims(ctx); c != nil {
		return c.TenantID
	}
	return ""
}

func UserID(ctx context.Context) string {
	if c := Claims(ctx); c != nil {
		return c.UserID
	}
	return ""
}

func Role(ctx context.Context) string {
	if c := Claims(ctx); c != nil {
		return c.Role
	}
	return ""
}

func StudentID(ctx context.Context) string {
	if c := Claims(ctx); c != nil {
		return c.SID
	}
	return ""
}
