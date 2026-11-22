// webserve — server statis untuk build frontend (Vite dist) + proxy /api ke backend.
//
// Dipakai untuk akses publik tanpa mengekspos Vite dev server (dev server punya
// endpoint transform/HMR yang bisa dieksploitasi bila terbuka ke internet, dan
// overlay error-nya ikut tampil ke semua pengguna saat ada permintaan aneh).
//
// Contoh:
//
//	go run ./cmd/webserve -addr :5173 -dist ../frontend/dist -api http://127.0.0.1:8080
package main

import (
	"flag"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	addr := flag.String("addr", ":5173", "alamat listen (mis. :5173)")
	dist := flag.String("dist", "../frontend/dist", "folder hasil build frontend")
	api := flag.String("api", "http://127.0.0.1:8080", "base URL API backend")
	flag.Parse()

	root, err := filepath.Abs(*dist)
	if err != nil {
		log.Fatalf("dist tidak valid: %v", err)
	}
	if st, err := os.Stat(filepath.Join(root, "index.html")); err != nil || st.IsDir() {
		log.Fatalf("index.html tidak ditemukan di %s — jalankan `npm run build` dulu", root)
	}
	target, err := url.Parse(*api)
	if err != nil {
		log.Fatalf("api tidak valid: %v", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.FlushInterval = -1 // SSE (/reports/live/stream) langsung diteruskan
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("proxy %s %s: %v", r.Method, r.URL.Path, err)
		http.Error(w, `{"code":"BAD_GATEWAY","message":"Backend tidak merespons"}`, http.StatusBadGateway)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeHTTP(w, r)
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.Handle("/", spaHandler(root))

	srv := &http.Server{
		Addr:              *addr,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("webserve jalan di %s — dist=%s api=%s", *addr, root, target)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server berhenti: %v", err)
	}
}

// spaHandler menyajikan berkas statis; path tanpa ekstensi → index.html (SPA).
func spaHandler(root string) http.Handler {
	files := http.FileServer(http.Dir(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := path.Clean("/" + strings.TrimPrefix(r.URL.Path, "/"))
		if clean == "/" {
			serveIndex(w, r, root)
			return
		}
		full := filepath.Join(root, filepath.FromSlash(clean))
		if st, err := os.Stat(full); err == nil && !st.IsDir() {
			if strings.HasPrefix(clean, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}
		// Jangan fallback untuk berkas ber-ekstensi (404 apa adanya).
		if path.Ext(clean) != "" {
			http.NotFound(w, r)
			return
		}
		serveIndex(w, r, root)
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, root string) {
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, filepath.Join(root, "index.html"))
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		next.ServeHTTP(w, r)
	})
}
