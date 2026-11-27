import { expect, test, type Page } from '@playwright/test';
import { openFixture } from './helpers';

async function setup(page: Page, context: 'empty' | 'text' | 'children' = 'empty') {
  await openFixture(page);
  await page.evaluate(context => {
    const editor = window.__editor!;
    const [first, second, third] = editor.doc.blocks;
    editor.setDoc({ ...editor.doc, blocks: [first!, {
      ...second!, text: context === 'text' ? [{ text: 'intact' }] : [],
      children: context === 'children' ? [{ ...third!, id: 'child' }] : [],
    }, third!] });
    const command = {
      id: 'ticket', label: '案件カード', keywords: ['ticket'],
      create: () => ({
        id: 'card', type: 'custom:ticket' as const, text: [], children: [],
        props: { data: { status: 'open' } },
      }),
    };
    const old = editor.registerSlashBlock(command);
    const remove = editor.registerSlashBlock(command);
    old();
    document.addEventListener('remove-ticket', remove, { once: true });
    editor.focus('b2', 0);
  }, context);
}

const cardItem = (page: Page) => page.getByRole('menuitem', { name: '案件カード' });

test('Japanese slash insertion commits once, focuses the following paragraph and supports undo/redo', async ({ page }) => {
  await setup(page);
  await page.keyboard.type('/');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'あんけん', selectionStart: 4, selectionEnd: 4 });
  await cdp.send('Input.insertText', { text: '案件' });
  await expect(cardItem(page)).toBeVisible();
  await page.evaluate(() => {
    const body = window.__editor!.root.querySelector('.nb-body')!;
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    window.__changes = [];
  });
  await expect(cardItem(page)).toBeVisible();
  await page.keyboard.press('Enter');
  const state = await page.evaluate(() => ({
    ids: window.__editor!.doc.blocks.map(b => b.id),
    changes: window.__changes.length,
    caret: window.__editor!.store.selection?.focus,
  }));
  expect(state).toEqual({ ids: ['b1', 'card', 'b2', 'b3'], changes: 1, caret: { blockId: 'b2', offset: 0 } });
  await page.keyboard.type('next');
  await page.evaluate(() => window.__editor!.undo());
  await page.evaluate(() => window.__editor!.undo());
  expect(await page.evaluate(() => window.__editor!.doc.blocks.map(b => [b.id, b.text]))).toEqual([
    ['b1', [{ text: 'Alpha' }]], ['b2', []], ['b3', [{ text: 'Gamma' }]],
  ]);
  await page.evaluate(() => window.__editor!.redo());
  expect(await page.evaluate(() => window.__editor!.doc.blocks[1]?.props.data)).toEqual({ status: 'open' });
});

for (const context of ['text', 'children'] as const) {
  test('built-in commands remain available in a paragraph with ' + context, async ({ page }) => {
    await setup(page, context);
    await page.keyboard.type('/');
    await expect(page.getByRole('menuitem', { name: /Heading 1/ })).toBeVisible();
    await expect(cardItem(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.__editor!.doc.blocks[1]!.text[0]?.text))
      .toBe(context === 'text' ? '/intact' : '/');
  });
}

test('keyword search, cancellation, read-only and registration disposal', async ({ page }) => {
  await setup(page);
  await page.keyboard.type('/ticket');
  await expect(cardItem(page)).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__editor!.doc.blocks[1]!.text[0]?.text)).toBe('/ticket');
  await page.evaluate(() => window.__editor!.undo());
  await page.keyboard.type('/ticket');
  await page.evaluate(() => window.__editor!.setReadonly(true));
  await expect(cardItem(page)).toHaveCount(0);
  await page.evaluate(() => {
    window.__editor!.setReadonly(false);
    window.__editor!.undo();
    window.__editor!.focus('b2', 0);
  });
  await page.keyboard.type('/ticket');
  await expect(cardItem(page)).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('remove-ticket')));
  await expect(cardItem(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__editor!.doc.blocks.length)).toBe(3);
});

test('a stale menu activation cannot replace changed text', async ({ page }) => {
  await setup(page);
  await page.keyboard.type('/ticket');
  await expect(cardItem(page)).toBeVisible();
  await page.evaluate(() => {
    const editor = window.__editor!;
    const item = editor.root.querySelector('.nb-menu-item')!;
    editor.store.update(doc => ({ ...doc, blocks: doc.blocks.map(b =>
      b.id === 'b2' ? { ...b, text: [{ text: '/edited' }] } : b) }));
    item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  expect(await page.evaluate(() => window.__editor!.doc.blocks[1]?.text)).toEqual([{ text: '/edited' }]);
  expect(await page.evaluate(() => window.__editor!.doc.blocks.length)).toBe(3);
});

test('peer undo removes the card and leaves the original paragraph empty on both clients', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(async () => {
    const path = '/peers.ts';
    await (await import(path)).setupPeers();
    const editor = window.__editor!;
    editor.store.update(doc => ({ ...doc, blocks: doc.blocks.map(b => b.id === 'p' ? { ...b, text: [] } : b) }));
    editor.registerSlashBlock({ id: 'card', label: '案件カード', create: () => ({
      id: 'card', type: 'custom:ticket', props: { data: 42 }, children: [], text: [],
    }) });
    editor.focus('p', 0);
  });
  await page.keyboard.type('/');
  await cardItem(page).click();
  const peer = page.locator('#peer');
  await expect(peer.locator('[data-block-id="card"]')).toContainText('custom:ticket');
  await page.evaluate(() => window.__editor!.undo());
  await expect(page.locator('[data-block-id="card"]')).toHaveCount(0);
  await expect(peer.locator('[data-block-id="p"] .nb-text')).toHaveText('');
  await page.evaluate(() => window.__editor!.redo());
  await expect(peer.locator('[data-block-id="card"]')).toBeVisible();
});

test('a factory returning a conflicting descendant ID leaves the query intact', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const editor = window.__editor!;
    editor.registerSlashBlock({ id: 'bad', label: 'Invalid card', create: () => ({
      id: 'fresh', type: 'custom:ticket', props: {}, text: [], children: [editor.doc.blocks[0]!],
    }) });
  });
  await page.keyboard.type('/invalid');
  await page.getByRole('menuitem', { name: 'Invalid card' }).click();
  expect(await page.evaluate(() => window.__editor!.doc.blocks.map(b => b.id))).toEqual(['b1', 'b2', 'b3']);
  expect(await page.evaluate(() => window.__editor!.doc.blocks[1]?.text)).toEqual([{ text: '/invalid' }]);
});
