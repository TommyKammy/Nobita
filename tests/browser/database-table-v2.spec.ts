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
  await expect(page.locator('.nb-db-table').first()).toBeVisible();
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
  const docState = await getDoc(page);
  expect(
    (docState.blocks[0]?.props.database as {
      rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
    }).rows.find(row => row.id === 'r1')?.cells.name?.text
  ).toBe('Zebra');
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

test('deletes a selected range while a cell editor is focused', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').click();
  await page
    .locator('.nb-db-cell[data-row-id="r2"][data-column-id="name"]')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('.nb-db-cell.is-selected')).toHaveCount(2);
  await page.keyboard.press('Delete');
  const doc = await getDoc(page);
  const rows = (
    doc.blocks[0]?.props.database as {
      rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
    }
  ).rows;
  expect(rows[0]?.cells.name?.text).toBeUndefined();
  expect(rows[1]?.cells.name?.text).toBeUndefined();
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
