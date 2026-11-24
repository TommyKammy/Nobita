import { expect, test, type Page } from '@playwright/test';
import { getDoc, openFixture } from './helpers';

const v2Doc = () => ({
  version: 1,
  id: 'database-v2',
  title: '',
  blocks: [
    {
      id: 'db1',
      type: 'database',
      text: [],
      props: {
        database: {
          variant: 'database',
          title: 'Tasks',
          titleColumnId: 'name',
          columns: [
            { id: 'name', name: 'Name', type: 'text' },
            { id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Done'] },
            { id: 'done', name: 'Done', type: 'checkbox' },
          ],
          views: [
            {
              id: 'v1',
              name: 'Table',
              type: 'table',
              filters: [],
              columns: [
                { id: 'name', width: 200 },
                { id: 'status', width: 180 },
                { id: 'done', width: 120 },
              ],
            },
          ],
          activeViewId: 'v1',
          rows: [
            { id: 'r1', cells: { name: { text: 'One' }, status: { text: 'Todo' } } },
            {
              id: 'r2',
              cells: {
                name: { text: 'Two' },
                status: { text: 'Done' },
                done: { checked: true },
              },
            },
            { id: 'r3', cells: { name: { text: 'Three' }, status: { text: 'Todo' } } },
          ],
        },
      },
      children: [],
    },
  ],
});

async function setDoc(page: Page, doc = v2Doc()): Promise<void> {
  await page.evaluate(value => {
    const editor = (window as unknown as { __editor?: { setDoc(value: string): void } })
      .__editor;
    editor?.setDoc(JSON.stringify(value));
  }, doc);
  await expect(page.locator('.nb-db').first()).toBeVisible();
}

async function dragCells(page: Page, from: string, to: string): Promise<void> {
  const start = await page.locator(from).boundingBox();
  const end = await page.locator(to).boundingBox();
  if (!start || !end) throw new Error('Missing table cells');
  await page.mouse.move(start.x + 8, start.y + 8);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 8, end.y + end.height - 8, {
    steps: 8,
  });
  await page.mouse.up();
}

test('drags across cells to select and copy a range', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await dragCells(
    page,
    '.nb-db-cell[data-row-id="r1"][data-column-id="name"]',
    '.nb-db-cell[data-row-id="r2"][data-column-id="status"]'
  );
  await expect(page.locator('.nb-db-cell.is-selected')).toHaveCount(4);
  const copied = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const data = new DataTransfer();
    root?.querySelector('.nb-db')?.dispatchEvent(
      new ClipboardEvent('copy', {
        bubbles: true,
        clipboardData: data,
      })
    );
    return data.getData('text/plain');
  });
  expect(copied).toBe('One\tTodo\nTwo\tDone');
});

test('supports row selection, clipboard and delete', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-row-check').first().click();
  await expect(page.locator('.nb-db-table tbody tr.is-row-selected')).toHaveCount(1);
  const copied = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const data = new DataTransfer();
    root?.querySelector('.nb-db')?.dispatchEvent(
      new ClipboardEvent('copy', {
        bubbles: true,
        clipboardData: data,
      })
    );
    return data.getData('text/plain');
  });
  expect(copied).toBe('One\tTodo\t""');
  await page.keyboard.press('Delete');
  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(2);
  const doc = await getDoc(page);
  const rows = (doc.blocks[0]?.props.database as { rows: { id: string }[] }).rows;
  expect(rows.map(row => row.id)).toEqual(['r2', 'r3']);
});

test('fills a column by dragging the selection handle', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').click();
  const handle = page.locator('.nb-db-fill-handle');
  await expect(handle).toHaveAttribute('data-visible', 'true');
  const handleBox = await handle.boundingBox();
  const target = await page
    .locator('.nb-db-cell[data-row-id="r3"][data-column-id="name"]')
    .boundingBox();
  if (!handleBox || !target) throw new Error('Missing fill target');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  const doc = await getDoc(page);
  const rows = (doc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  }).rows;
  expect(rows.find(row => row.id === 'r2')?.cells.name?.text).toBe('One');
  expect(rows.find(row => row.id === 'r3')?.cells.name?.text).toBe('One');
});

test('does not fill when the handle is clicked without dragging', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').click();
  await page
    .locator('.nb-db-cell[data-row-id="r2"][data-column-id="name"]')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('.nb-db-cell.is-selected')).toHaveCount(2);
  await page.locator('.nb-db-fill-handle').click();
  const doc = await getDoc(page);
  const rows = (
    doc.blocks[0]?.props.database as {
      rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
    }
  ).rows;
  expect(rows[0]?.cells.name?.text).toBe('One');
  expect(rows[1]?.cells.name?.text).toBe('Two');
});

test('deletes every selected record', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  for (const check of await page.locator('.nb-db-row-check').all()) {
    await check.click();
  }
  await expect(page.locator('.nb-db-table tbody tr.is-row-selected')).toHaveCount(3);
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    root?.querySelector<HTMLElement>('.nb-db-row-expand')?.click();
  });
  await expect(page.locator('.nb-db-detail')).toBeVisible();
  await page.locator('.nb-db').focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('.nb-db-table tbody tr:not(.nb-db-empty-row)')).toHaveCount(0);
  await expect(page.locator('.nb-db-detail')).toHaveCount(0);
  const doc = await getDoc(page);
  expect(
    (doc.blocks[0]?.props.database as { rows: unknown[] }).rows
  ).toHaveLength(0);
});

test('fills using the rendered row order', async ({ page }) => {
  await openFixture(page);
  const doc = v2Doc();
  const view = (doc.blocks[0]?.props.database as { views: Array<Record<string, unknown>> })
    .views[0]!;
  view.filters = [{ columnId: 'name', operator: 'doesNotContain', value: 'Two' }];
  await setDoc(page, doc);
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').click();
  const handle = page.locator('.nb-db-fill-handle');
  const handleBox = await handle.boundingBox();
  const target = await page
    .locator('.nb-db-cell[data-row-id="r3"][data-column-id="name"]')
    .boundingBox();
  if (!handleBox || !target) throw new Error('Missing fill target');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  const rows = (await getDoc(page)).blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  };
  expect(rows.rows.find(row => row.id === 'r2')?.cells.name?.text).toBe('Two');
  expect(rows.rows.find(row => row.id === 'r3')?.cells.name?.text).toBe('One');
});

test('keeps the row detail open when an edit changes sort order', async ({ page }) => {
  await openFixture(page);
  const doc = v2Doc();
  const view = (doc.blocks[0]?.props.database as { views: Array<Record<string, unknown>> })
    .views[0]!;
  view.sorts = [{ columnId: 'name', direction: 'asc' }];
  await setDoc(page, doc);
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  await page.locator('.nb-db-detail-title').fill('Zebra');
  await expect(page.locator('.nb-db-detail')).toBeVisible();
  await expect(page.locator('.nb-db-detail-title')).toHaveValue('Zebra');
  await expect(
    page.locator('.nb-db-detail-navbtn[data-nav="prev"]')
  ).toBeEnabled();
  await expect(
    page.locator('.nb-db-detail-navbtn[data-nav="next"]')
  ).toBeDisabled();
  const docState = await getDoc(page);
  expect(
    (docState.blocks[0]?.props.database as {
      rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
    }).rows.find(row => row.id === 'r1')?.cells.name?.text
  ).toBe('Zebra');
});

test('undoes row deletion from the selection context', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-row-check').first().click();
  await page.keyboard.press('Delete');
  await expect(
    page.locator('.nb-db-table tbody tr[data-row-id]')
  ).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(
    page.locator('.nb-db-table tbody tr[data-row-id]')
  ).toHaveCount(3);
  await expect(
    page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]')
  ).toContainText('One');
});

test('does not route header input copy through the cell grid', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-row-check').first().click();
  await page.locator('.nb-db-title-input').click();
  const result = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const target = root?.querySelector('.nb-db-title-input');
    if (!target) return null;
    const data = new DataTransfer();
    const event = new ClipboardEvent('copy', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    target.dispatchEvent(event);
    return { prevented: event.defaultPrevented, text: data.getData('text/plain') };
  });
  expect(result).toEqual({ prevented: false, text: '' });
  await page.keyboard.press('Backspace');
  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(3);
});

test('opens the row detail panel and edits the title', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  const titleCell = page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]');
  await titleCell.hover();
  await page.locator('.nb-db-row-expand').first().click();
  await expect(page.locator('.nb-db-detail')).toBeVisible();
  const title = page.locator('.nb-db-detail-title');
  await expect(title).toHaveValue('One');
  await title.fill('Renamed');
  await page.locator('.nb-db-detail-navbtn').nth(1).click();
  await expect(page.locator('.nb-db-detail-title')).toHaveValue('Two');
  const doc = await getDoc(page);
  const row = (doc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  }).rows.find(item => item.id === 'r1');
  expect(row?.cells.name?.text).toBe('Renamed');
  await page.keyboard.press('Escape');
  await expect(page.locator('.nb-db-detail')).toHaveCount(0);
});

test('opens view settings and toggles a property', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-viewtab[data-active="true"]').click();
  await expect(page.locator('.nb-db-view-menu')).toBeVisible();
  await expect(page.locator('.nb-db-view-name')).toHaveValue('Table');
  await page.locator('.nb-db-pop-actions button', { hasText: 'Properties' }).click();
  await expect(page.locator('.nb-db-view-properties')).toBeVisible();
  const statusRow = page.locator('.nb-db-property-row', { hasText: 'Status' });
  await statusRow.locator('.nb-db-property-eye').click();
  await expect(page.locator('.nb-db-th[data-column-id="status"]')).toHaveCount(0);

  await page.locator('.nb-db-viewtab[data-active="true"]').click();
  await page.locator('.nb-db-pop-actions button', { hasText: 'Properties' }).click();
  await page
    .locator('.nb-db-property-row', { hasText: 'Status' })
    .locator('.nb-db-property-eye')
    .click();
  await expect(page.locator('.nb-db-th[data-column-id="status"]')).toHaveCount(1);

  await page.locator('.nb-db-viewtab[data-active="true"]').click();
  await page.locator('.nb-db-view-layout-btn', { hasText: 'Board' }).click();
  await expect(page.locator('.nb-db-board')).toBeVisible();
});

test('uses the column menu to hide, sort and duplicate columns', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-th[data-column-id="status"] .nb-db-col-head').click();
  await page.locator('.nb-db-pop-actions button', { hasText: 'Sort Descending' }).click();
  const statusTexts = await page
    .locator('.nb-db-cell[data-column-id="status"] .nb-db-select')
    .allTextContents();
  expect(statusTexts).toEqual(['Todo', 'Todo', 'Done']);

  await page.locator('.nb-db-th[data-column-id="status"] .nb-db-col-head').click();
  await page.locator('.nb-db-pop-actions button', { hasText: 'Duplicate' }).click();
  await expect(page.locator('.nb-db-th')).toHaveCount(4);

  await page.locator('.nb-db-th[data-column-id="status"] .nb-db-col-head').click();
  await page.locator('.nb-db-pop-actions button', { hasText: 'Hide In View' }).click();
  await expect(page.locator('.nb-db-th[data-column-id="status"]')).toHaveCount(0);
});

test('formats number cells from column settings', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'number-format',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'name',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              { id: 'score', name: 'Score', type: 'number' },
            ],
            rows: [
              { id: 'r1', cells: { name: { text: 'One' }, score: { text: '0.1' } } },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'score', width: 160 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  await page.locator('.nb-db-th[data-column-id="score"] .nb-db-col-head').click();
  await page.locator('.nb-db-number-format select').selectOption('percent');
  await expect(
    page.locator('.nb-db-cell[data-column-id="score"] input')
  ).toHaveValue('10%');
});

test('reads the current numeric value when refocusing a cell', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'number-refocus',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'name',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              { id: 'score', name: 'Score', type: 'number' },
            ],
            rows: [
              { id: 'r1', cells: { name: { text: 'One' }, score: { text: '10' } } },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'score', width: 160 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  const score = page.locator('.nb-db-cell[data-column-id="score"] input');
  await score.click();
  await page.keyboard.type('20');
  await page.locator('.nb-db-cell[data-column-id="name"]').click();
  await score.click();
  await expect(score).toHaveValue('20');
  const doc = await getDoc(page);
  expect(
    (
      doc.blocks[0]?.props.database as {
        rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
      }
    ).rows[0]?.cells.score?.text
  ).toBe('20');

  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  const detailScore = page.locator(
    '.nb-db-detail-field[data-column-id="score"] input'
  );
  await detailScore.click();
  await page.keyboard.type('30');
  await page.locator('.nb-db-detail-title').click();
  await detailScore.click();
  await expect(detailScore).toHaveValue('30');
});

test('preserves implicit currency precision on column actions', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'currency-precision',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'name',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              {
                id: 'price',
                name: 'Price',
                type: 'number',
                data: { format: 'currency' },
              },
            ],
            rows: [
              {
                id: 'r1',
                cells: { name: { text: 'One' }, price: { text: '12.34' } },
              },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'price', width: 160 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  const price = page.locator('.nb-db-cell[data-column-id="price"] input');
  await expect(price).toHaveValue('$12.34');
  await page.locator('.nb-db-th[data-column-id="price"] .nb-db-col-head').click();
  await page
    .locator('.nb-db-column-popover')
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await expect(price).toHaveValue('$12.34');
  const doc = await getDoc(page);
  const column = (
    doc.blocks[0]?.props.database as {
      columns: Array<{ id: string; data?: { decimal?: number } }>;
    }
  ).columns.find(item => item.id === 'price');
  expect(column?.data?.decimal).toBeUndefined();
});

test('keeps column width changes local to the active view', async ({ page }) => {
  await openFixture(page);
  const doc = v2Doc();
  const database = doc.blocks[0]?.props.database as {
    views: Array<Record<string, unknown>>;
  };
  database.views.push({
    id: 'v2',
    name: 'Table 2',
    type: 'table',
    filters: [],
    columns: [
      { id: 'name', width: 200 },
      { id: 'status', width: 180 },
      { id: 'done', width: 120 },
    ],
  });
  await setDoc(page, doc);
  await page.locator('.nb-db-add-column').click();
  await page.keyboard.press('Escape');
  let saved = await getDoc(page);
  let data = saved.blocks[0]?.props.database as {
    columns: Array<{ id: string }>;
    views: Array<{ columns?: Array<{ id: string; width: number }> }>;
  };
  const added = data.columns[data.columns.length - 1]!;
  expect(
    data.views[0]?.columns?.find(item => item.id === added.id)?.width
  ).toBe(180);
  expect(
    data.views[1]?.columns?.find(item => item.id === added.id)?.width
  ).toBe(180);
  const resizer = page.locator(
    `.nb-db-th[data-column-id="${added.id}"] .nb-db-resizer`
  );
  const box = await resizer.boundingBox();
  if (!box) throw new Error('Missing resizer');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 82, box.y + box.height / 2);
  await page.mouse.up();
  saved = await getDoc(page);
  data = saved.blocks[0]?.props.database as typeof data;
  expect(
    data.views[0]?.columns?.find(item => item.id === added.id)?.width
  ).toBeGreaterThan(180);
  expect(
    data.views[1]?.columns?.find(item => item.id === added.id)?.width
  ).toBe(180);
});

test('adds inserted columns to every view', async ({ page }) => {
  await openFixture(page);
  const doc = v2Doc();
  const database = doc.blocks[0]?.props.database as {
    views: Array<Record<string, unknown>>;
  };
  database.views.push({
    id: 'v2',
    name: 'Table 2',
    type: 'table',
    filters: [],
    columns: [
      { id: 'name', width: 200 },
      { id: 'status', width: 180 },
      { id: 'done', width: 120 },
    ],
  });
  await setDoc(page, doc);
  await page.locator('.nb-db-th[data-column-id="name"] .nb-db-col-head').click();
  await page
    .locator('.nb-db-column-popover')
    .getByRole('button', { name: 'Insert Right Column', exact: true })
    .click();
  const saved = await getDoc(page);
  const data = saved.blocks[0]?.props.database as {
    columns: Array<{ id: string }>;
    views: Array<{ columns?: Array<{ id: string; width: number }> }>;
  };
  const added = data.columns[1]!;
  expect(data.views[0]?.columns?.[1]).toEqual({ id: added.id, width: 180 });
  expect(data.views[1]?.columns?.[1]).toEqual({ id: added.id, width: 180 });
});

test('keeps undeclared select values in the detail panel', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'detail-undeclared-select',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'name',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              {
                id: 'status',
                name: 'Status',
                type: 'select',
                options: ['A', 'B'],
              },
              {
                id: 'tags',
                name: 'Tags',
                type: 'multi-select',
                options: ['A', 'B'],
              },
            ],
            rows: [
              {
                id: 'r1',
                cells: {
                  name: { text: 'One' },
                  status: { text: 'C' },
                  tags: { values: ['A', 'C'] },
                },
              },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'status', width: 160 },
                  { id: 'tags', width: 160 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  const status = page.locator(
    '.nb-db-detail-field[data-column-id="status"] select'
  );
  const tags = page.locator(
    '.nb-db-detail-field[data-column-id="tags"] select'
  );
  await expect(status).toHaveValue('C');
  await expect(tags.locator('option[value="C"]')).toHaveCount(1);
  await expect(tags.locator('option[value="C"]')).toHaveJSProperty(
    'selected',
    true
  );
  await status.selectOption('B');
  await tags.selectOption(['A', 'B', 'C']);
  const doc = await getDoc(page);
  const cells = (
    doc.blocks[0]?.props.database as {
      rows: Array<{
        id: string;
        cells: Record<string, { text?: string; values?: string[] }>;
      }>;
    }
  ).rows[0]?.cells;
  expect(cells?.status?.text).toBe('B');
  expect(cells?.tags?.values).toEqual(['A', 'B', 'C']);
});

test('keeps the dragged group context for multi-select groups', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'group-context',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'name',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              {
                id: 'tags',
                name: 'Tags',
                type: 'multi-select',
                options: ['A', 'B'],
              },
            ],
            rows: [
              {
                id: 'r1',
                cells: { name: { text: 'One' }, tags: { values: ['A', 'B'] } },
              },
              {
                id: 'r2',
                cells: { name: { text: 'Two' }, tags: { values: ['A', 'B'] } },
              },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                groupBy: 'tags',
                groupProperties: [
                  { key: 'A', manuallyCardSort: ['r1', 'r2'] },
                  { key: 'B', manuallyCardSort: ['r1', 'r2'] },
                ],
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'tags', width: 200 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  const bRows = page.locator(
    '.nb-db-group[data-group="B"] .nb-db-cell[data-column-id="name"]'
  );
  await expect(bRows).toHaveText(['One', 'Two']);
  const grip = page.locator(
    '.nb-db-group[data-group="B"] tr[data-row-id="r2"] .nb-db-row-grip'
  );
  const target = page.locator(
    '.nb-db-group[data-group="B"] tr[data-row-id="r1"]'
  );
  await target.hover();
  const start = await grip.boundingBox();
  const end = await target.boundingBox();
  if (!start || !end) throw new Error('Missing drag targets');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(bRows).toHaveText(['Two', 'One']);
  const doc = await getDoc(page);
  const groupProperties = (
    doc.blocks[0]?.props.database as {
      views: Array<{
        groupProperties?: Array<{ key: string; manuallyCardSort?: string[] }>;
      }>;
    }
  ).views[0]?.groupProperties;
  expect(
    groupProperties?.find(group => group.key === 'A')?.manuallyCardSort
  ).toEqual(['r1', 'r2']);
  expect(
    groupProperties?.find(group => group.key === 'B')?.manuallyCardSort
  ).toEqual(['r2', 'r1']);
});

test('restores hidden fields when pasting cut rows', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'cut-hidden-fields',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'name',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              { id: 'notes', name: 'Notes', type: 'text' },
              { id: 'files', name: 'Files', type: 'files' },
              {
                id: 'status',
                name: 'Status',
                type: 'select',
                options: ['A'],
              },
            ],
            rows: [
              {
                id: 'r1',
                cells: {
                  name: { text: 'One' },
                  notes: { text: 'Secret' },
                  files: {
                    files: [
                      {
                        id: 'f1',
                        name: 'Spec',
                        url: 'https://example.com/spec',
                      },
                    ],
                  },
                  status: { text: 'A' },
                },
              },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                hiddenColumns: ['notes', 'files'],
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'notes', width: 200 },
                  { id: 'files', width: 200 },
                  { id: 'status', width: 160 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  await page.locator('.nb-db-row-check').first().click();
  const result = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const db = root?.querySelector('.nb-db');
    const data = new DataTransfer();
    const cut = new ClipboardEvent('cut', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    db?.dispatchEvent(cut);
    const copied = data.getData('text/plain');
    const payload = data.getData('application/x-nobita-database-rows');
    const paste = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    db?.dispatchEvent(paste);
    return { copied, payload };
  });
  expect(result.payload).toBeTruthy();
  expect(result.copied).not.toContain('Secret');
  const doc = await getDoc(page);
  const cells = (
    doc.blocks[0]?.props.database as {
      rows: Array<{
        id: string;
        cells: Record<string, {
          text?: string;
          files?: Array<{ name: string }>;
        }>;
      }>;
    }
  ).rows[0]?.cells;
  expect(cells?.name?.text).toBe('One');
  expect(cells?.notes?.text).toBe('Secret');
  expect(cells?.files?.files?.[0]?.name).toBe('Spec');
});

test('maps cut rows onto another database by column name', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'cross-database-cut',
    title: '',
    blocks: [
      {
        id: 'db1',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'a-name',
            columns: [
              { id: 'a-name', name: 'Name', type: 'text' },
              {
                id: 'a-status',
                name: 'Status',
                type: 'select',
                options: ['Todo'],
              },
            ],
            rows: [
              {
                id: 'r1',
                cells: {
                  'a-name': { text: 'One' },
                  'a-status': { text: 'Todo' },
                },
              },
            ],
            views: [
              {
                id: 'va',
                name: 'Table',
                type: 'table',
                filters: [],
                columns: [
                  { id: 'a-name', width: 200 },
                  { id: 'a-status', width: 160 },
                ],
              },
            ],
            activeViewId: 'va',
          },
        },
        children: [],
      },
      {
        id: 'db2',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'b-name',
            columns: [
              { id: 'b-name', name: 'Name', type: 'text' },
              {
                id: 'b-status',
                name: 'Status',
                type: 'select',
                options: ['Todo'],
              },
            ],
            rows: [],
            views: [
              {
                id: 'vb',
                name: 'Table',
                type: 'table',
                filters: [],
                columns: [
                  { id: 'b-name', width: 200 },
                  { id: 'b-status', width: 160 },
                ],
              },
            ],
            activeViewId: 'vb',
          },
        },
        children: [],
      },
    ],
  });
  await page.locator('.nb-db').nth(0).locator('.nb-db-row-check').first().click();
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const dbs = root?.querySelectorAll<HTMLElement>('.nb-db');
    if (!dbs || dbs.length < 2) return;
    const data = new DataTransfer();
    dbs[0]?.dispatchEvent(
      new ClipboardEvent('cut', {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      })
    );
    dbs[1]?.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      })
    );
  });
  const doc = await getDoc(page);
  const rows = (
    doc.blocks[1]?.props.database as {
      rows: Array<{
        id: string;
        cells: Record<string, { text?: string }>;
      }>;
    }
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]?.cells['b-name']?.text).toBe('One');
  expect(rows[0]?.cells['b-status']?.text).toBe('Todo');
});

test('synchronizes the detail panel after an external undo', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  const title = page.locator('.nb-db-detail-title');
  await title.fill('Zebra');
  await expect(title).toHaveValue('Zebra');
  await page.evaluate(() => {
    (window as unknown as { __editor?: { undo(): boolean } }).__editor?.undo();
  });
  await expect(title).toHaveValue('One');
  await expect(
    page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]')
  ).toContainText('One');
});

test('edits raw numeric board titles and formats on blur', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'board-number-title',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'score',
            columns: [
              {
                id: 'score',
                name: 'Score',
                type: 'number',
                data: { format: 'currency' },
              },
              {
                id: 'status',
                name: 'Status',
                type: 'select',
                options: ['Todo'],
              },
            ],
            rows: [
              {
                id: 'r1',
                cells: { score: { text: '1234' }, status: { text: 'Todo' } },
              },
            ],
            views: [
              {
                id: 'v1',
                name: 'Board',
                type: 'board',
                filters: [],
                groupBy: 'status',
                columns: [
                  { id: 'score', width: 180 },
                  { id: 'status', width: 180 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  const title = page.locator('.nb-db-card-title');
  await expect(title).toHaveText('$1,234.00');
  await title.click();
  await expect(title).toHaveText('1234');
  await page.keyboard.type('5');
  await page.keyboard.press('Control+z');
  await expect(title).toHaveText('1234');
  await page.keyboard.press('Enter');
  await expect(title).toHaveText('$1,234.00');
  await title.click();
  await expect(title).toHaveText('1234');
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await expect(title).toHaveText('$12,345.00');
  const doc = await getDoc(page);
  expect(
    (
      doc.blocks[0]?.props.database as {
        rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
      }
    ).rows[0]?.cells.score?.text
  ).toBe('12345');
});

test('adds a property to the open detail panel', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  const fields = page.locator('.nb-db-detail-field');
  await expect(fields).toHaveCount(2);
  await page.getByRole('button', { name: 'Add Property' }).click();
  await page
    .locator('.nb-db-popover')
    .getByRole('button', { name: 'Text', exact: true })
    .click();
  await expect(fields).toHaveCount(3);
  const added = fields.last();
  await expect(added).toContainText('Column 4');
  await added.locator('.nb-db-detail-text').click();
  await page.keyboard.type('Note');
  const doc = await getDoc(page);
  const database = doc.blocks[0]?.props.database as {
    columns: Array<{ id: string }>;
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  };
  const columnId = database.columns[3]?.id;
  expect(columnId).toBeTruthy();
  expect(database.rows[0]?.cells[columnId!]?.text).toBe('Note');
});

test('renders files and people in the detail panel', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'detail-files-people',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'name',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              { id: 'files', name: 'Files', type: 'files' },
              { id: 'people', name: 'People', type: 'people' },
            ],
            rows: [
              {
                id: 'r1',
                cells: {
                  name: { text: 'One' },
                  files: {
                    files: [
                      {
                        id: 'f1',
                        name: 'Spec',
                        url: 'https://example.com/spec',
                      },
                    ],
                  },
                  people: { people: [{ id: 'p1', label: 'Ada' }] },
                },
              },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'files', width: 200 },
                  { id: 'people', width: 200 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  const files = page.locator(
    '.nb-db-detail-field[data-column-id="files"] .nb-db-detail-picker'
  );
  const people = page.locator(
    '.nb-db-detail-field[data-column-id="people"] .nb-db-detail-picker'
  );
  await expect(files).toHaveText('Spec');
  await expect(people).toHaveText('Ada');
  await files.click();
  const popover = page.locator('.nb-db-popover');
  await popover.getByLabel('File name').fill('Notes');
  await popover.getByLabel('File URL').fill('https://example.com/notes');
  await popover.getByRole('button', { name: 'Add file' }).click();
  await popover.getByRole('button', { name: 'Done' }).click();
  await expect(files).toHaveText('2 files');
  const doc = await getDoc(page);
  expect(
    (
      doc.blocks[0]?.props.database as {
        rows: Array<{ id: string; cells: Record<string, { files?: unknown[] }> }>;
      }
    ).rows[0]?.cells.files?.files
  ).toHaveLength(2);
});

test('keeps row actions when the title column is hidden', async ({ page }) => {
  await openFixture(page);
  const doc = v2Doc();
  const view = (doc.blocks[0]?.props.database as { views: Array<Record<string, unknown>> })
    .views[0]!;
  view.hiddenColumns = ['name'];
  await setDoc(page, doc);
  await expect(page.locator('.nb-db-row-expand')).toHaveCount(3);
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="status"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  await expect(page.locator('.nb-db-detail')).toBeVisible();
  await expect(page.locator('.nb-db-detail-title')).toHaveValue('One');
});

test('synchronizes a focused detail text field after undo', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'detail-text-undo',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'name',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              { id: 'note', name: 'Note', type: 'text' },
            ],
            rows: [
              {
                id: 'r1',
                cells: { name: { text: 'One' }, note: { text: 'Hello' } },
              },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'note', width: 200 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  const note = page.locator(
    '.nb-db-detail-field[data-column-id="note"] .nb-db-detail-text'
  );
  await note.click();
  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const element = root?.querySelector<HTMLElement>(
      '.nb-db-detail-field[data-column-id="note"] .nb-db-detail-text'
    );
    if (!element) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.type('World');
  await expect(note).toHaveText('World');
  await page.keyboard.press('Control+z');
  await expect(note).toHaveText('Hello');
  await page.keyboard.type('!');
  await expect(note).toHaveText('Hello!');
  const doc = await getDoc(page);
  expect(
    (
      doc.blocks[0]?.props.database as {
        rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
      }
    ).rows[0]?.cells.note?.text
  ).toBe('Hello!');
});

test('undoes detail edits from the detail panel', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  const check = page.locator(
    '.nb-db-detail-field[data-column-id="done"] button[role="checkbox"]'
  );
  await check.click();
  await expect(check).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Control+z');
  await expect(check).toHaveAttribute('aria-checked', 'false');
  const doc = await getDoc(page);
  expect(
    (
      doc.blocks[0]?.props.database as {
        rows: Array<{ id: string; cells: Record<string, { checked?: boolean }> }>;
      }
    ).rows[0]?.cells.done?.checked
  ).toBeFalsy();
});

test('closes record detail when switching to readonly', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  await expect(page.locator('.nb-db-detail')).toBeVisible();
  await page.evaluate(() => {
    const element = document.querySelector('nobita-editor') as unknown as {
      setReadonly(value: boolean): void;
    };
    element.setReadonly(true);
  });
  await expect(page.locator('.nb-db-detail')).toHaveCount(0);
});

test('expands saved collapsed groups in readonly views', async ({ page }) => {
  await openFixture(page);
  const doc = v2Doc();
  const view = (doc.blocks[0]?.props.database as { views: Array<Record<string, unknown>> })
    .views[0]!;
  view.groupBy = 'status';
  view.groupProperties = [{ key: 'Todo' }, { key: 'Done', collapsed: true }];
  await setDoc(page, doc);
  await page.evaluate(() => {
    const element = document.querySelector('nobita-editor') as unknown as {
      setReadonly(value: boolean): void;
    };
    element.setReadonly(true);
  });
  const done = page.locator('.nb-db-group[data-group="Done"]');
  await expect(done.locator('.nb-db-table')).toHaveCount(0);
  await done.locator('.nb-db-group-toggle').click();
  await expect(done.locator('.nb-db-table')).toBeVisible();
  await expect(
    done.locator('.nb-db-cell[data-row-id="r2"][data-column-id="name"]')
  ).toContainText('Two');
  const saved = await getDoc(page);
  expect(
    (
      saved.blocks[0]?.props.database as {
        views: Array<{ groupProperties?: Array<Record<string, unknown>> }>;
      }
    ).views[0]?.groupProperties
  ).toEqual([{ key: 'Todo' }, { key: 'Done', collapsed: true }]);
});

test('edits raw numeric detail titles', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'detail-number-title',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'score',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              {
                id: 'score',
                name: 'Score',
                type: 'number',
                data: { format: 'percent' },
              },
            ],
            rows: [
              { id: 'r1', cells: { name: { text: 'One' }, score: { text: '0.1' } } },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                columns: [
                  { id: 'score', width: 200 },
                  { id: 'name', width: 200 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  const title = page.locator('.nb-db-detail-title');
  await title.focus();
  await expect(title).toHaveValue('0.1');
  await title.evaluate((element: HTMLInputElement) => element.blur());
  await expect(title).toHaveValue('10%');
  await title.click();
  await page.keyboard.type('0.25');
  await title.evaluate((element: HTMLInputElement) => element.blur());
  await expect(title).toHaveValue('25%');
  const doc = await getDoc(page);
  expect(
    (
      doc.blocks[0]?.props.database as {
        rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
      }
    ).rows[0]?.cells.score?.text
  ).toBe('0.25');
});

test('clears multi-select values when choosing Empty', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'detail-multi-empty',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'name',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              {
                id: 'tags',
                name: 'Tags',
                type: 'multi-select',
                options: ['A', 'B'],
              },
            ],
            rows: [
              {
                id: 'r1',
                cells: { name: { text: 'One' }, tags: { values: ['A', 'B'] } },
              },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'tags', width: 200 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  const tags = page.locator(
    '.nb-db-detail-field[data-column-id="tags"] select'
  );
  await expect(tags.locator('option[value="A"]')).toHaveJSProperty(
    'selected',
    true
  );
  await expect(tags.locator('option[value="B"]')).toHaveJSProperty(
    'selected',
    true
  );
  await tags.selectOption(['']);
  const doc = await getDoc(page);
  expect(
    (
      doc.blocks[0]?.props.database as {
        rows: Array<{ id: string; cells: Record<string, { values?: string[] }> }>;
      }
    ).rows[0]?.cells.tags?.values
  ).toBeUndefined();
});

test('rebuilds detail fields when a column type is undone', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'detail-schema-undo',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'name',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              { id: 'note', name: 'Note', type: 'text' },
            ],
            rows: [
              {
                id: 'r1',
                cells: { name: { text: 'One' }, note: { text: 'Hello' } },
              },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'note', width: 200 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  await page.locator('.nb-db-th[data-column-id="note"] .nb-db-col-head').click();
  await page.locator('.nb-db-column-popover select').first().selectOption('checkbox');
  await page
    .locator('.nb-db-column-popover')
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  const field = page.locator('.nb-db-detail-field[data-column-id="note"]');
  await expect(field.locator('button[role="checkbox"]')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(field.locator('.nb-db-detail-text')).toBeVisible();
  await expect(field.locator('button[role="checkbox"]')).toHaveCount(0);
  await expect(field.locator('.nb-db-detail-text')).toHaveText('Hello');
});

test('rebinds the detail title when undo restores the title column', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-th[data-column-id="name"] .nb-db-col-head').click();
  await page
    .locator('.nb-db-column-popover')
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="status"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  const title = page.locator('.nb-db-detail-title');
  await expect(title).toHaveAttribute('data-column-id', 'status');
  await expect(title).toHaveValue('Todo');
  await page.keyboard.press('Control+z');
  await expect(title).toHaveAttribute('data-column-id', 'name');
  await expect(title).toHaveValue('One');
  await expect(
    page.locator('.nb-db-detail-field[data-column-id="status"]')
  ).toHaveCount(1);
});

test('renders grouped column names as text', async ({ page }) => {
  await openFixture(page);
  const doc = v2Doc();
  const database = doc.blocks[0]?.props.database as {
    columns: Array<{ name: string }>;
    views: Array<Record<string, unknown>>;
  };
  database.columns[1]!.name = '<img src=x onerror="window.__xss=1">';
  database.views[0]!.groupBy = 'status';
  await setDoc(page, doc);
  await expect(page.locator('.nb-db-tools')).toContainText('Group: <img');
  await expect(page.locator('.nb-db-tools img')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __xss?: number }).__xss
    )
  ).toBeUndefined();
});

test('cuts only the selected rows that are visible', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-row-check').nth(1).click();
  await page.locator('.nb-db-row-check').nth(2).click();
  await page.getByLabel('Search rows').fill('Three');
  await expect(
    page.locator('.nb-db-table tbody tr[data-row-id]')
  ).toHaveCount(1);
  const copied = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const db = root?.querySelector('.nb-db');
    const data = new DataTransfer();
    const event = new ClipboardEvent('cut', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    db?.dispatchEvent(event);
    return data.getData('text/plain');
  });
  expect(copied).toContain('Three');
  expect(copied).not.toContain('Two');
  const doc = await getDoc(page);
  expect(
    (
      doc.blocks[0]?.props.database as {
        rows: Array<{ id: string }>;
      }
    ).rows.map(row => row.id)
  ).toEqual(['r1', 'r2']);
});

test('deletes a selected range while a cell editor is focused', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').click();
  await page
    .locator('.nb-db-cell[data-row-id="r2"][data-column-id="name"]')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('.nb-db-cell.is-selected')).toHaveCount(2);
  await page.locator('.nb-db-title-input').click();
  await page.keyboard.press('Backspace');
  let doc = await getDoc(page);
  let rows = (
    doc.blocks[0]?.props.database as {
      rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
    }
  ).rows;
  expect(rows[0]?.cells.name?.text).toBe('One');
  expect(rows[1]?.cells.name?.text).toBe('Two');
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').click();
  await page
    .locator('.nb-db-cell[data-row-id="r2"][data-column-id="name"]')
    .click({ modifiers: ['Shift'] });
  await page.keyboard.press('Delete');
  doc = await getDoc(page);
  rows = (
    doc.blocks[0]?.props.database as {
      rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
    }
  ).rows;
  expect(rows[0]?.cells.name?.text).toBeUndefined();
  expect(rows[1]?.cells.name?.text).toBeUndefined();
});

test('copies grouped multi-select records once', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'grouped-multi-copy',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'name',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              {
                id: 'tags',
                name: 'Tags',
                type: 'multi-select',
                options: ['A', 'B'],
              },
            ],
            rows: [
              {
                id: 'r1',
                cells: { name: { text: 'One' }, tags: { values: ['A', 'B'] } },
              },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                groupBy: 'tags',
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'tags', width: 200 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  await expect(page.locator('.nb-db-table')).toHaveCount(2);
  await page.locator('.nb-db-row-check[data-row-id="r1"]').first().click();
  const copyText = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const db = root?.querySelector('.nb-db');
    const data = new DataTransfer();
    const event = new ClipboardEvent('copy', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    db?.dispatchEvent(event);
    return data.getData('text/plain');
  });
  expect(copyText.trim().split('\n')).toHaveLength(1);
  expect(copyText).toContain('One');
  const cutText = await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const db = root?.querySelector('.nb-db');
    const data = new DataTransfer();
    const event = new ClipboardEvent('cut', {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    db?.dispatchEvent(event);
    return data.getData('text/plain');
  });
  expect(cutText.trim().split('\n')).toHaveLength(1);
  const doc = await getDoc(page);
  expect(
    (doc.blocks[0]?.props.database as { rows: unknown[] }).rows
  ).toHaveLength(0);
});

test('updates manual group order when dragging a row', async ({ page }) => {
  await openFixture(page);
  const doc = v2Doc();
  const view = (doc.blocks[0]?.props.database as { views: Array<Record<string, unknown>> })
    .views[0]!;
  view.groupBy = 'status';
  view.groupProperties = [
    { key: 'Todo', manuallyCardSort: ['r3', 'r1'] },
    { key: 'Done' },
  ];
  await setDoc(page, doc);
  const todoRows = page.locator(
    '.nb-db-group[data-group="Todo"] .nb-db-cell[data-column-id="name"]'
  );
  await expect(todoRows).toHaveText(['Three', 'One']);
  const grip = page.locator(
    '.nb-db-group[data-group="Todo"] tr[data-row-id="r1"] .nb-db-row-grip'
  );
  const target = page.locator(
    '.nb-db-group[data-group="Todo"] tr[data-row-id="r3"]'
  );
  await target.hover();
  const start = await grip.boundingBox();
  const end = await target.boundingBox();
  if (!start || !end) throw new Error('Missing drag targets');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(todoRows).toHaveText(['One', 'Three']);
  const saved = await getDoc(page);
  const groupProperties = (
    saved.blocks[0]?.props.database as {
      views: Array<{
        groupProperties?: Array<{ key: string; manuallyCardSort?: string[] }>;
      }>;
    }
  ).views[0]?.groupProperties;
  expect(
    groupProperties?.find(group => group.key === 'Todo')?.manuallyCardSort
  ).toEqual(['r1', 'r3']);
});

test('preserves filtered records in manual group order', async ({ page }) => {
  await openFixture(page);
  const doc = v2Doc();
  const database = doc.blocks[0]?.props.database as {
    rows: Array<Record<string, unknown>>;
    views: Array<Record<string, unknown>>;
  };
  database.rows.push({
    id: 'r4',
    cells: { name: { text: 'Four' }, status: { text: 'Todo' } },
  });
  const view = database.views[0]!;
  view.groupBy = 'status';
  view.filters = [
    { columnId: 'name', operator: 'doesNotContain', value: 'Four' },
  ];
  view.groupProperties = [
    { key: 'Todo', manuallyCardSort: ['r4', 'r3', 'r1'] },
    { key: 'Done' },
  ];
  await setDoc(page, doc);
  const todoRows = page.locator(
    '.nb-db-group[data-group="Todo"] .nb-db-cell[data-column-id="name"]'
  );
  await expect(todoRows).toHaveText(['Three', 'One']);
  const grip = page.locator(
    '.nb-db-group[data-group="Todo"] tr[data-row-id="r1"] .nb-db-row-grip'
  );
  const target = page.locator(
    '.nb-db-group[data-group="Todo"] tr[data-row-id="r3"]'
  );
  await target.hover();
  const start = await grip.boundingBox();
  const end = await target.boundingBox();
  if (!start || !end) throw new Error('Missing drag targets');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(todoRows).toHaveText(['One', 'Three']);
  const saved = await getDoc(page);
  const groupProperties = (
    saved.blocks[0]?.props.database as {
      views: Array<{
        groupProperties?: Array<{ key: string; manuallyCardSort?: string[] }>;
      }>;
    }
  ).views[0]?.groupProperties;
  expect(
    groupProperties?.find(group => group.key === 'Todo')?.manuallyCardSort
  ).toEqual(['r4', 'r1', 'r3']);
});

test('keeps group order when dragging rows without saved settings', async ({ page }) => {
  await openFixture(page);
  const doc = v2Doc();
  const view = (doc.blocks[0]?.props.database as { views: Array<Record<string, unknown>> })
    .views[0]!;
  view.groupBy = 'status';
  await setDoc(page, doc);
  const labels = page.locator('.nb-db-group-label');
  await expect(labels).toHaveText(['Todo', 'Done']);
  const grip = page.locator(
    '.nb-db-group[data-group="Todo"] tr[data-row-id="r1"] .nb-db-row-grip'
  );
  const target = page.locator(
    '.nb-db-group[data-group="Todo"] tr[data-row-id="r3"]'
  );
  await target.hover();
  const start = await grip.boundingBox();
  const end = await target.boundingBox();
  if (!start || !end) throw new Error('Missing drag targets');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(labels).toHaveText(['Todo', 'Done']);
  const saved = await getDoc(page);
  const groupProperties = (
    saved.blocks[0]?.props.database as {
      views: Array<{
        groupProperties?: Array<{ key: string; manuallyCardSort?: string[] }>;
      }>;
    }
  ).views[0]?.groupProperties;
  expect(groupProperties?.map(group => group.key)).toEqual(['Todo', 'Done']);
  expect(
    groupProperties?.find(group => group.key === 'Todo')?.manuallyCardSort
  ).toEqual(['r3', 'r1']);
});

test('preserves omitted group settings when reordering groups', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'group-move-settings',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'name',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              {
                id: 'status',
                name: 'Status',
                type: 'select',
                options: ['A', 'B', 'C'],
              },
            ],
            rows: [
              { id: 'r1', cells: { name: { text: 'One' }, status: { text: 'A' } } },
              { id: 'r2', cells: { name: { text: 'Two' }, status: { text: 'C' } } },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                groupBy: 'status',
                hideEmptyGroups: true,
                groupProperties: [
                  { key: 'A' },
                  { key: 'B', collapsed: true },
                  { key: 'C' },
                ],
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'status', width: 200 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  await expect(page.locator('.nb-db-group')).toHaveCount(2);
  await page.locator('.nb-db-tools .nb-db-btn', { hasText: 'Group' }).click();
  const settings = page.locator('.nb-db-group-setting');
  await expect(settings).toHaveCount(2);
  await settings.nth(1).locator('.nb-db-property-move').first().click();
  const doc = await getDoc(page);
  expect(
    (
      doc.blocks[0]?.props.database as {
        views: Array<{
          groupProperties?: Array<{ key: string; collapsed?: boolean }>;
        }>;
      }
    ).views[0]?.groupProperties
  ).toEqual([
    { key: 'C' },
    { key: 'B', collapsed: true },
    { key: 'A' },
  ]);
});

test('reorders the no-value group', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'no-value-group',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'name',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              {
                id: 'status',
                name: 'Status',
                type: 'select',
                options: ['Todo'],
              },
            ],
            rows: [
              {
                id: 'r1',
                cells: { name: { text: 'One' }, status: { text: 'Todo' } },
              },
              { id: 'r2', cells: { name: { text: 'Two' } } },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                groupBy: 'status',
                groupProperties: [{ key: 'Todo' }, { key: '', collapsed: true }],
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'status', width: 200 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  await expect(page.locator('.nb-db-group-label')).toHaveText([
    'Todo',
    'No value',
  ]);
  await page.locator('.nb-db-tools .nb-db-btn', { hasText: 'Group' }).click();
  const settings = page.locator('.nb-db-group-setting');
  await expect(settings).toHaveCount(2);
  await settings.nth(1).locator('.nb-db-property-move').first().click();
  const doc = await getDoc(page);
  expect(
    (
      doc.blocks[0]?.props.database as {
        views: Array<{
          groupProperties?: Array<{ key: string; collapsed?: boolean }>;
        }>;
      }
    ).views[0]?.groupProperties
  ).toEqual([{ key: '', collapsed: true }, { key: 'Todo' }]);
});

test('uses type-aware editors for special title columns', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'checkbox-title',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            titleColumnId: 'done',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              { id: 'done', name: 'Done', type: 'checkbox' },
            ],
            rows: [
              {
                id: 'r1',
                cells: { name: { text: 'One' }, done: { checked: true } },
              },
            ],
            views: [
              {
                id: 'v1',
                name: 'Table',
                type: 'table',
                filters: [],
                columns: [
                  { id: 'name', width: 200 },
                  { id: 'done', width: 120 },
                ],
              },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="done"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  const title = page.locator('.nb-db-detail-title');
  await expect(title).toHaveAttribute('readonly', '');
  await expect(title).toHaveValue('true');
  const field = page.locator('.nb-db-detail-field[data-column-id="done"]');
  await expect(field).toHaveCount(1);
  const check = field.locator('button[role="checkbox"]');
  await expect(check).toHaveAttribute('aria-checked', 'true');
  await check.click();
  await expect(check).toHaveAttribute('aria-checked', 'false');
  await expect(title).toHaveValue('');
  const doc = await getDoc(page);
  expect(
    (
      doc.blocks[0]?.props.database as {
        rows: Array<{ id: string; cells: Record<string, { checked?: boolean }> }>;
      }
    ).rows[0]?.cells.done?.checked
  ).toBeFalsy();
});

test('hides groups emptied by search', async ({ page }) => {
  await openFixture(page);
  const doc = v2Doc();
  const view = (doc.blocks[0]?.props.database as { views: Array<Record<string, unknown>> })
    .views[0]!;
  view.groupBy = 'status';
  view.hideEmptyGroups = true;
  await setDoc(page, doc);
  await expect(page.locator('.nb-db-group')).toHaveCount(2);
  await page.getByLabel('Search rows').fill('Three');
  await expect(page.locator('.nb-db-group')).toHaveCount(1);
  await expect(page.locator('.nb-db-group-label')).toHaveText(['Todo']);
});

test('preserves group order when collapsing a group', async ({ page }) => {
  await openFixture(page);
  const doc = v2Doc();
  const view = (doc.blocks[0]?.props.database as { views: Array<Record<string, unknown>> })
    .views[0]!;
  view.groupBy = 'status';
  await setDoc(page, doc);
  const labels = page.locator('.nb-db-group-label');
  await expect(labels).toHaveText(['Todo', 'Done']);
  await page
    .locator('.nb-db-group[data-group="Done"] .nb-db-group-toggle')
    .click();
  await expect(labels).toHaveText(['Todo', 'Done']);
  const saved = await getDoc(page);
  const groupProperties = (
    saved.blocks[0]?.props.database as {
      views: Array<{ groupProperties?: Array<{ key: string; collapsed?: boolean }> }>;
    }
  ).views[0]?.groupProperties;
  expect(groupProperties).toEqual([
    { key: 'Todo' },
    { key: 'Done', collapsed: true },
  ]);
});

test('applies nested filter groups', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-btn', { hasText: 'Filter' }).click();
  await page.getByRole('button', { name: '+ Add group', exact: true }).click();
  await page
    .locator('.nb-db-filter-group')
    .getByRole('button', { name: '+ Add condition' })
    .click();
  await page.locator('.nb-db-filter-row select').nth(0).selectOption('status');
  await page.locator('.nb-db-filter-row select').nth(1).selectOption('is');
  await page.locator('.nb-db-filter-row select').nth(2).selectOption('Todo');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.nb-db-filter-chip')).toContainText('1 rule');
  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(2);
  const doc = await getDoc(page);
  const view = (doc.blocks[0]?.props.database as {
    views: Array<{ filter?: { conditions: Array<{ type?: string }> } }>;
  }).views[0];
  expect(view.filter?.conditions[0]?.type).toBe('group');
});

test('hides groups and persists collapsed group state', async ({ page }) => {
  await openFixture(page);
  const doc = v2Doc();
  const view = (doc.blocks[0]?.props.database as { views: Array<Record<string, unknown>> })
    .views[0]!;
  view.groupBy = 'status';
  view.groupProperties = [{ key: 'Todo' }, { key: 'Done' }];
  await setDoc(page, doc);
  await expect(page.locator('.nb-db-group')).toHaveCount(2);
  await page.locator('.nb-db-btn', { hasText: 'Group' }).click();
  await page
    .locator('.nb-db-group-setting', { hasText: 'Done' })
    .locator('.nb-db-property-eye')
    .click();
  await expect(page.locator('.nb-db-group')).toHaveCount(1);
  const state = await getDoc(page);
  const saved = (state.blocks[0]?.props.database as {
    views: Array<{ groupProperties?: Array<{ key: string; hide?: boolean }> }>;
  }).views[0];
  expect(saved.groupProperties?.find(group => group.key === 'Done')?.hide).toBe(true);
});
