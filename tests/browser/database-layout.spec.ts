import { expect, test, type Page } from '@playwright/test';
import { openFixture } from './helpers';

const layoutDoc = () => ({
  version: 1,
  id: 'database-layout',
  title: '',
  blocks: [
    {
      id: 'h1',
      type: 'heading',
      text: [{ text: 'Roadmap' }],
      props: { level: 2 },
      children: [],
    },
    {
      id: 'p1',
      type: 'paragraph',
      text: [{ text: 'Body copy used to measure the text column.' }],
      props: {},
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
          titleColumnId: 'name',
          columns: [
            { id: 'name', name: 'Name', type: 'text' },
            { id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Done'] },
            { id: 'due', name: 'Due', type: 'date' },
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
                { id: 'due', width: 160 },
              ],
            },
          ],
          activeViewId: 'v1',
          rows: [
            {
              id: 'r1',
              cells: {
                name: { text: 'Ship the layout' },
                status: { text: 'Todo' },
                due: { text: '2026-12-01' },
              },
            },
            {
              id: 'r2',
              cells: {
                name: { text: 'Check the header' },
                status: { text: 'Done' },
                due: { text: '2026-12-02' },
              },
            },
          ],
        },
      },
      children: [],
    },
  ],
});

async function setDoc(page: Page, doc = layoutDoc()): Promise<void> {
  await page.evaluate(value => {
    const editor = (window as unknown as { __editor?: { setDoc(value: string): void } })
      .__editor;
    editor?.setDoc(JSON.stringify(value));
  }, doc);
  await expect(page.locator('.nb-db').first()).toBeVisible();
}

function wideLayoutDoc() {
  const doc = layoutDoc();
  const database = doc.blocks[2]!.props.database as {
    views: Array<{ columns?: Array<{ id: string; width: number }> }>;
  };
  database.views[0]!.columns = [
    { id: 'name', width: 400 },
    { id: 'status', width: 300 },
    { id: 'due', width: 300 },
  ];
  return doc;
}

interface Box {
  x: number;
  right: number;
  width: number;
  height: number;
  opacity: string;
}

async function layoutMetrics(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    if (!root) throw new Error('Missing editor root');
    const box = (selector: string): Box => {
      const element = root.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        opacity: getComputedStyle(element).opacity,
      };
    };
    return {
      body: box('.nb-block[data-type="paragraph"] .nb-text'),
      dbBlock: box('.nb-block[data-type="database"]'),
      db: box('.nb-db'),
      title: box('.nb-db-title-input'),
      viewbar: box('.nb-db-viewbar'),
      tools: box('.nb-db-tools'),
      table: box('.nb-db-table'),
      thead: box('.nb-db-table thead'),
      row: box('.nb-db-table tbody tr'),
      cellText: box('.nb-db-cell .nb-db-text'),
    };
  });
}

test('aligns the database edge, title and first column with body text', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  const metrics = await layoutMetrics(page);

  expect(Math.abs(metrics.table.x - metrics.body.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.viewbar.x - metrics.body.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.dbBlock.x - (metrics.body.x - 8))).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.title.x - (metrics.body.x + 30))).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.cellText.x - (metrics.body.x + 30))).toBeLessThanOrEqual(1);
  expect(Math.round(metrics.row.height)).toBe(34);
  expect(Math.round(metrics.thead.height)).toBe(34);
  expect(metrics.tools.opacity).toBe('0');
});

test('reveals the toolbar on hover and keyboard focus', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  const tools = page.locator('.nb-db-tools');

  await expect(tools).toHaveCSS('opacity', '0');
  await page.locator('.nb-db').hover();
  await expect(tools).toHaveCSS('opacity', '1');
  await page.mouse.move(0, 0);
  await expect(tools).toHaveCSS('opacity', '0');
  await page.locator('.nb-db-search').focus();
  await expect(tools).toHaveCSS('opacity', '1');
});

test('keeps filter chips behind the filter toggle', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  const filter = page.locator('.nb-db-btn[title="Filter rows"]');

  await filter.click();
  await expect(page.locator('.nb-db-filter-popover')).toBeVisible();
  await page.getByRole('button', { name: '+ Add filter' }).click();
  await page.locator('.nb-db-filter-row select').nth(0).selectOption('status');
  await page.locator('.nb-db-filter-row select').nth(1).selectOption('is');
  await page.locator('.nb-db-filter-row select').nth(2).selectOption('Todo');
  await page.getByRole('button', { name: 'Apply' }).click();

  await expect(page.locator('.nb-db-filter-bar')).toBeVisible();
  await expect(page.locator('.nb-db-filter-chip')).toContainText('Status');

  await filter.click();
  await expect(page.locator('.nb-db-filter-bar')).toHaveCount(0);
  await filter.click();
  await expect(page.locator('.nb-db-filter-bar')).toBeVisible();
});

test('keeps uncalculated statistics hidden until the footer is hovered', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  const stat = page.locator('.nb-db-foot .nb-db-stat').first();

  await expect(stat).toHaveCSS('opacity', '0');
  await page.locator('.nb-db-foot').first().hover();
  await expect(stat).toHaveCSS('opacity', '1');
});

test('expands search from the toolbar and clears it', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  const wrap = page.locator('.nb-db-search-wrap');

  await expect(wrap).toHaveAttribute('data-open', 'false');
  await page.locator('.nb-db-search-toggle').click();
  await expect(wrap).toHaveAttribute('data-open', 'true');
  await expect(page.locator('.nb-db-search')).toBeFocused();

  await page.locator('.nb-db-search').fill('Ship');
  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(1);
  await page.locator('.nb-db-search-clear').click();
  await expect(page.locator('.nb-db-search')).toHaveValue('');
  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.nb-db-search')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(wrap).toHaveAttribute('data-open', 'false');
});

test('clears an active search when the header becomes narrow', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  await page.locator('.nb-db-search-toggle').click();
  await page.locator('.nb-db-search').fill('Ship');
  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator('.nb-db-search-wrap')).toBeHidden();
  await expect(page.locator('.nb-db-search')).toHaveValue('');
  await expect(page.locator('.nb-db-table tbody tr')).toHaveCount(2);
});

test('keeps sort, properties and group in view settings', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);

  await expect(page.locator('.nb-db-tools .nb-db-btn[title="Sort rows"]')).toHaveCount(0);
  await expect(
    page.locator('.nb-db-tools .nb-db-btn[title="Show or hide columns"]')
  ).toHaveCount(0);
  await expect(page.locator('.nb-db-tools .nb-db-btn[title="Group rows"]')).toHaveCount(0);
  await expect(page.locator('.nb-db-viewmore')).toHaveCount(1);

  await page.locator('.nb-db-viewmore').click();
  const menu = page.locator('.nb-db-view-menu');
  await expect(menu.getByRole('button', { name: /^Properties/ })).toBeVisible();
  await expect(menu.getByRole('button', { name: /^Sort/ })).toBeVisible();
  await expect(menu.getByRole('button', { name: /^Group/ })).toBeVisible();
});

test('keeps add-column and new-record controls reachable while scrolling', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, wideLayoutDoc());
  const scroll = page.locator('.nb-db-scroll');
  const positions = () =>
    page.evaluate(() => {
      const root = document.querySelector('nobita-editor')?.shadowRoot;
      const scroller = root?.querySelector('.nb-db-scroll');
      const add = root?.querySelector('.nb-db-add-column-head');
      const label = root?.querySelector('.nb-db-new-record-label');
      if (!scroller || !add || !label) throw new Error('Missing sticky controls');
      return {
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
        addX: add.getBoundingClientRect().x,
        labelX: label.getBoundingClientRect().x,
      };
    });

  const before = await positions();
  expect(before.scrollWidth).toBeGreaterThan(before.clientWidth);
  await scroll.evaluate(element => {
    element.scrollLeft = 240;
  });
  await page.waitForTimeout(50);
  const after = await positions();
  expect(Math.abs(after.addX - before.addX)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.labelX - before.labelX)).toBeLessThanOrEqual(1);
});

test('overlays row actions without reserving title-cell space', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);
  const titleCell = page.locator('.nb-db-cell.has-row-ops').first();

  await expect(titleCell).toHaveCSS('padding-right', '6px');
  await page.locator('.nb-db-table tbody tr').first().hover();
  await expect(page.locator('.nb-db-row-ops').first()).toBeVisible();
});

test('keeps the header inside the database at narrow widths', async ({ page }) => {
  await openFixture(page);
  await setDoc(page);

  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(100);
    const metrics = await layoutMetrics(page);
    expect(metrics.tools.right).toBeLessThanOrEqual(metrics.db.right + 1);
    expect(Math.abs(metrics.table.x - metrics.body.x)).toBeLessThanOrEqual(1);
    const overflow = await page.evaluate(() => {
      const root = document.querySelector('nobita-editor')?.shadowRoot;
      const head = root?.querySelector('.nb-db-head');
      if (!head) throw new Error('Missing database header');
      return { scroll: head.scrollWidth, client: head.clientWidth };
    });
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  }
});

test.describe('touch viewport', () => {
  test.use({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });

  test('shows tools and statistics without hover', async ({ page }) => {
    await openFixture(page);
    await setDoc(page);
    await expect(page.locator('.nb-db-tools')).toHaveCSS('opacity', '1');
    await expect(page.locator('.nb-db-search-wrap')).toBeHidden();
    await expect(page.locator('.nb-db-foot .nb-db-stat').first()).toHaveCSS(
      'opacity',
      '1'
    );

    const layout = await page.evaluate(() => {
      const root = document.querySelector('nobita-editor')?.shadowRoot;
      const bar = root?.querySelector('.nb-db-bar');
      const viewbar = root?.querySelector('.nb-db-viewbar');
      const tools = root?.querySelector('.nb-db-tools');
      if (!bar || !viewbar || !tools) throw new Error('Missing database header');
      return {
        barRight: bar.getBoundingClientRect().right,
        viewbarWidth: viewbar.getBoundingClientRect().width,
        toolsRight: tools.getBoundingClientRect().right,
      };
    });
    expect(layout.viewbarWidth).toBeGreaterThan(80);
    expect(layout.toolsRight).toBeLessThanOrEqual(layout.barRight + 1);
  });
});
