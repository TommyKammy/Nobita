import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';

test('registered and unregistered clients can edit and exchange the same custom block', async ({ page }) => {
  await openFixture(page);
  const original = await page.evaluate(() => {
    const editor = window.__editor!;
    const card = {
      id: 'card', type: 'custom:issue' as const,
      props: { data: { id: 42, tags: ['bug', null, false], extra: { label: '<b>Issue</b>' } } },
      text: [{ text: 'Issue 42' }],
      children: [{ id: 'child', type: 'paragraph' as const, props: {}, children: [], text: [] }],
    };
    editor.registerCustomBlock(card.type, block => JSON.stringify(block.props.data));
    editor.setDoc({ ...editor.getDoc(), blocks: [card, ...editor.getDoc().blocks] });
    return editor.getJSON();
  });
  const content = page.locator('[data-block-id="card"] > .nb-row > .nb-content');
  await expect(content).toContainText('<b>Issue</b>');
  await expect(content.locator('b')).toHaveCount(0);

  // A fresh editor instance opens the persisted JSON without registering any renderer.
  await openFixture(page);
  await page.evaluate(json => window.__editor!.setDoc(json), original);
  await expect(content).toHaveText('custom:issue');
  await expect(content.locator(':scope > div')).toHaveAttribute('contenteditable', 'false');
  await page.evaluate(() => window.__editor!.focus('b1', 5));
  await page.keyboard.type(' edited');
  const saved = await page.evaluate(() => window.__editor!.getJSON());
  expect(JSON.parse(saved).blocks[0]).toEqual(JSON.parse(original).blocks[0]);
  expect(JSON.parse(saved).blocks[1].text).toEqual([{ text: 'Alpha edited' }]);

  await openFixture(page);
  await page.evaluate(json => {
    const editor = window.__editor!;
    editor.setDoc(json);
    editor.registerCustomBlock('custom:issue', (block, readonly) => {
      const label = document.createElement('span');
      label.textContent = (readonly ? 'Read: ' : 'Edit: ') + JSON.stringify(block.props.data);
      return label;
    });
  }, saved);
  await expect(content).toContainText('Edit: {"id":42');
  await page.evaluate(() => window.__editor!.setReadonly(true));
  await expect(content).toContainText('Read: {"id":42');
  await page.evaluate(() => window.__editor!.registerCustomBlock('custom:issue', null));
  await expect(content).toHaveText('custom:issue');
  expect(await page.evaluate(() => window.__editor!.getJSON())).toBe(saved);
});

test('two editors can render the same custom type differently', async ({ page }) => {
  await openFixture(page);
  const states = await page.evaluate(() => {
    const first = window.__editor!;
    first.setDoc({
      ...first.getDoc(),
      blocks: [{ id: 'card', type: 'custom:issue', props: { data: 1 }, children: [], text: [] }],
    });
    const host = window.__host.cloneNode(false) as typeof window.__host;
    host.removeAttribute('id');
    document.body.append(host);
    host.doc = first.getJSON();
    const second = host.editor!;
    const content = () => [first, second].map(editor =>
      editor.root.querySelector('.nb-content')?.textContent);
    first.registerCustomBlock('custom:issue', block => String(block.props.data));
    const registered = content();
    second.registerCustomBlock('custom:issue', () => 'Second');
    first.setDoc({ ...first.getDoc(), blocks: first.getDoc().blocks.map(block =>
      ({ ...block, props: { data: 2 } })) });
    const updated = content();
    first.registerCustomBlock('custom:issue', null);
    const removed = content();
    host.remove();
    return { registered, updated, removed };
  });
  expect(states).toEqual({
    registered: ['1', 'custom:issue'],
    updated: ['2', 'Second'],
    removed: ['custom:issue', 'Second'],
  });
});

test('host controls retain native keyboard activation without editing the document', async ({ page }) => {
  await openFixture(page);
  const before = await page.evaluate(() => {
    const editor = window.__editor!;
    editor.registerCustomBlock('custom:action', () => {
      const button = document.createElement('button');
      button.textContent = 'Open issue';
      button.onclick = () => { button.textContent = 'Opened'; };
      return button;
    });
    editor.setDoc({ ...editor.doc, blocks: [
      { id: 'card', type: 'custom:action', text: [], props: { data: 42 }, children: [] },
      ...editor.doc.blocks,
    ] });
    return editor.getJSON();
  });
  const button = page.getByRole('button', { name: 'Open issue' });
  await button.focus();
  await button.press('ControlOrMeta+Alt+1');
  expect(await page.evaluate(() => window.__editor!.getJSON())).toBe(before);
  await button.press('Enter');
  await expect(page.getByRole('button', { name: 'Opened' })).toBeVisible();
  expect(await page.evaluate(() => window.__editor!.getJSON())).toBe(before);
});

test('unrecognized payloads survive a failing renderer, boundary deletes and clipboard paste', async ({ page }) => {
  await openFixture(page);
  const card = await page.evaluate(() => {
    const editor = window.__editor!;
    const block = {
      id: 'card', type: 'custom:issue' as const, props: { data: { future: [null, false] } },
      text: [], children: [],
    };
    const [first, ...rest] = editor.getDoc().blocks;
    editor.registerCustomBlock(block.type, () => { throw new Error('Unsupported schema'); });
    editor.setDoc({ ...editor.doc, blocks: [first!, block, ...rest] });
    return block;
  });
  await expect(page.locator('[data-block-id="card"] .nb-content')).toHaveText(card.type);
  await page.evaluate(() => window.__editor!.focus('b1', 5));
  await page.keyboard.press('Delete');
  await page.evaluate(() => window.__editor!.focus('b2', 0));
  await page.keyboard.press('Backspace');
  expect(await page.evaluate(() => window.__editor!.doc.blocks[1])).toEqual(card);
  const pasted = await page.evaluate(() => {
    const editor = window.__editor!;
    editor.registerCustomBlock('custom:issue', null);
    editor.selectBlocks(['card']);
    const data = new DataTransfer();
    const body = editor.root.querySelector('.nb-body')!;
    for (const type of ['copy', 'paste']) {
      body.dispatchEvent(new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: data }));
    }
    return editor.doc.blocks[1]!;
  });
  expect(pasted.id).not.toBe(card.id);
  expect({ ...pasted, id: card.id }).toEqual(card);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.__editor!.doc.blocks[1])).toEqual(card);
});
