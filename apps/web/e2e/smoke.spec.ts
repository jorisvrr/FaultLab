import { expect, test } from '@playwright/test';

test('loads a Raft experiment, runs it in a Worker, and verifies the streamed trace', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/configure');
  await page.getByLabel('Experiment').selectOption('raft-healthy');
  // Run Experiment validates the configuration, loads it into the Worker and starts the run.
  await page.getByTestId('run-experiment').click();
  await expect(page.getByTestId('lifecycle')).toHaveAttribute('data-state', 'completed', { timeout: 60_000 });
  await expect(page.getByTestId('fingerprint')).toHaveAttribute('data-matches', 'true');
  await expect(page.getByTestId('node-n5-summary')).toHaveText(/leader · term 1/);
  expect(errors).toEqual([]);
});
