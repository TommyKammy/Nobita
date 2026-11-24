import { expect, test, type Page } from '@playwright/test';
import { getDoc, openFixture } from './helpers';

const tableDoc = () => ({
  version: 1,
  id: 'table-test',
  title: '',
  blocks: [
    {
      id: 't1',
      type: 'table',
      text: [],
      props: {
        table: {
          columns: [{ id: 'c1', width: 160 }, { id: 'c2', width: 160 }],
          rows: [
            { id: 'r1', cells: { c1: { text: 'A' }, c2: { text: 'B' } } },
            { id: 'r2', cells: {} },
          ],
        },
      },
      children: [],
    },
  ],
});

async function setDoc(page: Page, doc: unknown): Promise<void> {
  await page.evaluate(value => {
    const editor = (window as unknown as { __editor?: { setDoc(value: string): void } })
      .__editor;
    editor?.setDoc(JSON.stringify(value));
  }, doc);
  await expect(page.locator('.nb-table-grid')).toBeVisible();
}

test('renders and edits a simple table independently from Database', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());

  await expect(page.locator('.nb-table-grid')).toBeVisible();
  await expect(page.locator('.nb-db')).toHaveCount(0);
  await expect(page.locator('.nb-table-cell')).toHaveCount(4);

  const cell = page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c1"]');
  await cell.click();
  await page.keyboard.press('End');
  await page.keyboard.type('XYZ');
  let doc = await getDoc(page);
  expect(doc.blocks[0]?.props.table).toMatchObject({
    columns: [{ id: 'c1' }, { id: 'c2' }],
  });
  expect((doc.blocks[0]?.props.table as { rows: { id: string; cells: Record<string, { text?: string }> }[] }).rows[0]?.cells.c1?.text).toBe('AXYZ');

  await page.locator('.nb-table-action', { hasText: '+ Row' }).click();
  await expect(page.locator('.nb-table-grid tbody tr')).toHaveCount(3);
  await page.locator('.nb-table-action', { hasText: '+ Column' }).click();
  await expect(page.locator('.nb-table-grid colgroup col')).toHaveCount(4);
});

test('inserts a simple table from the slash menu', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    const editor = (window as unknown as { __editor?: { focus(blockId: string): void } })
      .__editor;
    editor?.focus('b1');
  });
  await page.keyboard.type('/');
  await page.locator('.nb-menu-item', { hasText: 'Table' }).click();
  await expect(page.locator('.nb-table-grid')).toBeVisible();
  const doc = await getDoc(page);
  expect(doc.blocks.some(block => block.type === 'table')).toBe(true);
  expect(doc.blocks.some(block => block.type === 'database')).toBe(false);
});

test('deletes rows and columns from the table menu', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());
  await page.locator('.nb-table-row-handle').first().click();
  await page.locator('.nb-table-menu button', { hasText: 'Delete row' }).click();
  await expect(page.locator('.nb-table-grid tbody tr')).toHaveCount(1);

  await page.locator('.nb-table-cell').first().click({ button: 'right' });
  await page.locator('.nb-table-menu button', { hasText: 'Delete column' }).click();
  await expect(page.locator('.nb-table-grid colgroup col')).toHaveCount(2);
});

test('imports an HTML table as a simple table', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      'text/html',
      '<table><tr><th>Task</th><th>Owner</th></tr><tr><td>Ship</td><td>Ada</td></tr></table>'
    );
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('[data-block-id="b1"] .nb-text')
      ?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
  });
  await expect(page.locator('.nb-table-grid')).toBeVisible();
  const doc = await getDoc(page);
  expect(doc.blocks.some(block => block.type === 'table')).toBe(true);
  expect(doc.blocks.some(block => block.type === 'database')).toBe(false);
});


test('keeps focus in a table cell after editing a paragraph', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'table-focus',
    title: '',
    blocks: [
      { id: 'p1', type: 'paragraph', text: [{ text: 'Before' }], props: {}, children: [] },
      tableDoc().blocks[0],
    ],
  });
  await page.locator('[data-block-id="p1"] .nb-text').click();
  await page.keyboard.press('End');
  await page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c1"]').click();
  await page.keyboard.press('End');
  await page.keyboard.type('XYZ');

  const doc = await getDoc(page);
  expect(doc.blocks.find(block => block.id === 'p1')?.text).toBe('Before');
  const table = doc.blocks.find(block => block.type === 'table');
  expect((table?.props.table as { rows: { id: string; cells: Record<string, { text?: string }> }[] }).rows[0]?.cells.c1?.text).toBe('AXYZ');
});

test('reverts a focused table cell when the host undoes', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());
  const cell = page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c1"]');
  await cell.click();
  await page.keyboard.press('End');
  await page.keyboard.type('Z');
  await expect(cell).toHaveText('AZ');
  await page.evaluate(() => {
    (window as unknown as { __editor?: { undo(): boolean } }).__editor?.undo();
  });
  await expect(cell).toHaveText('A');
  const doc = await getDoc(page);
  expect((doc.blocks[0]?.props.table as { rows: { id: string; cells: Record<string, { text?: string }> }[] }).rows[0]?.cells.c1?.text).toBe('A');
});
