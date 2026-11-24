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
          views: [
            { id: 'v-table', name: 'Table', type: 'table', filters: [] },
            { id: 'v-board', name: 'Board', type: 'board', filters: [], groupBy: 'status' },
          ],
          activeViewId: 'v-table',
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
              cells: {
                name: { text: 'Three' },
                status: { text: 'Todo' },
                tags: { values: ['Legacy'] },
                people: {
                  people: [
                    { id: 'u1', label: 'Alex' },
                    { id: 'u2', label: 'Alex' },
                  ],
                },
              },
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

async function setTextBoard(page: Page): Promise<void> {
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { setDoc(value: string): void };
    }).__editor;
    editor?.setDoc(
      JSON.stringify({
        version: 1,
        id: 'text-board',
        title: '',
        blocks: [
          {
            id: 'db-text',
            type: 'database',
            text: [],
            props: {
              database: {
                variant: 'database',
                columns: [{ id: 'name', name: 'Name', type: 'text' }],
                rows: [
                  { id: 'tr1', cells: { name: { text: 'One' } } },
                  { id: 'tr2', cells: { name: { text: 'Two' } } },
                ],
                views: [
                  { id: 'v-table', name: 'Table', type: 'table', filters: [] },
                  { id: 'v-board', name: 'Board', type: 'board', filters: [], groupBy: 'name' },
                ],
                activeViewId: 'v-table',
              },
            },
            children: [],
          },
        ],
      })
    );
  });
  await expect(page.locator('.nb-db-table')).toBeVisible();
  await page.locator('.nb-db-viewtab', { hasText: 'Board' }).click();
  await expect(page.locator('.nb-db-board')).toBeVisible();
}

async function databaseState(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('nobita-editor') as unknown as {
      doc: { blocks: Array<{ props: { database?: unknown } }> };
    };
    return host.doc.blocks[0]?.props.database as {
      columns: Array<{ id: string; width?: number }>;
      rows: Array<{ id: string; cells: Record<string, Record<string, unknown>> }>;
      views?: Array<{ id: string; type?: string; filters?: unknown[]; groupBy?: string }>;
      activeViewId?: string;
      view?: { type?: string; filters?: unknown[]; groupBy?: string };
    };
    return {
      ...data,
      view:
        data.views?.find(view => view.id === data.activeViewId) ??
        data.view,
    };
  });
}

test('renders table, board and new property types', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await expect(page.locator('.nb-db-table')).toBeVisible();
  await expect(page.locator('.nb-db-chip')).toHaveCount(3);
  await expect(page.locator('.nb-db-select', { hasText: 'Spec' })).toBeVisible();
  await expect(page.locator('.nb-db-select', { hasText: 'Ada' })).toBeVisible();

  await page.locator('.nb-db-viewtab', { hasText: 'Board' }).click();
  await expect(page.locator('.nb-db-board')).toBeVisible();
  await expect(page.locator('.nb-db-board-column')).toHaveCount(2);
  await expect(page.locator('.nb-db-card')).toHaveCount(3);
  await expect(page.locator('.nb-db-card', { hasText: 'One' })).toBeVisible();

  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const column = root?.querySelector('.nb-db-board-column[data-group="Todo"]');
    const data = new DataTransfer();
    data.setData('text/nobita-row', 'r2');
    column?.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      })
    );
  });
  let rejected = await databaseState(page);
  expect(rejected.rows[1]?.cells.status?.text).toBe('Done');

  await page
    .locator('.nb-db-card', { hasText: 'Two' })
    .dragTo(page.locator('.nb-db-board-column[data-group="Todo"]'));
  let data = await databaseState(page);
  expect(data.rows[1]?.cells.status?.text).toBe('Todo');
  await expect(page.locator('.nb-db-board-column[data-group="Todo"] .nb-db-card')).toHaveCount(3);

  await page.locator('.nb-db-viewtab', { hasText: 'Table' }).click();
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

  await page.locator('.nb-db-cell[data-row-id="r3"][data-column-id="tags"] button').click();
  await expect(page.locator('.nb-db-check-row')).toHaveCount(3);
  await expect(page.locator('.nb-db-check-row', { hasText: 'Legacy' })).toBeVisible();
  await page.locator('.nb-db-check-row', { hasText: 'Legacy' }).locator('input').uncheck();
  await page.locator('.nb-db-popover').getByRole('button', { name: 'Done', exact: true }).click();
  data = await databaseState(page);
  expect(data.rows[2]?.cells.tags?.values).toBeUndefined();

  await page.locator('.nb-db-cell[data-row-id="r3"][data-column-id="people"] button').click();
  await page.locator('.nb-db-popover').getByRole('button', { name: 'Done', exact: true }).click();
  data = await databaseState(page);
  expect(
    (data.rows[2]?.cells.people?.people as Array<{ id: string; label: string }>).map(
      person => person.id
    )
  ).toEqual(['u1', 'u2']);

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
  await page.locator('.nb-db-filter-row select').nth(2).selectOption('Todo');
  await page.getByRole('button', { name: 'Apply' }).click();

  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.nb-db-count')).toContainText('2 of 3 rows');

  await page.locator('.nb-db-viewtab', { hasText: 'Board' }).click();
  await expect(page.locator('.nb-db-board')).toBeVisible();
  await expect(page.locator('.nb-db-board-column')).toHaveCount(2);
  // Filters belong to the table view; the board view keeps all rows.
  await expect(page.locator('.nb-db-card')).toHaveCount(3);
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

test('keeps board title focus when the title is the group key', async ({ page }) => {
  await openFixture(page);
  await setTextBoard(page);

  const title = page.locator('.nb-db-card-title').first();
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.type('XYZ');

  await expect(title).toHaveText('OneXYZ');
  expect(
    await page.evaluate(() => {
      const host = document.querySelector('nobita-editor');
      return host?.shadowRoot?.activeElement?.textContent ?? '';
    })
  ).toBe('OneXYZ');

  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+z`);
  const afterUndo = await databaseState(page);
  expect(afterUndo.rows[0]?.cells.name?.text).not.toBe('OneXYZ');
  await expect(title).toHaveText(afterUndo.rows[0]?.cells.name?.text ?? '');

  await page.keyboard.press(`${mod}+Shift+z`);
  const afterRedo = await databaseState(page);
  expect(afterRedo.rows[0]?.cells.name?.text).toBe('OneXYZ');
  await expect(title).toHaveText('OneXYZ');
});

test('defers board regrouping when blur precedes a toolbar click', async ({ page }) => {
  await openFixture(page);
  await setTextBoard(page);

  await page.locator('.nb-db-card-title').first().click();
  await page.locator('.nb-db-viewtab', { hasText: 'Table' }).click();
  await expect(page.locator('.nb-db-table')).toBeVisible();
});

test('does not use board title paste for table grid import', async ({ page }) => {
  await openFixture(page);
  await setTextBoard(page);

  const title = page.locator('.nb-db-card-title').first();
  await title.click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'A\tB');
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      clipboardData: data,
    });
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-db-card-title')
      ?.dispatchEvent(event);
  });

  const data = await databaseState(page);
  expect(data.rows).toHaveLength(2);
  expect(data.rows[0]?.cells.name?.text).toBe('One');
});

test('parses quoted spreadsheet fields before applying TSV', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', '"first\nsecond"\tneighbor');
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      clipboardData: data,
    });
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-db-cell[data-row-id="r1"][data-column-id="name"]')
      ?.dispatchEvent(event);
  });

  const data = await databaseState(page);
  expect(data.rows).toHaveLength(3);
  expect(data.rows[0]?.cells.name?.text).toBe('first\nsecond');
  expect(data.rows[0]?.cells.status?.text).toBe('neighbor');
});

test('preserves literal quotes in unquoted TSV fields', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', '5" bolt\tneighbor\nHe said "hello"\tother');
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      clipboardData: data,
    });
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-db-cell[data-row-id="r1"][data-column-id="name"]')
      ?.dispatchEvent(event);
  });

  const data = await databaseState(page);
  expect(data.rows[0]?.cells.name?.text).toBe('5" bolt');
  expect(data.rows[0]?.cells.status?.text).toBe('neighbor');
  expect(data.rows[1]?.cells.name?.text).toBe('He said "hello"');
  expect(data.rows[1]?.cells.status?.text).toBe('other');
});

test('preserves a trailing empty row when copying a single-column range', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { setDoc(value: string): void };
    }).__editor;
    editor?.setDoc(
      JSON.stringify({
        version: 1,
        id: 'trailing-row',
        title: '',
        blocks: [
          {
            id: 'db-trailing',
            type: 'database',
            text: [],
            props: {
              database: {
                variant: 'database',
                columns: [{ id: 'c', name: 'C', type: 'text' }],
                rows: [
                  { id: 'tr1', cells: { c: { text: 'replacement' } } },
                  { id: 'tr2', cells: {} },
                  { id: 'tr3', cells: { c: { text: 'stale' } } },
                ],
              },
            },
            children: [],
          },
        ],
      })
    );
  });
  await expect(page.locator('.nb-db-table')).toBeVisible();

  await page.locator('.nb-db-cell[data-row-id="tr1"][data-column-id="c"]').click();
  await page
    .locator('.nb-db-cell[data-row-id="tr2"][data-column-id="c"]')
    .click({ modifiers: ['Shift'] });
  const copied = await page.evaluate(() => {
    const data = new DataTransfer();
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-db')
      ?.dispatchEvent(
        new ClipboardEvent('copy', {
          bubbles: true,
          clipboardData: data,
        })
      );
    return data.getData('text/plain');
  });
  expect(copied).toBe('replacement\n""');

  await page.locator('.nb-db-cell[data-row-id="tr2"][data-column-id="c"]').click();
  await page.evaluate(text => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-db-cell[data-row-id="tr2"][data-column-id="c"]')
      ?.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          clipboardData: data,
        })
      );
  }, copied);

  const data = await databaseState(page);
  expect(data.rows[1]?.cells.c?.text).toBe('replacement');
  expect(data.rows[2]?.cells.c).toBeUndefined();
});

test('does not activate picker buttons during Shift range selection', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"] .nb-db-text').click();
  await page
    .locator('.nb-db-cell[data-row-id="r2"][data-column-id="done"] button')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('.nb-db-popover')).toHaveCount(0);
  expect(
    await page.locator('.nb-db-cell[data-row-id="r2"][data-column-id="done"] button').getAttribute('aria-checked')
  ).toBe('false');

  await page
    .locator('.nb-db-cell[data-row-id="r2"][data-column-id="status"] button')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('.nb-db-popover')).toHaveCount(0);
});

test('clears file and people references when cutting a range', async ({ page }) => {
  await openFixture(page);
  await setDatabase(page);

  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="name"]').click();
  await page
    .locator('.nb-db-cell[data-row-id="r1"][data-column-id="people"]')
    .click({ modifiers: ['Shift'] });
  await page.evaluate(() => {
    const data = new DataTransfer();
    const event = new ClipboardEvent('cut', {
      bubbles: true,
      clipboardData: data,
    });
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-db-cell[data-row-id="r1"][data-column-id="name"]')
      ?.dispatchEvent(event);
  });

  const data = await databaseState(page);
  expect(data.rows[0]?.cells.name).toBeUndefined();
  expect(data.rows[0]?.cells.files).toBeUndefined();
  expect(data.rows[0]?.cells.people).toBeUndefined();
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

  await page.locator('.nb-db-viewtab', { hasText: 'Board' }).click();
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
  await expect(page.locator('.nb-db-cell.is-selected')).toHaveCount(0);
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
