import { expect, test, type Page } from '@playwright/test';
import { blockById, getDoc, openFixture } from './helpers';

async function setDoc(page: Page, doc: unknown): Promise<void> {
  await page.evaluate(value => {
    const editor = (window as unknown as {
      __editor?: { setDoc(value: string): void };
    }).__editor;
    editor?.setDoc(JSON.stringify(value));
  }, doc);
  await page.waitForTimeout(80);
}

async function setReadonly(page: Page, value: boolean): Promise<void> {
  await page.evaluate(flag => {
    const editor = (window as unknown as {
      __editor?: { setReadonly(next: boolean): void };
    }).__editor;
    editor?.setReadonly(flag);
  }, value);
  await page.waitForTimeout(50);
}

async function getSelectedBlockIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.querySelector('nobita-editor') as unknown as {
      getSelectedBlockIds(): string[];
    };
    return host.getSelectedBlockIds();
  });
}

function richTestDoc() {
  return {
    version: 1,
    id: 'ctx-menu-doc',
    title: 'Context Menu Doc',
    blocks: [
      { id: 'p1', type: 'paragraph', text: [{ text: 'First paragraph' }], props: {}, children: [] },
      { id: 'p2', type: 'paragraph', text: [{ text: 'Second paragraph' }], props: {}, children: [] },
      { id: 'p3', type: 'paragraph', text: [{ text: 'Third paragraph' }], props: {}, children: [] },
      {
        id: 't1',
        type: 'table',
        text: [],
        props: {
          table: {
            columns: [
              { id: 'c1', width: 160 },
              { id: 'c2', width: 160 },
            ],
            rows: [
              { id: 'r1', cells: { c1: { text: 'Alpha' }, c2: { text: 'Beta' } } },
              { id: 'r2', cells: { c1: { text: 'Gamma' }, c2: { text: 'Delta' } } },
            ],
          },
        },
        children: [],
      },
      {
        id: 'db1',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            title: 'Tasks',
            columns: [
              { id: 'name', name: 'Task', type: 'text' },
              { id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Done'] },
            ],
            rows: [
              {
                id: 'row1',
                cells: { name: { text: 'Write tests' }, status: { text: 'Todo' } },
              },
              {
                id: 'row2',
                cells: { name: { text: 'Ship release' }, status: { text: 'Done' } },
              },
            ],
            views: [
              { id: 'v-table', name: 'Table', type: 'table' },
              { id: 'v-board', name: 'Board', type: 'board', groupBy: 'status' },
            ],
            activeViewId: 'v-table',
          },
        },
        children: [],
      },
    ],
  };
}

test('right-clicking a block opens the block menu at cursor and executes actions', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, richTestDoc());

  const block = page.locator('.nb-block[data-block-id="p1"] .nb-text');
  await block.click({ button: 'right' });

  const menu = page.locator('.nb-menu');
  await expect(menu).toBeVisible();
  expect(await getSelectedBlockIds(page)).toEqual(['p1']);

  await menu.getByRole('menuitem', { name: /^Duplicate/ }).click();
  await expect(menu).toBeHidden();

  const doc = await getDoc(page);
  expect(doc.blocks.filter(b => b.text === 'First paragraph')).toHaveLength(2);
});

test('right-clicking inside a multi-block selection opens batch menu and executes batch actions', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, richTestDoc());

  await page.evaluate(() => {
    const host = document.querySelector('nobita-editor') as unknown as {
      selectBlocks(ids: string[]): void;
    };
    host.selectBlocks(['p1', 'p2']);
  });
  expect(await getSelectedBlockIds(page)).toEqual(['p1', 'p2']);

  await page.locator('.nb-block[data-block-id="p2"] .nb-text').click({ button: 'right' });
  const menu = page.locator('.nb-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Duplicate 2 blocks/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Delete 2 blocks/ })).toBeVisible();

  await menu.getByRole('menuitem', { name: /^Delete 2 blocks/ }).click();
  await expect(menu).toBeHidden();

  const doc = await getDoc(page);
  expect(blockById(doc, 'p1')).toBeUndefined();
  expect(blockById(doc, 'p2')).toBeUndefined();
  expect(blockById(doc, 'p3')?.text).toBe('Third paragraph');
});

test('Shift+Right-click preserves native browser context menu without preventing default', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, richTestDoc());

  const defaultPrevented = await page.evaluate(() => {
    const host = document.querySelector('nobita-editor');
    const target = host?.shadowRoot?.querySelector('.nb-block[data-block-id="p1"] .nb-text');
    if (!target) throw new Error('Target block not found');
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 2,
      shiftKey: true,
      clientX: 120,
      clientY: 120,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  });

  expect(defaultPrevented).toBe(false);
  await expect(page.locator('.nb-menu')).toBeHidden();
});

test('readonly mode disables editor, table, and database context menus', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, richTestDoc());
  await setReadonly(page, true);

  await page.locator('.nb-block[data-block-id="p1"] .nb-text').click({ button: 'right' });
  await expect(page.locator('.nb-menu')).toBeHidden();

  await page.locator('.nb-table .nb-table-cell').first().click({ button: 'right' });
  await expect(page.locator('.nb-table-menu')).toBeHidden();

  await page.locator('.nb-db tbody tr').first().locator('td').nth(1).click({ button: 'right' });
  await expect(page.locator('.nb-db-popover')).toBeHidden();
});

test('right-clicking a simple table cell opens cell context menu and inserts a row', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, richTestDoc());

  await page.locator('.nb-table .nb-table-cell').first().click({ button: 'right' });
  const menu = page.locator('.nb-table-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Insert row below' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Insert column right' })).toBeVisible();

  await menu.getByRole('button', { name: 'Insert row below' }).click();
  await expect(menu).toBeHidden();

  const doc = await getDoc(page);
  const table = blockById(doc, 't1')?.props.table as { rows: unknown[] };
  expect(table.rows).toHaveLength(3);
});

test('right-clicking database rows, headers, and board cards opens popovers at cursor', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, richTestDoc());

  // Table row right-click -> Duplicate
  await page.locator('.nb-db tbody tr').first().locator('td').nth(1).click({ button: 'right' });
  const popover = page.locator('.nb-db-popover');
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('button', { name: 'Open record' })).toBeVisible();
  await popover.getByRole('button', { name: 'Duplicate' }).click();
  await expect(popover).toBeHidden();

  let doc = await getDoc(page);
  let db = blockById(doc, 'db1')?.props.database as { rows: unknown[] };
  expect(db.rows).toHaveLength(3);

  // Column header right-click -> Column popover
  await page.locator('.nb-db thead th[data-column-id="status"]').click({ button: 'right' });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('button', { name: 'Duplicate' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();

  // Switch to Board view and right-click a card -> Open record
  await page.locator('.nb-db-viewtab', { hasText: 'Board' }).click();
  const card = page.locator('.nb-db-card').first();
  await expect(card).toBeVisible();
  await card.click({ button: 'right' });
  await expect(popover).toBeVisible();
  await popover.getByRole('button', { name: 'Open record' }).click();
  await expect(page.locator('.nb-db-detail')).toBeVisible();
});
