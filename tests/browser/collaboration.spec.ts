import { test, expect } from '@playwright/test';
import { openFixture } from './helpers';
for (const [id, selector, kind] of [
  ['p', '.nb-text', 'body'],
  ['t', '.nb-table-cell', 'table'],
  ['d', '.nb-db-rich-text', 'database'],
] as const) {
  test(
    kind +
      ' IME merges remote input once, restores caret and delegates history',
    async ({ page }) => {
      await openFixture(page);
      await page.evaluate(async () => {
        const path = '/peers.ts';
        await (await import(path)).setupPeers();
      });
      const input = page
        .locator('#editor')
        .locator('[data-block-id="' + id + '"] ' + selector)
        .first();
      await input.click();
      if (kind === 'body')
        await page.evaluate(() => window.__editor!.focus('p', 1));
      else
        await input.evaluate((el) => {
          const root = el.getRootNode() as ShadowRoot & {
            getSelection(): Selection;
          };
          root.getSelection().collapse(el.firstChild, 1);
        });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', {
        text: 'に',
        selectionStart: 1,
        selectionEnd: 1,
      });
      await page.evaluate(
        ({ id, kind }) => {
          const peer = (document.querySelector('#peer') as typeof window.__host)
            .editor!;
          peer.store.update((d) => {
            const doc = structuredClone(d),
              b = doc.blocks.find((x) => x.id === id)!;
            if (kind === 'body') b.text = [{ text: 'Bab' }];
            else
              (b.props.table ?? b.props.database)!.rows[0]!.cells.c!.text =
                'Bab';
            return doc;
          });
        },
        { id, kind }
      );
      await cdp.send('Input.insertText', { text: '日' });
      const peerInput = page
        .locator('#peer')
        .locator('[data-block-id="' + id + '"] ' + selector)
        .first();
      await expect(input).toHaveText('Ba日b');
      await expect(peerInput).toHaveText('Ba日b');
      expect(
        await input.evaluate(
          (el) =>
            (
              el.getRootNode() as ShadowRoot & { getSelection(): Selection }
            ).getSelection().focusOffset
        )
      ).toBe(3);
      await input.press('ControlOrMeta+z');
      await expect(peerInput).toHaveText('Bab');
      if (kind === 'body') await page.keyboard.press('ControlOrMeta+Shift+z');
      else await input.press('ControlOrMeta+Shift+z');
      await expect(peerInput).toHaveText('Ba日b');
    }
  );
}
test('presence stays outside editable DOM and unsupported history preserves content', async ({
  page,
}) => {
  await openFixture(page);
  await page.evaluate(async () => {
    const path = '/peers.ts';
    await (await import(path)).setupPeers();
    window.__editor!.focus('p', 1);
  });
  await expect(page.locator('#peer .nb-peer-selection')).toHaveCount(1);
  await expect(page.locator('#peer .nb-text .nb-peer-selection')).toHaveCount(
    0
  );
  await page.reload();
  await page.waitForFunction(() => window.__ready);
  await page.evaluate(async () => {
    const path = '/peers.ts';
    await (await import(path)).setupPeers(false);
    window.__editor!.focus('p', 1);
  });
  await page.keyboard.type('X');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#peer .nb-text').first()).toHaveText('aXb');
  expect(
    await page.evaluate(() => [
      window.__editor!.store.canUndo,
      window.__editor!.store.canRedo,
    ])
  ).toEqual([false, false]);
});

test('table and database history are disabled without adapter history, and disconnect starts fresh history', async ({
  page,
}) => {
  await openFixture(page);
  await page.evaluate(async () => {
    const path = '/peers.ts';
    await (await import(path)).setupPeers(false);
  });
  for (const selector of ['.nb-table-cell', '.nb-db-rich-text']) {
    const cell = page.locator('#editor ' + selector).first();
    await cell.click();
    await page.keyboard.press('End');
    await page.keyboard.type('X');
    const peer = page.locator('#peer ' + selector).first();
    await expect(peer).toHaveText('abX');
    await cell.press('ControlOrMeta+z');
    await expect(peer).toHaveText('abX');
    await cell.press('ControlOrMeta+Shift+z');
    await expect(peer).toHaveText('abX');
  }
  expect(
    await page.evaluate(async () => {
      const editor = window.__editor!;
      await editor.setCollaboration(null);
      const oldAvailable = editor.store.canUndo;
      editor.setTitle('local');
      editor.focus('p', 1);
      return oldAvailable;
    })
  ).toBe(false);
  await page.keyboard.type('Z');
  await expect(page.locator('#editor .nb-text').first()).toHaveText('aZb');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#editor .nb-text').first()).toHaveText('ab');
  await expect(page.locator('#peer .nb-text').first()).toHaveText('ab');
});

for (const [id, selector] of [
  ['t', '.nb-table-cell'],
  ['d', '.nb-db-rich-text'],
]) {
  test(
    id + ' keeps normal typing at the logical cell offset',
    async ({ page }) => {
      await openFixture(page);
      await page.evaluate(async () => {
        const path = '/peers.ts';
        await (await import(path)).setupPeers();
      });
      const cell = page.locator('#editor ' + selector).first();
      await cell.click();
      await cell.evaluate((el) =>
        (el.getRootNode() as ShadowRoot & { getSelection(): Selection })
          .getSelection()
          .collapse(el.firstChild, 1)
      );
      await page.evaluate((id) => {
        const peer = (document.querySelector('#peer') as typeof window.__host)
          .editor!;
        peer.store.update((d) => {
          const doc = structuredClone(d),
            b = doc.blocks.find((b) => b.id === id)!;
          (b.props.table ?? b.props.database)!.rows[0]!.cells.c!.text = 'Bab';
          return doc;
        });
      }, id);
      await page.keyboard.type('X');
      await expect(page.locator('#peer ' + selector).first()).toHaveText(
        'BaXb'
      );
    }
  );
}
test('document replacements stay in sync with the peer', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(async () => {
    const path = '/peers.ts';
    await (await import(path)).setupPeers();
    const editor = window.__editor!,
      doc = structuredClone(editor.doc);
    doc.blocks = [{ ...doc.blocks[0]!, id: 'replacement' }];
    window.__host.doc = doc;
    editor.focus('replacement', 1);
  });
  await page.keyboard.type('X');
  await expect(
    page.locator('#peer [data-block-id="replacement"] .nb-text')
  ).toHaveText('aXb');
  await expect(
    page.evaluate(() =>
      window.__editor!.setDoc({ ...window.__editor!.doc, id: 'other' })
    )
  ).rejects.toThrow(/Disconnect collaboration/);
  await expect(page.locator('#editor .nb-text').first()).toHaveText('aXb');
});
