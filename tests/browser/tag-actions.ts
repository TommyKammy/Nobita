import { expect, type Page } from '@playwright/test';

export async function openTags(page: Page) {
  await page.locator('#page-menu').click();
  const edit = page.getByRole('menuitem', { name: 'Edit tags' });
  await expect(edit.locator('svg')).toBeVisible();
  await edit.click();
  const input = page.getByRole('textbox', { name: 'Tag name' });
  await expect(input).toBeFocused();
  return input;
}

export async function addTag(page: Page, tag: string) {
  const input = await openTags(page);
  await input.fill(tag);
  await input.press('Enter');
  await page.getByRole('button', { name: 'Save tags' }).click();
}

export async function removeTag(page: Page, tag: string) {
  await openTags(page);
  await page.getByRole('button', { name: 'Remove tag ' + tag, exact: true }).click();
  await page.getByRole('button', { name: 'Save tags' }).click();
}
