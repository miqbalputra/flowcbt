// Package platform: metrik RED minimal berformat Prometheus tanpa dependency eksternal.
// C-05: metrik dasar (HTTP, SSE drop, worker) diekspos di GET /metrics.
package platform

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
)

type Metrics struct {
	mu      sync.Mutex
	counter map[string]int64
	gauges  map[string]float64
}

func NewMetrics() *Metrics {
	return &Metrics{counter: map[string]int64{}, gauges: map[string]float64{}}
}

func (m *Metrics) Inc(name string, labels ...string) {
	if m == nil {
		return
	}
	key := name
	if len(labels) > 0 {
		key += "{" + strings.Join(labels, ",") + "}"
	}
	m.mu.Lock()
	m.counter[key]++
	m.mu.Unlock()
}

func (m *Metrics) Add(name string, n int64) {
	if m == nil {
		return
	}
	m.mu.Lock()
	m.counter[name] += n
	m.mu.Unlock()
}

func (m *Metrics) Set(name string, v float64) {
	if m == nil {
		return
	}
	m.mu.Lock()
	m.gauges[name] = v
	m.mu.Unlock()
}

func label(k, v string) string {
	return k + "=\"" + strings.ReplaceAll(v, "\"", "\\\"") + "\""
}

// Handler menulis exposition format Prometheus 0.0.4.
func (m *Metrics) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		m.mu.Lock()
		keys := make([]string, 0, len(m.counter))
		for k := range m.counter {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			fmt.Fprintf(w, "%s %d\n", k, m.counter[k])
		}
		gkeys := make([]string, 0, len(m.gauges))
		for k := range m.gauges {
			gkeys = append(gkeys, k)
		}
		sort.Strings(gkeys)
		for _, k := range gkeys {
			fmt.Fprintf(w, "%s %s\n", k, strconv.FormatFloat(m.gauges[k], 'f', -1, 64))
		}
		m.mu.Unlock()
	}
}

// HTTPLabel membentuk label untuk http_requests_total.
func HTTPLabel(method, route string, status int) string {
	return label("method", method) + "," + label("route", route) + "," + label("status", strconv.Itoa(status))
}
