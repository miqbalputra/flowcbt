package httpmw

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"flowcbt/backend/internal/auth"
)

const testSecret = "test-secret"

func TestRequireAuthRejectsPre2FAToken(t *testing.T) {
	pre := &auth.Claims{UserID: "u1", Role: "owner", Typ: "pre2fa"}
	tok, err := auth.SignAccessToken(testSecret, pre, 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	called := false
	h := RequireAuth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("pre2fa token harus ditolak (401), dapat %d", rec.Code)
	}
	if called {
		t.Fatal("handler tidak boleh dipanggil untuk pre2fa token")
	}
}

func TestRequireAuthAcceptsStaffToken(t *testing.T) {
	staff := &auth.Claims{UserID: "u1", Role: "owner", Typ: "staff"}
	tok, err := auth.SignAccessToken(testSecret, staff, 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	called := false
	h := RequireAuth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !called {
		t.Fatalf("token staff harus diteruskan, code=%d called=%v", rec.Code, called)
	}
}

func TestRequireAuthQueryOrHeaderRejectsPre2FAToken(t *testing.T) {
	pre := &auth.Claims{UserID: "u1", Role: "owner", Typ: "pre2fa"}
	tok, _ := auth.SignAccessToken(testSecret, pre, 5*time.Minute)
	h := RequireAuthQueryOrHeader(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler tidak boleh dipanggil")
	}))
	req := httptest.NewRequest(http.MethodGet, "/sse?token="+tok, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("pre2fa via query harus 401, dapat %d", rec.Code)
	}
}
