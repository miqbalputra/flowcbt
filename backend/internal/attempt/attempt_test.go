package attempt

import (
	"errors"
	"net/http"
	"testing"

	"flowcbt/backend/internal/httpx"

	"github.com/google/uuid"
)

// X-03: regresi untuk input yang sebelumnya menghasilkan HTTP 500.
func TestValidateEventFields(t *testing.T) {
	validID := uuid.NewString()
	cases := []struct {
		name    string
		id      string
		typ     string
		wantErr bool
		status  int
	}{
		{"valid", validID, "answer", false, 0},
		{"empty id", "", "answer", true, http.StatusBadRequest},
		{"non-uuid id", "evt-demo-001", "answer", true, http.StatusBadRequest},
		{"unknown type", validID, "unknown", true, http.StatusBadRequest},
		{"violation type", validID, "violation", false, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := validateEventFields(c.id, c.typ)
			if c.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				var ae *httpx.AppError
				if !errors.As(err, &ae) {
					t.Fatalf("expected *httpx.AppError, got %T", err)
				}
				if ae.HTTPStatus != c.status {
					t.Fatalf("status = %d, want %d", ae.HTTPStatus, c.status)
				}
				if ae.Code != httpx.CodeValidation {
					t.Fatalf("code = %s, want %s", ae.Code, httpx.CodeValidation)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.String() != c.id {
				t.Fatalf("uuid = %s, want %s", got.String(), c.id)
			}
		})
	}
}
