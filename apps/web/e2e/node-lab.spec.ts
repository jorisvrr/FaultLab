import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { watchErrors } from './helpers';

/**
 * CP6 Gate 1: the sculptural node prototype (node-lab.html), in Chromium, Firefox and WebKit.
 * Rendering architecture (ADR-0025), interaction, fallback tiers and measurements. Results are
 * written to test-results/node-lab-<browser>.json and summarised in docs/CP6_GATE1_NODE.md.
 */
test.use({ viewport: { width: 1586, height: 992 } });

type Metrics = { tier: string; dpr: number; frames: number; drawCalls: number; triangles: number; programs: number; geometries: number; textures: number; cpuMs: number; gpuMs: number | null; firstRenderMs: number | null; contextLost: number };
const metrics = (page: Page) =>
  page.evaluate(() => {
    const { requestFrame: _, ...m } = (globalThis as any).nodeLab.metrics;
    return m as Metrics;
  });
const lab = (page: Page, fn: string) => page.evaluate((src) => new Function('lab', src)((globalThis as any).nodeLab), fn);
const rendered = (page: Page) => page.waitForFunction(() => (globalThis as any).nodeLab?.metrics.frames > 0, null, { timeout: 20_000 });
const settle = async (page: Page) => {
  // Wait until two consecutive reads, 300 ms apart, see the same frame count (transitions done).
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const { frames } = await metrics(page);
    if (frames === last) return frames;
    last = frames;
    await page.waitForTimeout(300);
  }
  throw new Error('the stage never became idle');
};

test('one WebGL context, two draw calls, the 3D chunk only where a stage is shown', async ({ page }) => {
  const errors = watchErrors(page);
  const chunks: string[] = [];
  page.on('request', (r) => r.url().includes('NodeCanvas') && chunks.push(r.url()));
  // Simulate keeps its CP5 presentation and shows no stage, so it must not pay for three.js.
  // (Before Gate 3 no screen had a stage at all; Configure's topology preview is the first.)
  await page.goto('/#/simulate');
  await expect(page.getByTestId('playback')).toBeVisible();
  expect(chunks, 'a screen with no stage does not download the 3D chunk').toEqual([]);

  // Configure does show a stage, so the chunk arrives there — lazily, and only then.
  await page.goto('/#/configure');
  await page.getByTestId('configure').waitFor();
  await expect.poll(() => chunks.length, { message: 'Configure loads the 3D chunk lazily' }).toBe(1);

  await page.goto('/node-lab.html?scene=states-warm');
  await rendered(page);
  expect(await page.locator('canvas').count()).toBe(1);
  for (const scene of ['investigate-ref', 'simulate-ref', 'scale-20']) {
    await lab(page, `lab.setScene('${scene}')`);
    await settle(page);
    const m = await metrics(page);
    expect(m.drawCalls, `${scene}: bodies + auras, whatever the node count`).toBe(2);
    expect([m.programs, m.geometries, m.textures], 'shared programs and geometries, no textures').toEqual([2, 2, 0]);
  }
  expect(await page.locator('canvas').count(), 'scene changes reuse the context').toBe(1);
  expect(errors).toEqual([]);
});

test('an idle stage renders nothing; transitions render until they settle, then stop', async ({ page }) => {
  await page.goto('/node-lab.html?scene=simulate-ref');
  await rendered(page);
  const idle = await settle(page);
  await page.waitForTimeout(1_500);
  expect((await metrics(page)).frames, 'no frames while nothing changes').toBe(idle);

  // Hover: a short transition (≈ 0.09 s time constant) renders a handful of frames, then stops.
  await page.getByTestId('stage-node-n2').hover();
  const afterHover = await settle(page);
  expect(afterHover - idle).toBeGreaterThan(3);
  expect(afterHover - idle).toBeLessThan(90);
  await expect(page.getByTestId('stage-node-n2')).toHaveCSS('cursor', 'pointer');

  // Selection by click and by keyboard; focus is a real DOM button with a name.
  await page.getByTestId('stage-node-n2').click();
  await expect(page.getByTestId('stage-node-n2')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('stage-node-n3').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('stage-node-n3')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('stage-node-n2')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('stage-node-n3')).toHaveAccessibleName(/n3, follower/);

  // Interrupting a transition midway (select, then deselect within one frame) settles cleanly.
  await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>('[data-testid="stage-node-n1"]')!;
    b.click();
    requestAnimationFrame(() => b.click());
  });
  await settle(page);
  await expect(page.getByTestId('stage-node-n1')).toHaveAttribute('aria-pressed', 'false');
});

test('reduced motion: state changes are instantaneous (one frame, no transition)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/node-lab.html?scene=simulate-ref');
  await rendered(page);
  const idle = await settle(page);
  await page.getByTestId('stage-node-n1').click();
  const after = await settle(page);
  expect(after - idle, 'at most a couple of frames for hover + selection').toBeLessThanOrEqual(3);
});

test('fallback tiers: reduced 3D and flat (no WebGL) show the same nodes and states', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/node-lab.html?scene=states-warm&tier=reduced');
  await rendered(page);
  const reduced = await metrics(page);
  expect([reduced.tier, reduced.dpr, reduced.drawCalls]).toEqual(['reduced', 1, 2]);

  const chunks: string[] = [];
  page.on('request', (r) => r.url().includes('NodeCanvas') && chunks.push(r.url()));
  await page.goto('/node-lab.html?scene=states-warm&tier=flat');
  await expect(page.getByTestId('stage-flat')).toBeVisible();
  expect(await page.locator('canvas').count()).toBe(0);
  expect(chunks, 'the flat tier never downloads three.js').toEqual([]);
  await expect(page.locator('[data-testid="stage-flat"] g[data-node]')).toHaveCount(14);
  // The DOM layer (names, focus, selection) is identical in every tier.
  await expect(page.getByTestId('stage-node-s10'), 'the sheet pre-selects s10 to show the selected state').toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('stage-node-s2')).toHaveAccessibleName('s2, follower');
  await page.getByTestId('stage-node-s2').click();
  await expect(page.getByTestId('stage-node-s2'), 'selecting works without WebGL').toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('stage-node-s2').click();
  await expect(page.getByTestId('stage-node-s2')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('stage-node-s6')).toHaveAccessibleName('s6, crashed');
  await expect(page.getByTestId('stage-node-s13')).toHaveAccessibleName('s13, crashed, partitioned');
  expect(errors).toEqual([]);
});

test('a lost WebGL context falls back to the flat tier and recovers; unmounting releases the context', async ({ page }) => {
  await page.goto('/node-lab.html?scene=simulate-ref');
  await rendered(page);
  await page.evaluate(() => ((globalThis as any).lose = document.querySelector('canvas')!.getContext('webgl2')!.getExtension('WEBGL_lose_context')));
  await page.evaluate(() => (globalThis as any).lose.loseContext());
  await expect(page.getByTestId('stage')).toHaveAttribute('data-context-lost', 'true');
  await expect(page.getByTestId('stage-flat')).toBeVisible();
  const before = (await metrics(page)).frames;
  await page.evaluate(() => (globalThis as any).lose.restoreContext());
  await expect(page.getByTestId('stage')).toHaveAttribute('data-context-lost', 'false');
  await page.getByTestId('stage-node-n1').hover();
  await expect.poll(async () => (await metrics(page)).frames).toBeGreaterThan(before);
  expect((await metrics(page)).contextLost).toBe(1);

  // Switching to the flat tier unmounts the canvas; its context is released (not leaked).
  await page.evaluate(() => ((globalThis as any).oldCanvas = document.querySelector('canvas')));
  await lab(page, `lab.setTier('flat')`);
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as any).oldCanvas.getContext('webgl2')?.isContextLost() ?? true)).toBe(true);
});

test('measurements: shader compile, CPU/GPU frame time, 1 / 5 / 20 nodes, full and reduced tiers', async ({ page }, info) => {
  test.setTimeout(180_000);
  const results: Record<string, unknown> = {};
  for (const tier of ['full', 'reduced']) {
    await page.goto(`/node-lab.html?scene=scale-1&tier=${tier}&chrome=0`);
    await rendered(page);
    results[`${tier}/firstRenderMs (incl. shader compile)`] = Math.round((await metrics(page)).firstRenderMs ?? -1);
    for (const n of [1, 5, 20]) {
      await lab(page, `lab.setScene('scale-${n}')`);
      await settle(page);
      // Force 180 consecutive frames (the stage normally renders only on change).
      const run = await page.evaluate(async () => {
        const m = (globalThis as any).nodeLab.metrics;
        const cpu: number[] = [];
        const gpu: number[] = [];
        const gaps: number[] = [];
        let last = performance.now();
        for (let i = 0; i < 180; i++) {
          m.requestFrame();
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
          await new Promise<void>((r) => setTimeout(r, 0));
          const now = performance.now();
          gaps.push(now - last);
          last = now;
          cpu.push(m.cpuMs);
          if (m.gpuMs !== null) gpu.push(m.gpuMs);
        }
        const q = (xs: number[], p: number) => {
          const s = [...xs].sort((a, b) => a - b);
          return s.length === 0 ? null : Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]! * 100) / 100;
        };
        return { cpuP50: q(cpu, 0.5), cpuP95: q(cpu, 0.95), gpuP50: q(gpu, 0.5), gpuP95: q(gpu, 0.95), frameGapP50: q(gaps, 0.5), frameGapP95: q(gaps, 0.95), drawCalls: m.drawCalls, triangles: m.triangles, dpr: m.dpr };
      });
      results[`${tier}/${n} nodes`] = run;
      expect(run.drawCalls).toBe(2);
      expect(run.cpuP95!, `${tier}, ${n} nodes: CPU per frame`).toBeLessThan(8);
    }
  }
  // Idle: no frames for 2 s; repeated scene / tier switches leave no extra GPU resources.
  const idle = await settle(page);
  await page.waitForTimeout(2_000);
  results['idleFramesIn2s'] = (await metrics(page)).frames - idle;
  for (let i = 0; i < 5; i++) for (const s of ['scale-20', 'states-warm', 'investigate-ref']) await lab(page, `lab.setScene('${s}')`);
  await settle(page);
  const after = await metrics(page);
  results['resourcesAfter15SceneSwitches'] = { programs: after.programs, geometries: after.geometries, textures: after.textures };
  results['heapMB'] = await page.evaluate(() => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return memory === undefined ? null : Math.round(memory.usedJSHeapSize / 1e5) / 10;
  });
  mkdirSync('test-results', { recursive: true });
  writeFileSync(join('test-results', `node-lab-${info.project.name}.json`), `${JSON.stringify(results, null, 2)}\n`);
  expect(results['idleFramesIn2s']).toBe(0);
  expect(results['resourcesAfter15SceneSwitches']).toEqual({ programs: 2, geometries: 2, textures: 0 });
});
