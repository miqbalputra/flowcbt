// stream.go — Server-Sent Events untuk laporan real-time (PRD FR-9.3).
//
// GET /reports/live/stream?exam_id=&class_id=&q=&token=
//
// EventSource di browser tidak bisa mengirim header Authorization, sehingga
// token JWT diterima via query `?token=` (middleware RequireAuthQueryOrHeader).
// Setiap 5 detik server mengirim event `snapshot` berisi data yang sama
// bentuknya dengan REST /reports/live (daftar) atau /reports/live/{id}
// (bila exam_id diberikan). Klien memakai EventEmitter auto-reconnect;
// koneksi ditutup server setelah 30 menit (klien tersambung ulang otomatis).
package reports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/httpx"
)

const (
	sseInterval   = 5 * time.Second
	sseMaxSession = 30 * time.Minute
)

func (m *Module) liveStream(w http.ResponseWriter, r *http.Request) {
	// Superadmin tanpa tenant tidak punya data laporan.
	tenantID, err := tenantOf(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}

	examID := r.URL.Query().Get("exam_id")
	if examID != "" && !uuidRe.MatchString(examID) {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Parameter exam_id tidak valid"))
		return
	}
	classID := r.URL.Query().Get("class_id")
	if classID != "" && !uuidRe.MatchString(classID) {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Parameter class_id tidak valid"))
		return
	}
	search := r.URL.Query().Get("q")

	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Streaming tidak didukung"))
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // proxy (nginx/traefik) jangan buffer
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "retry: 5000\n\n") // instruksi reconnect ke klien
	flusher.Flush()

	ctx := r.Context()
	ticker := time.NewTicker(sseInterval)
	defer ticker.Stop()
	deadline := time.NewTimer(sseMaxSession)
	defer deadline.Stop()

	// Snapshot pertama langsung, tanpa menunggu tick.
	send := func() bool {
		var payload any
		if examID != "" {
			data, err := m.liveDetailData(ctx, tenantID, examID, classID, search)
			if err != nil {
				return writeSSEError(w, flusher, err)
			}
			payload = data
		} else {
			data, err := m.liveListData(ctx, tenantID)
			if err != nil {
				return writeSSEError(w, flusher, err)
			}
			payload = data
		}
		b, err := json.Marshal(payload)
		if err != nil {
			return writeSSEError(w, flusher, err)
		}
		if _, err := fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", b); err != nil {
			return false // klien_putus
		}
		flusher.Flush()
		return true
	}

	if !send() {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-deadline.C:
			fmt.Fprint(w, "event: reconnect\ndata: {\"reason\":\"max_session\"}\n\n")
			flusher.Flush()
			return
		case <-ticker.C:
			if !send() {
				return
			}
		}
	}
}

// writeSSEError mengirim event error sekali; false bila koneksi putus.
func writeSSEError(w http.ResponseWriter, flusher http.Flusher, err error) bool {
	if err != nil && (errors.Is(err, context.Canceled) || strings.Contains(err.Error(), "context canceled")) {
		return false
	}
	msg := "Gagal memuat data laporan"
	if err != nil {
		msg = sanitizeSSEMessage(err.Error())
	}
	if _, err := fmt.Fprintf(w, "event: error\ndata: {\"message\":%q}\n\n", msg); err != nil {
		return false
	}
	flusher.Flush()
	return true
}

// sanitizeSSEMessage hilangkan carriage/newline agar format SSE tetap valid.
func sanitizeSSEMessage(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '\n' || c == '\r' {
			continue
		}
		out = append(out, c)
	}
	return string(out)
}
