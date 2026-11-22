import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            // cache paket soal & API GET data pengerjaan agar halaman ujian terbuka saat offline
            urlPattern: ({ url }) => url.pathname.includes('/api/v1/student/exam-data/') || url.pathname.includes('/api/v1/attempts/'),
            method: 'GET',
            handler: 'NetworkFirst',
            options: { cacheName: 'flowcbt-attempt', expiration: { maxEntries: 30, maxAgeSeconds: 3600 } },
          },
        ],
      },
      manifest: {
        id: 'flowcbt-siswa',
        name: 'FlowCBT Siswa',
        short_name: 'FlowCBT',
        description: 'Ujian online yang tetap jalan walau internet putus',
        lang: 'id',
        theme_color: '#1957bb',
        background_color: '#f9fafb',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    // Dev server HANYA untuk lokal: endpoint transform/HMR-nya berbahaya bila
    // terbuka ke internet (pernah kena percobaan RCE lewat injeksi glob option).
    // Untuk akses publik pakai build statis: `go run ./cmd/webserve` di backend.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
})
