// Menyajikan build produksi Vite (dist) dengan proxy API & security header.
// Dipakai untuk menjalankan FlowCBT di VPS tanpa nginx:
//   ROOT=web/apps/teacher/dist PORT=5173 node scripts/serve-web.mjs
//   ROOT=web/apps/student/dist PORT=5174 node scripts/serve-web.mjs
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const ROOT = process.env.ROOT;
const PORT = Number(process.env.PORT || 5173);
const API_ORIGIN = process.env.API_ORIGIN || 'http://127.0.0.1:8080';

if (!ROOT || !existsSync(ROOT)) {
  console.error('ROOT wajib berisi direktori dist yang sudah di-build');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8', '.woff2': 'font/woff2',
};

function securityHeaders(res, isHtml) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  if (isHtml) res.setHeader('Cache-Control', 'no-cache');
}

function sendFile(res, file, status = 200) {
  securityHeaders(res, file.endsWith('.html'));
  res.statusCode = status;
  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
  if (file.includes('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // X-05: jangan pernah menyajikan sumber TypeScript / file Vite internal.
  if (/^\/(src|@vite|@react-refresh)(\/|$)/.test(url.pathname) || /\.(tsx?|map)$/.test(url.pathname)) {
    securityHeaders(res, false);
    res.statusCode = 404;
    return res.end('Not found');
  }

  // Proxy API same-origin ke Go API. SSE tidak boleh di-buffer.
  if (url.pathname.startsWith('/api/')) {
    try {
      const target = API_ORIGIN + req.url;
      // Kumpulkan body dulu — stream req tidak bisa dipakai ulang oleh fetch.
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks);
      const headers = { ...req.headers, host: new URL(API_ORIGIN).host };
      delete headers['content-length'];
      const r = await fetch(target, {
        method: req.method, headers,
        body: ['GET', 'HEAD'].includes(req.method) || raw.length === 0 ? undefined : raw,
      });
      securityHeaders(res, false);
      res.statusCode = r.status;
      for (const [k, v] of r.headers) {
        if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v);
      }
      if (r.body) {
        const reader = r.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        securityHeaders(res, false);
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify({ error: { code: 'BAD_GATEWAY', message: 'API tidak tersedia' } }));
    }
    return;
  }

  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/' || path === '\\') path = '/index.html';
  let file = join(ROOT, path);
  if (existsSync(file) && statSync(file).isFile()) return sendFile(res, file);

  // SPA fallback (termasuk /exam/... untuk app siswa).
  const fallback = join(ROOT, 'index.html');
  if (existsSync(fallback)) return sendFile(res, fallback);
  securityHeaders(res, false);
  res.statusCode = 404;
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => console.log(`serving ${ROOT} on 0.0.0.0:${PORT} -> ${API_ORIGIN}`));
