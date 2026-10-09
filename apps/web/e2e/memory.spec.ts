import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Retained memory across repeated runs (CP6 Gate 1; replaces the leak assertion that lived in
 * the CP5 performance gate).
 *
 * Chromium only: it is the one engine that exposes a real heap size, and only with
 * `--expose-gc` plus `--enable-precise-memory-info` (see playwright.config.ts). Firefox and
 * WebKit have no equivalent API, so these tests skip there rather than pretend to measure.
 *
 * Methodology and why the CP5 version was unreliable: `src/bench/bench.ts`, `leakCheck`.
 */
type Leak = {
  supported: boolean;
  warmup: number;
  warmBaselineMB: number | null;
  heapsMB: number[];
  perRunMB: number;
  growthMB: number;
  spreadMB: number;
  workersCreated: number;
  workersLeaked: number;
  retainedForFaultInjection: number;
};

const TOLERANCE_MB = 10; // unchanged from CP5

async function leakCheck(page: Page, options: Record<string, unknown>): Promise<Leak> {
  await page.goto('/bench.html');
  await page.waitForFunction(() => 'faultlabBench' in globalThis);
  return page.evaluate(
    (o) => (globalThis as unknown as { faultlabBench: { leakCheck: (o: unknown) => Promise<Leak> } }).faultlabBench.leakCheck(o),
    options,
  );
}

test.describe('retained memory across repeated runs', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'no heap API outside Chromium');

  test('three repeats: the heap reaches a steady state, every Worker is released', async ({ page }, info) => {
    test.setTimeout(600_000);
    const repeats: Leak[] = [];
    for (let i = 0; i < 3; i++) repeats.push(await leakCheck(page, { warmup: 2, samples: 5 }));
    mkdirSync('test-results', { recursive: true });
    writeFileSync(join('test-results', `memory-${info.project.name}.json`), `${JSON.stringify(repeats, null, 2)}\n`);

    for (const r of repeats) {
      expect(r.supported, 'the heap API must be available in this run').toBe(true);
      expect(r.heapsMB).toHaveLength(5);
      // Every run created exactly one Worker and terminated it (2 warm-up + 5 measured).
      expect(r.workersCreated).toBe(7);
      expect(r.workersLeaked, 'Workers left running after dispose').toBe(0);
      expect(r.retainedForFaultInjection, 'no deliberate retention in the real check').toBe(0);
      // Growth over the measured window, from the slope: not a two-sample difference.
      expect(r.growthMB, `retained memory across 4 further disposed runs (series ${r.heapsMB.join(', ')} MB)`).toBeLessThan(TOLERANCE_MB);
    }
    // Independent of the slope: the whole steady-state series stays inside the same tolerance.
    for (const r of repeats) expect(r.spreadMB, 'spread of the steady-state series').toBeLessThan(TOLERANCE_MB);
  });

  test('fault injection: the check fails when each disposed run is deliberately retained', async ({ page }, info) => {
    test.setTimeout(600_000);
    const injected = await leakCheck(page, { warmup: 2, samples: 5, retain: true });
    mkdirSync('test-results', { recursive: true });
    writeFileSync(join('test-results', `memory-injected-${info.project.name}.json`), `${JSON.stringify(injected, null, 2)}\n`);
    expect(injected.supported).toBe(true);
    expect(injected.retainedForFaultInjection).toBe(5);
    // A trace of ≈ 124 000 entries plus its index is tens of MB, so retaining one per run must
    // put the measurement far outside the tolerance. If this ever passes, the check is blind.
    expect(injected.growthMB, `a retained Session per run must be detected (series ${injected.heapsMB.join(', ')} MB)`).toBeGreaterThan(TOLERANCE_MB);
    expect(injected.perRunMB, 'growth per retained run').toBeGreaterThan(1);
  });
});
