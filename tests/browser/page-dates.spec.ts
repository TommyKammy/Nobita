import { expect, test, type Page } from '@playwright/test';

const url = process.env.NOBITA_DEMO_URL ?? '/demo.html';

function active(page: Page) {
  return page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('nobita.demo.v2')!);
    return state.pages[state.activeId] as {
      doc: { id: string; title: string };
      createdAt?: number;
      updatedAt: number;
      tags?: string[];
    };
  });
}

async function menu(page: Page, label: string, answer?: string) {
  await page.locator('#page-menu').click();
  if (answer !== undefined) page.once('dialog', dialog => dialog.accept(answer));
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test('dates follow successful content saves across page actions and reloads', async ({ page }) => {
  await page.goto(url);
  await page.locator('#new-page').click();
  const created = await active(page);
  expect(created.createdAt).toBe(created.updatedAt);
  await expect(page.locator('#page-dates')).toContainText('Created');
  await page.locator('.nb-title').fill('Dated note');
  await expect.poll(async () => (await active(page)).updatedAt).toBeGreaterThan(created.updatedAt);
  const titleDate = (await active(page)).updatedAt;

  await page.locator('.nb-text').first().click();
  await page.keyboard.type('Body');
  await expect.poll(async () => (await active(page)).updatedAt).toBeGreaterThan(titleDate);
  const bodyDate = (await active(page)).updatedAt;
  await menu(page, 'Edit tags', 'alpha, beta');
  const tagged = await active(page);
  expect(tagged.tags).toEqual(['alpha', 'beta']);
  expect(tagged.updatedAt).toBeGreaterThan(bodyDate);
  await menu(page, 'Edit tags', 'beta, alpha');
  await menu(page, 'Rename', 'Dated note');
  await page.locator('#favorite').click();
  await page.locator('[data-page-id="getting-started"] .page-title').first().click();
  await page.locator(`[data-page-id="${created.doc.id}"] .page-title`).click();
  await page.reload();
  expect(await active(page)).toMatchObject({ createdAt: created.createdAt, updatedAt: tagged.updatedAt });
  await menu(page, 'Move to Trash');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await active(page)).toMatchObject({ createdAt: created.createdAt, updatedAt: tagged.updatedAt });
  await menu(page, 'Duplicate');
  const copy = await active(page);
  expect(copy.createdAt).toBe(copy.updatedAt);
  expect(copy.updatedAt).toBeGreaterThan(tagged.updatedAt);
  expect(copy.tags).toEqual(tagged.tags);
});

test('legacy creation date stays unknown and failed writes keep the last saved date', async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('#shell')).toBeVisible();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('nobita.demo.v2')!);
    delete state.pages[state.activeId].createdAt;
    state.pages[state.activeId].updatedAt = 1000;
    localStorage.setItem('nobita.demo.v2', JSON.stringify(state));
  });
  await page.reload();
  const dates = page.locator('#page-dates');
  await expect(dates).toContainText('Created Unknown');
  const original = await dates.textContent();
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      Storage.prototype.setItem = set;
      throw new DOMException('Storage full', 'QuotaExceededError');
    };
  });
  await menu(page, 'Rename', 'Pending rename');
  await expect(page.locator('#save-text')).toContainText('Not saved');
  expect(await dates.textContent()).toBe(original);
  expect((await active(page)).updatedAt).toBe(1000);
  await page.locator('#favorite').click();
  expect((await active(page)).updatedAt).toBeGreaterThan(1000);
  await page.reload();
  await expect(dates).toContainText('Created Unknown');
  await expect(page.locator('.nb-title')).toHaveText('Pending rename');
});

test('dates a pending edit at the successful write, including an early navigation flush', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-01T12:00:00Z'));
  await page.goto(url);
  await page.locator('#new-page').click();
  const created = await active(page);
  await page.clock.setFixedTime(new Date('2026-01-01T12:01:00Z'));
  await page.locator('.nb-title').fill('Pending');
  expect((await active(page)).updatedAt).toBe(created.updatedAt);
  const savedAt = new Date('2026-01-01T12:02:00Z');
  await page.clock.setFixedTime(savedAt);
  await page.locator('[data-page-id="getting-started"] .page-title').first().click();
  await page.locator(`[data-page-id="${created.doc.id}"] .page-title`).click();
  expect(await active(page)).toMatchObject({ createdAt: created.createdAt, updatedAt: savedAt.getTime() });
});

test('reverting a title before its save preserves the last content timestamp', async ({ page }) => {
  await page.goto(url);
  await page.locator('#new-page').click();
  const created = await active(page);
  const title = page.locator('.nb-title');
  await title.fill('Temporary');
  await title.fill('');
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  expect((await active(page)).updatedAt).toBe(created.updatedAt);
});
