import { defineConfig } from '@playwright/test';

/** End-to-end checks of the CP2.5 viewer in a real browser (the locally installed Chrome). */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5174', channel: 'chrome', viewport: { width: 1440, height: 1000 } },
  webServer: { command: 'npx vite --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: false, timeout: 30_000 },
});
