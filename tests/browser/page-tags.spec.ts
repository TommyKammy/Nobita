import { expect, test, type Page } from '@playwright/test';

const url = process.env.NOBITA_DEMO_URL ?? '/demo.html';

async function addTag(page: Page, tag: string) {
  const input = page.getByRole('textbox', { name: 'Tag name' });
  await input.fill(tag);
  await input.press('Enter');
}

async function newPage(page: Page, title: string) {
  await page.locator('#new-page').click();
  await page.getByRole('textbox', { name: 'Document title' }).fill(title);
}

test('inline tags preserve editor history, dates and persisted content', async ({ page }) => {
  await page.goto(url);
  await newPage(page, 'Tagged note');
  const body = page.locator('.nb-text').first();
  await body.click();
  await page.keyboard.type('Draft');
  await addTag(page, '  企画  ');
  await addTag(page, '企画');
  const chip = page.getByRole('button', { name: 'Remove tag 企画' });
  await expect(chip).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Tag name' })).toBeFocused();
  await body.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.nb-body')).not.toContainText('Second');
  await expect(chip).toBeVisible();
  await expect(page.locator('.nb-body')).toContainText('Draft');
  await page.reload();
  await expect(chip).toBeVisible();
  await expect(page.locator('.nb-title')).toHaveText('Tagged note');
  await chip.click();
  await expect(chip).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#tag-chips')).toBeEmpty();
  await expect(page.locator('.nb-body')).toContainText('Draft');
});

test('filter includes nested pages, intersects favorites and can recover from zero matches', async ({ page }) => {
  await page.goto(url);
  await newPage(page, 'Parent');
  await page.locator('#page-menu').click();
  await page.getByRole('menuitem', { name: 'Add nested page' }).click();
  await page.locator('.nb-title').fill('Tagged child');
  await addTag(page, 'release');
  await page.locator('#favorite').click();
  await newPage(page, 'Tagged peer');
  await addTag(page, 'release');
  const filter = page.getByRole('combobox', { name: 'Tag', exact: true });
  const titles = page.locator('#page-tree .page-title');
  await filter.selectOption('release');
  await expect(titles).toHaveCount(2);
  await expect(titles.filter({ hasText: 'Tagged child' })).toBeVisible();
  await page.locator('[data-view="favorites"]').click();
  await expect(titles).toHaveText(['Tagged child']);
  await titles.click();
  await page.getByRole('button', { name: 'Remove tag release' }).click();
  await expect(page.locator('#page-tree')).toHaveText('No pages with this tag.');
  await page.locator('[data-view="all"]').click();
  await expect(titles).toHaveText(['Tagged peer']);
  await titles.click();
  await page.getByRole('button', { name: 'Remove tag release' }).click();
  await expect(filter).toHaveValue('release');
  await filter.selectOption('');
  await expect(titles.filter({ hasText: 'Parent' })).toBeVisible();
});

test('switching notes clears the tag draft and trash renders existing tags read-only', async ({ page }) => {
  await page.goto(url);
  await newPage(page, 'Tagged for trash');
  await addTag(page, '分類');
  const input = page.getByRole('textbox', { name: 'Tag name' });
  await input.fill('unfinished');
  await page.locator('[data-page-id="getting-started"] .page-title').first().click();
  await expect(input).toHaveValue('');
  await page.locator('#page-tree .page-title').filter({ hasText: 'Tagged for trash' }).click();
  await page.locator('#page-menu').click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.locator('[data-view="trash"]').click();
  await page.locator('#page-tree .page-title').filter({ hasText: 'Tagged for trash' }).click();
  await expect(page.locator('#tag-chips')).toHaveText('分類');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove tag 分類' })).toHaveCount(0);
  await page.locator('#banner-restore').click();
  await expect(page.getByRole('button', { name: 'Remove tag 分類' })).toBeVisible();
});

test('a narrow viewport can add and remove long tags without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(url);
  const tag = '長'.repeat(100);
  await addTag(page, tag);
  const remove = page.getByRole('button', { name: 'Remove tag ' + tag });
  await expect(remove).toBeVisible();
  expect(await page.locator('#editor-scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await remove.click();
  await expect(remove).toHaveCount(0);
});

test('new pages remain visible when created from a tag-filtered list', async ({ page }) => {
  await page.goto(url);
  await addTag(page, 'old');
  const filter = page.locator('#filter-tag');
  await filter.selectOption('old');
  await newPage(page, 'New without a tag');
  await expect(filter).toHaveValue('');
  await expect(page.locator('#page-tree .page-title').filter({ hasText: 'New without a tag' })).toBeVisible();
  await expect(page.locator('#tag-chips')).toBeEmpty();
});

test('Japanese composition stays in the tag input until submission', async ({ page }) => {
  await page.goto(url);
  const input = page.getByRole('textbox', { name: 'Tag name' });
  await input.focus();
  const client = await page.context().newCDPSession(page);
  await client.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
  await expect(input).toHaveValue('にほん');
  await expect(page.locator('#tag-chips')).toBeEmpty();
  await client.send('Input.insertText', { text: '日本' });
  await expect(input).toHaveValue('日本');
  await expect(page.locator('#tag-chips')).toBeEmpty();
  await page.getByRole('button', { name: 'Add tag', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove tag 日本' })).toBeVisible();
});

test('filtering and duplicate tags preserve dates, and a failed tag removal retries safely', async ({ page }) => {
  await page.goto(url);
  await newPage(page, 'Save semantics');
  await addTag(page, 'review');
  const saved = () => page.evaluate(() => {
    const workspace = JSON.parse(localStorage.getItem('nobita.demo.v2')!);
    const { tags, updatedAt } = workspace.pages[workspace.activeId];
    return { tags, updatedAt };
  });
  const previous = await saved();
  await addTag(page, ' review ');
  await page.locator('#filter-tag').selectOption('review');
  expect(await saved()).toEqual(previous);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      Storage.prototype.setItem = original;
      throw new DOMException('Storage full', 'QuotaExceededError');
    };
  });
  await page.getByRole('button', { name: 'Remove tag review' }).click();
  await expect(page.locator('#save-text')).toHaveText('Not saved');
  expect(await saved()).toEqual(previous);
  await page.locator('#favorite').click();
  expect((await saved()).tags).toEqual([]);
  expect((await saved()).updatedAt).toBeGreaterThan(previous.updatedAt);
});
