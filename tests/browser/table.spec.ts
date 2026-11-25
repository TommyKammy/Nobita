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
    data.setData('text/plain', 'X\tY\nZ\tW\n');
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

test('copies trailing empty cells with explicit TSV fields', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());
  const first = page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c1"]');
  const last = page.locator('.nb-table-cell[data-row-id="r2"][data-column-id="c1"]');
  const firstBox = await first.boundingBox();
  const lastBox = await last.boundingBox();
  if (!firstBox || !lastBox) throw new Error('Missing table cells');
  await page.mouse.move(firstBox.x + 8, firstBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(lastBox.x + lastBox.width - 8, lastBox.y + lastBox.height - 8, {
    steps: 5,
  });
  await page.mouse.up();
  const copied = await page.evaluate(() => {
    const cell = document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-table-cell[data-row-id="r2"][data-column-id="c1"]');
    if (!cell) return null;
    const data = new DataTransfer();
    cell.dispatchEvent(
      new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data })
    );
    return data.getData('text/plain');
  });
  expect(copied).toBe('A\n""');
});

test('restores editor focus when undo removes an inserted table', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    const editor = (window as unknown as { __editor?: { focus(blockId: string): void } })
      .__editor;
    editor?.focus('b1');
  });
  await page.keyboard.type('/');
  await page.locator('.nb-menu-item', { hasText: 'Table' }).click();
  await expect(page.locator('.nb-table-grid')).toBeVisible();
  await expect(page.locator('.nb-table-cell').first()).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.nb-table-grid')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.nb-table-grid')).toBeVisible();
  await expect(page.locator('.nb-table-cell').first()).toBeFocused();
});

test('keeps the full width selected for ragged TSV paste', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'table-ragged',
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
  await page.evaluate(() => {
    const cell = document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-table-cell[data-row-id="r2"][data-column-id="c2"]');
    if (!cell) return;
    const data = new DataTransfer();
    data.setData('text/plain', 'X\tY\nZ');
    cell.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
  });
  await expect(page.locator('.nb-table-cell-wrap[aria-selected="true"]')).toHaveCount(4);
  const doc = await getDoc(page);
  const table = doc.blocks[0]?.props.table as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  };
  expect(table.rows[0]?.cells.c1?.text).toBe('X');
  expect(table.rows[0]?.cells.c2?.text).toBe('Y');
  expect(table.rows[1]?.cells.c1?.text).toBe('Z');
  expect(table.rows[1]?.cells.c2?.text).toBe('D');
});

test('focuses a table block for page-link insertion', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'table-focus-block',
    title: '',
    blocks: [
      { id: 'before', type: 'paragraph', text: [{ text: 'Before' }], props: {}, children: [] },
      tableDoc().blocks[0],
      { id: 'after', type: 'paragraph', text: [{ text: 'After' }], props: {}, children: [] },
    ],
  });
  const ids = await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        focus(blockId: string, offset?: number): void;
        insertPageLink(page: { id: string; title: string }): string | null;
      };
    }).__editor;
    editor?.focus('after', 0);
    editor?.focus('t1', 0);
    editor?.insertPageLink({ id: 'p2', title: 'Page' });
    return document.querySelector('nobita-editor')?.doc?.blocks.map(block => block.id);
  });
  expect(ids).toEqual(['before', 't1', expect.any(String), 'after']);
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

async function selectCellRange(
  page: Page,
  selector: string,
  start: number,
  end: number
): Promise<void> {
  await page.evaluate(
    ({ sel, from, to }) => {
      const root = document.querySelector('nobita-editor')?.shadowRoot;
      const cell = root?.querySelector<HTMLElement>(sel);
      if (!cell) throw new Error(`Missing cell: ${sel}`);
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let cursor = 0;
      let startNode: Node | null = null;
      let startOffset = 0;
      let endNode: Node | null = null;
      let endOffset = 0;
      let node = walker.nextNode();
      while (node) {
        const len = (node.textContent ?? '').length;
        if (!startNode && from <= cursor + len) {
          startNode = node;
          startOffset = Math.max(0, from - cursor);
        }
        if (!endNode && to <= cursor + len) {
          endNode = node;
          endOffset = Math.max(0, to - cursor);
          break;
        }
        cursor += len;
        node = walker.nextNode();
      }
      if (!startNode || !endNode) throw new Error('Selection offsets out of range');
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      const selection = root?.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    },
    { sel: selector, from: start, to: end }
  );
}

test('formats simple table cells via floating toolbar, shortcuts, and collapsed caret', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'table-rich-format',
    title: '',
    blocks: [
      {
        id: 't1',
        type: 'table',
        text: [],
        props: {
          table: {
            columns: [{ id: 'c1', width: 200 }, { id: 'c2', width: 200 }],
            rows: [{ id: 'r1', cells: { c1: { text: 'Hello world' } } }],
          },
        },
        children: [],
      },
    ],
  });

  const c1Selector = '.nb-table-cell[data-row-id="r1"][data-column-id="c1"]';
  const c1 = page.locator(c1Selector);
  await c1.click();
  await selectCellRange(page, c1Selector, 0, 5);

  const toolbar = page.locator('.nb-db-inline-toolbar');
  await expect(toolbar).toBeVisible();
  const boldBtn = toolbar.locator('.nb-db-inline-tool[data-tag="strong"]');
  await expect(boldBtn).toHaveAttribute('data-active', 'false');
  await expect(boldBtn).toHaveAttribute('aria-pressed', 'false');
  await boldBtn.click();
  await expect(boldBtn).toHaveAttribute('data-active', 'true');
  await expect(boldBtn).toHaveAttribute('aria-pressed', 'true');

  let doc = await getDoc(page);
  type CellShape = { text?: string; runs?: Array<{ text: string; marks?: Record<string, unknown> }> };
  let cellData = (
    doc.blocks[0]?.props.table as { rows: Array<{ cells: Record<string, CellShape> }> }
  ).rows[0]?.cells.c1;
  expect(cellData).toEqual({
    text: 'Hello world',
    runs: [{ text: 'Hello', marks: { bold: true } }, { text: ' world' }],
  });

  // Shortcuts toggle italic, underline, code, strike, and remove bold on partial range
  for (const [shortcut, mark] of [
    ['Control+i', 'italic'],
    ['Control+u', 'underline'],
    ['Control+e', 'code'],
    ['Control+Shift+s', 'strike'],
  ] as const) {
    await page.keyboard.press(shortcut);
    doc = await getDoc(page);
    cellData = (
      doc.blocks[0]?.props.table as { rows: Array<{ cells: Record<string, CellShape> }> }
    ).rows[0]?.cells.c1;
    expect(cellData?.runs?.[0]?.marks?.[mark]).toBe(true);
    await page.keyboard.press(shortcut);
  }
  await page.keyboard.press('Control+b');
  doc = await getDoc(page);
  cellData = (
    doc.blocks[0]?.props.table as { rows: Array<{ cells: Record<string, CellShape> }> }
  ).rows[0]?.cells.c1;
  expect(cellData).toEqual({ text: 'Hello world' });

  // Collapsed-caret pending formatting
  const c2 = page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c2"]');
  await c2.click();
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Bold');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Plain');
  await expect(c2).toHaveText('BoldPlain');
  doc = await getDoc(page);
  const c2Data = (
    doc.blocks[0]?.props.table as { rows: Array<{ cells: Record<string, CellShape> }> }
  ).rows[0]?.cells.c2;
  expect(c2Data).toEqual({
    text: 'BoldPlain',
    runs: [{ text: 'Bold', marks: { bold: true } }, { text: 'Plain' }],
  });
});

test('preserves caret position and formatting across inline Undo/Redo in table cells', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'table-rich-undo',
    title: '',
    blocks: [
      {
        id: 't1',
        type: 'table',
        text: [],
        props: {
          table: {
            columns: [{ id: 'c1', width: 220 }],
            rows: [
              {
                id: 'r1',
                cells: {
                  c1: {
                    text: 'Hello world',
                    runs: [{ text: 'Hello', marks: { bold: true } }, { text: ' world' }],
                  },
                },
              },
            ],
          },
        },
        children: [],
      },
    ],
  });

  const c1Selector = '.nb-table-cell[data-row-id="r1"][data-column-id="c1"]';
  const c1 = page.locator(c1Selector);
  await c1.click();
  await selectCellRange(page, c1Selector, 5, 5);
  await page.keyboard.type('!');
  await expect(c1).toHaveText('Hello! world');

  await page.keyboard.press('Control+z');
  await expect(c1).toBeFocused();
  await expect(c1).toHaveText('Hello world');
  await expect(c1.locator('.nb-m-bold')).toHaveText('Hello');

  // Verify caret stayed in the middle of the cell (offset 6, neither 0 nor end 11) by typing '?'
  await page.keyboard.type('?');
  await expect(c1).toHaveText('Hello ?world');

  await page.keyboard.press('Control+z');
  await expect(c1).toHaveText('Hello world');
  await page.keyboard.press('Control+Shift+z');
  await expect(c1).toHaveText('Hello ?world');
});

test('guards IME composition and sanitizes single-cell HTML paste', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());

  const c1Selector = '.nb-table-cell[data-row-id="r1"][data-column-id="c1"]';
  const c1 = page.locator(c1Selector);
  await c1.click();
  await page.keyboard.press('End');

  await page.evaluate(sel => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const cell = root?.querySelector<HTMLElement>(sel);
    if (!cell) throw new Error('Missing cell');
    cell.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    cell.textContent = 'Aあ';
    cell.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }, c1Selector);

  // Enter during composition did not move focus to row 2, and mid-composition input did not commit
  await expect(c1).toBeFocused();
  let doc = await getDoc(page);
  expect(
    (doc.blocks[0]?.props.table as { rows: Array<{ cells: Record<string, { text?: string }> }> })
      .rows[0]?.cells.c1?.text
  ).toBe('A');

  await page.evaluate(sel => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const cell = root?.querySelector<HTMLElement>(sel);
    cell?.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'あ' }));
  }, c1Selector);

  doc = await getDoc(page);
  expect(
    (doc.blocks[0]?.props.table as { rows: Array<{ cells: Record<string, { text?: string }> }> })
      .rows[0]?.cells.c1?.text
  ).toBe('Aあ');

  // Single-cell paste with raw HTML + plain text inserts sanitized plain text only
  const c2Selector = '.nb-table-cell[data-row-id="r1"][data-column-id="c2"]';
  const c2 = page.locator(c2Selector);
  await c2.click();
  await page.keyboard.press('End');
  await page.evaluate(sel => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const cell = root?.querySelector<HTMLElement>(sel);
    const data = new DataTransfer();
    data.setData('text/html', '<b>Hi</b><img src=x><table><tr><td>bad</td></tr></table>');
    data.setData('text/plain', 'Hi');
    cell?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
  }, c2Selector);

  await expect(c2).toHaveText('BHi');
  await expect(c2.locator('img, table, b')).toHaveCount(0);
});

test('preserves rich-text marks when pasting an HTML table', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      'text/html',
      '<table><tr><td><strong>Bold</strong> and <code>code</code></td><td>Plain</td></tr></table>'
    );
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('[data-block-id="b1"] .nb-text')
      ?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
  });
  await expect(page.locator('.nb-table-grid')).toBeVisible();
  const doc = await getDoc(page);
  const table = doc.blocks.find(block => block.type === 'table')?.props.table as {
    columns: Array<{ id: string }>;
    rows: Array<{
      cells: Record<string, { text?: string; runs?: Array<{ text: string; marks?: Record<string, unknown> }> }>;
    }>;
  };
  const [c1, c2] = table.columns;
  expect(table.rows[0]?.cells[c1!.id]).toEqual({
    text: 'Bold and code',
    runs: [
      { text: 'Bold', marks: { bold: true } },
      { text: ' and ' },
      { text: 'code', marks: { code: true } },
    ],
  });
  expect(table.rows[0]?.cells[c2!.id]).toEqual({ text: 'Plain' });
});

test('preserves Shift+Enter line breaks alongside rich-text marks', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());
  const c2 = page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c2"]');
  await c2.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Top');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Bottom');

  const doc = await getDoc(page);
  const cellData = (
    doc.blocks[0]?.props.table as {
      rows: Array<{
        cells: Record<string, { text?: string; runs?: Array<{ text: string; marks?: Record<string, unknown> }> }>;
      }>;
    }
  ).rows[0]?.cells.c2;
  expect(cellData?.text).toBe('BTop\nBottom');
  expect(cellData?.runs).toEqual([
    { text: 'B' },
    { text: 'Top\nBottom', marks: { bold: true } },
  ]);
});

test('renders highlight and text-color marks inside simple table cells', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'table-colors',
    title: '',
    blocks: [
      {
        id: 't1',
        type: 'table',
        text: [],
        props: {
          table: {
            columns: [{ id: 'c1', width: 180 }],
            rows: [
              {
                id: 'r1',
                cells: {
                  c1: {
                    text: 'Colored',
                    runs: [{ text: 'Colored', marks: { highlight: 'yellow', color: 'red' } }],
                  },
                },
              },
            ],
          },
        },
        children: [],
      },
    ],
  });

  const span = page.locator('.nb-table-cell [data-highlight="yellow"][data-text-color="red"]');
  await expect(span).toHaveText('Colored');
  const styles = await span.evaluate(el => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color };
  });
  expect(styles.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(styles.color).not.toBe('rgb(0, 0, 0)');
});

test('reorders rows and columns via drag handles with drop-line indicator, Undo, and click menu fallback', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'table-drag-reorder',
    title: '',
    blocks: [
      {
        id: 't1',
        type: 'table',
        text: [],
        props: {
          table: {
            columns: [
              { id: 'c1', width: 110, backgroundColor: '#fef3c7' },
              { id: 'c2', width: 150 },
              { id: 'c3', width: 190 },
            ],
            rows: [
              {
                id: 'r1',
                cells: {
                  c1: { text: 'R1C1', runs: [{ text: 'R1C1', marks: { bold: true } }] },
                  c2: { text: 'R1C2' },
                  c3: { text: 'R1C3' },
                },
              },
              { id: 'r2', cells: { c1: { text: 'R2C1' } } },
              { id: 'r3', cells: { c1: { text: 'R3C1' } } },
            ],
          },
        },
        children: [],
      },
    ],
  });

  // Drag row 1 handle below row 3
  await page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c1"]').hover();
  const rowHandle = page.locator('.nb-table-row-handle[data-row-id="r1"]');
  const rowHandleBox = await rowHandle.boundingBox();
  const r3Box = await page.locator('.nb-table-cell[data-row-id="r3"][data-column-id="c1"]').boundingBox();
  if (!rowHandleBox || !r3Box) throw new Error('Missing row drag boxes');

  await page.mouse.move(rowHandleBox.x + rowHandleBox.width / 2, rowHandleBox.y + rowHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(r3Box.x + r3Box.width / 2, r3Box.y + r3Box.height - 2, { steps: 8 });
  await expect(page.locator('.nb-table-drop-line')).toHaveAttribute('data-axis', 'row');
  await expect(page.locator('.nb-table-drop-line')).toHaveAttribute('data-visible', 'true');
  await page.mouse.up();

  await expect(page.locator('.nb-table-menu')).toHaveCount(0);
  await expect(page.locator('.nb-table-drop-line')).toHaveAttribute('data-visible', 'false');
  let doc = await getDoc(page);
  type ReorderTable = {
    columns: Array<{ id: string; width?: number; backgroundColor?: string }>;
    rows: Array<{ id: string; cells: Record<string, { text?: string; runs?: unknown[] }> }>;
  };
  let table = doc.blocks[0]?.props.table as ReorderTable;
  expect(table.rows.map(r => r.id)).toEqual(['r2', 'r3', 'r1']);
  expect(table.rows[2]?.cells.c1?.runs).toEqual([{ text: 'R1C1', marks: { bold: true } }]);

  // Undo restores original row order
  await page.evaluate(() => {
    (window as unknown as { __editor?: { undo(): boolean } }).__editor?.undo();
  });
  doc = await getDoc(page);
  table = doc.blocks[0]?.props.table as ReorderTable;
  expect(table.rows.map(r => r.id)).toEqual(['r1', 'r2', 'r3']);

  // Drag column 1 handle past column 3
  await page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c1"]').hover();
  const colHandle = page.locator('.nb-table-column-handle[data-column-id="c1"]');
  const colHandleBox = await colHandle.boundingBox();
  const c3Box = await page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c3"]').boundingBox();
  if (!colHandleBox || !c3Box) throw new Error('Missing column drag boxes');

  await page.mouse.move(colHandleBox.x + colHandleBox.width / 2, colHandleBox.y + colHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(c3Box.x + c3Box.width - 2, c3Box.y + c3Box.height / 2, { steps: 8 });
  await expect(page.locator('.nb-table-drop-line')).toHaveAttribute('data-axis', 'column');
  await expect(page.locator('.nb-table-drop-line')).toHaveAttribute('data-visible', 'true');
  await page.mouse.up();

  await expect(page.locator('.nb-table-menu')).toHaveCount(0);
  doc = await getDoc(page);
  table = doc.blocks[0]?.props.table as ReorderTable;
  expect(table.columns.map(c => c.id)).toEqual(['c2', 'c3', 'c1']);
  expect(table.columns[2]).toMatchObject({ id: 'c1', width: 110, backgroundColor: '#fef3c7' });
  expect(table.rows[0]?.cells.c1?.runs).toEqual([{ text: 'R1C1', marks: { bold: true } }]);

  // Undo restores original column order
  await page.evaluate(() => {
    (window as unknown as { __editor?: { undo(): boolean } }).__editor?.undo();
  });
  doc = await getDoc(page);
  table = doc.blocks[0]?.props.table as ReorderTable;
  expect(table.columns.map(c => c.id)).toEqual(['c1', 'c2', 'c3']);

  // Normal click without drag still opens row & column menus
  await page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c1"]').hover();
  await page.locator('.nb-table-row-handle[data-row-id="r1"]').click();
  await expect(page.locator('.nb-table-menu')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.locator('.nb-table-cell[data-row-id="r1"][data-column-id="c1"]').hover();
  await page.locator('.nb-table-column-handle[data-column-id="c1"]').click();
  await expect(page.locator('.nb-table-menu')).toHaveCount(1);
});

test('blocks handles, shortcuts, and paste in readonly simple tables', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, tableDoc());
  await page.evaluate(() => {
    (window as unknown as { __editor?: { setReadonly(value: boolean): void } }).__editor?.setReadonly(
      true
    );
  });

  await expect(page.locator('.nb-table-row-handle')).toHaveCount(0);
  await expect(page.locator('.nb-table-column-handle')).toHaveCount(0);

  const c1Selector = '.nb-table-cell[data-row-id="r1"][data-column-id="c1"]';
  const c1 = page.locator(c1Selector);
  await expect(c1).toHaveAttribute('contenteditable', 'false');
  await c1.click();
  await page.keyboard.press('Control+b');
  await page.evaluate(sel => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const cell = root?.querySelector<HTMLElement>(sel);
    const data = new DataTransfer();
    data.setData('text/plain', 'Injected');
    cell?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
  }, c1Selector);

  const doc = await getDoc(page);
  expect(
    (doc.blocks[0]?.props.table as { rows: Array<{ cells: Record<string, { text?: string; runs?: unknown[] }> }> })
      .rows[0]?.cells.c1
  ).toEqual({ text: 'A' });
});

test('preserves trailing newlines when editing earlier text in a plain table cell', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'table-trailing-newline',
    title: '',
    blocks: [
      {
        id: 't1',
        type: 'table',
        text: [],
        props: {
          table: {
            columns: [{ id: 'c1' }, { id: 'c2' }],
            rows: [{ id: 'r1', cells: { c1: { text: 'hello\n' } } }],
          },
        },
        children: [],
      },
    ],
  });

  const cellSelector = '.nb-table-cell[data-row-id="r1"][data-column-id="c1"]';
  const cell = page.locator(cellSelector);
  await cell.click();
  await page.evaluate(sel => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const el = root?.querySelector<HTMLElement>(sel);
    const textNode = el?.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Missing leading text node');
    }
    const range = document.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);
    const selection = root!.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, cellSelector);
  await page.keyboard.type('X');

  const doc = await getDoc(page);
  expect(
    (doc.blocks[0]?.props.table as { rows: Array<{ cells: Record<string, { text?: string; runs?: unknown[] }> }> })
      .rows[0]?.cells.c1
  ).toEqual({ text: 'heXllo\n' });
});
