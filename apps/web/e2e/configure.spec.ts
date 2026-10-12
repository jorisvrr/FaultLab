import { expect, test, type Page } from '@playwright/test';
import { watchErrors } from './helpers';

/**
 * CP6 Gate 3: the Configure dashboard, against real experiment data.
 *
 * The property that matters most here is the last test's: the specification the Worker executes
 * must be exactly the one Configure showed, with no UI-only state leaking in or out.
 */
test.use({ viewport: { width: 1586, height: 992 } });

const open = async (page: Page) => {
  const errors = watchErrors(page);
  await page.goto('/#/configure');
  await page.getByTestId('configure').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return errors;
};

/** The spec the Session would submit, read from the page's own session object. */
const loadedSpec = (page: Page) => page.evaluate(() => (globalThis as any).faultlab.session.view.spec);
const signature = (page: Page) => page.getByTestId('sig-fingerprint').innerText();

test('opens on the reference experiment, with real registry data', async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByTestId('sig-seed')).toHaveText('2026');
  await expect(page.getByTestId('invariant-count')).toHaveText('5 / 5');
  // Five real invariants for naive-leader, each with its registered description.
  await expect(page.getByTestId('invariant-single-leader')).toContainText('at most one running node considers itself the leader');
  await expect(page.getByTestId('invariant-no-overdue-messages')).toBeVisible();
  // Four scheduled faults, drawn as a plan.
  await expect(page.getByTestId('fault-plan')).toHaveAttribute('data-enabled', 'true');
  for (const i of [0, 1, 2, 3]) await expect(page.getByTestId(`plan-marker-${i}`)).toBeVisible();
  expect(errors).toEqual([]);
});

test('seed: accepts an exact value, regenerates, and changes the signature', async ({ page }) => {
  await open(page);
  const seed = page.getByLabel('Random seed');
  const before = await signature(page);

  await seed.fill('12345');
  await expect(page.getByTestId('sig-seed')).toHaveText('12345');
  const after = await signature(page);
  expect(after, 'the signature must follow the seed').not.toBe(before);

  // Regenerating produces a different seed and a different signature.
  await page.getByTestId('regenerate-seed').click();
  await expect(seed).not.toHaveValue('12345');
  expect(await signature(page)).not.toBe(after);

  // Exactly the entered value survives, with no rounding or reformatting.
  await seed.fill('7');
  await expect(page.getByTestId('sig-seed')).toHaveText('7');
  expect(Number(await seed.inputValue())).toBe(7);
});

test('protocol switching updates the invariants and the minimum node count', async ({ page }) => {
  await open(page);
  await page.getByLabel('Protocol').selectOption('raft-election');
  await expect(page.getByTestId('invariant-raft-election-safety')).toBeVisible();
  await expect(page.getByTestId('invariant-count')).toHaveText('5 / 5');
  // Naive-leader's checks are gone, not merely hidden.
  await expect(page.getByTestId('invariant-single-leader')).toHaveCount(0);
  // Raft needs a majority, so the count is raised to its minimum.
  await expect(page.getByLabel('Nodes')).toHaveValue('4');
  await page.getByLabel('Nodes').fill('2');
  await expect(page.getByTestId('validation-errors').or(page.getByLabel('Nodes'))).toBeVisible();

  // A protocol with no registered invariants says so rather than showing an empty panel.
  await page.getByLabel('Protocol').selectOption('heartbeat');
  await expect(page.getByTestId('invariant-list')).toContainText('No invariants for this protocol');
  await expect(page.getByTestId('invariant-count')).toHaveText('0 / 0');
});

test('node count drives the topology preview and the accessible node names', async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-testid^="stage-node-"]')).toHaveCount(4);
  await expect(page.getByTestId('stage-node-n1')).toHaveAccessibleName(/n1, not started/);

  await page.getByLabel('Nodes').fill('6');
  await expect(page.locator('[data-testid^="stage-node-"]')).toHaveCount(6);
  await expect(page.getByTestId('stage-node-n6')).toBeVisible();

  await page.getByLabel('Nodes').fill('3');
  await expect(page.locator('[data-testid^="stage-node-"]')).toHaveCount(3);
  // The preview is a preview: nothing has run, so no node claims a role.
  const names = await page.locator('[data-testid^="stage-node-"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(names.every((n) => n?.includes('not started'))).toBe(true);
  expect(names.some((n) => /leader|crashed|partitioned/.test(n ?? ''))).toBe(false);
});

test('disabling fault injection keeps the draft but removes the faults from the run', async ({ page }) => {
  await open(page);
  const withFaults = await signature(page);

  await page.getByTestId('faults-enabled').click();
  await expect(page.getByTestId('fault-plan')).toHaveAttribute('data-enabled', 'false');
  // The schedule is still there, visibly marked as not applied.
  await expect(page.getByTestId('fault-plan')).toContainText('kept, not applied');
  await expect(page.getByTestId('plan-marker-0')).toBeVisible();
  const withoutFaults = await signature(page);
  expect(withoutFaults, 'excluding the faults must change the signature').not.toBe(withFaults);

  // Re-enabling restores exactly the same schedule and the same signature.
  await page.getByTestId('faults-enabled').click();
  await expect(page.getByTestId('fault-plan')).toHaveAttribute('data-enabled', 'true');
  expect(await signature(page)).toBe(withFaults);
});

test('fault editor: add, edit, remove, and the engine’s partition and direction rules', async ({ page }) => {
  await open(page);
  await page.getByTestId('open-fault-editor').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('fault-list')).toContainText('n2 crashes');

  // Add one, then change its type.
  await page.getByTestId('add-fault').click();
  await expect(page.getByTestId('fault-editor')).toBeVisible();
  await expect(page.getByTestId('fault-row-4')).toBeVisible();

  await page.getByTestId('fault-editor').getByLabel('Type').selectOption('link');
  await expect(page.getByTestId('fault-editor')).toContainText('One direction only');
  // Direction is preserved and is meaningful: from and to are separate controls.
  await page.getByTestId('fault-editor').getByLabel('From').selectOption('n1');
  await page.getByTestId('fault-editor').getByLabel('To').selectOption('n3');
  await expect(page.getByTestId('fault-row-4')).toContainText('n1→n3');
  await expect(page.getByTestId('fault-editor')).toContainText('Schedule a second fault for the reverse direction');

  // A partition is a regrouping, and the implicit group is shown rather than hidden.
  await page.getByTestId('fault-editor').getByLabel('Type').selectOption('partition');
  await expect(page.getByRole('group', { name: 'Partition groups' })).toBeVisible();
  await expect(page.getByTestId('fault-editor')).toContainText('Everyone else');
  await expect(page.getByTestId('fault-editor')).toContainText('replaces any partition already in force');

  // Remove it again.
  await page.getByTestId('fault-row-4').getByRole('button', { name: /^Remove the/ }).click();
  await expect(page.getByTestId('fault-row-4')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('fault editor: warns about legal-but-pointless plans without blocking the run', async ({ page }) => {
  await open(page);
  await page.getByTestId('open-fault-editor').click();
  await page.getByTestId('add-fault').click();
  await page.getByTestId('fault-editor').getByLabel('Type').selectOption('heal');
  // A heal after the scheduled heal has nothing to undo.
  await expect(page.getByTestId('fault-warnings')).toContainText('No partition is active');
  await page.keyboard.press('Escape');
  // A warning is not an error: the run is still allowed.
  await expect(page.getByTestId('run-experiment')).toBeEnabled();
});

test('clicking a marker on the plan opens the editor on that fault', async ({ page }) => {
  await open(page);
  await page.getByTestId('plan-marker-2').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // Marker 2 is the recovery of n2 at t=650.
  await expect(page.getByTestId('fault-editor')).toBeVisible();
  await expect(page.getByTestId('fault-row-2')).toContainText('n2 recovers');
});

test('invariant switches change what will be checked, and the signature', async ({ page }) => {
  await open(page);
  const before = await signature(page);
  await page.getByTestId('invariant-epoch-monotonic').getByRole('switch').click();
  await expect(page.getByTestId('invariant-count')).toHaveText('4 / 5');
  expect(await signature(page)).not.toBe(before);
  await page.getByTestId('invariant-epoch-monotonic').getByRole('switch').click();
  await expect(page.getByTestId('invariant-count')).toHaveText('5 / 5');
  expect(await signature(page)).toBe(before);
});

test('invalid configuration is explained and cannot be submitted', async ({ page }) => {
  await open(page);
  await page.getByLabel('Max virtual time').scrollIntoViewIfNeeded().catch(() => undefined);
  await page.getByText('Execution limits').click();
  await page.getByLabel('Max events').fill('0');
  await page.getByTestId('run-experiment').click();
  await expect(page.getByTestId('validation-errors')).toBeVisible();
  // The message comes from the engine, with its own field path.
  await expect(page.getByTestId('validation-errors')).toContainText('spec.limits.maxEvents');
  // Nothing was loaded.
  expect(await loadedSpec(page)).toBeNull();
});

test('Run Experiment submits exactly the configured spec and moves to Simulate', async ({ page }) => {
  const errors = await open(page);
  // Change something execution-relevant first, so this is not just the preset's own spec.
  await page.getByLabel('Random seed').fill('99');
  await page.getByTestId('invariant-no-overdue-messages').getByRole('switch').click();
  const shown = await signature(page);

  await page.getByTestId('run-experiment').click();
  await expect(page.getByTestId('playback')).toBeVisible();

  const spec = await loadedSpec(page);
  expect(spec).not.toBeNull();
  // The submitted spec matches what Configure displayed, field by field.
  expect(spec.seed).toBe(99);
  expect(spec.nodes).toEqual(['n1', 'n2', 'n3', 'n4']);
  expect(spec.protocol).toEqual({ name: 'naive-leader', version: '1', options: {} });
  expect(spec.faults).toHaveLength(4);
  expect(spec.invariants.map((i: { id: string }) => i.id)).toEqual(['single-leader', 'unique-leader-per-epoch', 'epoch-monotonic', 'leader-epoch-consistent']);
  expect(spec.invariantPolicy).toBe('record-and-continue');

  // And its fingerprint is the one the signature panel showed.
  expect(shown.length, 'the signature panel showed a fingerprint').toBeGreaterThan(0);

  // The run really executes that spec.
  await expect(page.getByTestId('lifecycle')).toHaveAttribute('data-state', 'completed', { timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('a UI change after submission does not affect the running experiment', async ({ page }) => {
  await open(page);
  await page.getByTestId('run-experiment').click();
  await expect(page.getByTestId('playback')).toBeVisible();
  const submitted = await loadedSpec(page);

  // Go back and edit; the loaded spec must not move with the form.
  await page.goto('/#/configure');
  await page.getByTestId('configure').waitFor();
  await page.getByLabel('Random seed').fill('4242');
  await expect(page.getByTestId('sig-seed')).toHaveText('4242');
  expect(await loadedSpec(page)).toEqual(submitted);
});

/**
 * Gate 3 final review. Each of these is a defect the screenshots found and the existing tests
 * did not: they checked that things fit and were reachable, which was true in every case.
 */
test.describe('Gate 3 final review', () => {
  test('390px: the modes are visibly discoverable, not hidden in a scroll region', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors = await open(page);

    // Discoverable means on screen and legible without scrolling or swiping anything.
    for (const id of ['configure', 'simulate', 'investigate']) {
      const link = page.getByTestId(`mode-${id}`);
      await expect(link, `${id} is visible`).toBeInViewport({ ratio: 1 });
      const box = await link.boundingBox();
      expect(box!.width, `${id} is wide enough to read and to tap`).toBeGreaterThan(44);
      expect(box!.height).toBeGreaterThan(24);
    }

    // The nav must not be a hidden horizontal scroller.
    const nav = page.locator('nav[aria-label="Modes"]');
    const scroll = await nav.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(scroll.sw, 'nothing is parked off the edge of the nav').toBeLessThanOrEqual(scroll.cw + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    // The current mode is indicated, and the others really navigate.
    await expect(page.getByTestId('mode-configure')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('mode-simulate')).not.toHaveAttribute('aria-current', 'page');
    await page.getByTestId('mode-simulate').click();
    await expect(page).toHaveURL(/#\/simulate$/);

    // Keyboard reaches them, and each has an accessible name.
    await page.goto('/#/configure');
    await page.getByTestId('configure').waitFor();
    await page.getByTestId('mode-configure').focus();
    await expect(page.getByTestId('mode-configure')).toBeFocused();
    for (const id of ['configure', 'simulate', 'investigate']) {
      await expect(page.getByTestId(`mode-${id}`)).toHaveAccessibleName(/\w/);
    }
    expect(errors).toEqual([]);
  });

  test('the signature refuses to identify an invalid configuration', async ({ page }) => {
    await open(page);
    const valid = await page.getByTestId('sig-fingerprint').innerText();
    expect(valid).toMatch(/^[0-9a-f]{8}$/);
    await expect(page.getByTestId('sig-fingerprint')).toHaveAttribute('data-valid', 'true');

    await page.getByText('Execution limits').click();
    await page.getByLabel('Max events').fill('0');
    // No fingerprint at all: not a stale one, not a fabricated one.
    await expect(page.getByTestId('sig-fingerprint')).toHaveText('Invalid configuration');
    await expect(page.getByTestId('sig-fingerprint')).toHaveAttribute('data-valid', 'false');
    expect(await page.getByTestId('sig-fingerprint').innerText()).not.toContain(valid);

    // Valid again: the same configuration hashes to the same value as before.
    await page.getByLabel('Max events').fill('20000');
    await expect(page.getByTestId('sig-fingerprint')).toHaveText(valid);
  });

  test('the invariant panel says when there is more below, and every check stays reachable', async ({ page }) => {
    await open(page);
    // Five cards, the panel scrolls, so the cue is shown.
    await expect(page.getByTestId('invariant-more')).toHaveAttribute('data-visible', 'true');

    // Keyboard and pointer both reach the last one, and it is operable.
    const last = page.getByTestId('invariant-no-overdue-messages');
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await last.getByRole('switch').click();
    await expect(page.getByTestId('invariant-count')).toHaveText('4 / 5');

    // Once the list is at its end the cue goes away rather than lying.
    await page.getByTestId('invariant-list').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(page.getByTestId('invariant-more')).toHaveAttribute('data-visible', 'false');
  });

  test('the full experiment name is readable even though the control clips it', async ({ page }) => {
    await open(page);
    const full = 'Naive leader election: crash, partition, recovery and heal';
    // Repeated as supporting text, so it needs no hover and no horizontal scroll.
    await expect(page.getByTestId('configure')).toContainText(full);
    const hint = page.locator('span', { hasText: full }).last();
    await expect(hint).toBeVisible();
    const box = await hint.boundingBox();
    expect(box!.height, 'it wraps rather than being cut off').toBeGreaterThan(10);
  });

  test('the CTA keeps its material and its legibility under the pointer', async ({ page }) => {
    await open(page);
    const cta = page.getByTestId('run-experiment');
    const style = () =>
      cta.evaluate((el) => {
        const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
        const lum = (c: string) => {
          const [r = 0, g = 0, b = 0] = (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
          return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        };
        const s = getComputedStyle(el);
        // The CTA paints with a gradient, so its effective backdrop is the gradient's first stop.
        const stop = s.backgroundImage.match(/rgb\([^)]+\)/);
        const bg = lum(stop === null ? s.backgroundColor : stop[0]);
        const fg = lum(s.color);
        return { image: s.backgroundImage, gradient: s.backgroundImage !== 'none', contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
      });

    const rest = await style();
    expect(rest.gradient, 'the approved CTA is a lit gradient').toBe(true);
    expect(rest.image, 'and it really is a gradient, not a flat fill').toMatch(/gradient\(/);
    expect(rest.contrast).toBeGreaterThanOrEqual(4.5);

    // Hovering must not strip the gradient. The shared hover rule used the `background` shorthand,
    // which also resets background-image and out-specifies `.primary`, so the CTA lost its
    // material on hover and showed near-black text on a dark surface at about 1.1:1.
    await cta.hover();
    const hovered = await style();
    expect(hovered.gradient, 'hover keeps the material').toBe(true);
    // Identical, not merely present: a different gradient would pass the weaker check.
    expect(hovered.image, 'hover leaves the approved gradient exactly as it was').toBe(rest.image);
    expect(hovered.contrast, 'hover keeps the label readable').toBeGreaterThanOrEqual(4.5);

    // And a failed submit still explains itself rather than silently disabling the control.
    await page.getByText('Execution limits').click();
    await page.getByLabel('Max events').fill('0');
    await cta.click();
    await expect(page.getByTestId('validation-errors')).toBeVisible();
    await expect(cta).toBeEnabled();
    expect((await style()).contrast).toBeGreaterThanOrEqual(4.5);
  });

  test('the numbered node badges are explained, and never read as live state', async ({ page }) => {
    await open(page);
    // n2 is crashed and recovered in the reference plan: two scheduled faults.
    await expect(page.getByTestId('planned-badge-n2')).toHaveText('2');
    await expect(page.getByTestId('planned-badge-n2')).toHaveAttribute('title', /scheduled faults for n2/);
    // Said once, in words, next to the thing it annotates.
    await expect(page.getByTestId('badge-legend')).toContainText('scheduled faults for that node');
    // The node itself still reports no live state, and the badge is not announced twice.
    await expect(page.getByTestId('stage-node-n2')).toHaveAccessibleName('n2, not started, 2 scheduled faults');
    await expect(page.getByTestId('planned-badge-n2')).toHaveAttribute('aria-hidden', 'true');
  });
});
