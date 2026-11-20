package api

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5/middleware"
)

// TestRecovererReturnsInternalJSON — panic handler dikonversi jadi JSON
// APIError {code:"INTERNAL"} 500 (#9), TANPA menampilkan stack ke klien.
func TestRecovererReturnsInternalJSON(t *testing.T) {
	boom := func(w http.ResponseWriter, r *http.Request) { panic("stack rahasia bo-boom") }
	h := recoverer(http.HandlerFunc(boom))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/uji", nil)
	// RequestID dipasang di router sebelum recoverer; rantai sama seperti
	// produksi agar GetReqID mengembalikan id nyata.
	h = middleware.RequestID(h)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("seharusnya 500, dapat %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"code":"INTERNAL"`) {
		t.Errorf("body seharusnya berisi code INTERNAL: %s", body)
	}
	if strings.Contains(body, "bo-boom") || strings.Contains(body, "goroutine") {
		t.Errorf("stack/panic TIDAK boleh bocor ke klien: %s", body)
	}
}

// captureHandler rekam output log (uji req_id pada logger, #11).
type captureHandler struct {
	buf *bytes.Buffer
}

func (c *captureHandler) Enabled(_ context.Context, _ slog.Level) bool { return true }

func (c *captureHandler) Handle(_ context.Context, r slog.Record) error {
	c.buf.WriteString(r.Message)
	// req_id dikirim sebagai attr biasa.
	r.Attrs(func(a slog.Attr) bool {
		if a.Key == "req_id" {
			c.buf.WriteString(" req_id=" + a.Value.String())
		}
		return true
	})
	return nil
}

func (c *captureHandler) WithAttrs(attrs []slog.Attr) slog.Handler { return c }
func (c *captureHandler) WithGroup(name string) slog.Handler       { return c }

// TestLoggerEmitsReqID — logger menempelkan req_id dari middleware
// RequestID (chi middleware.GetReqID) pada setiap baris log akses (#11).
func TestLoggerEmitsReqID(t *testing.T) {
	old := slog.Default()
	buf := &bytes.Buffer{}
	slog.SetDefault(slog.New(&captureHandler{buf: buf}))
	defer slog.SetDefault(old)

	h := middleware.RequestID(logger(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})))
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/ping", nil))
	if !strings.Contains(buf.String(), "req_id=") {
		t.Errorf("log akses seharusnya memuat req_id, dapat: %q", buf.String())
	}
}
