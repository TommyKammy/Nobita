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

  await page.locator('.nb-table-cell').last().hover();
  await page.locator('.nb-table-add-row').click();
  await expect(page.locator('.nb-table-grid tbody tr')).toHaveCount(3);
  await page.locator('.nb-table-cell').last().hover();
  await page.locator('.nb-table-add-column').click();
  await expect(page.locator('.nb-table-grid colgroup col')).toHaveCount(3);
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
  await page.keyboard.type('Cell');
  const doc = await getDoc(page);
  const table = doc.blocks.find(block => block.type === 'table');
  expect(table).toBeTruthy();
  expect(doc.blocks.some(block => block.type === 'database')).toBe(false);
  expect(
    (table?.props.table as { rows: { cells: Record<string, { text?: string }> }[] })
      .rows[0]?.cells[table?.props.table?.columns[0]?.id ?? '']?.text
  ).toBe('Cell');
});

test('deletes rows and columns from the table menu', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());
  await page.locator('.nb-table-cell').first().hover();
  await page.locator('.nb-table-row-handle').first().click();
  await page.locator('.nb-table-menu-actions button', { hasText: 'Delete' }).click();
  await expect(page.locator('.nb-table-grid tbody tr')).toHaveCount(1);

  await page.locator('.nb-table-cell').first().hover();
  await page.locator('.nb-table-column-handle').first().click();
  await page.locator('.nb-table-menu-actions button', { hasText: 'Delete' }).click();
  await expect(page.locator('.nb-table-grid colgroup col')).toHaveCount(1);
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


test('preserves Shift+Enter line breaks in table cells', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());
  const cell = page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c2"]');
  await cell.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('second');

  const doc = await getDoc(page);
  const table = doc.blocks[0]?.props.table as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  };
  expect(table.rows[0]?.cells.c2?.text).toBe('B\nsecond');

  await setDoc(page, doc);
  await expect(cell).toHaveText(/B\s+second/u);
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

test('selects table cells by dragging and supports copy and clear', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'table-range',
    title: '',
    blocks: [
      {
        id: 't1',
        type: 'table',
        text: [],
        props: {
          table: {
            columns: [{ id: 'c1' }, { id: 'c2' }],
            rows: [
              { id: 'r1', cells: { c1: { text: 'A' }, c2: { text: 'B' } } },
              { id: 'r2', cells: { c1: { text: 'C' }, c2: { text: 'D' } } },
            ],
          },
        },
        children: [],
      },
    ],
  });
  const first = page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c1"]');
  const last = page.locator('.nb-table-cell[data-row-id="r2"][data-column-id="c2"]');
  const firstBox = await first.boundingBox();
  const lastBox = await last.boundingBox();
  if (!firstBox || !lastBox) throw new Error('Missing table cells');
  await page.mouse.move(firstBox.x + 8, firstBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(lastBox.x + lastBox.width - 8, lastBox.y + lastBox.height - 8, {
    steps: 8,
  });
  await page.mouse.up();

  await expect(page.locator('.nb-table-selection')).toHaveAttribute('data-visible', 'true');
  await expect(page.locator('.nb-table-cell-wrap[aria-selected="true"]')).toHaveCount(4);

  const copied = await page.evaluate(() => {
    const cell = document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-table-cell[data-row-id="r2"][data-column-id="c2"]');
    if (!cell) return null;
    const data = new DataTransfer();
    const event = new ClipboardEvent('copy', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    cell.dispatchEvent(event);
    return data.getData('text/plain');
  });
  expect(copied).toBe('A\tB\nC\tD');

  await page.evaluate(() => {
    const cell = document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-table-cell[data-row-id="r2"][data-column-id="c2"]');
    if (!cell) return;
    const data = new DataTransfer();
    data.setData('text/plain', 'X\tY\nZ\tW');
    cell.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
  });
  await expect(first).toBeFocused();
  let doc = await getDoc(page);
  let table = doc.blocks[0]?.props.table as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  };
  expect(table.rows[0]?.cells.c1?.text).toBe('X');
  expect(table.rows[0]?.cells.c2?.text).toBe('Y');
  expect(table.rows[1]?.cells.c1?.text).toBe('Z');
  expect(table.rows[1]?.cells.c2?.text).toBe('W');

  await page.keyboard.press('Delete');
  doc = await getDoc(page);
  table = doc.blocks[0]?.props.table as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  };
  expect(table.rows[0]?.cells).toEqual({});
  expect(table.rows[1]?.cells).toEqual({});
  await expect(page.locator('.nb-table-selection')).toHaveAttribute('data-visible', 'false');
});

test('types into the active cell after a drag selection', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());
  const first = page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c1"]');
  const last = page.locator('.nb-table-cell[data-row-id="r2"][data-column-id="c2"]');
  const firstBox = await first.boundingBox();
  const lastBox = await last.boundingBox();
  if (!firstBox || !lastBox) throw new Error('Missing table cells');
  await page.mouse.move(firstBox.x + 8, firstBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(lastBox.x + lastBox.width - 8, lastBox.y + lastBox.height - 8, {
    steps: 8,
  });
  await page.mouse.up();
  await page.keyboard.type('Q');
  const doc = await getDoc(page);
  const table = doc.blocks[0]?.props.table as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  };
  expect(table.rows[0]?.cells.c1?.text).toBe('AQ');
  await expect(page.locator('.nb-table-selection')).toHaveAttribute('data-visible', 'false');
});

test('undoes table row insertion from a focused cell', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());
  await page.locator('.nb-table-cell[data-row-id="r2"][data-column-id="c2"]').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.locator('.nb-table-grid tbody tr')).toHaveCount(3);
  await expect(page.locator('.nb-table-cell').nth(4)).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.nb-table-grid tbody tr')).toHaveCount(2);
  await expect(page.locator('.nb-table-cell').nth(2)).toBeFocused();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.nb-table-grid tbody tr')).toHaveCount(3);
  await expect(page.locator('.nb-table-cell').nth(2)).toBeFocused();
});

test('shows AFFiNE-style handles and hover add controls', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());
  const rowHandle = page.locator('.nb-table-row-handle').first();
  const columnHandle = page.locator('.nb-table-column-handle').first();
  await expect(rowHandle).toHaveAttribute('data-visible', 'false');
  await page.locator('.nb-table-cell').first().hover();
  await expect(rowHandle).toHaveAttribute('data-visible', 'true');
  await expect(columnHandle).toHaveAttribute('data-visible', 'true');

  await page.locator('.nb-table-cell').last().hover();
  await expect(page.locator('.nb-table-add-row')).toHaveAttribute('data-visible', 'true');
  await expect(page.locator('.nb-table-add-column')).toHaveAttribute('data-visible', 'true');
  await expect(page.locator('.nb-table-add-corner')).toHaveAttribute('data-visible', 'true');
  await page.mouse.move(10, 10);
  await expect(page.locator('.nb-table-add-row')).toHaveAttribute('data-visible', 'false');
});

test('uses AFFiNE row and column menus', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());
  await page.locator('.nb-table-cell').first().hover();
  await page.locator('.nb-table-column-handle').first().click();
  await expect(page.locator('.nb-table-menu-actions button')).toHaveText([
    'Insert Left',
    'Insert Right',
    'Move Left',
    'Move Right',
    'Duplicate',
    'Clear column contents',
    'Delete',
  ]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.nb-table-menu')).toHaveCount(0);
  await page.locator('.nb-table-cell').first().hover();
  await page.locator('.nb-table-column-handle').first().click();
  await page.locator('.nb-table-color[title="Blue"]').click();
  let doc = await getDoc(page);
  let table = doc.blocks[0]?.props.table as {
    columns: Array<{ id: string; backgroundColor?: string }>;
  };
  expect(table.columns[0]?.backgroundColor).toBeTruthy();
  await expect(
    page.locator('.nb-table-cell-wrap[data-column-id="c1"]').first()
  ).toHaveAttribute('data-background', 'true');

  await page.locator('.nb-table-cell').first().hover();
  await page.locator('.nb-table-row-handle').first().click();
  await page.locator('.nb-table-menu-actions button', { hasText: 'Duplicate' }).click();
  await expect(page.locator('.nb-table-grid tbody tr')).toHaveCount(3);

  await page.locator('.nb-table-cell').first().hover();
  await page.locator('.nb-table-row-handle').first().click();
  await page.locator('.nb-table-menu-actions button', { hasText: 'Clear row contents' }).click();
  doc = await getDoc(page);
  table = doc.blocks[0]?.props.table as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  };
  expect(Object.keys(table.rows[0]?.cells ?? {})).toHaveLength(0);
});

test('resizes only the dragged table column', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());
  const resizer = page.locator('.nb-table-resizer').first();
  const box = await resizer.boundingBox();
  if (!box) throw new Error('Missing table resizer');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  const doc = await getDoc(page);
  const table = doc.blocks[0]?.props.table as {
    columns: Array<{ id: string; width?: number }>;
  };
  expect(table.columns[0]?.width).toBe(200);
  expect(table.columns[1]?.width).toBe(160);
});

test('adds multiple rows by dragging the hover add control', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());
  await page.locator('.nb-table-cell').last().hover();
  const addRow = page.locator('.nb-table-add-row');
  const box = await addRow.boundingBox();
  if (!box) throw new Error('Missing add-row control');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 80, { steps: 5 });
  await expect(page.locator('.nb-table-add-tip')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.nb-table-grid tbody tr')).toHaveCount(4);
  await expect(page.locator('.nb-table-add-tip')).toHaveCount(0);
});
