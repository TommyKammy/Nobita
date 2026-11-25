import { expect, test, type Page } from '@playwright/test';
import { getDoc, openDatabaseViewSetting, openFixture } from './helpers';

const SVG_BLUE =
  'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2240%22%20height%3D%2240%22%3E%3Crect%20width%3D%2240%22%20height%3D%2240%22%20fill%3D%22%233b82f6%22/%3E%3C/svg%3E';
const SVG_GREEN =
  'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2240%22%20height%3D%2240%22%3E%3Crect%20width%3D%2240%22%20height%3D%2240%22%20fill%3D%22%2310b981%22/%3E%3C/svg%3E';
const SVG_AMBER =
  'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2240%22%20height%3D%2240%22%3E%3Crect%20width%3D%2240%22%20height%3D%2240%22%20fill%3D%22%23f59e0b%22/%3E%3C/svg%3E';

interface DatabaseDocShape {
  columns: Array<{ id: string; name: string; type: string }>;
  rows: Array<{ id: string; cells: Record<string, { text?: string }> }>;
  views: Array<{
    id: string;
    name: string;
    type: string;
    coverColumnId?: string | null;
    groupProperties?: Array<{ key: string; manuallyCardSort?: string[] }>;
  }>;
  activeViewId?: string;
}

const propertiesDoc = () => ({
  version: 1,
  id: 'database-properties',
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
            { id: 'pct', name: 'Progress', type: 'progress' },
            { id: 'cover', name: 'Cover', type: 'image' },
          ],
          views: [
            {
              id: 'v-table',
              name: 'Table',
              type: 'table',
              filters: [],
              columns: [
                { id: 'name', width: 160 },
                { id: 'status', width: 120 },
                { id: 'pct', width: 180 },
                { id: 'cover', width: 140 },
              ],
            },
            {
              id: 'v-board',
              name: 'Board',
              type: 'board',
              filters: [],
              groupBy: 'status',
              columns: [
                { id: 'name', width: 160 },
                { id: 'status', width: 120 },
                { id: 'pct', width: 180 },
                { id: 'cover', width: 140 },
              ],
            },
          ],
          activeViewId: 'v-table',
          rows: [
            {
              id: 'r1',
              cells: {
                name: { text: 'Alpha' },
                status: { text: 'Todo' },
                pct: { text: '25' },
                cover: { text: SVG_BLUE },
              },
            },
            {
              id: 'r2',
              cells: {
                name: { text: 'Beta' },
                status: { text: 'Todo' },
                pct: { text: '100' },
              },
            },
            {
              id: 'r3',
              cells: {
                name: { text: 'Gamma' },
                status: { text: 'Done' },
              },
            },
          ],
        },
      },
      children: [],
    },
  ],
});

async function setDoc(page: Page, doc = propertiesDoc()): Promise<void> {
  await page.evaluate(value => {
    const editor = (window as unknown as { __editor?: { setDoc(value: string): void } })
      .__editor;
    editor?.setDoc(JSON.stringify(value));
  }, doc);
  await expect(page.locator('.nb-db').first()).toBeVisible();
}

async function getDb(page: Page): Promise<DatabaseDocShape> {
  const doc = await getDoc(page);
  return doc.blocks[0]!.props.database as DatabaseDocShape;
}

test.describe('database progress, image, and board card covers', () => {
  test('progress cell supports pointer scrub, keyboard control, undo/redo, stats, filter, sort, and readonly', async ({
    page,
  }) => {
    await openFixture(page);
    await setDoc(page);

    const r3Cell = page.locator('td[data-row-id="r3"][data-column-id="pct"]');
    const r3Slider = r3Cell.locator('.nb-db-progress');
    await expect(r3Slider).toHaveAttribute('aria-valuetext', 'Empty');
    await expect(r3Slider).not.toHaveAttribute('aria-valuenow');

    // Pointer click and drag-scrub on .nb-db-progress-track
    const track = r3Cell.locator('.nb-db-progress-track');
    const box = await track.boundingBox();
    if (!box) throw new Error('Missing progress track bounding box');

    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();

    await expect(r3Slider).toHaveAttribute('aria-valuenow', '60');
    await expect(r3Cell.locator('.nb-db-progress-label')).toHaveText('60%');
    await expect(r3Cell.locator('.nb-db-progress-fill')).toHaveAttribute(
      'style',
      /width:\s*60%/
    );
    expect((await getDb(page)).rows[2]?.cells.pct?.text).toBe('60');

    // Keyboard control: ArrowRight (+5), Shift+ArrowRight (+1), ArrowLeft (-5), Home (0), End (100), Backspace (empty)
    await r3Slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(r3Slider).toHaveAttribute('aria-valuenow', '65');

    await page.keyboard.press('Shift+ArrowRight');
    await expect(r3Slider).toHaveAttribute('aria-valuenow', '66');

    await page.keyboard.press('ArrowLeft');
    await expect(r3Slider).toHaveAttribute('aria-valuenow', '61');

    await page.keyboard.press('Home');
    await expect(r3Slider).toHaveAttribute('aria-valuenow', '0');

    await page.keyboard.press('End');
    await expect(r3Slider).toHaveAttribute('aria-valuenow', '100');

    // Touch r1 (sets r1=0 for Average=50% and separates r3's Backspace undo step)
    const r1Slider = page
      .locator('td[data-row-id="r1"][data-column-id="pct"] .nb-db-progress');
    await r1Slider.focus();
    await page.keyboard.press('Home');
    await expect(r1Slider).toHaveAttribute('aria-valuenow', '0');

    await r3Slider.focus();
    await page.keyboard.press('Backspace');
    await expect(r3Slider).toHaveAttribute('aria-valuetext', 'Empty');
    expect((await getDb(page)).rows[2]?.cells.pct).toBeUndefined();

    // Undo / Redo restores 100 and clears back to empty
    await r3Slider.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(r3Slider).toHaveAttribute('aria-valuenow', '100');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(r3Slider).toHaveAttribute('aria-valuetext', 'Empty');

    // r1=0, r2=100, r3=empty -> Average should be 50%
    const statBtn = page.locator('.nb-db-stat[data-stat-column="pct"]');
    await statBtn.click();
    await page.locator('.nb-db-stat-option', { hasText: 'Average' }).click();
    await expect(statBtn).toContainText('50%');

    // Set r3=25, test numeric ascending & descending sort (0, 25, 100)
    await r3Slider.focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('ArrowRight');
    }
    await expect(r3Slider).toHaveAttribute('aria-valuenow', '25');

    const pctColHead = page.locator('th[data-column-id="pct"] .nb-db-col-head');
    await pctColHead.click();
    await page.locator('.nb-db-column-popover').getByRole('button', { name: 'Sort Ascending' }).click();
    await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(3);
    const ascIds = await page
      .locator('.nb-db-table tbody tr')
      .evaluateAll(rows => rows.map(row => row.getAttribute('data-row-id')));
    expect(ascIds).toEqual(['r1', 'r3', 'r2']);

    await pctColHead.click();
    await page.locator('.nb-db-column-popover').getByRole('button', { name: 'Sort Descending' }).click();
    const descIds = await page
      .locator('.nb-db-table tbody tr')
      .evaluateAll(rows => rows.map(row => row.getAttribute('data-row-id')));
    expect(descIds).toEqual(['r2', 'r3', 'r1']);

    // Numeric filter: greaterThanOrEqual 50 -> only r2 (100)
    await openDatabaseViewSetting(page, 'Filter');
    const filterPop = page.locator('.nb-db-filter-popover');
    await filterPop.getByRole('button', { name: '+ Add filter' }).click();
    const filterRow = filterPop.locator('.nb-db-filter-row').first();
    await filterRow.locator('select').nth(0).selectOption('pct');
    await filterRow.locator('select').nth(1).selectOption('greaterThanOrEqual');
    await filterRow.locator('input').fill('50');
    await filterPop.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.nb-db-table tbody tr').first()).toHaveAttribute('data-row-id', 'r2');

    // Clear filter so r1, r2, r3 are all visible, then test readonly mode
    await openDatabaseViewSetting(page, /^Filter/);
    await page.locator('.nb-db-filter-popover').getByRole('button', { name: 'Clear all' }).click();
    await page.locator('.nb-db-filter-popover').getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(3);

    await page.evaluate(() => {
      const editor = document.querySelector('nobita-editor') as unknown as {
        setReadonly(value: boolean): void;
      };
      editor.setReadonly(true);
    });

    await expect(r1Slider).toHaveAttribute('tabindex', '-1');
    await expect(r1Slider).toHaveAttribute('aria-disabled', 'true');
    const r1Box = await page
      .locator('td[data-row-id="r1"][data-column-id="pct"] .nb-db-progress-track')
      .boundingBox();
    if (!r1Box) throw new Error('Missing r1 progress track box');
    await page.mouse.click(r1Box.x + r1Box.width * 0.8, r1Box.y + r1Box.height / 2);
    await r1Slider.dispatchEvent('keydown', { key: 'ArrowRight' });
    await expect(r1Slider).toHaveAttribute('aria-valuenow', '0');
    expect((await getDb(page)).rows[0]?.cells.pct?.text).toBe('0');
  });

  test('image cell supports URL validation, uploadImage adapter, Record Page sync, and readonly', async ({
    page,
  }) => {
    await openFixture(page);
    await setDoc(page);

    const r2ImageBtn = page.locator('td[data-row-id="r2"][data-column-id="cover"] .nb-db-image-cell');
    await expect(r2ImageBtn).toContainText('Add image…');

    // Rejects javascript:alert(1)
    await r2ImageBtn.click();
    const pop = page.locator('.nb-db-popover');
    await expect(pop).toBeVisible();
    await pop.locator('input[type="url"]').fill('javascript:alert(1)');
    await pop.getByRole('button', { name: 'Save' }).click();
    await expect(pop.locator('.nb-db-error')).toBeVisible();
    await expect(pop.locator('.nb-db-error')).toContainText('Enter a valid image URL.');
    expect((await getDb(page)).rows[1]?.cells.cover).toBeUndefined();

    // Accepts data:image/svg+xml URL
    await pop.locator('input[type="url"]').fill(SVG_GREEN);
    await pop.getByRole('button', { name: 'Save' }).click();
    await expect(pop).toHaveCount(0);
    await expect(r2ImageBtn.locator('img.nb-db-thumb')).toHaveAttribute('src', SVG_GREEN);
    expect((await getDb(page)).rows[1]?.cells.cover?.text).toBe(SVG_GREEN);

    // Reopening shows preview and Remove clears cell
    await r2ImageBtn.click();
    await expect(pop.locator('.nb-db-img-preview img')).toHaveAttribute('src', SVG_GREEN);
    await pop.getByRole('button', { name: 'Remove' }).click();
    await expect(pop).toHaveCount(0);
    await expect(r2ImageBtn).toContainText('Add image…');
    expect((await getDb(page)).rows[1]?.cells.cover).toBeUndefined();

    // Wire uploadImage adapter: rejecting uploader shows error and preserves doc
    await page.evaluate(() => {
      const editor = (window as unknown as {
        __editor?: { setUploadImage(handler: (file: File) => Promise<{ src: string }>): void };
      }).__editor;
      editor?.setUploadImage(async () => {
        throw new Error('Upload failed');
      });
    });

    await r2ImageBtn.click();
    await expect(pop.getByRole('button', { name: 'Upload image' })).toBeVisible();
    await pop.locator('input[type="file"]').setInputFiles({
      name: 'bad.png',
      mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71]),
    });
    await expect(pop.locator('.nb-db-error')).toBeVisible();
    await expect(pop.locator('.nb-db-error')).toContainText('Could not upload image.');
    expect((await getDb(page)).rows[1]?.cells.cover).toBeUndefined();

    // Working uploadImage adapter saves returned { src } and closes popover
    await page.evaluate(src => {
      const editor = (window as unknown as {
        __editor?: { setUploadImage(handler: (file: File) => Promise<{ src: string }>): void };
      }).__editor;
      editor?.setUploadImage(async () => ({ src }));
    }, SVG_AMBER);

    await pop.locator('input[type="file"]').setInputFiles({
      name: 'ok.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    });
    await expect(pop).toHaveCount(0);
    await expect(r2ImageBtn.locator('img.nb-db-thumb')).toHaveAttribute('src', SVG_AMBER);
    expect((await getDb(page)).rows[1]?.cells.cover?.text).toBe(SVG_AMBER);

    // Record Page: editing progress range and image picker live-syncs to table
    await page.locator('.nb-db-table tbody tr[data-row-id="r2"]').hover();
    await page.locator('.nb-db-table tbody tr[data-row-id="r2"] .nb-db-row-expand').click();
    const detail = page.locator('.nb-db-detail');
    await expect(detail).toBeVisible();

    const range = detail.locator('.nb-db-detail-range');
    await range.fill('42');
    await expect(detail.locator('.nb-db-detail-progress-val')).toHaveText('42%');
    await expect(
      page.locator('td[data-row-id="r2"][data-column-id="pct"] .nb-db-progress')
    ).toHaveAttribute('aria-valuenow', '42');

    await detail.locator('.nb-db-detail-image').click();
    const detailPop = page.locator('.nb-db-popover');
    await detailPop.locator('input[type="url"]').fill(SVG_BLUE);
    await detailPop.getByRole('button', { name: 'Save' }).click();
    await expect(detail.locator('.nb-db-detail-image img.nb-db-thumb')).toHaveAttribute(
      'src',
      SVG_BLUE
    );
    await expect(r2ImageBtn.locator('img.nb-db-thumb')).toHaveAttribute('src', SVG_BLUE);

    await detail.locator('.nb-db-detail-close').click();
    await expect(detail).toHaveCount(0);

    // Readonly mode disables progress range and image picker inside Record Page
    await page.evaluate(() => {
      const editor = document.querySelector('nobita-editor') as unknown as {
        setReadonly(value: boolean): void;
      };
      editor.setReadonly(true);
    });
    await page.locator('.nb-db-table tbody tr[data-row-id="r2"]').hover();
    await page.locator('.nb-db-table tbody tr[data-row-id="r2"] .nb-db-row-expand').click();
    await expect(detail).toBeVisible();
    await expect(detail.locator('.nb-db-detail-range')).toBeDisabled();
    await expect(detail.locator('.nb-db-detail-image')).toBeDisabled();
  });

  test('board card covers render, live-sync from Record Page, toggle off cleanly, clear on column change/delete, and keep drag-reorder working', async ({
    page,
  }) => {
    await openFixture(page);
    await setDoc(page);

    // Switch to Board view and select Cover in View settings
    await page.locator('.nb-db-viewtab', { hasText: 'Board' }).click();
    await expect(page.locator('.nb-db-board')).toBeVisible();

    await page.locator('.nb-db-viewmore').click();
    const viewMenu = page.locator('.nb-db-view-menu');
    const coverSelect = viewMenu.locator('.nb-db-cover-setting select');
    await coverSelect.selectOption('cover');
    await expect(viewMenu).toHaveCount(0);

    expect((await getDb(page)).views.find(v => v.id === 'v-board')?.coverColumnId).toBe('cover');

    // r1 has cover, r2 & r3 do not
    const card1 = page.locator('.nb-db-card[data-row-id="r1"]');
    const card2 = page.locator('.nb-db-card[data-row-id="r2"]');
    const card3 = page.locator('.nb-db-card[data-row-id="r3"]');

    await expect(card1).toHaveClass(/has-cover/);
    await expect(card1.locator('.nb-db-card-cover img')).toHaveAttribute('src', SVG_BLUE);
    await expect(card1.locator('.nb-db-card-image')).toHaveCount(0);
    await expect(card1.locator('.nb-db-card-progress .nb-db-mini-bar')).toBeVisible();
    await expect(card1.locator('.nb-db-card-progress')).toContainText('25%');

    await expect(card2).not.toHaveClass(/has-cover/);
    await expect(card2.locator('.nb-db-card-cover')).toHaveCount(0);
    await expect(card3).not.toHaveClass(/has-cover/);
    await expect(card3.locator('.nb-db-card-cover')).toHaveCount(0);

    // Open Record Page from card2 and add/change/remove cover -> live-updates behind modal
    await card2.click();
    const detail = page.locator('.nb-db-detail');
    await expect(detail).toBeVisible();

    await detail.locator('.nb-db-detail-image').click();
    const pop = page.locator('.nb-db-popover');
    await pop.locator('input[type="url"]').fill(SVG_GREEN);
    await pop.getByRole('button', { name: 'Save' }).click();
    await expect(card2).toHaveClass(/has-cover/);
    await expect(card2.locator('.nb-db-card-cover img')).toHaveAttribute('src', SVG_GREEN);

    await detail.locator('.nb-db-detail-image').click();
    await pop.locator('input[type="url"]').fill(SVG_AMBER);
    await pop.getByRole('button', { name: 'Save' }).click();
    await expect(card2.locator('.nb-db-card-cover img')).toHaveAttribute('src', SVG_AMBER);

    await detail.locator('.nb-db-detail-image').click();
    await pop.getByRole('button', { name: 'Remove' }).click();
    await expect(card2).not.toHaveClass(/has-cover/);
    await expect(card2.locator('.nb-db-card-cover')).toHaveCount(0);

    await detail.locator('.nb-db-detail-close').click();
    await expect(detail).toHaveCount(0);

    // Board card drag-reorder still works when cards have covers (drag r1 onto Done column's r3)
    const doneColumn = page.locator('.nb-db-board-column[data-group="Done"]');
    await card1.dragTo(doneColumn.locator('.nb-db-card[data-row-id="r3"]'), {
      targetPosition: { x: 40, y: 8 },
    });
    await expect(doneColumn.locator('.nb-db-card[data-row-id="r1"]')).toBeVisible();
    await expect(doneColumn.locator('.nb-db-card[data-row-id="r1"] .nb-db-card-cover img')).toHaveAttribute(
      'src',
      SVG_BLUE
    );
    expect((await getDb(page)).rows[0]?.cells.status?.text).toBe('Done');

    // Setting Card cover back to None removes covers and renders image as compact thumb chip
    await page.locator('.nb-db-viewmore').click();
    await page.locator('.nb-db-view-menu .nb-db-cover-setting select').selectOption('');
    await expect(card1).not.toHaveClass(/has-cover/);
    await expect(card1.locator('.nb-db-card-cover')).toHaveCount(0);
    await expect(card1.locator('.nb-db-card-image img.nb-db-card-thumb')).toHaveAttribute(
      'src',
      SVG_BLUE
    );
    await expect(card1.locator('.nb-db-card-image')).not.toContainText('data:image/');
    expect((await getDb(page)).views.find(v => v.id === 'v-board')?.coverColumnId).toBeUndefined();

    // Re-enable cover, then change Cover column type to text -> clears coverColumnId and removes covers
    await page.locator('.nb-db-viewmore').click();
    await page.locator('.nb-db-view-menu .nb-db-cover-setting select').selectOption('cover');
    await expect(card1).toHaveClass(/has-cover/);

    await page.locator('.nb-db-viewtab', { hasText: 'Table' }).click();
    await page.locator('th[data-column-id="cover"] .nb-db-col-head').click();
    await page.locator('.nb-db-column-popover select').first().selectOption('text');
    await page.locator('.nb-db-column-popover').getByRole('button', { name: 'Done' }).click();
    expect((await getDb(page)).views.find(v => v.id === 'v-board')?.coverColumnId).toBeUndefined();

    await page.locator('.nb-db-viewtab', { hasText: 'Board' }).click();
    await expect(card1).not.toHaveClass(/has-cover/);
    await expect(card1.locator('.nb-db-card-cover')).toHaveCount(0);

    // Separately, deleting the image cover column also clears coverColumnId and removes covers
    await setDoc(page);
    await page.locator('.nb-db-viewtab', { hasText: 'Board' }).click();
    await page.locator('.nb-db-viewmore').click();
    await page.locator('.nb-db-view-menu .nb-db-cover-setting select').selectOption('cover');
    await expect(card1).toHaveClass(/has-cover/);

    await page.locator('.nb-db-viewtab', { hasText: 'Table' }).click();
    await page.locator('th[data-column-id="cover"] .nb-db-col-head').click();
    await page.locator('.nb-db-column-popover').getByRole('button', { name: 'Delete' }).click();
    expect((await getDb(page)).views.find(v => v.id === 'v-board')?.coverColumnId).toBeUndefined();

    await page.locator('.nb-db-viewtab', { hasText: 'Board' }).click();
    await expect(card1).not.toHaveClass(/has-cover/);
    await expect(card1.locator('.nb-db-card-cover')).toHaveCount(0);
  });
});
