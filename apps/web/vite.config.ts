import { defineConfig } from 'vite';

/**
 * `bench.html`, `node-lab.html` and `design.html` are development and testing tools: the Gate 1
 * renderer prototype, the measurement harness and the Gate 2 component gallery. The browser tests
 * drive them, so the default build keeps them; the PUBLIC build (`--mode public`, used by the
 * deployment) emits only the application, so the internal pages are never served in production and
 * their chunks are never shipped.
 */
const INTERNAL = { bench: 'bench.html', nodeLab: 'node-lab.html', design: 'design.html' };

export default defineConfig(({ mode }) => ({
  // Fixed ports, distinct from the CP2.5 demo (5173/5174/4173).
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 4180, strictPort: true },
  build: { target: 'es2023', rollupOptions: { input: { main: 'index.html', ...(mode === 'public' ? {} : INTERNAL) } } },
  worker: { format: 'es' },
}));
