import { expect, test, type Page } from '@playwright/test';
import { openFixture } from './helpers';

async function seed(page: Page, first = 'A', last = 'B') {
  await openFixture(page);
  await page.evaluate(
    ([a, b]) => {
      window.__editor!.setDoc({
        version: 1,
        id: 'merge',
        title: '',
        blocks: [
          {
            id: 'table',
            type: 'table',
            children: [],
            text: [],
            props: {
              table: {
                columns: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
                rows: [
                  { id: 'r', cells: { a: { text: a! } } },
                  { id: 's', cells: { b: { text: b! } } },
                ],
              },
            },
          },
        ],
      });
    },
    [first, last]
  );
}

const cells = (page: Page) => page.locator('.nb-table-cell');
const anchor = (page: Page) => cells(page).first();
const value = (page: Page) =>
  page.evaluate(() => window.__editor!.doc.blocks[0]!.props.table!.rows[0]!.cells.a);

async function checkMerged(page: Page, text: string) {
  await expect(cells(page)).toHaveCount(3);
  await expect(anchor(page).locator('..')).toHaveAttribute('rowspan', '2');
  await expect(anchor(page).locator('..')).toHaveAttribute('colspan', '2');
  expect(await value(page)).toMatchObject({ text, colspan: 2, rowspan: 2 });
}

async function selectSquare(page: Page) {
  await anchor(page).click();
  await cells(page)
    .nth(4)
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('td.is-area-selected')).toHaveCount(4);
}

test('merges, edits, clears, splits and restores a rectangle with history', async ({ page }) => {
  await seed(page);
  await selectSquare(page);
  await cells(page).nth(4).click({ button: 'right' });
  await page.getByRole('button', { name: 'Merge cells', exact: true }).click();
  await checkMerged(page, 'A\nB');
  await page.keyboard.press('End');
  await page.keyboard.type('X');
  await checkMerged(page, 'A\nBX');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Y');
  await checkMerged(page, 'A\nBXY');
  expect((await value(page))?.runs?.at(-1)?.marks?.bold).toBe(true);
  await anchor(page).fill('');
  await checkMerged(page, '');
  await page.keyboard.type('again');
  await checkMerged(page, 'again');
  await page.keyboard.press('Tab');
  await expect(cells(page).nth(1)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('Escape');
  await expect(anchor(page)).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: 'Split cell', exact: true }).press('Enter');
  await expect(cells(page)).toHaveCount(6);
  expect((await value(page))?.text).toBe('again');
  await page.keyboard.press('Control+z');
  await checkMerged(page, 'again');
  await page.keyboard.press('Control+Shift+z');
  await expect(cells(page)).toHaveCount(6);
});

test('rejects an oversized merge while preserving selection, cells and history', async ({
  page,
}) => {
  await seed(page, '😀'.repeat(4999), 'xx');
  await selectSquare(page);
  const before = await page.evaluate(() => window.__editor!.getJSON());
  await page.keyboard.press('Shift+F10');
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('10,000');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Merge cells', exact: true }).press('Enter');
  await expect(page.locator('td.is-area-selected')).toHaveCount(4);
  expect(await page.evaluate(() => window.__editor!.getJSON())).toBe(before);
  expect(await page.evaluate(() => window.__editor!.undo())).toBe(false);
});

test('imports nested HTML and copies expanded merged range in HTML and TSV', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData(
      'text/html',
      '<table><tr><td rowspan="2" colspan="2"><b>  A</b><table><tr><td>B</td></tr></table>\n</td><td>X</td></tr><tr><td>Y</td></tr></table>'
    );
    window.__host
      .shadowRoot!.querySelector('.nb-text')!
      .dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
  });
  await expect(cells(page)).toHaveCount(3);
  await cells(page).last().click();
  await anchor(page).click({ modifiers: ['Shift'] });
  const payload = await anchor(page).evaluate(cell => {
    const dt = new DataTransfer();
    cell.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, clipboardData: dt }));
    return { html: dt.getData('text/html'), tsv: dt.getData('text/plain') };
  });
  expect(payload.html).toContain('colspan="2" rowspan="2"');
  expect(payload.tsv).toBe('"  AB\n"\t""\tX\n""\t""\tY');
  await page.evaluate(html => {
    window.__setDoc();
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    window.__host
      .shadowRoot!.querySelector('.nb-text')!
      .dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
  }, payload.html);
  await expect(cells(page)).toHaveCount(3);
  const text = await page.evaluate(() => {
    const table = window.__editor!.doc.blocks.find(b => b.type === 'table')!.props.table!;
    return table.rows[0]!.cells[table.columns[0]!.id];
  });
  expect(text).toMatchObject({ text: '  AB\n', rowspan: 2, colspan: 2 });
});

test('drag merges and keeps covered row and column actions aligned', async ({ page }) => {
  await seed(page);
  const first = (await anchor(page).boundingBox())!;
  const last = (await cells(page).nth(4).boundingBox())!;
  await page.mouse.move(first.x + 8, first.y + 8);
  await page.mouse.down();
  await page.mouse.move(last.x + 8, last.y + 8, { steps: 8 });
  await page.mouse.up();
  await anchor(page).click({ button: 'right' });
  await page.getByRole('button', { name: 'Merge cells', exact: true }).click();
  await checkMerged(page, 'A\nB');
  const col = (await page.locator('col[data-column-id="b"]').boundingBox())!;
  const row = (await page.locator('tr[data-row-id="s"]').boundingBox())!;
  const x = col.x + col.width / 2,
    y = row.y + row.height / 2;
  await page.mouse.move(x, y);
  for (const [label, axis, center] of [
    ['Column 2 actions', 'x', x],
    ['Row 2 actions', 'y', y],
  ] as const) {
    const handle = page.getByRole('button', { name: label, exact: true });
    await expect(handle).toHaveAttribute('data-visible', 'true');
    const box = (await handle.boundingBox())!;
    expect(Math.abs(box[axis] + box[axis === 'x' ? 'width' : 'height'] / 2 - center)).toBeLessThan(
      2
    );
  }
});

test('keyboard extends a rectangle, merges, and moves past the span', async ({ page }) => {
  await seed(page);
  await anchor(page).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('td.is-area-selected')).toHaveCount(4);
  await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: 'Merge cells', exact: true }).press('Enter');
  await checkMerged(page, 'A\nB');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  await expect(cells(page).nth(1)).toBeFocused();
});
