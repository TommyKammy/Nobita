import { expect, test } from '@playwright/test';
import { openFixture, selectText } from './helpers';

test('partial dictionary preserves English fallback, formatting actions and document data', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(async () => (await import('/dictionary.ts')).mount('partial'));
  await selectText(page, 'b1', 0, 5);
  await expect(page.getByRole('button', { name: 'Italic (I)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Strong (B)', exact: true }).click();
  expect(await page.evaluate(() => window.__editor!.doc.blocks[0]!.text[0]!.marks?.bold)).toBe(true);
  await page.locator('[data-block-id="b1"] .nb-text').click({ button: 'right' });
  await expect(page.getByText('Remove block', { exact: true })).toBeVisible();
  await expect(page.getByText('Duplicate', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const add = page.locator('.nb-db-new-record-toolbar');
  await expect(add).toHaveText('<b>Add item</b>');
  await expect(add.locator('b')).toHaveCount(0);
  await expect(add).toHaveAttribute('title', 'Add record');
  await expect(page.getByRole('textbox', { name: 'Database title' })).toHaveValue('Delete');
  await add.click();
  await expect(page.getByRole('button', { name: 'Close record page' })).toBeVisible();
});

test('Japanese slash commands retain English search aliases and database actions use Japanese labels', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(async () => (await import('/dictionary.ts')).mount('ja'));
  await page.locator('[data-block-id="b2"] .nb-text').click();
  await page.keyboard.type('/head');
  await page.getByRole('menuitem').filter({ hasText: '見出し1' }).click();
  expect(await page.evaluate(() => window.__editor!.doc.blocks[1]!.type)).toBe('heading');
  await expect(page.getByRole('textbox', { name: 'データベース名' })).toHaveValue('Delete');
  await expect(page.getByRole('button', { name: '列「Delete」を編集' })).toBeVisible();
  await page.getByRole('button', { name: 'ビューの設定' }).click();
  await expect(page.getByRole('button', { name: 'ビューを複製' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'テーブル', exact: true })).toBeVisible();
});

test('an editor with a dictionary can coexist with an English editor', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(async () => {
    (await import('/dictionary.ts')).mount('partial');
    const english = document.createElement('nobita-editor') as typeof window.__host;
    english.doc = window.__editor!.doc;
    document.body.append(english);
  });
  const editors = page.locator('nobita-editor');
  await expect(editors.nth(0).locator('.nb-db-new-record-toolbar')).toHaveText('<b>Add item</b>');
  await expect(editors.nth(1).locator('.nb-db-new-record-toolbar')).toHaveText('New Record');
});

test('English subsequences and Japanese IME select the same command', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(async () => (await import('/dictionary.ts')).mount('ja'));
  const text = page.locator('[data-block-id="b2"] .nb-text');
  await text.click();
  await page.keyboard.type('/hd1');
  await expect(page.getByRole('menuitem').filter({ hasText: '見出し1' })).toBeVisible();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
  const ime = await page.context().newCDPSession(page);
  await ime.send('Input.imeSetComposition', { text: '見出し2', selectionStart: 4, selectionEnd: 4 });
  for (const key of ['ArrowDown', 'Escape', 'Enter']) {
    const handled = await text.evaluate((node, key) => !node.dispatchEvent(new KeyboardEvent('keydown', {
      key, bubbles: true, composed: true, cancelable: true, isComposing: true,
    })), key);
    expect(handled, key).toBe(false);
  }
  await expect(page.getByRole('menu')).toBeVisible();
  await ime.send('Input.insertText', { text: '見出し2' });
  await expect(page.getByRole('menuitem')).toHaveCount(1);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__editor!.doc.blocks[1])).toMatchObject({
    type: 'heading', props: { level: 2 }, text: [],
  });
});

test('Japanese board placeholders stay out of saved cells and user group names stay literal', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(async () => {
    (await import('/dictionary.ts')).mount('ja');
    window.__editor!.setDoc(JSON.stringify({ version: 1, id: 'board', blocks: [{
      id: 'db', type: 'database', props: { database: {
        columns: [{ id: 'title', name: 'Title', type: 'text' }, { id: 'group', name: 'Group', type: 'select', options: ['No value'] }],
        rows: [{ id: 'a', cells: {} }, { id: 'b', cells: { group: { text: 'No value' } } }],
        views: [{ id: 'board', name: 'Board', type: 'board', groupBy: 'group' }], activeViewId: 'board',
      } },
    }] }));
  });
  await expect(page.locator('.nb-db-board-group-label')).toHaveText(['No value', '値なし']);
  const card = page.locator('.nb-db-card-title').first();
  expect(await card.evaluate(node => getComputedStyle(node, '::before').content)).toBe('"無題"');
  await card.focus();
  await card.blur();
  const rows = await page.evaluate(() => window.__editor!.doc.blocks[0]!.props.database!.rows);
  expect(rows.every(row => !row.cells.title?.text)).toBe(true);
});

test('translated controls keep table commands and callout values independent of their labels', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(async () => {
    (await import('/dictionary.ts')).mount('ja');
    window.__editor!.setDoc(JSON.stringify({ version: 1, id: 'controls', blocks: [
      { id: 'callout', type: 'callout', text: [{ text: 'Note' }], props: { tone: 'info' } },
      { id: 'table', type: 'table', props: { table: {
        columns: [{ id: 'c1' }], rows: [{ id: 'r1', cells: { c1: { text: 'Delete' } } }],
      } } },
    ] }));
  });
  const tone = page.getByRole('combobox', { name: 'コールアウトの種類' });
  await tone.selectOption({ label: '注意' });
  expect(await page.evaluate(() => window.__editor!.doc.blocks[0]!.props.tone)).toBe('warning');
  const cell = page.locator('.nb-table-cell').first();
  await cell.click({ button: 'right' });
  await page.getByRole('button', { name: '下に行を挿入' }).click();
  expect(await page.evaluate(() => window.__editor!.doc.blocks[1]!.props.table!.rows.length)).toBe(2);
  await expect(cell).toHaveText('Delete');
});
