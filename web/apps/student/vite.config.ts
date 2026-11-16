import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // properti 'test' untuk vitest tidak ada di tipe UserConfig vite; cast aman karena vitest membacanya saat runtime

  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': (globalThis as any).process?.env?.DEV_API_PROXY || 'http://127.0.0.1:8080' },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any);
