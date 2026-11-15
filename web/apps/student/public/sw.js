// Service Worker PWA (FR-7.1): precache aset aplikasi agar halaman ujian tetap terbuka saat offline.
const CACHE = 'flowcbt-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (e: any) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e: any) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Strategi: network-first untuk API (agar sinkron jalan saat online), cache-first untuk aset statis.
self.addEventListener('fetch', (e: any) => {
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
