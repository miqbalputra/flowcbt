import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': (globalThis as any).process?.env?.DEV_API_PROXY || 'http://127.0.0.1:8080' },
  },
  build: { outDir: 'dist' },
});
