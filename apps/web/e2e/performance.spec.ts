import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { expected, lifecycle, openPreset } from './helpers';

/**
 * CP5 performance gate (measurements + acceptance criteria), per browser engine. Results are
 * written to test-results/perf-<browser>.json and summarised in docs/TEST_STRATEGY.md (CP5).
 * Thresholds are set from the Phase 0/6 baselines with a safety margin; they guard against
 * regressions, they are not benchmarks of absolute speed.
 */
type Bench = { workerRun: (id: string, options?: object, cycles?: number) => Promise<any>; mainThreadRun: (id: string) => Promise<any> };
const bench = (page: import('@playwright/test').Page) => page.evaluate.bind(page);

test('pipeline measurements: Worker vs main thread, clone vs json, seeking, pause/resume', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.goto('/bench.html');
  await page.waitForFunction(() => 'faultlabBench' in globalThis);
  const call = <T>(fn: (b: Bench) => Promise<T>) => bench(page)(async (source) => new Function('b', `return (${source})(b)`)((globalThis as unknown as { faultlabBench: Bench }).faultlabBench), fn.toString()) as Promise<T>;
  const results: Record<string, unknown> = {};
  results['mainThread_long'] = await call((b) => b.mainThreadRun('raft-long-heartbeats'));
  for (const encoding of ['clone', 'json']) {
    results[`worker_long_${encoding}`] = await call(new Function('b', `return b.workerRun('raft-long-heartbeats', { encoding: '${encoding}' })`) as never);
  }
  results['worker_small'] = await call((b) => b.workerRun('raft-isolate-leader'));
  results['worker_churn'] = await call((b) => b.workerRun('raft-leader-churn'));
  results['worker_long_pause_resume_40'] = await call((b) => b.workerRun('raft-long-heartbeats', {}, 40));
  results['leakCheck_heapMB_after_each_of_3_long_runs'] = await call((b: Bench & { leakCheck?: () => Promise<(number | null)[]> }) => b.leakCheck!());
  mkdirSync('test-results', { recursive: true });
  writeFileSync(join('test-results', `perf-${info.project.name}.json`), `${JSON.stringify(results, null, 2)}\n`);

  const long = results['worker_long_clone'] as { matches: boolean; entries: number; maxFrameGapMs: number; frameAtMaxMs: number; mainMaxChunkMs: number };
  const baseline = results['mainThread_long'] as { maxFrameGapMs: number };
  const longJson = results['worker_long_json'] as { matches: boolean };
  const cycles = results['worker_long_pause_resume_40'] as { matches: boolean };
  // Correctness under load and after 40 pause/resume cycles.
  expect([long.matches, longJson.matches, cycles.matches]).toEqual([true, true, true]);
  expect(long.entries).toBe(expected('raft-long-heartbeats').entries);
  // Acceptance criteria (see TEST_STRATEGY, CP5 performance gate).
  expect(baseline.maxFrameGapMs, 'the baseline must show the block it causes (measurement sanity)').toBeGreaterThan(200);
  expect(long.mainMaxChunkMs, 'largest main-thread chunk (decode + freeze + index + fingerprint)').toBeLessThan(50);
  expect(long.frameAtMaxMs, 'slowest TraceIndex frame (seek) on the main thread').toBeLessThan(50);
  expect(long.maxFrameGapMs, 'longest frame gap while a 124k-entry run executes in the Worker').toBeLessThan(250);
  const heaps = results['leakCheck_heapMB_after_each_of_3_long_runs'] as (number | null)[];
  if (heaps[0] !== null) expect(heaps.at(-1)! - heaps[0]!, 'heap growth after 3 disposed long runs (no leak between runs)').toBeLessThan(10);
});

test('the app stays responsive while a long run streams and the view follows it live', async ({ page }, info) => {
  test.setTimeout(120_000);
  await openPreset(page, 'raft-long-heartbeats');
  await page.evaluate(() => {
    const w = globalThis as unknown as { gaps: number[] };
    w.gaps = [];
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      w.gaps.push(now - last);
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.getByTestId('run').click();
  // Interact while it runs: navigation must keep working.
  await page.getByTestId('mode-investigate').click();
  await page.getByTestId('mode-simulate').click();
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'completed', { timeout: 60_000 });
  const gaps = await page.evaluate(() => (globalThis as unknown as { gaps: number[] }).gaps);
  const sorted = [...gaps].sort((a, b) => a - b);
  const summary = { frames: gaps.length, p50: Math.round(sorted[Math.floor(gaps.length / 2)]!), p95: Math.round(sorted[Math.floor(gaps.length * 0.95)]!), max: Math.round(sorted.at(-1)!), over50: gaps.filter((g) => g > 50).length };
  writeFileSync(join('test-results', `perf-app-${info.project.name}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  expect(summary.p95, 'p95 frame gap with live rendering').toBeLessThan(50);
});
