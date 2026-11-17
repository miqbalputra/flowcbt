// Service Worker PWA (FR-7.1): precache aset aplikasi agar halaman ujian tetap terbuka saat offline.
// CATATAN: file ini adalah JavaScript murni yang dijalankan browser — JANGAN memakai anotasi tipe TypeScript.
// X-01: anotasi `(e: any)` sebelumnya membuat SyntaxError sehingga SW tidak pernah terdaftar.
const CACHE = 'flowcbt-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  // addAll gagal seluruhnya bila salah satu resource tidak tersedia. Fallback per-URL
  // memastikan install tetap sukses walaupun salah satu entri belum ter-cache.
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll(SHELL).catch(() => Promise.all(SHELL.map((url) => c.add(url).catch(() => undefined)))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Strategi: network-first untuk API (agar sinkron jalan saat online), cache-first untuk aset statis.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response(JSON.stringify({ error: { code: 'OFFLINE', message: 'offline' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })),
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && e.request.method === 'GET') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('/index.html'))),
  );
});
