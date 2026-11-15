package httpx

import (
	"errors"
	"net/http"
)

// AppError adalah error standar API: {code, message, details} (PRD Bagian 9).
type AppError struct {
	HTTPStatus int    `json:"-"`
	Code       string `json:"code"`
	Message    string `json:"message"`
	Details    any    `json:"details,omitempty"`
}

func (e *AppError) Error() string { return e.Code + ": " + e.Message }

func Err(code, msg string, status int) *AppError {
	return &AppError{HTTPStatus: status, Code: code, Message: msg}
}

func ErrDetails(code, msg string, status int, details any) *AppError {
	return &AppError{HTTPStatus: status, Code: code, Message: msg, Details: details}
}

// Kode error stabil (PRD Bagian 9 / 18.7).
const (
	CodeValidation      = "VALIDATION_ERROR"
	CodeUnauthorized    = "UNAUTHORIZED"
	CodeForbidden       = "FORBIDDEN"
	CodeNotFound        = "NOT_FOUND"
	CodeConflict        = "CONFLICT"
	CodeRateLimited     = "RATE_LIMITED"
	CodeQuotaExceeded   = "QUOTA_EXCEEDED"
	CodeAttemptExpired  = "ATTEMPT_EXPIRED"
	CodeTokenInvalid    = "TOKEN_INVALID"
	CodeExamNotOpen     = "EXAM_NOT_OPEN"
	CodeAttemptLimit    = "ATTEMPT_LIMIT_REACHED"
	CodeTenantReadOnly  = "TENANT_READ_ONLY"
	CodeInternal        = "INTERNAL_ERROR"
	CodeIdempotency     = "IDEMPOTENCY_CONFLICT"
)

func BadRequest(code, msg string) *AppError        { return Err(code, msg, http.StatusBadRequest) }
func Unauthorized(msg string) *AppError            { return Err(CodeUnauthorized, msg, http.StatusUnauthorized) }
func Forbidden(msg string) *AppError               { return Err(CodeForbidden, msg, http.StatusForbidden) }
func NotFound(msg string) *AppError                { return Err(CodeNotFound, msg, http.StatusNotFound) }
func Conflict(code, msg string) *AppError          { return Err(code, msg, http.StatusConflict) }
func TooManyRequests(msg string) *AppError         { return Err(CodeRateLimited, msg, http.StatusTooManyRequests) }
func Internal(err error) *AppError                 { return Err(CodeInternal, "terjadi kesalahan internal", http.StatusInternalServerError) }

func AsAppError(err error) *AppError {
	var ae *AppError
	if errors.As(err, &ae) {
		return ae
	}
	return Internal(err)
}
