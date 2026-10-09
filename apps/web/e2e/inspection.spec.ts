import { expect, test } from '@playwright/test';
import { lifecycle, openPreset, watchErrors } from './helpers';

test('node inspection equals the Worker engine’s own state at the same step boundary', async ({ page }) => {
  await openPreset(page, 'raft-isolate-leader');
  await page.getByTestId('run').click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'completed');
  // For several steps: reconstruct on the main thread (TraceIndex) vs. a snapshot from the Worker.
  const mismatches = await page.evaluate(async () => {
    const { session } = (globalThis as unknown as { faultlab: { session: any } }).faultlab;
    const index = session.trace.index;
    const out: string[] = [];
    for (const step of [1, 25, 100, 150, 220, 300, index.steps.length]) {
      const { snapshot } = await session.client.snapshot(step);
      const frame = index.frameAt(index.step(step).last);
      for (const node of snapshot.nodes) {
        const f = frame.nodes.find((n: { id: string }) => n.id === node.id);
        const engine = JSON.stringify({ status: node.status, incarnation: node.incarnation, state: node.state === null ? undefined : node.state.value, storage: Object.fromEntries(node.storage), timers: node.timers.map(([id]: [string]) => id) });
        const ui = JSON.stringify({ status: f.status, incarnation: f.incarnation, state: f.state, storage: f.storage, timers: f.pendingTimers.map((t: { timerId: string }) => t.timerId) });
        if (engine !== ui) out.push(`step ${step} ${node.id}: ${engine} ≠ ${ui}`);
      }
    }
    return out;
  });
  expect(mismatches).toEqual([]);
});

test('violation analysis: jump to the exact entry, follow its cause chain, verify the stored fixture', async ({ page }) => {
  const errors = watchErrors(page);
  await openPreset(page, 'cx-naive-leader.single-leader');
  await page.getByTestId('run').click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'completed');
  await page.getByTestId('mode-investigate').click();
  const violation = page.getByTestId('violations').getByRole('button').first();
  await violation.click();
  await expect(page.getByTestId('entry-detail')).toContainText('invariant.violation');
  await expect(page.getByTestId('entry-detail')).toContainText('single-leader');
  await expect(page.getByTestId('position')).toContainText('invariant.violation');
  // Engine 0.3.0-cp2 fixture, reproduced through the legacy projection.
  await expect(page.getByTestId('fixture-verification')).toHaveAttribute('data-matches', 'true');
  await expect(page.getByTestId('fixture-verification')).toContainText('c5be175f');
  await expect(page.getByTestId('fixture-verification')).toContainText('legacy');
  // Follow the cause chain one level up.
  const cause = (await page.getByTestId('ancestors').getByRole('button').first().textContent())!;
  await page.getByTestId('ancestors').getByRole('button').first().click();
  await expect(page.getByTestId('entry-detail').getByRole('heading', { level: 3 })).toContainText(`${cause} timer.fire`);
  await expect(page.getByTestId('consequences')).toContainText('invariant.violation'); // and the violation is among its consequences
  expect(errors).toEqual([]);
});

test('markers navigate to exact entries, not to timestamps', async ({ page }) => {
  await openPreset(page, 'heartbeat-crash-partition');
  await page.getByTestId('run').click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'completed');
  await page.keyboard.press('Home');
  for (const kind of ['node.crash', 'node.recover', 'network.partition', 'network.heal']) {
    await page.keyboard.press(']');
    await expect(page.getByTestId('position')).toContainText(kind);
  }
  const index = await page.evaluate(() => (globalThis as unknown as { faultlab: { session: any } }).faultlab.session.view.cursor);
  const entry = await page.evaluate((i) => (globalThis as unknown as { faultlab: { session: any } }).faultlab.session.trace.index.entry(i).kind, index);
  expect(entry).toBe('network.heal');
});
