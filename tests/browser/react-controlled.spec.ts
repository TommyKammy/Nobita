import { expect, test } from '@playwright/test';

test('a controlled React edit survives prop feedback with one undo entry', async ({ page }) => {
  await page.goto('/react-controlled.html');
  const text = page.locator('[data-block-id="controlled"] .nb-text');
  await text.click();
  await page.keyboard.press('End');
  await page.keyboard.type('X');
  await expect(text).toHaveText('AlphaX');
  await page.keyboard.press('Control+z');
  await expect(text).toHaveText('Alpha');
  expect(await page.evaluate(() => (window as Window & { sources: string[] }).sources)).not.toContain('replace');
});
