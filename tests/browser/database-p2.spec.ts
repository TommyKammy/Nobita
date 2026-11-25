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

async function showBoard(page: Page): Promise<void> {
  await page.locator('.nb-db-viewtab', { hasText: 'Board' }).click();
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
