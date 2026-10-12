import { expect, test, type Page } from '@playwright/test';
import { PRESETS } from '@faultlab/experiments';
import { lifecycle, openPreset, watchErrors } from './helpers';

/**
 * CP6 regression (found in CP6 Phase 0): after a click, the controlled "follow live" checkbox
 * showed its OLD state for one frame, because Session notified React only on the next animation
 * frame and React restores controlled inputs at the end of the event.
 *
 * Each check clicks inside the page and samples the checkbox's real `checked` property
 * synchronously after the click and in each of the following frames, while Worker data keeps
 * arriving; any sample with the opposite state fails the test.
 */
type Sample = { checked: boolean; lifecycle: string };

/** Install the in-page helpers once per page. */
async function helpers(page: Page) {
  await page.evaluate(() => {
    const g = globalThis as any;
    const box = () => document.querySelector<HTMLInputElement>('[data-testid="follow"]')!;
    const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    /**
     * Run `act`, then sample the checkbox: synchronously (a click toggles a checkbox natively, so
     * React must agree before the event returns), after pending microtasks (React renders
     * updates from non-React events there, still before any paint), and in `frames` frames.
     */
    g.sampleAfter = async (act: () => void, frames = 6, synchronous = true) => {
      act();
      const out: Sample[] = [];
      if (synchronous) out.push({ checked: box().checked, lifecycle: g.faultlab.session.view.run.lifecycle });
      await Promise.resolve();
      out.push({ checked: box().checked, lifecycle: g.faultlab.session.view.run.lifecycle });
      for (let k = 0; k < frames; k++) {
        await nextFrame();
        out.push({ checked: box().checked, lifecycle: g.faultlab.session.view.run.lifecycle });
      }
      return out;
    };
    g.clickFollow = () => box().click();
  });
}

/** The synchronous sample applies to clicks on the checkbox itself; other actions are checked from the first microtask on. */
const samples = (page: Page, act: string, frames = 6, synchronous = act.includes('clickFollow')): Promise<Sample[]> =>
  page.evaluate(({ act, frames, synchronous }) => (globalThis as any).sampleAfter(new Function(act) as () => void, frames, synchronous), { act, frames, synchronous });
const all = (xs: Sample[], checked: boolean) => expect(xs.map((x) => x.checked), `every sample shows ${checked}`).toEqual(xs.map(() => checked));
const follow = (page: Page) => page.evaluate(() => (globalThis as any).faultlab.session.view.follow as boolean);

test('the follow-live checkbox shows the intended state immediately, in every situation', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await openPreset(page, 'raft-long-heartbeats');
  await helpers(page);

  // Ready (not running): uncheck and check.
  all(await samples(page, 'globalThis.clickFollow()'), false);
  all(await samples(page, 'globalThis.clickFollow()'), true);

  // While running (Worker chunks arrive every frame): uncheck, check, rapid toggling.
  await page.getByTestId('run').click();
  await page.waitForFunction(() => (globalThis as any).faultlab.session.view.length > 2_000);
  const running = await samples(page, 'globalThis.clickFollow()');
  all(running, false);
  expect(running.some((s) => s.lifecycle === 'running'), 'sampled while the run was streaming').toBe(true);
  all(await samples(page, 'globalThis.clickFollow()'), true);

  // Pause during the run (clicked in the page, so it lands while the run is still streaming).
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-testid="pause"]')!.click());
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'paused');
  all(await samples(page, ''), true);
  for (let k = 0; k < 7; k++) {
    // Seven clicks inside one task: the state after each click is the opposite of the previous one.
    const rapid = await page.evaluate(() => {
      const box = document.querySelector<HTMLInputElement>('[data-testid="follow"]')!;
      const seen: boolean[] = [];
      for (let i = 0; i < 7; i++) {
        box.click();
        seen.push(box.checked);
      }
      return seen;
    });
    expect(rapid).toEqual([false, true, false, true, false, true, false]);
    all(await samples(page, ''), false);
    all(await samples(page, 'globalThis.clickFollow()'), true);
  }

  // Keyboard shortcut F behaves the same.
  all(await samples(page, 'dispatchEvent(new KeyboardEvent("keydown", { key: "f" }))'), false);
  expect(await follow(page)).toBe(false);

  // Resuming does not change it.
  const resumed = await samples(page, 'document.querySelector(\'[data-testid="run"]\').click()');
  all(resumed, false);
  expect(resumed.some((s) => s.lifecycle === 'running'), 'sampled after resuming').toBe(true);

  // Switching views keeps it (the control is docked in every view).
  await page.getByTestId('mode-investigate').click();
  await expect(page.getByTestId('investigate')).toBeVisible();
  all(await samples(page, ''), false);
  all(await samples(page, 'globalThis.clickFollow()'), true);

  // Navigating to a historical event turns following off at once.
  const nav = await samples(page, 'document.querySelector(\'[data-testid="entries"] button\').click()');
  all(nav, false);
  await page.getByTestId('mode-simulate').click();
  all(await samples(page, ''), false);
  all(await samples(page, 'globalThis.clickFollow()'), true);
  // Dragging the cursor slider (a real input event on the range control) also turns it off at once.
  const slide = `const r = document.querySelector('[data-testid="cursor"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, '5');
    r.dispatchEvent(new Event('input', { bubbles: true }));`;
  all(await samples(page, slide), false);
  expect(await page.evaluate(() => (globalThis as any).faultlab.session.view.cursor)).toBe(5);

  // Switching runs: a newly loaded run follows its newest entry, without a flash of the old state.
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'completed', { timeout: 60_000 });
  // The next run is loaded through the Session, staying in Simulate so the checkbox stays mounted
  // for every sample. What is under test is the Session → React sync when one run replaces
  // another; Configure's own navigation is covered by configure.spec.ts.
  const next = PRESETS.find((p) => p.id === 'raft-isolate-leader')!;
  await page.evaluate((spec) => ((globalThis as any).nextSpec = spec), next.spec as unknown);
  all(await samples(page, 'globalThis.faultlab.session.load(globalThis.nextSpec, { id: "raft-isolate-leader", title: "switched run", summary: "", category: "education" })'), true);
  await expect(lifecycle(page)).toHaveAttribute('data-state', 'ready');
  all(await samples(page, 'globalThis.clickFollow()'), false);
  all(await samples(page, 'document.querySelector(\'[data-testid="restart"]\').click()'), true);
  expect(errors).toEqual([]);
});
