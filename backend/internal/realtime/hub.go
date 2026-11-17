// Package realtime: hub SSE in-process untuk laporan real-time (FR-9.3).
// B-07: heartbeat, metrik drop, dan koneksi ulang bila buffer penuh.
// Di produksi multi-replica, interface ini bisa diganti Redis pub/sub.
package realtime

import (
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

type Hub struct {
	mu       sync.Mutex
	channels map[string]map[chan string]bool
	dropped  atomic.Uint64
}

func NewHub() *Hub {
	return &Hub{channels: map[string]map[chan string]bool{}}
}

// DroppedCount dipakai metrik sse_dropped_total (B-07/C-05).
func (h *Hub) DroppedCount() uint64 { return h.dropped.Load() }

func (h *Hub) Subscribe(topic string) chan string {
	ch := make(chan string, 64)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.channels[topic] == nil {
		h.channels[topic] = map[chan string]bool{}
	}
	h.channels[topic][ch] = true
	return ch
}

func (h *Hub) Unsubscribe(topic string, ch chan string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.channels[topic] != nil {
		delete(h.channels[topic], ch)
	}
}

func (h *Hub) Publish(topic, msg string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.channels[topic] {
		select {
		case ch <- msg:
		default:
			// B-07: jangan buang diam-diam. Tutup koneksi agar klien subscribe ulang
			// dan menghitung metrik drop, daripada ketinggalan event selamanya.
			h.dropped.Add(1)
			delete(h.channels[topic], ch)
			close(ch)
		}
	}
}

// SSE menulis stream Server-Sent Events; fallback polling ada di klien (FR-9.3).
func (h *Hub) SSE(w http.ResponseWriter, r *http.Request, topic string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming tidak didukung", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Connection", "keep-alive")

	// B-07: hapus write deadline (C-02) agar koneksi panjang tidak terputus proxy.
	if rc := http.NewResponseController(w); rc != nil {
		_ = rc.SetWriteDeadline(time.Time{})
	}

	ch := h.Subscribe(topic)
	defer h.Unsubscribe(topic, ch)

	fmt.Fprint(w, "retry: 3000\n\nevent: hello\ndata: {}\n\n")
	flusher.Flush()

	// Heartbeat mencegah idle-timeout proxy (>60s) memutus koneksi.
	hb := time.NewTicker(15 * time.Second)
	defer hb.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-hb.C:
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case msg, open := <-ch:
			if !open {
				return // buffer penuh → klien akan subscribe ulang
			}
			if _, err := fmt.Fprintf(w, "event: live\ndata: %s\n\n", msg); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
