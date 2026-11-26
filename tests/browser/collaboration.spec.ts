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

test('peers receive the caret after typing, deletion and splitting a paragraph', async ({
  page,
}) => {
  await openFixture(page);
  await page.evaluate(async () => {
    const path = '/peers.ts';
    await (await import(path)).setupPeers();
    window.__editor!.focus('p', 1);
  });
  for (const key of ['X', 'Backspace', 'Enter']) {
    await page.keyboard.press(key);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const selection = window.__editor!.getSelection(),
            root = (document.querySelector('#peer') as typeof window.__host)
              .shadowRoot!;
          if (!selection) return false;
          const el = root.querySelector(
            '[data-block-id="' + selection.focus.blockId + '"] .nb-text'
          );
          const marker = root.querySelector('.nb-peer-selection');
          if (!el || !marker) return false;
          const r = document.createRange(),
            walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let n = walker.nextNode(),
            i = selection.focus.offset;
          while (n && i > (n.textContent ?? '').length) {
            i -= n.textContent!.length;
            n = walker.nextNode();
          }
          if (!n) return false;
          r.setStart(n, i);
          r.collapse(true);
          const expected = r.getBoundingClientRect(),
            actual = marker.getBoundingClientRect();
          return (
            Math.abs(expected.left - actual.left) < 1 &&
            Math.abs(expected.top - actual.top) < 1
          );
        })
      )
      .toBe(true);
  }
});

for (const selector of ['.nb-table-cell', '.nb-db-rich-text']) {
  test(
    selector + ' keeps pending bold on a collaborative IME commit',
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
      await page.keyboard.press('ControlOrMeta+b');
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', {
        text: 'に',
        selectionStart: 1,
        selectionEnd: 1,
      });
      await cdp.send('Input.insertText', { text: '日' });
      const peer = page.locator('#peer ' + selector).first();
      await expect(peer).toHaveText('a日b');
      await expect(peer.locator('.nb-m-bold')).toHaveText('日');
      await cell.press('ControlOrMeta+z');
      await expect(peer).toHaveText('ab');
    }
  );
}

test('record detail IME merges an incoming edit before the composition anchor', async ({
  page,
}) => {
  await openFixture(page);
  await page.evaluate(async () => {
    const path = '/peers.ts';
    await (await import(path)).setupPeers();
    const editor = window.__editor!;
    editor.store.update((d) => {
      const next = structuredClone(d);
      next.blocks[2]!.props.database!.rows[0]!.page = {
        content: [{ text: 'ab' }],
      };
      return next;
    });
    window.__host
      .shadowRoot!.querySelector<HTMLElement>('.nb-db-row-expand')!
      .click();
  });
  const body = page.locator('#editor .nb-db-page-text');
  await body.click();
  await body.evaluate((el) => {
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    (el.getRootNode() as ShadowRoot & { getSelection(): Selection })
      .getSelection()
      .collapse(text, 1);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {
    text: 'に',
    selectionStart: 1,
    selectionEnd: 1,
  });
  await page.evaluate(() => {
    const b = (document.querySelector('#peer') as typeof window.__host).editor!;
    b.store.update((d) => {
      const next = structuredClone(d);
      next.blocks[2]!.props.database!.rows[0]!.page = {
        content: [{ text: 'Bab' }],
      };
      return next;
    });
  });
  await cdp.send('Input.insertText', { text: '日' });
  await expect(body).toHaveText('Ba日b');
  await page.keyboard.type('Z');
  await expect(body).toHaveText('Ba日Zb');
  expect(
    await page.evaluate(() =>
      (
        document.querySelector('#peer') as typeof window.__host
      ).doc.blocks[2]!.props.database!.rows[0]!.page!.content.map(
        (r) => r.text
      ).join('')
    )
  ).toBe('Ba日Zb');
});

test('IME replacement retains a peer insertion inside the original selection', async ({
  page,
}) => {
  await openFixture(page);
  await page.evaluate(async () => {
    const path = '/peers.ts';
    await (await import(path)).setupPeers();
    const editor = window.__editor!;
    editor.store.update((d) => ({
      ...d,
      blocks: d.blocks.map((b) =>
        b.id === 'p' ? { ...b, text: [{ text: 'abcd' }] } : b
      ),
    }));
    editor.focus('p', 1);
    const root = window.__host.shadowRoot! as ShadowRoot & {
      getSelection(): Selection;
    };
    const input = root.querySelector('[data-block-id="p"] .nb-text')!;
    const node = document
      .createTreeWalker(input, NodeFilter.SHOW_TEXT)
      .nextNode()!;
    root.getSelection().setBaseAndExtent(node, 1, node, 3);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {
    text: 'に',
    selectionStart: 1,
    selectionEnd: 1,
  });
  await page.evaluate(() => {
    const editor = (document.querySelector('#peer') as typeof window.__host)
      .editor!;
    editor.store.update((d) => ({
      ...d,
      blocks: d.blocks.map((b) =>
        b.id === 'p' ? { ...b, text: [{ text: 'abXcd' }] } : b
      ),
    }));
  });
  await cdp.send('Input.insertText', { text: '日' });
  const peer = page.locator('#peer [data-block-id="p"] .nb-text');
  await expect(peer).toHaveText('a日Xd');
  await page.keyboard.type('Z');
  await expect(peer).toHaveText('a日ZXd');
});

test('disconnect during IME retains deferred peer edits for subsequent local typing', async ({
  page,
}) => {
  await openFixture(page);
  await page.evaluate(async () => {
    const path = '/peers.ts';
    await (await import(path)).setupPeers();
    window.__editor!.focus('p', 1);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {
    text: 'に',
    selectionStart: 1,
    selectionEnd: 1,
  });
  await page.evaluate(() => {
    const peer = (document.querySelector('#peer') as typeof window.__host)
      .editor!;
    peer.store.update((d) => ({
      ...d,
      blocks: d.blocks.map((b) =>
        b.id === 'p' ? { ...b, text: [{ text: 'Bab' }] } : b
      ),
    }));
  });
  const value = () =>
    page.evaluate(() =>
      window.__editor!.doc.blocks[0]!.text.map((r) => r.text).join('')
    );
  expect(await value()).toBe('ab');
  await page.evaluate(() => window.__editor!.setCollaboration(null));
  expect(await value()).toBe('Bab');
  await page.evaluate(() => window.__editor!.focus('p', 3));
  await page.keyboard.type('Z');
  expect(await value()).toBe('BabZ');
  await expect(page.locator('#peer [data-block-id="p"] .nb-text')).toHaveText(
    'Bab'
  );
});

for (const key of ['Backspace', 'Delete']) {
  test(
    key + ' joins a paragraph without dropping offline typing in it',
    async ({ page }) => {
      await openFixture(page);
      const network = await page.evaluateHandle(async () => {
        const path = '/peers.ts';
        const network = await (await import(path)).setupPeers();
        const editor = window.__editor!,
          p = editor.doc.blocks[0]!;
        editor.setDoc({
          ...editor.doc,
          blocks: [
            { ...p, text: [{ text: 'a' }] },
            { ...p, id: 'q', text: [{ text: 'b' }] },
          ],
        });
        network.pause();
        return network;
      });
      await page.evaluate(
        (key) =>
          window.__editor!.focus(
            key === 'Backspace' ? 'q' : 'p',
            key === 'Backspace' ? 0 : 1
          ),
        key
      );
      await page.keyboard.press(key);
      await expect(page.locator('#editor .nb-text')).toHaveCount(1);
      await page.evaluate(() =>
        (document.querySelector('#peer') as typeof window.__host).editor!.focus(
          'q',
          1
        )
      );
      await page.keyboard.type('X');
      await network.evaluate((n) => n.resume());
      await expect(page.locator('#editor .nb-text')).toHaveText('abX');
      await expect(page.locator('#peer .nb-text')).toHaveText('abX');
      await page.keyboard.type('Y');
      await expect(page.locator('#editor .nb-text')).toHaveText('abXY');
    }
  );
}

for (const composing of [false, true]) {
  test(
    (composing ? 'IME commit' : 'Typing') +
      ' keeps its caret in the remotely split suffix',
    async ({ page }) => {
      await openFixture(page);
      const network = await page.evaluateHandle(async () => {
        const path = '/peers.ts',
          network = await (await import(path)).setupPeers(),
          editor = window.__editor!;
        const block = editor.doc.blocks[0]!;
        editor.setDoc({
          ...editor.doc,
          blocks: [{ ...block, text: [{ text: 'abcd' }] }],
        });
        network.pause();
        editor.focus(block.id, 2);
        return network;
      });
      await page.keyboard.press('Enter');
      await expect(page.locator('#editor .nb-text')).toHaveText(['ab', 'cd']);
      await page.evaluate(() =>
        (document.querySelector('#peer') as typeof window.__host).editor!.focus(
          'p',
          3
        )
      );
      const text = composing ? '日' : 'X';
      if (composing) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.imeSetComposition', {
          text: 'に',
          selectionStart: 1,
          selectionEnd: 1,
        });
        await network.evaluate((n) => n.resume());
        await cdp.send('Input.insertText', { text });
      } else {
        await page.keyboard.type(text);
        await network.evaluate((n) => n.resume());
      }
      await expect(page.locator('#peer .nb-text')).toHaveText([
        'ab',
        'c' + text + 'd',
      ]);
      await page.keyboard.type('Y');
      await expect(page.locator('#editor .nb-text')).toHaveText([
        'ab',
        'c' + text + 'Yd',
      ]);
    }
  );
}
