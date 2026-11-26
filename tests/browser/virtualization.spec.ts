import { expect, test, type Page } from '@playwright/test';
import type { NobitaEditorElement } from '@nobita/element';
import { windowLayout } from '../../packages/element/src/virtualizer';
import { openFixture } from './helpers';

const mounted = '.nb-body > .nb-block';

async function setup(page: Page, count = 10_000) {
  await openFixture(page);
  await page.evaluate((n) => window.__benchSetSize(n), count);
}

test('merges adjacent windows and sizes every gap from measured offsets', () => {
  const heights = new Float64Array([0, 10, 30, 35, 50, 60, 80, 100, 125, 155]);
  expect(windowLayout(heights, 4, 6, [1, 5, 6])).toEqual([
    -10, 1, -20, 4, 5, 6, -55,
  ]);
  expect(windowLayout(heights, 0, 0, [])).toEqual([-155]);
});

test('retains ordinary rendering below the threshold', async ({ page }) => {
  await setup(page, 200);
  await expect(page.locator(mounted)).toHaveCount(200);
  await expect(page.locator('.nb-body > [aria-hidden=true]')).toHaveCount(0);
});

test('keeps the original IME node and commits once after a distant jump', async ({
  page,
}) => {
  await setup(page);
  const cdp = await page.context().newCDPSession(page);
  const initial = await page.evaluateHandle(() => {
    window.__host.editor!.focus('bench-9', 7);
    return window.__host.shadowRoot!.querySelector(
      '[data-block-id="bench-9"] .nb-text'
    )!;
  });
  await cdp.send('Input.imeSetComposition', {
    text: '漢字',
    selectionStart: 2,
    selectionEnd: 2,
  });
  await page.evaluate(() => window.__host.editor!.scrollToBlock('bench-4999'));
  const far = page.locator('[data-block-id="bench-4999"]');
  await expect(far).toBeInViewport();
  await page.evaluate(() =>
    new Promise(requestAnimationFrame).then(
      () => new Promise(requestAnimationFrame)
    )
  );
  expect(await page.locator(mounted).count()).toBeLessThan(150);
  expect(
    await initial.evaluate(
      (el) =>
        el.isConnected &&
        el ===
          window.__host.shadowRoot!.querySelector(
            '[data-block-id="bench-9"] .nb-text'
          ) &&
        el.textContent?.includes('漢字')
    )
  ).toBe(true);
  await cdp.send('Input.insertText', { text: '漢字' });
  expect(
    await page.evaluate(() => window.__host.doc!.blocks[9]!.text[0]?.text)
  ).toBe('Block 9漢字');
  expect(
    await page.evaluate(
      () =>
        window.__changes.filter(
          (c) => c.doc.blocks[9]?.text[0]?.text === 'Block 9漢字'
        ).length
    )
  ).toBe(1);
});

test('edits after a fast scroll, copies and deletes a logical range, and undoes', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight)
  );
  const tail = page.locator('[data-block-id="bench-9999"] .nb-text');
  await expect(tail).toBeInViewport();
  await page.evaluate(() => window.__host.editor!.focus('bench-9999', 10));
  await page.keyboard.type('!');
  await expect(tail).toHaveText('Block 9999!');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+a');
  const copied = await page.evaluate(() => {
    const data = new DataTransfer();
    window.__host
      .shadowRoot!.querySelector('.nb-body')!
      .dispatchEvent(
        new ClipboardEvent('copy', {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        })
      );
    return JSON.parse(data.getData('application/x-nobita+json')).blocks.map(
      (b: { id: string }) => b.id
    );
  });
  expect(copied).toEqual(
    Array.from({ length: 10_000 }, (_, i) => 'bench-' + i)
  );
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.__host.doc!.blocks.length)).toBe(1);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.__host.doc!.blocks.length)).toBe(
    10_000
  );
  await page.evaluate(() => window.__host.editor!.focus('bench-5000', 0));
  await expect(page.locator('[data-block-id="bench-5000"]')).toBeInViewport();
});

test('finds a scroll parent across the shadow boundary and reveals nested blocks', async ({
  page,
}) => {
  await openFixture(page);
  await page.evaluate(() => {
    const host = window.__host as NobitaEditorElement;
    const wrapper = document.createElement('section');
    wrapper.style.cssText = 'height:360px;overflow-y:auto';
    host.before(wrapper);
    wrapper.append(host);
    window.__benchSetSize(10_000);
    const doc = host.doc!;
    const last = doc.blocks.at(-1)!;
    host.doc = {
      ...doc,
      blocks: [
        ...doc.blocks.slice(0, -1),
        { ...last, children: [{ ...last, id: 'child' }] },
      ],
    };
    host.editor!.focus('child', 0);
  });
  await expect(page.locator('[data-block-id="child"]')).toBeInViewport();
  expect(
    await page.locator('section').evaluate((el) => el.scrollTop)
  ).toBeGreaterThan(100_000);
  expect(await page.locator(mounted).count()).toBeLessThan(150);
});

test('copies and deletes a text selection spanning an unmounted interval', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const host = window.__host;
    host.editor!.focus('bench-9', 0);
    host.editor!.scrollToBlock('bench-4999');
    const shadow = host.shadowRoot!;
    const text = (id: number) =>
      shadow.querySelector(`[data-block-id="bench-${id}"] .nb-text`)!;
    const selection = (
      shadow as ShadowRoot & { getSelection(): Selection }
    ).getSelection();
    selection.setBaseAndExtent(
      text(9),
      0,
      text(4999),
      text(4999).childNodes.length
    );
    document.dispatchEvent(new Event('selectionchange'));
  });
  const text = await page.evaluate(() => {
    const data = new DataTransfer();
    window.__host
      .shadowRoot!.querySelector('.nb-body')!
      .dispatchEvent(
        new ClipboardEvent('copy', {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        })
      );
    return data.getData('text/plain');
  });
  expect(text).toContain('Block 2500');
  await page.keyboard.press('Backspace');
  expect(
    await page.evaluate(() =>
      window.__host.doc!.blocks.some((b) => b.id === 'bench-2500')
    )
  ).toBe(false);
  await page.evaluate(() => window.__host.editor!.undo());
  expect(await page.evaluate(() => window.__host.doc!.blocks.length)).toBe(
    10_000
  );
});

test('retains logical numbering and supports an explicit full-render option', async ({
  page,
}) => {
  await setup(page, 500);
  const values = await page.evaluate(() => {
    const host = window.__host;
    const doc = {
      ...host.doc!,
      blocks: host.doc!.blocks.map((b) => ({
        ...b,
        type: 'numbered' as const,
      })),
    };
    host.doc = doc;
    host.editor!.scrollToBlock('bench-450');
    const marker = host.shadowRoot!.querySelector(
      '[data-block-id="bench-450"] .nb-marker'
    )!.textContent;
    const container = document.createElement('div');
    document.body.append(container);
    const Editor = host.editor!
      .constructor as typeof import('@nobita/element').NobitaEditor;
    const full = new Editor(container, { doc, virtualize: false });
    const count = full.root.querySelectorAll('.nb-body > .nb-block').length;
    full.destroy();
    container.remove();
    return { marker, count };
  });
  expect(values).toEqual({ marker: '451', count: 500 });
});

test('horizontal movement from a distant pinned caret follows logical neighbors', async ({
  page,
}) => {
  await setup(page);
  for (const [key, offset, target] of [
    ['ArrowLeft', 0, 'bench-8'],
    ['ArrowRight', 7, 'bench-10'],
    ['Shift+ArrowLeft', 0, 'bench-8'],
    ['Shift+ArrowRight', 7, 'bench-10'],
  ] as const) {
    await page.evaluate((offset) => {
      window.__host.editor!.focus('bench-9', offset);
      window.__host.editor!.scrollToBlock('bench-4999');
    }, offset);
    await expect(page.locator('[data-block-id="bench-4999"]')).toBeInViewport();
    await page.keyboard.press(key);
    const selection = await page.evaluate(() =>
      window.__host.editor!.getSelection()
    );
    expect(selection?.focus.blockId).toBe(target);
    expect(selection?.anchor.blockId).toBe(
      key.startsWith('Shift') ? 'bench-9' : target
    );
  }
});

test('all blocks are present during print and the window returns afterwards', async ({
  page,
}) => {
  await setup(page, 500);
  const counts = await page.evaluate(() => {
    const body = window.__host.shadowRoot!.querySelector('.nb-body')!;
    window.dispatchEvent(new Event('beforeprint'));
    const printed = body.querySelectorAll(':scope > .nb-block').length;
    const gaps = body.querySelectorAll(':scope > [aria-hidden=true]').length;
    window.dispatchEvent(new Event('afterprint'));
    return [printed, gaps, body.children.length];
  });
  expect(counts.slice(0, 2)).toEqual([500, 0]);
  expect(counts[2]).toBeLessThan(150);
});

test('a detached editor binds to its eventual scrolling ancestor', async ({
  page,
}) => {
  await setup(page, 1000);
  await page.evaluate(() => {
    const outer = document.createElement('section');
    outer.style.cssText = 'position:fixed;inset:0;height:350px;overflow:auto';
    const container = document.createElement('div');
    container.id = 'preview';
    outer.append(container);
    const Editor = window.__host.editor!
      .constructor as typeof import('@nobita/element').NobitaEditor;
    new Editor(container, { doc: window.__host.doc! });
    document.body.append(outer);
  });
  await page.evaluate(() =>
    new Promise(requestAnimationFrame).then(
      () => new Promise(requestAnimationFrame)
    )
  );
  await page
    .locator('section')
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(
    page.locator('#preview [data-block-id="bench-999"]')
  ).toBeInViewport();
});

for (const count of [10, 500]) {
  test(
    'reveals nested collapsed ancestors in a readonly document of ' +
      count +
      ' blocks',
    async ({ page }) => {
      await setup(page, count);
      const revealed = await page.evaluate(() => {
        const host = window.__host;
        const doc = host.doc!,
          last = doc.blocks.at(-1)!;
        const collapsed = { ...last, props: { collapsed: true } };
        host.doc = {
          ...doc,
          blocks: [
            ...doc.blocks.slice(0, -1),
            {
              ...collapsed,
              children: [
                {
                  ...collapsed,
                  id: 'middle',
                  children: [{ ...last, id: 'result' }],
                },
              ],
            },
          ],
        };
        host.setReadonly(true);
        return host.editor!.scrollToBlock('result');
      });
      expect(revealed).toBe(true);
      await expect(page.locator('[data-block-id="result"]')).toBeInViewport();
      expect(
        await page.evaluate(
          () => window.__host.doc!.blocks.at(-1)!.props.collapsed
        )
      ).toBe(true);
    }
  );
}

test('database search, readonly tab and expanded group survive virtual eviction and remount', async ({
  page,
}) => {
  await setup(page, 1000);
  await page.evaluate(() => {
    const host = window.__host,
      doc = host.doc!;
    host.doc = {
      ...doc,
      blocks: [
        {
          ...doc.blocks[0]!,
          type: 'database',
          props: {
            database: {
              variant: 'database',
              columns: [
                { id: 'name', name: 'Name', type: 'text' },
                { id: 'status', name: 'Status', type: 'select' },
              ],
              views: [
                { id: 'one', name: 'All', type: 'table' },
                {
                  id: 'two',
                  name: 'Grouped',
                  type: 'table',
                  groupBy: 'status',
                  groupProperties: [{ key: 'Done', collapsed: true }],
                },
              ],
              activeViewId: 'one',
              rows: ['alpha', 'beta'].map((text) => ({
                id: text,
                cells: { name: { text }, status: { text: 'Done' } },
              })),
            },
          },
        },
        ...doc.blocks.slice(1),
      ],
    };
  });
  await page.evaluate(() => window.__host.setReadonly(true));
  const tab = page.getByRole('tab', { name: 'Grouped' });
  await tab.click();
  const group = page.locator('.nb-db-group[data-group="Done"]');
  await group.locator('.nb-db-group-toggle').click();
  await page.locator('.nb-db-search-toggle').click();
  await page.locator('.nb-db-search').fill('alpha');
  await page.evaluate(() => window.__host.editor!.focus('bench-999', 0));
  await expect(page.locator('.nb-db')).toHaveCount(0);
  await page.evaluate(() => window.__host.editor!.scrollToBlock('bench-0'));
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(group.locator('.nb-db-table')).toBeVisible();
  await expect(page.locator('.nb-db-search')).toHaveValue('alpha');
  await expect(page.locator('.nb-db-cell[data-row-id="beta"]')).toHaveCount(0);
});

test('document boundary shortcuts move and extend the logical selection', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => window.__host.editor!.focus('bench-5', 3));
  const start = { blockId: 'bench-0', offset: 0 };
  const end = { blockId: 'bench-9999', offset: 10 };
  const original = { blockId: 'bench-5', offset: 3 };
  for (const [key, anchor, focus] of [
    ['Control+Shift+End', original, end],
    ['Control+Shift+Home', original, start],
    ['Control+End', end, end],
    ['Control+Home', start, start],
  ] as const) {
    await page.keyboard.press(key);
    expect(
      await page.evaluate(() => window.__host.editor!.getSelection())
    ).toEqual({ anchor, focus });
    await expect(
      page.locator(`[data-block-id="${focus.blockId}"]`)
    ).toBeInViewport();
    expect(await page.locator(mounted).count()).toBeLessThan(150);
  }
});

test('a portaled record dialog pins its owning database until closed', async ({
  page,
}) => {
  await setup(page, 1000);
  await page.evaluate(() => {
    const host = window.__host,
      doc = host.doc!;
    host.doc = {
      ...doc,
      blocks: [
        {
          ...doc.blocks[0]!,
          children: [
            {
              ...doc.blocks[0]!,
              id: 'nested-db',
              type: 'database',
              props: {
                database: {
                  variant: 'database',
                  columns: [{ id: 'name', name: 'Name', type: 'text' }],
                  rows: [{ id: 'r', cells: { name: { text: 'Original' } } }],
                },
              },
            },
          ],
        },
        ...doc.blocks.slice(1),
      ],
    };
  });
  await page.locator('.nb-db-cell[data-row-id="r"] .nb-db-rich-text').click();
  await page.keyboard.press('Control+Enter');
  const dialog = page.getByRole('dialog', { name: 'Record page' });
  await expect(dialog).toBeVisible();
  const title = dialog.locator('.nb-db-detail-title');
  await title.focus();
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight)
  );
  await expect(page.locator('[data-block-id="bench-999"]')).toBeInViewport();
  await expect(title).toBeFocused();
  await title.fill('Edited while scrolled');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        window.__host.doc!.blocks[0]!.children[0]!.props.database!.rows[0]!
          .cells.name?.text
    )
  ).toBe('Edited while scrolled');
  await page.evaluate(() => window.__host.editor!.focus('bench-999', 0));
  await expect(page.locator('[data-block-id="nested-db"]')).toHaveCount(0);
});
