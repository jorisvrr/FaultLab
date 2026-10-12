import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { COUNTEREXAMPLES, PRESETS } from '@faultlab/experiments';

export interface Expected {
  readonly id: string;
  readonly spec: unknown;
  readonly reason: string;
  readonly entries: number;
  readonly fingerprint: string;
}
/** Computed in Node by test/browser-goldens.test.ts. */
export const EXPECTED: readonly Expected[] = JSON.parse(readFileSync(join(import.meta.dirname, 'expected-fingerprints.json'), 'utf8'));
export const expected = (id: string): Expected => EXPECTED.find((e) => e.id === id)!;

/** Track uncaught page errors; every test asserts there were none. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/**
 * Run a spec through the page's real Session (Worker, streaming, incremental index) until the
 * run settles, and report what the main thread received.
 */
export async function runInPage(page: Page, spec: unknown, runOptions: Record<string, unknown> = {}) {
  return page.evaluate(
    async ({ spec, runOptions }) => {
      const { session } = (globalThis as unknown as { faultlab: { session: any } }).faultlab;
      const settle = (states: string[]) =>
        new Promise<void>((resolve) => {
          const check = () => states.includes(session.view.run.lifecycle) && (off(), resolve());
          const off = session.subscribe(check);
          check();
        });
      const t0 = performance.now();
      session.load(spec, { id: 'e2e', title: 'e2e', summary: '', category: 'test' }, runOptions);
      await settle(['ready', 'error']);
      session.run();
      await settle(['completed', 'stopped', 'aborted', 'error']);
      // The received trace's fingerprint is verified after the run, in background batches.
      await new Promise<void>((resolve) => {
        const check = () => (session.view.run.fingerprint === null || session.view.run.fingerprint.matches !== null) && (off(), resolve());
        const off = session.subscribe(check);
        check();
      });
      const v = session.view.run;
      return { lifecycle: v.lifecycle, stopReason: v.stopReason, received: v.received, fingerprint: v.fingerprint, error: v.error, engineVersion: v.engineVersion, ms: performance.now() - t0, appendMs: session.trace.appendMs, maxAppendMs: session.trace.maxAppendMs };
    },
    { spec, runOptions },
  );
}

/**
 * Load a preset and stop at `ready`, without running it.
 *
 * It drives the Session directly rather than the Configure screen. These tests are about the
 * runtime — lifecycle, Worker, watchdog, inspection — and Configure has its own spec
 * (configure.spec.ts) that checks the screen submits exactly what it displays. Going through
 * the UI here would also be impossible for the diagnostic presets, which Configure does not
 * offer, and would couple every runtime test to a dashboard's markup.
 */
export async function openPreset(page: Page, id: string) {
  // Counterexamples are registered separately from the presets and are addressed by the same id.
  const preset = PRESETS.find((p) => p.id === id) ?? COUNTEREXAMPLES.find((p) => p.id === id);
  if (preset === undefined) throw new Error(`no preset ${id}`);
  // Simulate renders the docked playback bar, so the lifecycle badge and controls are present.
  await page.goto('/#/simulate');
  await page.waitForFunction(() => 'faultlab' in globalThis);
  await page.evaluate(
    ({ spec, meta }) => (globalThis as unknown as { faultlab: { session: { load: (s: unknown, m: unknown) => void } } }).faultlab.session.load(spec, meta),
    {
      spec: preset.spec as unknown,
      // A counterexample preset carries no summary or category of its own.
      meta: { id: preset.id, title: preset.title, summary: 'summary' in preset ? preset.summary : '', category: 'category' in preset ? preset.category : 'counterexample' },
    },
  );
  await expect(page.getByTestId('lifecycle')).toHaveAttribute('data-state', 'ready');
}

export const lifecycle = (page: Page) => page.getByTestId('lifecycle');
