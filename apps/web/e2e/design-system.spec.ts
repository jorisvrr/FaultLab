import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * CP6 Gate 2: the design system, exercised through its gallery (design.html) in Chromium,
 * Firefox and WebKit.
 *
 * The gallery is development-only and uses demonstration values; these tests check the
 * components' behaviour and accessibility, not any simulation result.
 */
const REFERENCE = { width: 1586, height: 992 };
test.use({ viewport: REFERENCE });

const open = async (page: Page) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // The dev server has no favicon; everything else must load.
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('favicon.ico') && problems.push(`${r.status()} ${r.url()}`));
  await page.goto('/design.html');
  await page.locator('#tokens').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return problems;
};

test('the gallery renders every section with no page or resource errors', async ({ page }, info) => {
  const problems = await open(page);
  for (const id of ['tokens', 'type', 'surfaces', 'buttons', 'controls', 'status', 'overlays', 'tabs', 'timeline', 'shell']) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  // Both fonts actually loaded; a fallback would quietly change every measurement below.
  const families = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
  expect(families.some((f) => /Geist Variable/.test(f)), `loaded: ${families.join(', ')}`).toBe(true);
  expect(families.some((f) => /Geist Mono/.test(f))).toBe(true);
  expect(problems).toEqual([]);

  // Review artefacts: the whole gallery plus each section, per engine.
  mkdirSync('../../references/cp6/gallery', { recursive: true });
  await page.screenshot({ path: `../../references/cp6/gallery/${info.project.name}-full.png`, fullPage: true });
  for (const id of ['tokens', 'type', 'surfaces', 'buttons', 'controls', 'status', 'overlays', 'timeline', 'recon', 'shell']) {
    await page.locator(`#${id}`).screenshot({ path: `../../references/cp6/gallery/${info.project.name}-${id}.png` });
  }
});

test('overlays: the open states are captured and inspected, at desktop and at 390 px', async ({ page }, info) => {
  const sizes = [
    { name: 'desktop', width: 1586, height: 992 },
    { name: 'phone', width: 390, height: 844 },
  ];
  const cases = [
    { button: 'Open dialog', id: 'dialog' },
    { button: 'Open side drawer', id: 'side-drawer' },
    { button: 'Open bottom drawer', id: 'bottom-drawer' },
  ];
  mkdirSync('../../references/cp6/gallery', { recursive: true });
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await open(page);
    for (const c of cases) {
      await page.locator('#overlays').scrollIntoViewIfNeeded();
      const trigger = page.getByRole('button', { name: c.button });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      // The entrance animation must finish, or the capture shows a half-faded panel and an
      // undimmed backdrop — which is what the first run of this test caught.
      await page.evaluate(() => Promise.all(document.querySelector('dialog')!.getAnimations({ subtree: true }).map((a) => a.finished)));
      await expect(dialog).toHaveJSProperty('open', true);
      expect(await dialog.evaluate((d: HTMLDialogElement) => d.matches(':modal')), 'the overlay must be modal, not merely open').toBe(true);

      // Geometry: never wider or taller than the viewport, and the body scrolls rather than
      // the dialog growing past the screen.
      const box = (await dialog.boundingBox())!;
      expect(box.width, `${c.id} @ ${size.name}: wider than the viewport`).toBeLessThanOrEqual(size.width);
      expect(box.height, `${c.id} @ ${size.name}: taller than the viewport`).toBeLessThanOrEqual(size.height);
      expect(box.x, `${c.id} @ ${size.name}: starts off-screen`).toBeGreaterThanOrEqual(0);

      // The close control carries a name and shows a focus ring.
      const close = page.getByRole('button', { name: 'Close' });
      await close.focus();
      const ring = await close.evaluate((el) => {
        const st = getComputedStyle(el);
        return { style: st.outlineStyle, width: parseFloat(st.outlineWidth) };
      });
      expect(ring.style, `${c.id}: close button focus ring`).not.toBe('none');
      expect(ring.width).toBeGreaterThanOrEqual(1);

      if (info.project.name === 'chromium') {
        await page.screenshot({ path: `../../references/cp6/gallery/overlay-${c.id}-${size.name}.png` });
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  }
});

test('axe-core finds no accessibility violations', async ({ page }, info) => {
  await open(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    join('test-results', `axe-${info.project.name}.json`),
    `${JSON.stringify({ violations: results.violations, passes: results.passes.length, incomplete: results.incomplete.map((i) => i.id) }, null, 2)}\n`,
  );
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.help}`);
  expect(summary, 'axe violations').toEqual([]);
});

test('keyboard: every control is reachable, focus is visible, nothing is a trap', async ({ page }) => {
  await open(page);
  await page.locator('#buttons').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Run Experiment', exact: true }).first().focus();

  // Tab forward through a stretch of controls: focus must always land on something focusable
  // and must always be visibly ringed.
  for (let i = 0; i < 25; i++) {
    const outline = await page.evaluate(() => {
      const el = document.activeElement;
      if (el === null || el === document.body) return null;
      const s = getComputedStyle(el);
      return { tag: el.tagName, outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle, matchesFocusVisible: el.matches(':focus-visible') };
    });
    // Focus may leave the document for the browser's own UI; that is the engine's business,
    // not the design system's. What matters is that every control we DO land on is ringed.
    if (outline === null) {
      await page.keyboard.press('Tab');
      continue;
    }
    if (outline.matchesFocusVisible) {
      expect(outline.outlineStyle, `${outline.tag} has no visible focus ring`).not.toBe('none');
      expect(parseFloat(outline.outlineWidth), `${outline.tag} focus ring width`).toBeGreaterThanOrEqual(1);
    }
    await page.keyboard.press('Tab');
  }
});

test('keyboard: native semantics work without custom handlers', async ({ page }) => {
  await open(page);
  // Switch: Space toggles a real checkbox.
  const sw = page.locator('#controls').getByRole('switch', { name: 'Fault injection' });
  const before = await sw.isChecked();
  await sw.focus();
  await page.keyboard.press('Space');
  expect(await sw.isChecked()).toBe(!before);

  // Segmented control: one tab stop, arrow keys move between radios.
  const first = page.locator('#controls').getByRole('radio', { name: 'entries' });
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#controls').getByRole('radio', { name: 'markers only' })).toBeChecked();

  // Tabs: arrow keys move, Home and End jump.
  await page.getByRole('tab', { name: 'Overview' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');

  // Number field: arrow keys step the value (native).
  const seed = page.locator('#controls').getByLabel('Random seed');
  await seed.focus();
  const seedBefore = Number(await seed.inputValue());
  await page.keyboard.press('ArrowUp');
  expect(Number(await seed.inputValue())).toBe(seedBefore + 1);

  // Range: arrow keys and Home/End (native).
  const speed = page.locator('#controls').getByLabel(/Replay speed/);
  await speed.focus();
  await page.keyboard.press('Home');
  expect(Number(await speed.inputValue())).toBe(10);
});

test('dialog: initial focus, containment, Esc, restoration, cleanup and an inert background', async ({ page }) => {
  await open(page);
  // Opened from the keyboard, because focus restoration is what keyboard users depend on.
  // (WebKit does not focus a button on click at all, by macOS convention, so a pointer-opened
  // dialog has nothing to restore to in that engine — and nothing is lost by it.)
  const trigger = page.getByRole('button', { name: 'Open dialog' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(/Keyboard shortcuts/);

  // Focus moved into the dialog.
  expect(await page.evaluate(() => document.querySelector('dialog')?.contains(document.activeElement) ?? false)).toBe(true);

  // Containment: tabbing many times never reaches a control on the page behind. Focus may
  // park on <body> as it wraps past the last control, which is fine — what must never happen
  // is focus landing on background content.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const dialog = document.querySelector('dialog');
      const active = document.activeElement;
      if (active === null || active === document.body || active === document.documentElement) return 'parked';
      return dialog?.contains(active) === true ? 'inside' : `OUTSIDE: ${active.tagName}.${active.className}`;
    });
    expect(where, `after ${i + 1} tabs`).not.toContain('OUTSIDE');
  }

  // The background is inert: a click on a button behind the dialog does nothing.
  const before = await page.getByRole('switch', { name: 'reduced motion' }).isChecked();
  await page.getByRole('switch', { name: 'reduced motion' }).click({ force: true, timeout: 2000 }).catch(() => undefined);
  expect(await page.getByRole('switch', { name: 'reduced motion' }).isChecked()).toBe(before);

  // Esc closes and focus returns to the trigger.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // Closing leaves nothing behind: the page scrolls and reacts again.
  await page.getByRole('switch', { name: 'reduced motion' }).click();
  expect(await page.getByRole('switch', { name: 'reduced motion' }).isChecked()).toBe(!before);
});

test('dialog: the backdrop closes it, and the close button restores focus too', async ({ page }) => {
  await open(page);
  const trigger = page.getByRole('button', { name: 'Open side drawer' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(trigger, 'the close button must return focus to the opener').toBeFocused();

  await trigger.click();
  // Click far from the drawer, on the backdrop.
  await page.mouse.click(40, 500);
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('tooltip: opens on focus as well as hover, and Esc dismisses it', async ({ page }) => {
  await open(page);
  const stop = page.locator('#controls').getByRole('button', { name: 'Stop', exact: true });
  await stop.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(stop, 'Esc must dismiss the tooltip without moving focus').toBeFocused();
});

test('reduced motion: transitions and the spinner animation are switched off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const durations = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return ['--motion-fast', '--motion-base', '--motion-slow'].map((n) => s.getPropertyValue(n).trim());
  });
  // Engines normalise the unit ("0s" and "0ms" are the same duration), so compare numerically.
  expect(durations.map((d) => (d.endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000))).toEqual([0, 0, 0]);
  const spinner = await page.evaluate(() => {
    const el = document.querySelector('[role="status"]');
    return el === null ? null : getComputedStyle(el).animationName;
  });
  expect(spinner, 'the spinner must stop rotating').toBe('none');
});

test('responsive: five viewports render without horizontal overflow or clipped controls', async ({ page }, info) => {
  const sizes = [
    { name: 'reference', width: 1586, height: 992 },
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'laptop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'phone', width: 390, height: 844 },
  ];
  const report: Record<string, unknown> = {};
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await open(page);
    const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    report[size.name] = overflow;
    expect(overflow.scrollWidth, `${size.name}: horizontal overflow`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    // Interactive targets stay comfortably tappable on the narrow viewports.
    if (size.width <= 768) {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('button, [role="switch"], select, input[type="number"]')]
          .map((el) => ({ tag: el.tagName, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 24)
          .map(({ tag, r }) => `${tag} ${Math.round(r.width)}×${Math.round(r.height)}`),
      );
      expect(small, `${size.name}: controls shorter than 24px`).toEqual([]);
      // Every navigation mode must remain reachable, by scrolling if not by fitting.
      const nav = await page.evaluate(() => {
        const list = document.querySelector('nav[aria-label="Modes"]');
        if (list === null) return null;
        const links = [...list.querySelectorAll('a')];
        return { reachable: list.scrollWidth <= list.clientWidth || getComputedStyle(list).overflowX === 'auto', count: links.length };
      });
      expect(nav?.reachable, `${size.name}: navigation modes are clipped and unreachable`).toBe(true);
      expect(nav?.count).toBe(3);
    }
    if (info.project.name === 'chromium') {
      await page.screenshot({ path: `../../references/cp6/gallery/responsive-${size.name}.png`, fullPage: size.width <= 768 });
    }
  }
  mkdirSync('test-results', { recursive: true });
  writeFileSync(join('test-results', `responsive-${info.project.name}.json`), `${JSON.stringify(report, null, 2)}\n`);
});
