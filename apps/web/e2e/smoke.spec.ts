import { expect, test } from '@playwright/test';

test('loads a Raft experiment, runs it in a Worker, and verifies the streamed trace', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/configure');
  await page.getByTestId('choose-raft-healthy').click();
  await page.getByTestId('load').click();
  await expect(page.getByTestId('lifecycle')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('lifecycle')).toHaveAttribute('data-state', 'completed');
  await expect(page.getByTestId('fingerprint')).toHaveAttribute('data-matches', 'true');
  await expect(page.getByTestId('node-n5-summary')).toHaveText(/leader · term 1/);
  expect(errors).toEqual([]);
});
