// stream_ticket.go — tiket sekali-pakai untuk SSE laporan real-time.
//
// MASALAH (audit P1-6): EventSource tidak bisa mengirim header, sehingga
// token JWT lama dikirim via query `?token=` dan ikut tercetak di log
// akses / riwayat proxy. SOLUSI: klien meminta tiket pendek (30 detik)
// lewat POST dengan header Authorization; GET /live/stream kini hanya
// menerima `?ticket=`. Tiket dipakai sekali, terikat klaim staf, dan
// tidak berguna untuk hal lain — kebocoran di log tidak bernilai.
package reports

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"
)

const (
	streamTicketTTL  = 30 * time.Second
	maxStreamTickets = 10_000 // atau riak bersih saat penuh
)

type streamTicket struct {
	claims  *auth.Claims
	expires time.Time
}

// POST /reports/live/stream-ticket — minta tiket sekali-pakai (auth header
// staf, sama seperti laporan lain). Response: {data:{ticket:"...",expires_in:30}}.
func (m *Module) issueStreamTicket(w http.ResponseWriter, r *http.Request) {
	claims := ctxinfo.Claims(r.Context())
	if claims == nil {
		httpx.Error(w, httpx.NewErr(http.StatusUnauthorized, "UNAUTHORIZED", "Sesi tidak dikenali"))
		return
	}
	// rate-limit per tenant: tiket dipakai sekali tiap koneksi SSE —
	// reconnect loop normal jauh di bawah 60/menit; ini memblokir spam
	// minta-tiket (pencegahan pemenuhan memori tiket).
	if !m.a.RL.Allow("sseticket:"+claims.TenantID, 60) {
		httpx.Error(w, httpx.ErrRateLimited)
		return
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		httpx.Error(w, err)
		return
	}
	id := hex.EncodeToString(buf)

	m.ticketMu.Lock()
	if len(m.tickets) > maxStreamTickets {
		now := time.Now()
		for k, t := range m.tickets {
			if now.After(t.expires) {
					delete(m.tickets, k)
			}
		}
	}
	m.tickets[id] = streamTicket{claims: claims, expires: time.Now().Add(streamTicketTTL)}
	m.ticketMu.Unlock()

	httpx.OK(w, map[string]any{"data": map[string]any{
		"ticket":     id,
		"expires_in": 30,
	}})
}

// requireStreamTicket — middleware SSE: hanya menerima `?ticket=` valid
// (sekali pakai, 30 detik). Query `token=` JANGAN lagi diterima agar JWT
// tidak pernah kembali ke log.
func (m *Module) requireStreamTicket(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("ticket")
		if id == "" {
			httpx.Error(w, httpx.NewErr(http.StatusUnauthorized, "TICKET_REQUIRED",
				"Tiket SSE wajib — minta lewat POST /reports/live/stream-ticket"))
				return
		}
		m.ticketMu.Lock()
		t, ok := m.tickets[id]
		if ok {
			delete(m.tickets, id) // sekali pakai
		}
		m.ticketMu.Unlock()
		if !ok || time.Now().After(t.expires) {
			httpx.Error(w, httpx.NewErr(http.StatusUnauthorized, "TICKET_INVALID",
				"Tiket SSE tidak valid atau kedaluwarsa"))
			return
		}
		if t.claims != nil {
			r = r.WithContext(ctxinfo.WithClaims(r.Context(), t.claims))
		}
		next.ServeHTTP(w, r)
	})
}
