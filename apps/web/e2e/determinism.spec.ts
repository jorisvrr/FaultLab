import { expect, test } from '@playwright/test';
import { EXPECTED, runInPage, watchErrors } from './helpers';

/**
 * Cross-browser determinism (CP5): every reference experiment, executed in a real Web Worker of
 * this browser engine and streamed to the main thread, must produce EXACTLY the trace Node
 * produced (same fingerprint, same length, same stop reason), with both chunk encodings. The
 * engine goldens (7fda34b3, 6a1dfe65) are among them. A mismatch is to be investigated, never
 * "fixed" by changing the reference.
 */
for (const encoding of ['clone', 'json'] as const) {
  test(`all ${EXPECTED.length} reference experiments reproduce their Node fingerprints (${encoding})`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/#/simulate');
    for (const e of EXPECTED) {
      const result = await runInPage(page, e.spec, { encoding });
      expect({ id: e.id, lifecycle: result.lifecycle, reason: result.stopReason, entries: result.received, fingerprint: result.fingerprint?.received, matchesWorker: result.fingerprint?.matches }).toEqual({
        id: e.id,
        lifecycle: 'completed',
        reason: e.reason,
        entries: e.entries,
        fingerprint: e.fingerprint,
        matchesWorker: true,
      });
      expect(result.engineVersion).toBe('0.4.0-cp4');
    }
    expect(errors).toEqual([]);
  });
}
