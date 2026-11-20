package httpx

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
)

// Error API standar sesuai PRD §9: {code, message, details}
type APIError struct {
	Status  int         `json:"-"`
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details,omitempty"`
}

func (e *APIError) Error() string { return e.Message }

func NewErr(status int, code, msg string) *APIError {
	return &APIError{Status: status, Code: code, Message: msg}
}

var (
	ErrUnauthorized   = NewErr(http.StatusUnauthorized, "UNAUTHORIZED", "Tidak terautentikasi")
	ErrForbidden      = NewErr(http.StatusForbidden, "FORBIDDEN", "Akses ditolak")
	ErrNotFound       = NewErr(http.StatusNotFound, "NOT_FOUND", "Data tidak ditemukan")
	ErrBadRequest     = NewErr(http.StatusBadRequest, "BAD_REQUEST", "Permintaan tidak valid")
	ErrConflict       = NewErr(http.StatusConflict, "CONFLICT", "Konflik data")
	ErrQuotaExceeded  = NewErr(http.StatusPaymentRequired, "QUOTA_EXCEEDED", "Kuota habis, silakan upgrade paket")
	ErrRateLimited    = NewErr(http.StatusTooManyRequests, "RATE_LIMITED", "Terlalu banyak permintaan, coba lagi nanti")
	ErrTokenInvalid   = NewErr(http.StatusUnauthorized, "TOKEN_INVALID", "Token tidak valid")
	ErrAttemptExpired = NewErr(http.StatusGone, "ATTEMPT_EXPIRED", "Waktu pengerjaan sudah habis")
)

func JSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		_ = json.NewEncoder(w).Encode(data)
	}
}

func OK(w http.ResponseWriter, data any) { JSON(w, http.StatusOK, data) }

func Created(w http.ResponseWriter, data any) { JSON(w, http.StatusCreated, data) }

func Error(w http.ResponseWriter, err error) {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		JSON(w, apiErr.Status, apiErr)
		return
	}
	slog.Error("request gagal", "err", err)
	JSON(w, http.StatusInternalServerError, &APIError{Status: 500, Code: "INTERNAL", Message: "Terjadi kesalahan internal"})
}

// maxJSONBody batas ukuran body JSON per-request (sync batch kelas besar
// tetap aman; upload media pakai jalur multipart tersendiri).
const maxJSONBody = 5 << 20 // 5 MB

func Decode(r *http.Request, dst any) error {
	defer r.Body.Close()
	// w nil diizinkan sejak Go 1.19 — batas tetap diterapkan tanpa merusak conn.
	r.Body = http.MaxBytesReader(nil, r.Body, maxJSONBody)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			return NewErr(http.StatusRequestEntityTooLarge, "BODY_TOO_LARGE", "Data terlalu besar (maks 5 MB)")
		}
		return NewErr(http.StatusBadRequest, "BAD_REQUEST", "Body JSON tidak valid")
	}
	return nil
}

func ClientIP(r *http.Request) string {
	if fw := r.Header.Get("X-Forwarded-For"); fw != "" {
		parts := strings.SplitN(fw, ",", 2)
		return strings.TrimSpace(parts[0])
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}
