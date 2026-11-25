import { expect, test, type Page } from '@playwright/test';
import { getDoc, openFixture } from './helpers';

const p2Doc = () => ({
  version: 1,
  id: 'database-p2',
  title: '',
  blocks: [
    {
      id: 'db1',
      type: 'database',
      text: [],
      props: {
        database: {
          variant: 'database',
          title: 'P2',
          titleColumnId: 'name',
          columns: [
            { id: 'name', name: 'Name', type: 'text' },
            { id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Done'] },
            { id: 'owner', name: 'Owner', type: 'text' },
          ],
          views: [
            {
              id: 'v-table',
              name: 'Table',
              type: 'table',
              filters: [],
              columns: [
                { id: 'name', width: 220 },
                { id: 'status', width: 140 },
                { id: 'owner', width: 140 },
              ],
            },
            {
              id: 'v-board',
              name: 'Board',
              type: 'board',
              filters: [],
              groupBy: 'status',
              columns: [
                { id: 'name', width: 220 },
                { id: 'status', width: 140 },
                { id: 'owner', width: 140 },
              ],
            },
          ],
          activeViewId: 'v-table',
          rows: [
            {
              id: 'r1',
              cells: {
                name: { text: 'One', runs: [{ text: 'One', marks: { bold: true } }] },
                status: { text: 'Todo' },
                owner: { text: 'Ada' },
              },
              page: {
                content: [
                  { text: 'Row page ', marks: { bold: true } },
                  { text: 'body' },
                ],
              },
            },
            {
              id: 'r2',
              cells: {
                name: { text: 'Two' },
                status: { text: 'Todo' },
                owner: { text: 'Lin' },
              },
            },
            {
              id: 'r3',
              cells: {
                name: { text: 'Three' },
                status: { text: 'Done' },
                owner: { text: 'You' },
              },
            },
          ],
        },
      },
      children: [],
    },
  ],
});

async function setDoc(page: Page, doc = p2Doc()): Promise<void> {
  await page.evaluate(value => {
    const editor = (window as unknown as { __editor?: { setDoc(value: string): void } })
      .__editor;
    editor?.setDoc(JSON.stringify(value));
  }, doc);
  await expect(page.locator('.nb-db').first()).toBeVisible();
}

function multiGroupDoc() {
  const doc = p2Doc();
  const database = doc.blocks[0]!.props.database as unknown as {
    columns: Array<Record<string, unknown>>;
    views: Array<Record<string, unknown>>;
    rows: Array<{ id: string; cells: Record<string, Record<string, unknown>> }>;
    activeViewId?: string;
  };
  database.columns.push({
    id: 'tags',
    name: 'Tags',
    type: 'multi-select',
    options: ['Todo', 'Done'],
  });
  const board = database.views.find(view => view.id === 'v-board')!;
  board.groupBy = 'tags';
  board.columns = [
    ...(board.columns as Array<Record<string, unknown>>),
    { id: 'tags', width: 140 },
  ];
  database.rows[0]!.cells.tags = { values: ['Todo', 'Done'] };
  database.rows[1]!.cells.tags = { values: ['Done'] };
  database.rows[2]!.cells.tags = { values: ['Done'] };
  database.activeViewId = 'v-board';
  return doc;
}

async function showBoard(page: Page): Promise<void> {
  const boardTab = page.locator('.nb-db-viewtab', { hasText: 'Board' });
  if ((await boardTab.getAttribute('data-active')) !== 'true') {
    await boardTab.click();
  }
  await expect(page.locator('.nb-db-board')).toBeVisible();
}

test('formats text cells and persists runs', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);

  const cell = page.locator(
    '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
  );
  await expect(cell.locator('.nb-m-bold')).toHaveText('One');
  await cell.click();
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const text = root?.querySelector(
      '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
    );
    if (!text) throw new Error('Missing rich text cell');
    const node = document
      .createTreeWalker(text, NodeFilter.SHOW_TEXT)
      .nextNode();
    if (!node) throw new Error('Missing rich text node');
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, (node.textContent ?? '').length);
    const selection = root!.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  const toolbar = page.locator('.nb-db-inline-toolbar');
  await expect(toolbar).toBeVisible();
  await page.locator('.nb-db-inline-tool[data-tag="em"]').click();

  let doc = await getDoc(page);
  let database = doc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string; runs?: Array<{ text: string; marks?: Record<string, unknown> }> }> }>;
  };
  let saved = database.rows.find(row => row.id === 'r1')?.cells.name;
  expect(saved?.text).toBe('One');
  expect(saved?.runs?.[0]?.marks).toMatchObject({ bold: true, italic: true });

  await page.locator('.nb-db-inline-tool[data-tag="strong"]').click();
  doc = await getDoc(page);
  database = doc.blocks[0]?.props.database as typeof database;
  saved = database.rows.find(row => row.id === 'r1')?.cells.name;
  expect(saved?.runs?.[0]?.marks).toEqual({ italic: true });
});

test('keeps the caret while typing plain text in a rich cell', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  const cell = page.locator(
    '.nb-db-cell[data-row-id="r2"][data-column-id="name"] .nb-db-rich-text'
  );
  await cell.click();
  await page.keyboard.press('End');
  await page.keyboard.type('!?');
  await expect(cell).toHaveText('Two!?');
  await expect(cell).toBeFocused();
  const doc = await getDoc(page);
  const rows = (doc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  }).rows;
  expect(rows.find(row => row.id === 'r2')?.cells.name?.text).toBe('Two!?');
});

test('removes a mark only from the selected range', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  const cell = page.locator(
    '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
  );
  await cell.click();
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const text = root?.querySelector(
      '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
    );
    const node = text ? document.createTreeWalker(text, NodeFilter.SHOW_TEXT).nextNode() : null;
    if (!node) throw new Error('Missing rich text node');
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 2);
    const selection = root!.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.locator('.nb-db-inline-tool[data-tag="strong"]').click();

  const doc = await getDoc(page);
  const saved = (doc.blocks[0]?.props.database as {
    rows: Array<{
      id: string;
      cells: Record<string, {
        text?: string;
        runs?: Array<{ text: string; marks?: { bold?: true } }>;
      }>;
    }>;
  }).rows.find(row => row.id === 'r1')?.cells.name;
  expect(saved?.text).toBe('One');
  expect(saved?.runs?.[0]?.text).toBe('On');
  expect(saved?.runs?.[0]?.marks?.bold).toBeUndefined();
  expect(saved?.runs?.[1]?.text).toBe('e');
  expect(saved?.runs?.[1]?.marks?.bold).toBe(true);
});

test('synchronizes marks-only undo in record-page text fields', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  const row = page.locator('.nb-db-table tbody tr[data-row-id="r2"]');
  await row.hover();
  await row.locator('.nb-db-row-expand').click();
  const field = page.locator(
    '.nb-db-detail-field[data-column-id="owner"] .nb-db-detail-text'
  );
  await expect(field).toHaveText('Lin');
  await field.click();
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const text = root?.querySelector(
      '.nb-db-detail-field[data-column-id="owner"] .nb-db-detail-text'
    );
    const node = text ? document.createTreeWalker(text, NodeFilter.SHOW_TEXT).nextNode() : null;
    if (!node) throw new Error('Missing detail text node');
    const range = document.createRange();
    range.selectNodeContents(text!);
    const selection = root!.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.locator('.nb-db-inline-tool[data-tag="strong"]').click();
  let doc = await getDoc(page);
  let owner = (doc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string; runs?: unknown[] }> }>;
  }).rows.find(row => row.id === 'r2')?.cells.owner;
  expect(owner?.runs?.length).toBe(1);

  await page.keyboard.press('Control+z');
  await expect(field).toHaveText('Lin');
  await expect(field.locator('.nb-m-bold')).toHaveCount(0);
  await field.press('End');
  await page.keyboard.type('!');
  doc = await getDoc(page);
  owner = (doc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string; runs?: unknown[] }> }>;
  }).rows.find(row => row.id === 'r2')?.cells.owner;
  expect(owner?.text).toBe('Lin!');
  expect(owner?.runs).toBeUndefined();
});

test('applies formatting typed after a collapsed-caret shortcut', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page);
  const cell = page.locator(
    '.nb-db-cell[data-row-id="r2"][data-column-id="name"] .nb-db-rich-text'
  );
  await cell.fill('');
  await cell.press('End');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Bold');
  await expect(cell).toHaveText('Bold');
  const doc = await getDoc(page);
  const saved = (doc.blocks[0]?.props.database as {
    rows: Array<{
      id: string;
      cells: Record<string, {
        text?: string;
        runs?: Array<{ text: string; marks?: { bold?: true } }>;
      }>;
    }>;
  }).rows.find(row => row.id === 'r2')?.cells.name;
  expect(saved?.text).toBe('Bold');
  expect(saved?.runs?.[0]?.marks?.bold).toBe(true);
});

test('toggles pending formatting off at a collapsed caret', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  const cell = page.locator(
    '.nb-db-cell[data-row-id="r2"][data-column-id="name"] .nb-db-rich-text'
  );
  await cell.fill('');
  await cell.press('End');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Plain');
  await expect(cell).toHaveText('Plain');
  const doc = await getDoc(page);
  const saved = (doc.blocks[0]?.props.database as {
    rows: Array<{
      id: string;
      cells: Record<string, { text?: string; runs?: unknown[] }>;
    }>;
  }).rows.find(row => row.id === 'r2')?.cells.name;
  expect(saved?.text).toBe('Plain');
  expect(saved?.runs).toBeUndefined();
});

test('switches back to plain text after typing formatted text with a collapsed caret', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page);
  const cell = page.locator(
    '.nb-db-cell[data-row-id="r2"][data-column-id="name"] .nb-db-rich-text'
  );
  await cell.fill('');
  await cell.press('End');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Bold');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Plain');
  await expect(cell).toHaveText('BoldPlain');
  const doc = await getDoc(page);
  const saved = (doc.blocks[0]?.props.database as {
    rows: Array<{
      id: string;
      cells: Record<
        string,
        { text?: string; runs?: Array<{ text: string; marks?: Record<string, unknown> }> }
      >;
    }>;
  }).rows.find(row => row.id === 'r2')?.cells.name;
  expect(saved?.text).toBe('BoldPlain');
  expect(saved?.runs).toEqual([
    { text: 'Bold', marks: { bold: true } },
    { text: 'Plain' },
  ]);
});

test('sanitizes pasted content and keeps detail text single-line', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  const row = page.locator('.nb-db-table tbody tr[data-row-id="r2"]');
  await row.hover();
  await row.locator('.nb-db-row-expand').click();

  const detailText = page.locator(
    '.nb-db-detail-field[data-column-id="owner"] .nb-db-detail-text'
  );
  await detailText.click();
  await detailText.press('End');
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector('.nb-db-detail-text');
    const data = new DataTransfer();
    data.setData('text/html', '<b>X</b><script>alert(1)</script>');
    data.setData('text/plain', '\nX');
    target?.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, clipboardData: data })
    );
  });
  await expect(detailText).toHaveText('Lin X');
  await page.keyboard.press('Enter');
  await expect(detailText).not.toBeFocused();

  const pageBody = page.locator('.nb-db-page-text');
  await pageBody.click();
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector('.nb-db-page-text');
    const data = new DataTransfer();
    data.setData('text/html', '<strong>Html</strong>');
    data.setData('text/plain', 'Line 1\r\nLine 2');
    target?.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, clipboardData: data })
    );
  });
  await expect(pageBody).toContainText('Line 1\nLine 2');
  await expect(pageBody.locator('strong, script')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await showBoard(page);
  const title = page.locator('.nb-db-card[data-row-id="r2"] .nb-db-card-title');
  await title.click();
  await title.press('End');
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector(
      '.nb-db-card[data-row-id="r2"] .nb-db-card-title'
    );
    const data = new DataTransfer();
    data.setData('text/html', '<b>Card</b>');
    data.setData('text/plain', '!\nNext');
    target?.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, clipboardData: data })
    );
  });
  await expect(title).toHaveText('Two! Next');
  await expect(title.locator('b')).toHaveCount(0);
});

test('keeps search input mounted and defers filtering during IME composition', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page);

  await page.locator('.nb-db-search-toggle').click();
  const search = page.locator('.nb-db-search');
  await expect(search).toBeFocused();

  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const input = root?.querySelector<HTMLInputElement>('.nb-db-search');
    if (!input) throw new Error('Missing search input');
    (window as unknown as { __searchInput?: HTMLInputElement }).__searchInput = input;
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = 'Two';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  });
  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(3);

  await page.evaluate(() => {
    const input = (window as unknown as { __searchInput?: HTMLInputElement })
      .__searchInput;
    input?.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: 'Two' })
    );
  });
  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(1);
  const sameNode = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const current = root?.querySelector<HTMLInputElement>('.nb-db-search');
    return (
      current ===
      (window as unknown as { __searchInput?: HTMLInputElement }).__searchInput
    );
  });
  expect(sameNode).toBe(true);
});

test('defers rich-text cell commits during IME composition', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);

  const cell = page.locator(
    '.nb-db-cell[data-row-id="r2"][data-column-id="name"] .nb-db-rich-text'
  );
  await cell.click();
  await cell.press('End');
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector<HTMLElement>(
      '.nb-db-cell[data-row-id="r2"][data-column-id="name"] .nb-db-rich-text'
    );
    if (!target) throw new Error('Missing cell');
    target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    target.textContent = 'Twoあ';
    target.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  });

  let doc = await getDoc(page);
  let text = (doc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  }).rows.find(row => row.id === 'r2')?.cells.name?.text;
  expect(text).toBe('Two');

  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector<HTMLElement>(
      '.nb-db-cell[data-row-id="r2"][data-column-id="name"] .nb-db-rich-text'
    );
    target?.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: 'あ' })
    );
  });

  doc = await getDoc(page);
  text = (doc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  }).rows.find(row => row.id === 'r2')?.cells.name?.text;
  expect(text).toBe('Twoあ');
});

test('preserves unrelated multi-select tags when dragging across board groups', async ({
  page,
}) => {
  const doc = multiGroupDoc();
  const database = doc.blocks[0]!.props.database as unknown as {
    columns: Array<{ id: string; options?: string[] }>;
    rows: Array<{ id: string; cells: Record<string, { values?: string[] }> }>;
  };
  database.columns.find(col => col.id === 'tags')!.options = [
    'Todo',
    'Urgent',
    'Done',
  ];
  database.rows[0]!.cells.tags = { values: ['Todo', 'Urgent'] };

  await openFixture(page);
  await setDoc(page, doc);
  await showBoard(page);

  const todo = page.locator('.nb-db-board-column[data-group="Todo"]');
  const done = page.locator('.nb-db-board-column[data-group="Done"]');
  await todo
    .locator('.nb-db-card[data-row-id="r1"]')
    .dragTo(done.locator('.nb-db-card[data-row-id="r2"]'), {
      targetPosition: { x: 20, y: 4 },
    });

  const nextDoc = await getDoc(page);
  const values = (nextDoc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { values?: string[] }> }>;
  }).rows.find(row => row.id === 'r1')?.cells.tags?.values;
  expect(values).toEqual(['Urgent', 'Done']);
});

test('persists an editable row page body', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page
    .locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]')
    .hover();
  await page.locator('.nb-db-row-expand').first().click();
  const pageBody = page.locator('.nb-db-page-text');
  await expect(pageBody).toContainText('Row page body');
  await pageBody.fill('Updated page body');

  const doc = await getDoc(page);
  const row = (doc.blocks[0]?.props.database as {
    rows: Array<{ id: string; page?: { content: Array<{ text: string }> } }>;
  }).rows.find(item => item.id === 'r1');
  expect(row?.page?.content.map(run => run.text).join('')).toBe(
    'Updated page body'
  );

  await page.keyboard.press('Escape');
  await page
    .locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]')
    .hover();
  await page.locator('.nb-db-row-expand').first().click();
  await expect(page.locator('.nb-db-page-text')).toHaveText('Updated page body');
});

test('adds board cards, opens cards and exposes group actions', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page);
  await showBoard(page);

  const todo = page.locator('.nb-db-board-column[data-group="Todo"]');
  await todo.hover();
  await todo.locator('.nb-db-board-add').click();
  await expect(todo.locator('.nb-db-card')).toHaveCount(3);
  await expect(page.locator('.nb-db-card-title:focus')).toHaveCount(1);

  const card = todo.locator('.nb-db-card').first();
  await card.hover();
  await expect(card.locator('.nb-db-card-ops')).toBeVisible();
  await card.locator('.nb-db-card-op[title="Open record"]').click();
  await expect(page.locator('.nb-db-detail')).toBeVisible();
  await page.keyboard.press('Escape');

  await todo.locator('.nb-db-board-group-op[title="Group actions"]').click();
  let menu = page.locator('.nb-db-board-group-menu');
  await expect(menu.getByRole('button', { name: 'Add card' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Delete cards' })).toBeVisible();
  await menu.getByRole('button', { name: 'Add card' }).click();
  await expect(todo.locator('.nb-db-card')).toHaveCount(4);

  await todo.locator('.nb-db-board-group-op[title="Group actions"]').click();
  menu = page.locator('.nb-db-board-group-menu');
  await menu.getByRole('button', { name: 'Delete cards' }).click();
  await expect(todo.locator('.nb-db-card')).toHaveCount(0);
});

test('preserves multi-select membership when reordering inside a group', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, multiGroupDoc());
  await showBoard(page);

  const done = page.locator('.nb-db-board-column[data-group="Done"]');
  await done
    .locator('.nb-db-card[data-row-id="r1"]')
    .dragTo(done.locator('.nb-db-card[data-row-id="r2"]'), {
      targetPosition: { x: 20, y: 4 },
    });
  const doc = await getDoc(page);
  const values = (doc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { values?: string[] }> }>;
  }).rows.find(row => row.id === 'r1')?.cells.tags?.values;
  expect(values).toEqual(['Todo', 'Done']);
});

test('appends a card dropped into empty space in its own group', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page);
  await showBoard(page);

  const todo = page.locator('.nb-db-board-column[data-group="Todo"]');
  const box = await todo.boundingBox();
  if (!box) throw new Error('Missing Todo column');
  await todo
    .locator('.nb-db-card[data-row-id="r1"]')
    .dragTo(todo, {
      targetPosition: { x: 20, y: box.height - 8 },
    });
  const doc = await getDoc(page);
  const view = (doc.blocks[0]?.props.database as {
    views: Array<{
      id: string;
      groupProperties?: Array<{ key: string; manuallyCardSort?: string[] }>;
    }>;
  }).views.find(item => item.id === 'v-board');
  expect(
    view?.groupProperties?.find(group => group.key === 'Todo')?.manuallyCardSort
  ).toEqual(['r2', 'r1']);
});

test('reorders board cards within and across groups', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await showBoard(page);

  await page
    .locator('.nb-db-card[data-row-id="r2"]')
    .dragTo(page.locator('.nb-db-card[data-row-id="r1"]'), {
      targetPosition: { x: 20, y: 4 },
    });
  let doc = await getDoc(page);
  let view = (doc.blocks[0]?.props.database as {
    views: Array<{
      id: string;
      groupProperties?: Array<{ key: string; manuallyCardSort?: string[] }>;
    }>;
  }).views.find(item => item.id === 'v-board');
  expect(
    view?.groupProperties?.find(group => group.key === 'Todo')?.manuallyCardSort
  ).toEqual(['r2', 'r1']);

  await page
    .locator('.nb-db-card[data-row-id="r3"]')
    .dragTo(page.locator('.nb-db-card[data-row-id="r1"]'), {
      targetPosition: { x: 20, y: 4 },
    });
  doc = await getDoc(page);
  const database = doc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
    views: Array<{
      id: string;
      groupProperties?: Array<{ key: string; manuallyCardSort?: string[] }>;
    }>;
  };
  expect(
    database.rows.find(row => row.id === 'r3')?.cells.status?.text
  ).toBe('Todo');
  view = database.views.find(item => item.id === 'v-board');
  expect(
    view?.groupProperties?.find(group => group.key === 'Todo')?.manuallyCardSort
  ).toEqual(['r2', 'r3', 'r1']);
});

test('toggles bold off across multiple runs with mixed marks', async ({ page }) => {
  const doc = p2Doc();
  const database = doc.blocks[0]!.props.database as unknown as {
    rows: Array<{ id: string; cells: Record<string, unknown> }>;
  };
  database.rows[0]!.cells.name = {
    text: 'Hello world',
    runs: [
      { text: 'Hello ', marks: { bold: true, italic: true } },
      { text: 'world', marks: { bold: true } },
    ],
  };

  await openFixture(page);
  await setDoc(page, doc);

  const cell = page.locator(
    '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
  );
  await cell.click();
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const text = root?.querySelector(
      '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
    );
    if (!text) throw new Error('Missing rich text cell');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = root!.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  await page.locator('.nb-db-inline-tool[data-tag="strong"]').click();

  const nextDoc = await getDoc(page);
  const saved = (nextDoc.blocks[0]?.props.database as {
    rows: Array<{
      id: string;
      cells: Record<string, { text?: string; runs?: Array<{ text: string; marks?: Record<string, unknown> }> }>;
    }>;
  }).rows.find(row => row.id === 'r1')?.cells.name;
  expect(saved?.text).toBe('Hello world');
  expect(saved?.runs).toEqual([
    { text: 'Hello ', marks: { italic: true } },
    { text: 'world' },
  ]);
});

test('removes bold only on a partial slice inside mixed-mark runs', async ({
  page,
}) => {
  const doc = p2Doc();
  const database = doc.blocks[0]!.props.database as unknown as {
    rows: Array<{ id: string; cells: Record<string, unknown> }>;
  };
  database.rows[0]!.cells.name = {
    text: 'Hello world',
    runs: [
      { text: 'Hello ', marks: { bold: true } },
      { text: 'world', marks: { bold: true, italic: true } },
    ],
  };

  await openFixture(page);
  await setDoc(page, doc);

  const cell = page.locator(
    '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
  );
  await cell.click();
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const text = root?.querySelector(
      '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
    );
    if (!text) throw new Error('Missing rich text cell');
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    walker.nextNode();
    const second = walker.nextNode();
    if (!second) throw new Error('Missing second text node');
    const range = document.createRange();
    range.setStart(second, 0);
    range.setEnd(second, 2);
    const selection = root!.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  await page.locator('.nb-db-inline-tool[data-tag="strong"]').click();

  const nextDoc = await getDoc(page);
  const saved = (nextDoc.blocks[0]?.props.database as {
    rows: Array<{
      id: string;
      cells: Record<string, { text?: string; runs?: Array<{ text: string; marks?: Record<string, unknown> }> }>;
    }>;
  }).rows.find(row => row.id === 'r1')?.cells.name;
  expect(saved?.text).toBe('Hello world');
  expect(saved?.runs).toEqual([
    { text: 'Hello ', marks: { bold: true } },
    { text: 'wo', marks: { italic: true } },
    { text: 'rld', marks: { bold: true, italic: true } },
  ]);
});

test('preserves cell DOM mid-composition in a sorted table and re-sorts on compositionend', async ({
  page,
}) => {
  const doc = p2Doc();
  const database = doc.blocks[0]!.props.database as unknown as {
    views: Array<{ id: string; sorts?: Array<{ columnId: string; direction: string }> }>;
  };
  database.views.find(view => view.id === 'v-table')!.sorts = [
    { columnId: 'name', direction: 'asc' },
  ];

  await openFixture(page);
  await setDoc(page, doc);

  const cell = page.locator(
    '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
  );
  await cell.click();
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector<HTMLElement>(
      '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
    );
    if (!target) throw new Error('Missing sorted cell');
    (window as unknown as { __sortedCell?: HTMLElement }).__sortedCell = target;
    target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    target.textContent = 'ZZZ';
    target.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  });

  const sameBeforeEnd = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const current = root?.querySelector<HTMLElement>(
      '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
    );
    return (
      current ===
      (window as unknown as { __sortedCell?: HTMLElement }).__sortedCell
    );
  });
  expect(sameBeforeEnd).toBe(true);

  let nextDoc = await getDoc(page);
  let r1Text = (nextDoc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  }).rows.find(row => row.id === 'r1')?.cells.name?.text;
  expect(r1Text).toBe('One');

  await page.evaluate(() => {
    const target = (window as unknown as { __sortedCell?: HTMLElement })
      .__sortedCell;
    target?.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: 'ZZZ' })
    );
  });

  nextDoc = await getDoc(page);
  r1Text = (nextDoc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  }).rows.find(row => row.id === 'r1')?.cells.name?.text;
  expect(r1Text).toBe('ZZZ');

  const rowOrder = await page
    .locator('.nb-db-table tbody tr[data-row-id]')
    .evaluateAll(rows => rows.map(row => row.getAttribute('data-row-id')));
  expect(rowOrder).toEqual(['r3', 'r2', 'r1']);
});

test('keeps board card drop indicator when dragleave targets a child element', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page);
  await showBoard(page);

  const card = page.locator('.nb-db-card[data-row-id="r1"]');
  const box = await card.boundingBox();
  if (!box) throw new Error('Missing card box');

  await page.evaluate(
    ({ x, y }) => {
      const root = document.querySelector('nobita-editor')?.shadowRoot;
      const target = root?.querySelector<HTMLElement>(
        '.nb-db-card[data-row-id="r1"]'
      );
      if (!target) throw new Error('Missing card');
      target.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        })
      );
    },
    { x: box.x + box.width / 2, y: box.y + 4 }
  );
  await expect(card).toHaveClass(/is-drop-before/);

  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector<HTMLElement>(
      '.nb-db-card[data-row-id="r1"]'
    );
    const child = target?.querySelector<HTMLElement>('.nb-db-card-title') ?? null;
    target?.dispatchEvent(
      new DragEvent('dragleave', {
        bubbles: true,
        relatedTarget: child,
      })
    );
  });
  await expect(card).toHaveClass(/is-drop-before/);

  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector<HTMLElement>(
      '.nb-db-card[data-row-id="r1"]'
    );
    target?.dispatchEvent(
      new DragEvent('dragleave', {
        bubbles: true,
        relatedTarget: null,
      })
    );
  });
  await expect(card).not.toHaveClass(/is-drop-before/);
});

test('tracks horizontal scroll for the fill handle via requestAnimationFrame', async ({
  page,
}) => {
  const doc = p2Doc();
  const database = doc.blocks[0]!.props.database as unknown as {
    columns: Array<{ id: string; name: string; type: string }>;
    views: Array<{
      id: string;
      columns: Array<{ id: string; width: number }>;
    }>;
  };
  const tableView = database.views.find(view => view.id === 'v-table')!;
  for (let i = 1; i <= 6; i += 1) {
    const id = `extra${i}`;
    database.columns.push({ id, name: `Extra ${i}`, type: 'text' });
    tableView.columns.push({ id, width: 220 });
  }

  await openFixture(page);
  await setDoc(page, doc);

  const cell = page.locator(
    '.nb-db-cell[data-row-id="r1"][data-column-id="status"]'
  );
  await cell.click();
  const handle = page.locator('.nb-db-fill-handle');
  await expect(handle).toHaveAttribute('data-visible', 'true');

  const beforeLeft = await handle.evaluate(el =>
    Number.parseFloat((el as HTMLElement).style.left)
  );

  const result = await page.evaluate(
    () =>
      new Promise<{ afterLeft: number; expectedLeft: number }>(resolve => {
        const root = document.querySelector('nobita-editor')?.shadowRoot;
        const scroll = root?.querySelector<HTMLElement>('.nb-db-scroll');
        const td = root?.querySelector<HTMLElement>(
          '.nb-db-cell[data-row-id="r1"][data-column-id="status"]'
        );
        const fill = root?.querySelector<HTMLElement>('.nb-db-fill-handle');
        if (!scroll || !td || !fill) throw new Error('Missing scroll/cell/handle');
        scroll.scrollLeft = 100;
        scroll.dispatchEvent(new Event('scroll'));
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve({
              afterLeft: Number.parseFloat(fill.style.left),
              expectedLeft: Math.round(td.getBoundingClientRect().right - 1),
            });
          });
        });
      })
  );

  expect(result.afterLeft).toBeLessThan(beforeLeft);
  expect(result.afterLeft).toBe(result.expectedLeft);
});

test('aligns block-generated newline offsets for formatting and pasting in row page body', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page);

  const row = page.locator('.nb-db-table tbody tr[data-row-id="r1"]');
  await row.hover();
  await row.locator('.nb-db-row-expand').click();

  const pageBody = page.locator('.nb-db-page-text');
  await pageBody.click();
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const body = root?.querySelector<HTMLElement>('.nb-db-page-text');
    if (!body) throw new Error('Missing page body');
    body.innerHTML = 'abc<div>def</div>';
    const defText = body.querySelector('div')?.firstChild;
    if (!defText) throw new Error('Missing def text node');
    const range = document.createRange();
    range.setStart(defText, 0);
    range.setEnd(defText, 3);
    const selection = root!.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  await page.locator('.nb-db-inline-tool[data-tag="strong"]').click();

  let doc = await getDoc(page);
  let saved = (doc.blocks[0]?.props.database as {
    rows: Array<{
      id: string;
      page?: { content: Array<{ text: string; marks?: Record<string, unknown> }> };
    }>;
  }).rows.find(item => item.id === 'r1')?.page?.content;
  expect(saved).toEqual([
    { text: 'abc\n' },
    { text: 'def', marks: { bold: true } },
  ]);

  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const body = root?.querySelector<HTMLElement>('.nb-db-page-text');
    if (!body) throw new Error('Missing page body');
    body.innerHTML = 'abc<div>def</div>';
    const div = body.querySelector('div');
    if (!div) throw new Error('Missing block div');
    const range = document.createRange();
    range.setStart(div, 0);
    range.collapse(true);
    const selection = root!.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const data = new DataTransfer();
    data.setData('text/plain', 'X');
    body.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, clipboardData: data })
    );
  });

  doc = await getDoc(page);
  saved = (doc.blocks[0]?.props.database as {
    rows: Array<{
      id: string;
      page?: { content: Array<{ text: string; marks?: Record<string, unknown> }> };
    }>;
  }).rows.find(item => item.id === 'r1')?.page?.content;
  expect(saved?.map(run => run.text).join('')).toBe('abc\nXdef');
});

test('ignores Enter keydown during IME composition across database text hosts', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page);

  // Table cell
  const cell = page.locator(
    '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
  );
  await cell.click();
  const cellResult = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector<HTMLElement>(
      '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
    );
    if (!target) throw new Error('Missing table cell');
    target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    target.dispatchEvent(event);
    return {
      defaultPrevented: event.defaultPrevented,
      stillFocused: root?.activeElement === target,
    };
  });
  expect(cellResult).toEqual({ defaultPrevented: false, stillFocused: true });

  // Detail text field
  const row = page.locator('.nb-db-table tbody tr[data-row-id="r1"]');
  await row.hover();
  await row.locator('.nb-db-row-expand').click();
  const detailText = page.locator(
    '.nb-db-detail-field[data-column-id="owner"] .nb-db-detail-text'
  );
  await detailText.click();
  const detailResult = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector<HTMLElement>('.nb-db-detail-text');
    if (!target) throw new Error('Missing detail text');
    target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    target.dispatchEvent(event);
    return {
      defaultPrevented: event.defaultPrevented,
      stillFocused: root?.activeElement === target,
    };
  });
  expect(detailResult).toEqual({ defaultPrevented: false, stillFocused: true });

  // Board card title
  await page.keyboard.press('Escape');
  await showBoard(page);
  const title = page.locator('.nb-db-card[data-row-id="r1"] .nb-db-card-title');
  await title.click();
  const boardResult = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector<HTMLElement>(
      '.nb-db-card[data-row-id="r1"] .nb-db-card-title'
    );
    if (!target) throw new Error('Missing board card title');
    target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    target.dispatchEvent(event);
    return {
      defaultPrevented: event.defaultPrevented,
      stillFocused: root?.activeElement === target,
    };
  });
  expect(boardResult).toEqual({ defaultPrevented: false, stillFocused: true });
});

test('preserves caret position on undo in table rich-text cells', async ({ page }) => {
  await openFixture(page);
  const doc = p2Doc();
  const rows = (
    doc.blocks[0]!.props.database as {
      rows: Array<{ id: string; cells: Record<string, unknown> }>;
    }
  ).rows;
  rows[0]!.cells.name = {
    text: 'Hello World',
    runs: [{ text: 'Hello ', marks: { bold: true } }, { text: 'World' }],
  };
  await setDoc(page, doc);

  const cell = page.locator(
    '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
  );
  await cell.click();
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector<HTMLElement>(
      '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
    );
    const firstText = target
      ? document.createTreeWalker(target, NodeFilter.SHOW_TEXT).nextNode()
      : null;
    if (!firstText) throw new Error('Missing text node');
    const range = document.createRange();
    range.setStart(firstText, 5);
    range.collapse(true);
    const selection = root!.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.type('!');
  await expect(cell).toHaveText('Hello! World');

  await page.keyboard.press('Control+z');
  await expect(cell).toHaveText('Hello World');
  const caret = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector<HTMLElement>(
      '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
    );
    const selection = root?.getSelection();
    if (!target || !selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(target);
    pre.setEnd(range.startContainer, range.startOffset);
    return {
      focused: root?.activeElement === target,
      offset: pre.toString().length,
    };
  });
  expect(caret?.focused).toBe(true);
  expect(caret?.offset).toBeGreaterThan(0);
});

test('deep-clones rich-text runs when duplicating a column', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);

  await page.locator('.nb-db-th[data-column-id="name"] .nb-db-col-head').click();
  await page.getByRole('button', { name: 'Duplicate' }).click();

  let doc = await getDoc(page);
  let db = doc.blocks[0]?.props.database as {
    columns: Array<{ id: string; name: string }>;
    rows: Array<{
      id: string;
      cells: Record<string, { text?: string; runs?: Array<{ text: string; marks?: Record<string, unknown> }> }>;
    }>;
  };
  const copyCol = db.columns.find(col => col.name === 'Name copy');
  expect(copyCol).toBeTruthy();

  const copyCell = page.locator(
    `.nb-db-cell[data-row-id="r1"][data-column-id="${copyCol!.id}"] .nb-db-rich-text`
  );
  await copyCell.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Copy');
  await expect(copyCell).toHaveText('One Copy');

  doc = await getDoc(page);
  db = doc.blocks[0]?.props.database as typeof db;
  const original = db.rows.find(row => row.id === 'r1')?.cells.name;
  expect(original?.text).toBe('One');
  expect(original?.runs).toEqual([{ text: 'One', marks: { bold: true } }]);
});

test('applies highlight/text-color styles in database rich-text and opens links on Mod+Click in record page', async ({
  page,
}) => {
  await openFixture(page);
  const doc = p2Doc();
  const rows = (
    doc.blocks[0]!.props.database as {
      rows: Array<{
        id: string;
        cells: Record<string, unknown>;
        page?: { content: unknown[] };
      }>;
    }
  ).rows;
  rows[0]!.cells.name = {
    text: 'Highlight Color',
    runs: [
      { text: 'Highlight', marks: { highlight: 'yellow' } },
      { text: ' ' },
      { text: 'Color', marks: { color: 'red' } },
    ],
  };
  rows[0]!.page = {
    content: [
      {
        text: 'Docs',
        marks: { link: 'https://example.com/docs', highlight: 'yellow', color: 'red' },
      },
    ],
  };
  await setDoc(page, doc);

  const styles = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const hl = root?.querySelector<HTMLElement>('.nb-db-rich-text [data-highlight="yellow"]');
    const fg = root?.querySelector<HTMLElement>('.nb-db-rich-text [data-text-color="red"]');
    const base = root?.querySelector<HTMLElement>('.nb-db-rich-text');
    if (!hl || !fg || !base) return null;
    return {
      hlBg: getComputedStyle(hl).backgroundColor,
      fgColor: getComputedStyle(fg).color,
      baseColor: getComputedStyle(base).color,
    };
  });
  expect(styles).not.toBeNull();
  expect(styles!.hlBg).not.toBe('rgba(0, 0, 0, 0)');
  expect(styles!.hlBg).not.toBe('transparent');
  expect(styles!.fgColor).not.toBe(styles!.baseColor);

  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  await expect(page.locator('.nb-db-detail')).toBeVisible();

  await page.evaluate(() => {
    const win = window as unknown as {
      __openedLinks?: Array<[unknown, unknown, unknown]>;
    };
    win.__openedLinks = [];
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      win.__openedLinks!.push([url, target, features]);
      return null;
    }) as typeof window.open;
  });

  await page.locator('.nb-db-detail [data-link]').click({ modifiers: ['ControlOrMeta'] });
  const opened = await page.evaluate(
    () => (window as unknown as { __openedLinks?: unknown[] }).__openedLinks ?? []
  );
  expect(opened).toEqual([['https://example.com/docs', '_blank', 'noopener,noreferrer']]);
});

test('supports view switching and record page in readonly while blocking cut/paste and row menus', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page);
  await page.evaluate(() => {
    const editor = document.querySelector('nobita-editor') as unknown as {
      setReadonly(value: boolean): void;
    };
    editor.setReadonly(true);
  });

  await page.locator('.nb-db-viewtab', { hasText: 'Board' }).click();
  await expect(page.locator('.nb-db-board')).toBeVisible();
  let doc = await getDoc(page);
  expect((doc.blocks[0]?.props.database as { activeViewId?: string }).activeViewId).toBe(
    'v-table'
  );

  await page.locator('.nb-db-viewtab', { hasText: 'Table' }).click();
  await expect(page.locator('.nb-db-table')).toBeVisible();
  await expect(page.locator('.nb-db-row-expand')).toHaveCount(3);
  await expect(page.locator('.nb-db-rowmenu')).toHaveCount(0);

  await page.locator('.nb-db-table tbody tr').first().hover();
  await page.locator('.nb-db-row-expand').first().click();
  await expect(page.locator('.nb-db-detail')).toBeVisible();
  await expect(page.locator('.nb-db-detail-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.nb-db-detail')).toHaveCount(0);

  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const db = root?.querySelector<HTMLElement>('.nb-db');
    if (!db) throw new Error('Missing .nb-db');
    const cutDt = new DataTransfer();
    db.dispatchEvent(
      new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: cutDt })
    );
    const pasteDt = new DataTransfer();
    pasteDt.setData('text/plain', 'Injected');
    db.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: pasteDt })
    );
  });
  doc = await getDoc(page);
  const dbAfter = doc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  };
  expect(dbAfter.rows).toHaveLength(3);
  expect(dbAfter.rows[0]?.cells.name?.text).toBe('One');
});

test('prunes deleted row ids from manuallyCardSort on row and group deletion', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page);
  await showBoard(page);

  const todo = page.locator('.nb-db-board-column[data-group="Todo"]');
  await todo
    .locator('.nb-db-card[data-row-id="r2"]')
    .dragTo(todo.locator('.nb-db-card[data-row-id="r1"]'), {
      targetPosition: { x: 20, y: 4 },
    });

  let doc = await getDoc(page);
  let board = (
    doc.blocks[0]?.props.database as {
      views: Array<{
        id: string;
        groupProperties?: Array<{ key: string; manuallyCardSort?: string[] }>;
      }>;
    }
  ).views.find(view => view.id === 'v-board');
  expect(board?.groupProperties?.find(g => g.key === 'Todo')?.manuallyCardSort).toEqual([
    'r2',
    'r1',
  ]);

  await page.locator('.nb-db-viewtab', { hasText: 'Table' }).click();
  const row1 = page.locator('.nb-db-table tbody tr[data-row-id="r1"]');
  await row1.hover();
  await row1.locator('.nb-db-rowmenu').click();
  await page.getByRole('button', { name: 'Delete' }).click();

  doc = await getDoc(page);
  board = (
    doc.blocks[0]?.props.database as {
      views: Array<{
        id: string;
        groupProperties?: Array<{ key: string; manuallyCardSort?: string[] }>;
      }>;
    }
  ).views.find(view => view.id === 'v-board');
  expect(board?.groupProperties?.find(g => g.key === 'Todo')?.manuallyCardSort).toEqual([
    'r2',
  ]);

  await showBoard(page);
  await todo.locator('.nb-db-board-group-op[title="Group actions"]').click();
  await page.locator('.nb-db-board-group-menu').getByRole('button', { name: 'Delete cards' }).click();

  doc = await getDoc(page);
  board = (
    doc.blocks[0]?.props.database as {
      views: Array<{
        id: string;
        groupProperties?: Array<{ key: string; manuallyCardSort?: string[] }>;
      }>;
    }
  ).views.find(view => view.id === 'v-board');
  expect(
    board?.groupProperties?.find(g => g.key === 'Todo')?.manuallyCardSort
  ).toBeUndefined();
});

test('updates data-active and aria-pressed on inline rich-text toolbar buttons', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page);

  const cell = page.locator(
    '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
  );
  await cell.click();
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const text = root?.querySelector(
      '.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-rich-text'
    );
    const node = text ? document.createTreeWalker(text, NodeFilter.SHOW_TEXT).nextNode() : null;
    if (!node) throw new Error('Missing rich text node');
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, (node.textContent ?? '').length);
    const selection = root!.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  const bold = page.locator('.nb-db-inline-tool[data-tag="strong"]');
  const italic = page.locator('.nb-db-inline-tool[data-tag="em"]');
  await expect(bold).toHaveAttribute('data-active', 'true');
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await expect(italic).toHaveAttribute('data-active', 'false');
  await expect(italic).toHaveAttribute('aria-pressed', 'false');
});

test('opens record page via Mod+Enter, traps Tab focus, and restores trigger focus after navigation', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page);

  const triggerCell = page.locator(
    '.nb-db-cell[data-row-id="r1"][data-column-id="owner"] .nb-db-rich-text'
  );
  await triggerCell.click();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.nb-db-detail')).toBeVisible();

  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const root = document.querySelector('nobita-editor')?.shadowRoot;
      const detail = root?.querySelector('.nb-db-detail');
      const active = root?.activeElement ?? null;
      return Boolean(detail && active && detail.contains(active));
    });
    expect(inside).toBe(true);
  }
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Shift+Tab');
    const inside = await page.evaluate(() => {
      const root = document.querySelector('nobita-editor')?.shadowRoot;
      const detail = root?.querySelector('.nb-db-detail');
      const active = root?.activeElement ?? null;
      return Boolean(detail && active && detail.contains(active));
    });
    expect(inside).toBe(true);
  }

  await page.locator('.nb-db-detail-navbtn[data-nav="next"]').click();
  await expect(page.locator('.nb-db-detail-title')).toHaveValue('Two');

  await page.keyboard.press('Escape');
  await expect(page.locator('.nb-db-detail')).toHaveCount(0);
  await expect(triggerCell).toBeFocused();
});
