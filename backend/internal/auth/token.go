package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"time"

	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/platform"

	"github.com/golang-jwt/jwt/v5"
)

type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

type Issuer struct {
	DB         *platform.DB
	Clock      platform.Clock
	Secret     []byte
	AccessTTL  time.Duration
	RefreshTTL time.Duration
}

func (i *Issuer) IssueAccess(subject, role, tenantID, device string) (string, error) {
	now := i.Clock.Now()
	claims := &httpx.Claims{
		Sub: subject, Role: role, TenantID: tenantID, TokenType: "access", Device: device,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(i.AccessTTL)),
			ID:        platform.NewIDString(),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString(i.Secret)
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// IssuePair membuat access token + menyimpan refresh token. family dipertahankan sama
// sepanjang rantai rotasi agar deteksi reuse (FR-1.6) bekerja; login baru membuat family baru.
func (i *Issuer) IssuePair(ctx context.Context, q platform.Queryer, family, tenantID, subjectType, role, subjectID, device, ip, ua string) (*TokenPair, error) {
	access, err := i.IssueAccess(subjectID, role, tenantID, device)
	if err != nil {
		return nil, err
	}
	raw := randomToken()
	exp := i.Clock.Now().Add(i.RefreshTTL)
	_, err = q.Exec(ctx,
		`INSERT INTO refresh_tokens (tenant_id, subject_type, user_id, student_id, family_id, token_hash, device_hash, ip, user_agent, expires_at)
		 VALUES ($1,$2, NULLIF($3,'')::uuid, NULLIF($4,'')::uuid, $5, $6, NULLIF($7,''), NULLIF($8,'')::inet, $9, $10)`,
		tenantIDOrNil(tenantID), subjectType,
		map[bool]string{true: subjectID}[subjectType == "user"],
		map[bool]string{true: subjectID}[subjectType == "student"],
		family, hashToken(raw), device, ip, ua, exp)
	if err != nil {
		return nil, err
	}
	return &TokenPair{
		AccessToken: access, RefreshToken: raw,
		ExpiresIn: int64(i.AccessTTL.Seconds()), TokenType: "Bearer",
	}, nil
}

func roleFor(subjectType string) string {
	if subjectType == "student" {
		return "student"
	}
	return "user"
}

func tenantIDOrNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// Rotate memverifikasi refresh token lalu menerbitkan pasangan baru; bila token lama dipakai ulang
// (reuse), seluruh family dicabut (deteksi pencurian token).
func (i *Issuer) Rotate(ctx context.Context, q platform.Queryer, rawRefresh string) (*TokenPair, error) {
	return i.RotateWithDevice(ctx, q, rawRefresh, "")
}

// B-09: `FOR UPDATE` mencegah dua refresh konkuren lolos bersamaan (TOCTOU).
// expectedDeviceHash (hash cookie perangkat) bila diisi memastikan refresh curi
// tidak bisa dipakai di perangkat lain.
func (i *Issuer) RotateWithDevice(ctx context.Context, q platform.Queryer, rawRefresh, expectedDeviceHash string) (*TokenPair, error) {
	h := hashToken(rawRefresh)
	var (
		id, subjectType, family             string
		tenantID, userID, studentID, device *string
		expiresAt                           time.Time
		revokedAt                           *time.Time
	)
	err := q.QueryRow(ctx,
		`SELECT id, tenant_id, subject_type, user_id, student_id, family_id, device_hash, expires_at, revoked_at
		 FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`, h).
		Scan(&id, &tenantID, &subjectType, &userID, &studentID, &family, &device, &expiresAt, &revokedAt)
	if err != nil {
		return nil, httpx.Unauthorized("refresh token tidak dikenal")
	}
	tenantIDStr := ""
	if tenantID != nil {
		tenantIDStr = *tenantID
	}
	if revokedAt != nil {
		// token sudah pernah dipakai/dicabut (rotasi/logout) → ini reuse: cabut seluruh family (FR-1.6).
		// Revoke lewat koneksi system langsung (di luar tx pemanggil) agar tidak ikut ter-rollback
		// saat error dikembalikan.
		if i.DB != nil {
			_, _ = i.DB.System.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, family)
		} else {
			_, _ = q.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, family)
		}
		return nil, httpx.Unauthorized("penggunaan ulang refresh token terdeteksi; sesi dicabut")
	}
	if time.Now().After(expiresAt) {
		return nil, httpx.Unauthorized("refresh token tidak berlaku")
	}
	if expectedDeviceHash != "" && (device == nil || *device != expectedDeviceHash) {
		// Perangkat berbeda → cabut family (token diduga dicuri).
		_, _ = q.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, family)
		return nil, httpx.Unauthorized("refresh token tidak cocok dengan perangkat ini; sesi dicabut")
	}
	_, _ = q.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, id)

	subjectID := ""
	if userID != nil {
		subjectID = *userID
	}
	if subjectType == "student" && studentID != nil {
		subjectID = *studentID
	}
	dev := ""
	if device != nil {
		dev = *device
	}
	role := roleFor(subjectType)
	if subjectType == "user" {
		_ = q.QueryRow(ctx, `SELECT role FROM users WHERE id = $1`, subjectID).Scan(&role)
	}
	return i.IssuePair(ctx, q, family, tenantIDStr, subjectType, role, subjectID, dev, "", "")
}

func (i *Issuer) Revoke(ctx context.Context, q platform.Queryer, rawRefresh string) error {
	_, err := q.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, hashToken(rawRefresh))
	return err
}
