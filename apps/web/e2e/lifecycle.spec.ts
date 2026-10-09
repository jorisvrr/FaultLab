import { expect, test } from '@playwright/test';
import { expected, lifecycle, openPreset, watchErrors } from './helpers';

/** UX-001 / UX-002 and the run lifecycle, operated through the real UI. */
test('explicit lifecycle: ready → running → paused → (step) → running → completed', async ({ page }) => {
  const errors = watchErrors(page);
  await openPreset(page, 'raft-long-heartbeats');
  await expect(lifecycle(page)).toContainText('Ready (not started)');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'running');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'paused');
  const before = Number((await page.getByTestId('stats').textContent())!.match(/steps (\d+)/)![1]);
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.getByTestId('stats')).toContainText(`steps ${before + 1} `);
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'paused');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'completed', { timeout: 60_000 });
  await expect(page.getByTestId('fingerprint')).toContainText(expected('raft-long-heartbeats').fingerprint);
  expect(errors).toEqual([]);
});

test('Stop ends the run normally; Restart reruns it identically', async ({ page }) => {
  await openPreset(page, 'raft-long-heartbeats');
  await page.getByTestId('run').click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'running');
  await page.getByTestId('stop').click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'stopped');
  await expect(lifecycle(page)).toContainText('Stopped by you');
  await expect(page.getByTestId('fingerprint')).toHaveAttribute('data-matches', 'true'); // every produced entry arrived
  await page.getByTestId('restart').click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('run').click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'completed', { timeout: 60_000 });
  await expect(page.getByTestId('fingerprint')).toContainText(expected('raft-long-heartbeats').fingerprint);
});

test('rapid Start → Stop → Start, and Run A → select B → run B: no data from A ever reaches B', async ({ page }) => {
  const errors = watchErrors(page);
  await openPreset(page, 'raft-long-heartbeats');
  await page.getByTestId('run').click();
  await page.getByTestId('stop').click();
  await page.getByTestId('restart').click();
  await page.getByTestId('run').click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'running');
  // Switch to B while A is streaming.
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('choose-raft-isolate-leader').click();
  await page.getByTestId('load').click();
  await page.getByTestId('run').click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'completed');
  await expect(page.getByTestId('fingerprint')).toContainText(`${expected('raft-isolate-leader').fingerprint} ✓`);
  await expect(page.getByTestId('stats')).toContainText(`entries ${expected('raft-isolate-leader').entries}`);
  expect(errors).toEqual([]);
});

test('keyboard: Space runs and pauses, arrows move the cursor, every control has an accessible name', async ({ page }) => {
  await openPreset(page, 'raft-isolate-leader');
  await page.keyboard.press('Space');
  await expect(lifecycle(page)).toHaveAttribute('data-state', /running|completed/);
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'completed');
  await page.keyboard.press('Home');
  await expect(page.getByTestId('position')).toContainText('entry #0 ');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('position')).toContainText('entry #1 ');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByTestId('position')).toContainText('step 2');
  const next = await page.evaluate(() => {
    const { session } = (globalThis as unknown as { faultlab: { session: any } }).faultlab;
    return session.trace.index.nextMarker(session.view.cursor);
  });
  await page.keyboard.press(']');
  await expect(page.getByTestId('position')).toContainText(`entry #${next.index} `);
  for (const name of ['Run', 'Pause', 'Step', 'Stop', 'Restart', 'Previous marker', 'Next marker', 'Previous entry', 'Next entry', 'Previous simulation step', 'Next simulation step', 'Replay']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole('slider', { name: 'Trace position (entry)' })).toBeVisible();
});

test('UX-002: the controls stay in the viewport while the content scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 600 });
  await openPreset(page, 'raft-isolate-leader');
  await page.getByTestId('run').click();
  await page.getByTestId('node-n5').getByRole('button').click(); // opens the (long) inspector
  await page.locator('main').evaluate((m) => m.scrollTo(0, m.scrollHeight));
  const box = (await page.getByTestId('playback').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  await expect(page.getByTestId('run')).toBeInViewport();
});
