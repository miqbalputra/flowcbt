// Package realtime: hub SSE in-process untuk laporan real-time (FR-9.3).
// Di produksi bisa diganti Redis pub/sub; interface sama.
package realtime

import (
	"fmt"
	"net/http"
	"sync"
)

type Hub struct {
	mu       sync.Mutex
	channels map[string]map[chan string]bool
}

func NewHub() *Hub {
	return &Hub{channels: map[string]map[chan string]bool{}}
}

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
		}
	}
}

// SSE menulis stream Server-Sent Events; fallback polling 10 dtk ada di klien (FR-9.3).
func (h *Hub) SSE(w http.ResponseWriter, r *http.Request, topic string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming tidak didukung", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	ch := h.Subscribe(topic)
	defer h.Unsubscribe(topic, ch)
	fmt.Fprintf(w, "event: hello\ndata: {}\n\n")
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		}
	}
}
