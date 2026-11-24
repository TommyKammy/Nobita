import { expect, test, type Page } from '@playwright/test';
import { getDoc, openFixture } from './helpers';

const p1Doc = () => ({
  version: 1,
  id: 'database-p1',
  title: '',
  blocks: [
    {
      id: 'db1',
      type: 'database',
      text: [],
      props: {
        database: {
          variant: 'database',
          columns: [
            { id: 'name', name: 'Name', type: 'text' },
            { id: 'score', name: 'Score', type: 'number' },
            { id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Done'] },
            { id: 'done', name: 'Done', type: 'checkbox' },
          ],
          rows: [
            {
              id: 'r1',
              cells: {
                name: { text: 'Alpha' },
                score: { text: '10' },
                status: { text: 'Todo' },
                done: { checked: true },
              },
            },
            {
              id: 'r2',
              cells: {
                name: { text: 'Beta' },
                score: { text: '5' },
                status: { text: 'Done' },
              },
            },
            {
              id: 'r3',
              cells: {
                name: { text: 'Gamma' },
                score: { text: '20' },
                status: { text: 'Todo' },
              },
            },
          ],
          views: [
            { id: 'v-table', name: 'Table', type: 'table', filters: [] },
            { id: 'v-board', name: 'Board', type: 'board', filters: [], groupBy: 'status' },
          ],
          activeViewId: 'v-table',
        },
      },
      children: [],
    },
  ],
});

async function setDoc(page: Page, doc = p1Doc()): Promise<void> {
  await page.evaluate(value => {
    const editor = (window as unknown as { __editor?: { setDoc(value: string): void } })
      .__editor;
    editor?.setDoc(JSON.stringify(value));
  }, doc);
  await expect(page.locator('.nb-db-table').first()).toBeVisible();
}

test('sorts, filters and searches rows', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);

  await page.locator('.nb-db-btn', { hasText: 'Sort' }).click();
  await page.getByRole('button', { name: '+ Add sort' }).click();
  await page.locator('.nb-db-sort-popover .nb-db-filter-row select').nth(0).selectOption('score');
  await page.locator('.nb-db-sort-popover .nb-db-filter-row select').nth(1).selectOption('desc');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.nb-db-cell[data-column-id="name"] .nb-db-text').first()).toHaveText('Gamma');

  await page.locator('.nb-db-btn', { hasText: 'Filter' }).click();
  await page.getByRole('button', { name: '+ Add filter' }).click();
  await page.locator('.nb-db-filter-row select').nth(0).selectOption('score');
  await page.locator('.nb-db-filter-row select').nth(1).selectOption('greaterThan');
  await page.locator('.nb-db-filter-row input').fill('8');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(2);

  await page.locator('.nb-db-search').fill('amm');
  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.nb-db-search')).toHaveValue('amm');
});

test('hides columns and calculates footer statistics', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);

  await page.locator('.nb-db-btn', { hasText: 'Columns' }).click();
  await page.locator('.nb-db-column-toggle', { hasText: 'Status' }).locator('input').uncheck();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.nb-db-th[data-column-id="status"]')).toHaveCount(0);

  const scoreStat = page.locator('.nb-db-foot .nb-db-stat').nth(1);
  await scoreStat.click();
  await page.locator('.nb-db-stat-option', { hasText: 'Sum' }).click();
  await expect(page.locator('.nb-db-foot .nb-db-stat').nth(1)).toContainText('Sum: 35');
  await page
    .locator('.nb-db-cell[data-row-id="r1"][data-column-id="score"] input')
    .fill('15');
  await expect(page.locator('.nb-db-foot .nb-db-stat').nth(1)).toContainText('Sum: 40');
});

test('adds, renames, duplicates and deletes views', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await expect(page.locator('.nb-db-viewtab:not(.nb-db-viewmore):not(.nb-db-viewadd)')).toHaveCount(2);

  await page.locator('.nb-db-viewadd').click();
  await page.getByRole('button', { name: 'Table view' }).click();
  await expect(page.locator('.nb-db-viewtab', { hasText: 'Table 2' })).toBeVisible();

  await page.locator('.nb-db-viewmore').click();
  await page.getByRole('button', { name: 'Rename view' }).click();
  await page.locator('.nb-db-field input').fill('Custom');
  await page.locator('.nb-db-popover').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.nb-db-viewtab', { hasText: 'Custom' })).toBeVisible();

  await page.locator('.nb-db-viewmore').click();
  await page.getByRole('button', { name: 'Duplicate view' }).click();
  await expect(page.locator('.nb-db-viewtab', { hasText: 'Custom copy' })).toBeVisible();

  await page.locator('.nb-db-viewmore').click();
  await page.getByRole('button', { name: 'Delete view' }).click();
  await expect(page.locator('.nb-db-viewtab', { hasText: 'Custom copy' })).toHaveCount(0);
});

test('groups a table and collapses groups', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);

  await page.locator('.nb-db-btn', { hasText: 'Group' }).click();
  await page.locator('.nb-db-popover select').selectOption('status');
  await expect(page.locator('.nb-db-group')).toHaveCount(2);
  await expect(page.locator('.nb-db-group-label').first()).toHaveText('Todo');

  const first = page.locator('.nb-db-group-head').first();
  await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.nb-db-group').first().locator('.nb-db-table')).toHaveCount(0);
});

test('keeps view state independent', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);

  await page.locator('.nb-db-btn', { hasText: 'Filter' }).click();
  await page.getByRole('button', { name: '+ Add filter' }).click();
  await page.locator('.nb-db-filter-row select').nth(0).selectOption('done');
  await page.locator('.nb-db-filter-row select').nth(1).selectOption('isChecked');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(1);

  await page.locator('.nb-db-viewtab', { hasText: 'Board' }).click();
  await expect(page.locator('.nb-db-card')).toHaveCount(3);
  await page.locator('.nb-db-viewtab', { hasText: 'Table' }).click();
  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(1);
});

test('renames a database', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  const title = page.locator('.nb-db-title-input');
  await title.fill('Roadmap');
  const state = await page.evaluate(() => {
    const host = document.querySelector('nobita-editor') as unknown as {
      doc: { blocks: Array<{ props: { database?: { title?: string } } }> };
    };
    return host.doc.blocks[0]?.props.database?.title;
  });
  expect(state).toBe('Roadmap');
});

test('synchronizes duplicated cells in grouped tables', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'grouped-cells',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              { id: 'tags', name: 'Tags', type: 'multi-select', options: ['A', 'B'] },
              { id: 'score', name: 'Score', type: 'number' },
            ],
            rows: [
              { id: 'r1', cells: { name: { text: 'One' }, tags: { values: ['A', 'B'] }, score: { text: '1' } } },
              { id: 'r2', cells: { name: { text: 'Two' }, tags: { values: ['A'] }, score: { text: '2' } } },
            ],
            views: [
              { id: 'v1', name: 'By tag', type: 'table', filters: [], groupBy: 'tags' },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });

  await page
    .locator('.nb-db-group[data-group="B"] .nb-db-cell[data-row-id="r1"][data-column-id="score"] input')
    .fill('5');
  await expect(
    page.locator('.nb-db-group[data-group="A"] .nb-db-cell[data-row-id="r1"][data-column-id="score"] input')
  ).toHaveValue('5');
});

test('pastes rows in grouped table display order', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'grouped-paste',
    title: '',
    blocks: [
      {
        id: 'db',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            columns: [
              { id: 'name', name: 'Name', type: 'text' },
              { id: 'group', name: 'Group', type: 'select', options: ['A', 'B'] },
            ],
            rows: [
              { id: 'r1', cells: { name: { text: 'B1' }, group: { text: 'B' } } },
              { id: 'r2', cells: { name: { text: 'A1' }, group: { text: 'A' } } },
              { id: 'r3', cells: { name: { text: 'B2' }, group: { text: 'B' } } },
              { id: 'r4', cells: { name: { text: 'A2' }, group: { text: 'A' } } },
            ],
            views: [
              { id: 'v1', name: 'Grouped', type: 'table', filters: [], groupBy: 'group' },
            ],
            activeViewId: 'v1',
          },
        },
        children: [],
      },
    ],
  });

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'X\nY');
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-db-cell[data-row-id="r2"][data-column-id="name"]')
      ?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
  });
  const doc = await getDoc(page);
  const database = doc.blocks[0]?.props.database as {
    rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  };
  expect(database.rows.find(row => row.id === 'r2')?.cells.name?.text).toBe('X');
  expect(database.rows.find(row => row.id === 'r4')?.cells.name?.text).toBe('Y');
  expect(database.rows.find(row => row.id === 'r3')?.cells.name?.text).toBe('B2');
});
