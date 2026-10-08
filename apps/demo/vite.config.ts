import { defineConfig } from 'vite';

export default defineConfig({
  // Fixed address so the URL in the docs is always right; fail instead of silently switching ports.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2023' },
});
