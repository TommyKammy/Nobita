import { expect, test, type Page } from '@playwright/test';
import { openFixture } from './helpers';

const databaseBlock = {
  version: 1,
  id: 'database-test',
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
            { id: 'name', name: 'Name', type: 'text', width: 200 },
            { id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Done'] },
            { id: 'tags', name: 'Tags', type: 'multi-select', options: ['A', 'B'] },
            { id: 'files', name: 'Files', type: 'files' },
            { id: 'people', name: 'People', type: 'people' },
            { id: 'done', name: 'Done', type: 'checkbox' },
          ],
          rows: [
            {
              id: 'r1',
              cells: {
                name: { text: 'One' },
                status: { text: 'Todo' },
                tags: { values: ['A'] },
                files: {
                  files: [{ name: 'Spec', url: 'https://example.com/spec.pdf' }],
                },
                people: { people: [{ id: 'u1', label: 'Ada' }] },
                done: { checked: true },
              },
            },
            {
              id: 'r2',
              cells: {
                name: { text: 'Two' },
                status: { text: 'Done' },
                tags: { values: ['B'] },
                done: { checked: false },
              },
            },
            {
              id: 'r3',
              cells: { name: { text: 'Three' }, status: { text: 'Todo' } },
            },
          ],
        },
      },
      children: [],
    },
  ],
};

async function setDatabase(page: Page): Promise<void> {
  await page.evaluate(doc => {
    const editor = (window as unknown as {
      __editor?: { setDoc(value: string): void };
    }).__editor;
    editor?.setDoc(JSON.stringify(doc));
  }, databaseBlock);
  await expect(page.locator('.nb-db-table')).toBeVisible();
}

async function databaseState(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('nobita-editor') as unknown as {
      doc: { blocks: Array<{ props: { database?: unknown } }> };
    };
    return host.doc.blocks[0]?.props.database as {
      columns: Array<{ id: string; width?: number }>;
      rows: Array<{ id: string; cells: Record<string, Record<string, unknown>> }>;
      view?: { type?: string; filters?: unknown[]; groupBy?: string };
    };
  });
}

test('renders table, board and new property types', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await expect(page.locator('.nb-db-table')).toBeVisible();
  await expect(page.locator('.nb-db-chip')).toHaveCount(2);
  await expect(page.locator('.nb-db-select', { hasText: 'Spec' })).toBeVisible();
  await expect(page.locator('.nb-db-select', { hasText: 'Ada' })).toBeVisible();

  await page.locator('.nb-db-viewbtn[data-view="board"]').click();
  await expect(page.locator('.nb-db-board')).toBeVisible();
  await expect(page.locator('.nb-db-board-column')).toHaveCount(2);
  await expect(page.locator('.nb-db-card')).toHaveCount(3);
  await expect(page.locator('.nb-db-card', { hasText: 'One' })).toBeVisible();

  await page
    .locator('.nb-db-card', { hasText: 'Two' })
    .dragTo(page.locator('.nb-db-board-column[data-group="Todo"]'));
  let data = await databaseState(page);
  expect(data.rows[1]?.cells.status?.text).toBe('Todo');
  await expect(page.locator('.nb-db-board-column[data-group="Todo"] .nb-db-card')).toHaveCount(3);

  await page.locator('.nb-db-viewbtn[data-view="table"]').click();
  await expect(page.locator('.nb-db-table')).toBeVisible();
});

test('edits multi-select, files and people through pickers', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="tags"] button').click();
  await expect(page.locator('.nb-db-check-row')).toHaveCount(2);
  await page.locator('.nb-db-check-row', { hasText: 'B' }).locator('input').check();
  await page.locator('.nb-db-popover').getByRole('button', { name: 'Done', exact: true }).click();
  let data = await databaseState(page);
  expect(data.rows[0]?.cells.tags?.values).toEqual(['A', 'B']);

  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="people"] button').click();
  const people = page.getByRole('textbox', { name: 'People' });
  await people.fill('Ada, Lin');
  await page.locator('.nb-db-popover').getByRole('button', { name: 'Done', exact: true }).click();
  data = await databaseState(page);
  expect((data.rows[0]?.cells.people?.people as Array<{ label: string }>).map(p => p.label)).toEqual([
    'Ada',
    'Lin',
  ]);

  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="files"] button').click();
  await page.getByRole('textbox', { name: 'File name' }).fill('Plan');
  await page.getByRole('textbox', { name: 'File URL' }).fill('https://example.com/plan.pdf');
  await page.getByRole('button', { name: 'Add file', exact: true }).click();
  await page.locator('.nb-db-popover').getByRole('button', { name: 'Done', exact: true }).click();
  data = await databaseState(page);
  expect(
    (data.rows[0]?.cells.files?.files as Array<{ name: string }>).map(file => file.name)
  ).toContain('Plan');
});

test('filters rows and groups the board', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await page.locator('.nb-db-btn', { hasText: 'Filter' }).click();
  await expect(page.locator('.nb-db-filter-popover')).toBeVisible();
  await page.getByRole('button', { name: '+ Add filter' }).click();
  await page.locator('.nb-db-filter-row select').nth(0).selectOption('status');
  await page.locator('.nb-db-filter-row select').nth(1).selectOption('is');
  await page.locator('.nb-db-filter-row input').fill('Todo');
  await page.getByRole('button', { name: 'Apply' }).click();

  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.nb-db-count')).toContainText('2 of 3 rows');

  await page.locator('.nb-db-viewbtn[data-view="board"]').click();
  await expect(page.locator('.nb-db-board')).toBeVisible();
  await expect(page.locator('.nb-db-board-column')).toHaveCount(2);
  await expect(page.locator('.nb-db-card')).toHaveCount(2);
});

test('extends the table for oversized TSV imports', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'A\tB\tC\nD\tE\tF\nG\tH\tI\nJ\tK\tL');
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      clipboardData: data,
    });
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-db-cell[data-row-id="r2"][data-column-id="people"]')
      ?.dispatchEvent(event);
  });

  const data = await databaseState(page);
  expect(data.rows).toHaveLength(5);
  expect(data.columns).toHaveLength(7);
  expect(data.rows[4]?.cells[data.columns[6]!.id]?.text).toBe('L');
});

test('initializes checkbox filters to the displayed value', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await page.locator('.nb-db-btn', { hasText: 'Filter' }).click();
  await page.getByRole('button', { name: '+ Add filter' }).click();
  await page.locator('.nb-db-filter-row select').nth(0).selectOption('done');
  await page.locator('.nb-db-filter-row select').nth(1).selectOption('is');
  await page.getByRole('button', { name: 'Apply' }).click();

  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.nb-db-count')).toContainText('1 of 3 rows');
});

test('keeps the caret while editing a board card title', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await page.locator('.nb-db-viewbtn[data-view="board"]').click();
  const title = page
    .locator('.nb-db-card', { hasText: 'One' })
    .locator('.nb-db-card-title');
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.type('XYZ');

  await expect(title).toHaveText('OneXYZ');
  const data = await databaseState(page);
  expect(data.rows[0]?.cells.name?.text).toBe('OneXYZ');
});

test('pastes into the top-left corner of a selected range', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await page.locator('.nb-db-cell[data-row-id="r2"][data-column-id="name"] .nb-db-text').click();
  await page
    .locator('.nb-db-cell[data-row-id="r1"][data-column-id="status"]')
    .click({ modifiers: ['Shift'] });

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'A\tB\nC\tD');
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      clipboardData: data,
    });
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-db-cell[data-row-id="r2"][data-column-id="name"]')
      ?.dispatchEvent(event);
  });

  const data = await databaseState(page);
  expect(data.rows[0]?.cells.name?.text).toBe('A');
  expect(data.rows[0]?.cells.status?.text).toBe('B');
  expect(data.rows[1]?.cells.name?.text).toBe('C');
  expect(data.rows[1]?.cells.status?.text).toBe('D');
});

test('uses the clicked picker cell as the paste destination', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await page.locator('.nb-db-cell[data-row-id="r2"][data-column-id="status"] button').click();
  await expect(page.locator('.nb-db-popover')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'X	Y');
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      clipboardData: data,
    });
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-db')
      ?.dispatchEvent(event);
  });

  const data = await databaseState(page);
  expect(data.rows[1]?.cells.status?.text).toBe('X');
  expect(data.rows[1]?.cells.tags?.values).toEqual(['Y']);

  await page.locator('.nb-db-btn', { hasText: 'Filter' }).click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'P	Q');
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      clipboardData: data,
    });
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-db-popover input')
      ?.dispatchEvent(event);
  });
  const after = await databaseState(page);
  expect(after.rows[1]?.cells.status?.text).toBe('X');
});

test('resizes columns and persists the width', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  const th = page.locator('th[data-column-id="name"]');
  const resizer = th.locator('.nb-db-resizer');
  const box = await resizer.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 62, box!.y + box!.height / 2);
  await page.mouse.up();

  let data = await databaseState(page);
  expect(data.columns.find(column => column.id === 'name')?.width).toBeGreaterThan(220);

  await page.locator('th[data-column-id="name"] .nb-db-col-head').click();
  await page.locator('.nb-db-popover').getByRole('button', { name: 'Done', exact: true }).click();
  data = await databaseState(page);
  expect(data.columns.find(column => column.id === 'name')?.width).toBeGreaterThan(220);
});

test('imports TSV and copies a selected cell range', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-text').click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'A\tB\nC\tD');
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      clipboardData: data,
    });
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-db')
      ?.dispatchEvent(event);
  });

  let data = await databaseState(page);
  expect(data.rows[0]?.cells.name?.text).toBe('A');
  expect(data.rows[0]?.cells.status?.text).toBe('B');
  expect(data.rows[1]?.cells.name?.text).toBe('C');
  expect(data.rows[1]?.cells.status?.text).toBe('D');

  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').click();
  await page
    .locator('.nb-db-cell[data-row-id="r2"][data-column-id="status"]')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('.nb-db-cell.is-selected')).toHaveCount(4);

  const copied = await page.evaluate(() => {
    const data = new DataTransfer();
    const event = new ClipboardEvent('copy', {
      bubbles: true,
      clipboardData: data,
    });
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-db')
      ?.dispatchEvent(event);
    return data.getData('text/plain');
  });
  expect(copied).toContain('A\tB');
});
