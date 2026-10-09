import { defineConfig } from 'vite';

export default defineConfig({
  // Fixed ports, distinct from the CP2.5 demo (5173/5174/4173).
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 4180, strictPort: true },
  build: { target: 'es2023', rollupOptions: { input: { main: 'index.html', bench: 'bench.html', nodeLab: 'node-lab.html' } } },
  worker: { format: 'es' },
});
