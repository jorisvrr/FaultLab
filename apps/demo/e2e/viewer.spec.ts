import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const fixture = JSON.parse(
  readFileSync(new URL('../../../packages/engine/test/counterexamples/naive-leader.single-leader.json', import.meta.url), 'utf8'),
) as { expected: { fingerprint: string; violationTime: number; nodes: string[] } };

const errors: string[] = [];
async function open(page: Page, experiment: string) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?experiment=${experiment}`);
  await expect(page.getByTestId('run-info')).toContainText('EXECUTED in this tab');
}
const seekToFirst = async (page: Page, kind: string) => page.locator(`#log li[data-kind="${kind}"]`).first().click();
const fingerprintOf = async (page: Page) => (await page.getByTestId('run-info').textContent())!.match(/fingerprint (\w{8})/)![1];

test.afterEach(() => expect(errors).toEqual([]));

test('labels the view as a replay of a trace executed by the real engine', async ({ page }) => {
  await open(page, 'healthy');
  await expect(page.getByTestId('mode-badge')).toHaveText(/replay of a completed trace/i);
  await expect(page.getByTestId('engine-version')).toHaveText('@faultlab/engine 0.4.0-cp4');
  await expect(page.getByTestId('inputs')).toContainText('protocol   naive-leader@1');
});

test('healthy network: one stable leader (n4), no violation', async ({ page }) => {
  await open(page, 'healthy');
  await page.getByTestId('to-end').click();
  await expect(page.getByTestId('stop-reason')).toHaveText('run.end: time-limit');
  await expect(page.getByTestId('node-n4')).toHaveAttribute('data-role', 'leader');
  for (const id of ['n1', 'n2', 'n3']) await expect(page.getByTestId(`node-${id}`)).toHaveAttribute('data-role', '');
  await expect(page.getByTestId('violation-panel')).toBeHidden();
  await expect(page.locator('[data-testid="link-cut"]')).toHaveCount(0);
});

test('crash, recovery and partition are shown as the trace records them', async ({ page }) => {
  await open(page, 'crash-partition');
  await seekToFirst(page, 'node.crash');
  await expect(page.getByTestId('node-n2')).toHaveAttribute('data-status', 'crashed');
  await seekToFirst(page, 'node.recover');
  await expect(page.getByTestId('node-n2')).toHaveAttribute('data-status', 'running');
  await page.getByTestId('node-n2').click();
  // At node.recover itself, init has not committed yet: storage still reads boots 1 …
  await expect(page.getByTestId('inspector')).toContainText('"boots": 1');
  // … the very next entry is the recovered init's storage.write (storage commits first in a step).
  await page.getByTestId('step-forward').click();
  await expect(page.locator('#log li.current')).toHaveAttribute('data-kind', 'storage.write');
  await expect(page.getByTestId('inspector')).toContainText('"boots": 2');
  await seekToFirst(page, 'network.partition');
  await expect(page.locator('[data-testid="link-cut"]')).toHaveCount(3); // n1 cut from n2, n3, n4
  await expect(page.getByTestId('partition-label')).toHaveText('partition [n1] | [n2 n3 n4]');
  await seekToFirst(page, 'network.heal');
  await expect(page.locator('[data-testid="link-cut"]')).toHaveCount(0);
});

test('stored split-brain counterexample: violation highlighted, explained, and reproduced exactly', async ({ page }) => {
  await open(page, 'fixture-split-brain');
  await expect(page.getByTestId('violation-panel')).toBeHidden(); // not reached yet at #0
  await page.getByTestId('jump-violation').click();
  await expect(page.getByTestId('violation-panel')).toBeVisible();
  await expect(page.getByTestId('clock')).toHaveText(`t ${fixture.expected.violationTime}`);
  await expect(page.getByTestId('violation-nodes')).toHaveText(fixture.expected.nodes.join(', '));
  await expect(page.getByTestId('violation-observed')).toHaveText('2 running nodes are leader: n3, n4');
  await expect(page.getByTestId('violation-active-faults')).toContainText('partition #');
  for (const id of fixture.expected.nodes) await expect(page.getByTestId(`node-${id}`)).toHaveAttribute('data-violating', 'true');
  await expect(page.locator('[data-testid="violation-marker"]')).toHaveCount(1);
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('verify-result')).toHaveAttribute('data-identical', 'true');
  // The fixture was recorded by engine 0.3.0-cp2; the current trace reproduces it exactly via the legacy projection.
  await expect(page.getByTestId('verify-result')).toContainText(`stored fixture fingerprint ${fixture.expected.fingerprint}: matches ✓ (via legacy trace projection)`);
});

test('identical inputs give identical traces across reloads and re-execution', async ({ page }) => {
  await open(page, 'crash-partition');
  const first = await fingerprintOf(page);
  await page.reload();
  await expect(page.getByTestId('run-info')).toContainText('EXECUTED');
  expect(await fingerprintOf(page)).toBe(first);
  await page.getByTestId('execute').click();
  expect(await fingerprintOf(page)).toBe(first);
});

test('playback controls move through the trace without re-running the engine', async ({ page }) => {
  await open(page, 'healthy');
  const runInfo = await page.getByTestId('run-info').textContent();
  await expect(page.getByTestId('cursor')).toHaveText(/^#0 \//);
  await page.getByTestId('step-forward').click();
  await page.getByTestId('step-forward').click();
  await expect(page.getByTestId('cursor')).toHaveText(/^#2 \//);
  await page.getByTestId('step-back').click();
  await expect(page.getByTestId('cursor')).toHaveText(/^#1 \//);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('clock')).not.toHaveText('t 0');
  await expect.poll(async () => page.locator('[data-testid="message"]').count()).toBeGreaterThan(0); // messages in flight
  await page.getByTestId('play').click(); // pause
  await page.getByTestId('restart').click();
  await expect(page.getByTestId('cursor')).toHaveText(/^#0 \//);
  expect(await page.getByTestId('run-info').textContent()).toBe(runInfo); // replay never re-executed
});
