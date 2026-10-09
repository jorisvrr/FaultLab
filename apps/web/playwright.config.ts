import { defineConfig, devices } from '@playwright/test';

/**
 * CP5 browser tests against the PRODUCTION build (`vite build` + `vite preview`), in three engines:
 * Chromium (the locally installed Chrome), Firefox and WebKit (Playwright builds).
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: { baseURL: 'http://127.0.0.1:4180', viewport: { width: 1440, height: 900 } },
  projects: [
    // --expose-gc and precise memory info only so the performance page can read heap sizes after a forced GC (Chromium only; Chrome otherwise rounds performance.memory for privacy).
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 }, launchOptions: { args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: { command: 'npx vite preview --port 4180 --strictPort', url: 'http://127.0.0.1:4180', reuseExistingServer: false, timeout: 30_000 },
});
