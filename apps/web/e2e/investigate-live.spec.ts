import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expected, lifecycle, openPreset, watchErrors } from './helpers';

/**
 * CP6 regression (Investigate freeze, found in CP6 Phase 0): Investigate stays open with "follow
 * live" for the WHOLE heartbeat-heavy Raft run, while the newest entry's cause chain grows to
 * ≈ 8 000 entries. The CP5 performance test passed through Investigate for a single frame and
 * never saw this. Results are written to test-results/investigate-live-<browser>.json.
 */

/** Frame gaps (rAF), main-thread blocking (a MessageChannel ping loop, works in every engine) and long tasks where supported. */
async function installProbes(page: Page) {
  await page.evaluate(() => {
    const w = globalThis as unknown as { probe: { gaps: number[]; blocks: number[]; longTasks: number[]; maxChainShown: number; stop: boolean }; faultlab: { session: any } };
    // Loops close over THIS probe object, so installing a new probe ends the previous loops.
    const p: typeof w.probe = { gaps: [], blocks: [], longTasks: [], maxChainShown: 0, stop: false };
    w.probe = p;
    let last = performance.now();
    const frame = () => {
      const now = performance.now();
      p.gaps.push(now - last);
      last = now;
      // The cause chain of the entry Investigate shows right now (computing it costs ≈ 0.2 ms).
      const shown = document.querySelector('[data-testid="ancestors-count"]');
      if (shown !== null) p.maxChainShown = Math.max(p.maxChainShown, Number(shown.textContent));
      if (!p.stop) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const channel = new MessageChannel();
    let sent = performance.now();
    channel.port1.onmessage = () => {
      const now = performance.now();
      p.blocks.push(now - sent);
      if (p.stop) return;
      setTimeout(() => {
        sent = performance.now();
        channel.port2.postMessage(0);
      }, 4);
    };
    channel.port2.postMessage(0);
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      new PerformanceObserver((list) => list.getEntries().forEach((e) => p.longTasks.push(e.duration))).observe({ type: 'longtask' });
    }
  });
}

const sessionState = (page: Page) =>
  page.evaluate(() => {
    const { session } = (globalThis as unknown as { faultlab: { session: any } }).faultlab;
    return { cursor: session.view.cursor as number, follow: session.view.follow as boolean, length: session.view.length as number, lifecycle: session.view.run.lifecycle as string };
  });

/** Time from a click to the next painted frame (the click's handlers + the React commit + layout). */
const timedClick = (page: Page, selector: string, nth = 0) =>
  page.evaluate(
    ({ selector, nth }) =>
      new Promise<number>((resolve) => {
        const el = document.querySelectorAll<HTMLElement>(selector)[nth]!;
        const t0 = performance.now();
        el.click();
        requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - t0), 0));
      }),
    { selector, nth },
  );

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0);
  return { n: xs.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: Math.round(s.at(-1) ?? 0), over50: xs.filter((x) => x > 50).length, over100: xs.filter((x) => x > 100).length, over250: xs.filter((x) => x > 250).length };
};

test('Investigate stays responsive for a whole long run with follow live and an ≈ 8 000-entry cause chain', async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  await openPreset(page, 'raft-long-heartbeats');
  await page.getByTestId('mode-investigate').click();
  await expect(page.getByTestId('investigate')).toBeVisible();
  await installProbes(page);
  await page.getByTestId('run').click();

  // 1. Live, following, while the chain grows.
  await page.waitForFunction(() => (globalThis as any).faultlab.session.view.length > 40_000, null, { timeout: 120_000, polling: 100 });
  expect((await sessionState(page)).follow).toBe(true);

  // 2. Follow off, then navigate manually to an earlier event in the cause chain.
  const clicks: Record<string, number> = {};
  clicks['followOff'] = await timedClick(page, '[data-testid="follow"]');
  const before = await sessionState(page);
  expect(before.follow).toBe(false);
  clicks['causeLink'] = await timedClick(page, '[data-testid="ancestors"] button', 4);
  const inspected = await sessionState(page);
  expect(inspected.cursor).toBeLessThan(before.cursor);
  await page.waitForTimeout(500);
  const still = await sessionState(page);
  expect(still.cursor, 'the inspected entry stays put while the run continues').toBe(inspected.cursor);
  expect(still.length).toBeGreaterThan(inspected.length);

  // 3. Follow back on: jumps to the newest entry and keeps following.
  clicks['followOn'] = await timedClick(page, '[data-testid="follow"]');
  const following = await sessionState(page);
  expect(following.follow).toBe(true);
  expect(following.cursor).toBeGreaterThan(still.cursor);

  // 4. Stay on Investigate, following live, until the run completes.
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'completed', { timeout: 240_000 });
  await page.evaluate(() => ((globalThis as any).probe.stop = true));
  const probe = await page.evaluate(() => (globalThis as any).probe as { gaps: number[]; blocks: number[]; longTasks: number[]; maxChainShown: number });
  const chain = await page.evaluate((shown) => {
    const index = (globalThis as any).faultlab.session.trace.index;
    // The deepest chain near the end (the very last entry, run.end, has no cause).
    let deepestAt = 0;
    let deepest = 0;
    for (let i = index.length - 50; i < index.length; i++) {
      const n = index.ancestors(i).length as number;
      if (n > deepest) [deepest, deepestAt] = [n, i];
    }
    return { entries: index.length as number, deepest, deepestAt, maxChainShownWhileFollowing: shown };
  }, (await page.evaluate(() => (globalThis as any).probe.maxChainShown)) as number);

  // 5. Deterministic stress: replay the received trace through its deepest region (≈ 1.5 s at
  // 8 000 entries/s), so the shown entry and its ≈ 8 000-entry cause chain change on every tick.
  await installProbes(page);
  await page.evaluate((at) => {
    const { session } = (globalThis as any).faultlab;
    session.setCursor(at - 12_000);
    session.replay(8_000);
  }, chain.deepestAt);
  await page.waitForFunction(() => !(globalThis as any).faultlab.session.view.replaying, null, { timeout: 60_000 });
  await page.evaluate(() => ((globalThis as any).probe.stop = true));
  const replayProbe = await page.evaluate(() => (globalThis as any).probe as { gaps: number[]; blocks: number[]; maxChainShown: number });
  const replay = { maxChainShown: replayProbe.maxChainShown, frameGapsMs: stats(replayProbe.gaps), mainThreadBlockMs: stats(replayProbe.blocks) };

  // 6. Manual navigation through deep entries: 30 × ← (each shows an ≈ 8 000-entry chain).
  await page.evaluate((at) => (globalThis as any).faultlab.session.setCursor(at), chain.deepestAt);
  const keys = await page.evaluate(async () => {
    const out: number[] = [];
    for (let k = 0; k < 30; k++) {
      const t0 = performance.now();
      dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      out.push(performance.now() - t0);
    }
    return out;
  });
  clicks['keyArrowLeftMax'] = Math.max(...keys);
  const result = { browser: info.project.name, chain, replay, keyArrowLeftMs: stats(keys), frameGapsMs: stats(probe.gaps), mainThreadBlockMs: stats(probe.blocks), longTasksMs: probe.longTasks.length === 0 ? null : stats(probe.longTasks), clickToPaintMs: clicks };
  mkdirSync('test-results', { recursive: true });
  writeFileSync(join('test-results', `investigate-live-${info.project.name}.json`), `${JSON.stringify(result, null, 2)}\n`);

  // The scenario really reproduces the Phase 0 failure.
  expect(chain.entries).toBe(expected('raft-long-heartbeats').entries);
  expect(chain.deepest).toBeGreaterThan(7_900);
  // Which entry is newest at a given frame depends on timing (chunk boundaries); many entries
  // sit in short chains. This only shows that the chains grew while following live; the
  // deterministic ≈ 8 000-entry stress is the replay (5).
  expect(chain.maxChainShownWhileFollowing, 'cause chains grew while following live').toBeGreaterThan(2_000);
  expect(replay.maxChainShown, 'the replay showed the ≈ 8 000-entry chains').toBeGreaterThan(7_900);

  // 7. The FULL cause chain stays reachable: count, nearest cause, and the root (run.start, #0).
  await page.evaluate((at) => (globalThis as any).faultlab.session.setCursor(at), chain.deepestAt);
  const cursor = chain.deepestAt;
  await expect(page.getByTestId('ancestors-count')).toHaveText(String(chain.deepest));
  await page.getByTestId('ancestors-root').click();
  expect((await sessionState(page)).cursor).toBe(0);
  await expect(page.getByTestId('entry-detail')).toContainText('run.start');
  await page.evaluate((c) => (globalThis as any).faultlab.session.setCursor(c), cursor);
  // Scrolling the windowed list to its end shows the root as the last row.
  await page.getByTestId('ancestors').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(page.getByTestId('ancestors').locator('button', { hasText: /^#0$/ })).toBeVisible();

  // Responsiveness criteria (thresholds: see docs/TEST_STRATEGY.md, CP6).
  expect(result.mainThreadBlockMs.max, 'longest main-thread block').toBeLessThan(250);
  expect(replay.mainThreadBlockMs.max, 'longest main-thread block while replaying deep chains').toBeLessThan(250);
  expect(replay.frameGapsMs.p95, 'p95 frame gap while replaying deep chains').toBeLessThan(50);
  expect(result.frameGapsMs.p95, 'p95 frame gap').toBeLessThan(50);
  expect(result.frameGapsMs.over250, 'frame gaps over 250 ms').toBe(0);
  for (const [name, ms] of Object.entries(clicks)) expect(ms, `click → paint: ${name}`).toBeLessThan(250);
  expect(errors).toEqual([]);
});
