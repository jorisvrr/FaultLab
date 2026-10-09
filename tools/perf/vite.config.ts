import { defineConfig } from 'vite';

/**
 * Bundles a measurement script into one Node ESM file so it can run under V8's own profilers
 * (`node --cpu-prof`, `--expose-gc`, `--trace-gc`), which Vitest does not expose. Not part of
 * the application or the test suite.
 */
export default defineConfig({
  build: { ssr: true, target: 'node22', outDir: '.out', emptyOutDir: false, minify: false, rollupOptions: { output: { entryFileNames: '[name].mjs' } } },
  logLevel: 'warn',
});
