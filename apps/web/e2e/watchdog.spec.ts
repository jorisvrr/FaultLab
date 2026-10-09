import { expect, test } from '@playwright/test';
import { lifecycle, openPreset, watchErrors } from './helpers';

/**
 * A protocol handler that never returns (diagnostic-spin) blocks its Worker forever. The main
 * thread must stay responsive, and the watchdog must terminate the Worker and report the run as
 * ABORTED (not completed, not reproducible).
 */
test('an infinite loop in a handler: UI stays responsive, the watchdog aborts the run', async ({ page }) => {
  const errors = watchErrors(page);
  await openPreset(page, 'diagnostic-spin');
  // Count animation frames while the Worker spins: a blocked main thread would produce none.
  await page.evaluate(() => {
    const w = globalThis as unknown as { frames: number };
    w.frames = 0;
    const tick = () => {
      w.frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByTestId('run').click();
  await page.waitForTimeout(1000);
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'running'); // still "running": no step boundary is ever reached
  // The UI reacts while the Worker is stuck.
  await page.getByTestId('mode-investigate').click();
  await expect(page.getByTestId('investigate')).toBeVisible();
  await page.getByTestId('mode-simulate').click();
  const frames = await page.evaluate(() => (globalThis as unknown as { frames: number }).frames);
  expect(frames).toBeGreaterThan(20);
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'aborted', { timeout: 10_000 });
  await expect(page.getByTestId('aborted')).toContainText('watchdog');
  await expect(page.getByTestId('aborted')).toContainText('not reproducible');
  await expect(page.getByTestId('fingerprint')).toHaveCount(0); // never presented as a verified, complete trace
  // The page can start a new run afterwards.
  await openPreset(page, 'raft-healthy');
  await page.getByTestId('run').click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'completed');
  expect(errors).toEqual([]);
});
