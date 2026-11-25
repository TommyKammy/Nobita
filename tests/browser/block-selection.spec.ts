import { expect, test, type Page } from '@playwright/test';
import { blockById, focusBlock, getDoc, openFixture } from './helpers';

async function setDoc(page: Page, doc: unknown): Promise<void> {
  await page.evaluate(value => {
    const editor = (window as unknown as {
      __editor?: { setDoc(value: string): void };
    }).__editor;
    editor?.setDoc(JSON.stringify(value));
  }, doc);
  await page.waitForTimeout(80);
}

async function getSelectedBlockIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.querySelector('nobita-editor') as unknown as {
      getSelectedBlockIds(): string[];
    };
    return host.getSelectedBlockIds();
  });
}

function mixedDoc() {
  return {
    version: 1,
    id: 'block-selection-mixed',
    title: '',
    blocks: [
      { id: 'p1', type: 'paragraph', text: [{ text: 'Intro' }], props: {}, children: [] },
      { id: 'd1', type: 'divider', text: [], props: {}, children: [] },
      {
        id: 'img1',
        type: 'image',
        text: [],
        props: {
          src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="%232563eb"/></svg>',
          alt: 'Sample',
        },
        children: [],
      },
      {
        id: 't1',
        type: 'table',
        text: [],
        props: {
          table: {
            columns: [{ id: 'c1', width: 160 }, { id: 'c2', width: 160 }],
            rows: [{ id: 'r1', cells: { c1: { text: 'Cell A' }, c2: { text: 'Cell B' } } }],
          },
        },
        children: [],
      },
      {
        id: 'db1',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            columns: [{ id: 'name', name: 'Name', type: 'text' }],
            rows: [{ id: 'row1', cells: { name: { text: 'Task 1' } } }],
          },
        },
        children: [],
      },
      { id: 'p2', type: 'paragraph', text: [{ text: 'Outro' }], props: {}, children: [] },
    ],
  };
}

test('Escape closes overlays first, then toggles block selection on and off', async ({
  page,
}) => {
  await openFixture(page);
  await focusBlock(page, 'b1', 5);
  await page.keyboard.type(' /');
  await expect(page.locator('.nb-menu')).toBeVisible();

  // First Escape closes the slash menu without entering block selection
  await page.keyboard.press('Escape');
  await expect(page.locator('.nb-menu')).toBeHidden();
  expect(await getSelectedBlockIds(page)).toEqual([]);

  // Second Escape selects the current block
  await page.keyboard.press('Escape');
  expect(await getSelectedBlockIds(page)).toEqual(['b1']);
  const b1 = page.locator('.nb-block[data-block-id="b1"]');
  await expect(b1).toHaveClass(/nb-block-selected/);
  await expect(b1).toHaveAttribute('aria-selected', 'true');

  // Third Escape exits block selection and restores text focus in b1
  await page.keyboard.press('Escape');
  expect(await getSelectedBlockIds(page)).toEqual([]);
  await expect(b1).not.toHaveClass(/nb-block-selected/);
  await page.keyboard.type('!');
  const doc = await getDoc(page);
  expect(blockById(doc, 'b1')?.text).toBe('Alpha /!');
});

test('staged Cmd/Ctrl+A selects block text first, then all top-level blocks, and supports batch delete + undo', async ({
  page,
}) => {
  await openFixture(page);
  await focusBlock(page, 'b1', 2);

  // Stage 1: select all text within b1
  await page.keyboard.press('ControlOrMeta+a');
  expect(await getSelectedBlockIds(page)).toEqual([]);
  const sel = await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { getSelection(): { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number } } | null };
    }).__editor;
    return editor?.getSelection() ?? null;
  });
  expect(sel).toEqual({
    anchor: { blockId: 'b1', offset: 0 },
    focus: { blockId: 'b1', offset: 5 },
  });

  // Stage 2: select all top-level blocks
  await page.keyboard.press('ControlOrMeta+a');
  expect(await getSelectedBlockIds(page)).toEqual(['b1', 'b2', 'b3']);
  await expect(page.locator('.nb-block.nb-block-selected')).toHaveCount(3);

  // Batch delete all selected blocks leaves one clean fallback empty paragraph
  await page.keyboard.press('Backspace');
  expect(await getSelectedBlockIds(page)).toEqual([]);
  let doc = await getDoc(page);
  expect(doc.blocks).toHaveLength(1);
  expect(doc.blocks[0]?.type).toBe('paragraph');
  expect(doc.blocks[0]?.text).toBe('');

  // Undo restores all three blocks in a single step
  await page.keyboard.press('ControlOrMeta+z');
  doc = await getDoc(page);
  expect(doc.blocks.map(b => b.id)).toEqual(['b1', 'b2', 'b3']);
  expect(doc.blocks.map(b => b.text)).toEqual(['Alpha', 'Beta', 'Gamma']);
});

test('selects non-text blocks, extends via Shift+Arrow/gutter, inserts via Enter, and duplicates via Mod+D', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, mixedDoc());

  // Click divider to select it
  await page.locator('.nb-block[data-block-id="d1"] .nb-divider').click();
  expect(await getSelectedBlockIds(page)).toEqual(['d1']);

  // Shift+ArrowDown twice extends selection to [d1, img1, t1]
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  expect(await getSelectedBlockIds(page)).toEqual(['d1', 'img1', 't1']);

  // ArrowUp moves single-block selection up to img1
  await page.keyboard.press('ArrowUp');
  expect(await getSelectedBlockIds(page)).toEqual(['img1']);

  // Re-select [d1, img1, t1] and press Enter to insert a paragraph right after t1
  await page.locator('.nb-block[data-block-id="d1"] .nb-divider').click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Enter');
  expect(await getSelectedBlockIds(page)).toEqual([]);
  let doc = await getDoc(page);
  expect(doc.blocks.map(b => b.type)).toEqual([
    'paragraph',
    'divider',
    'image',
    'table',
    'paragraph',
    'database',
    'paragraph',
  ]);

  // Undo Enter insertion, then select [d1, img1] via gutter Shift+Click & Cmd/Ctrl+Click toggle
  await page.keyboard.press('ControlOrMeta+z');
  doc = await getDoc(page);
  expect(doc.blocks.map(b => b.id)).toEqual(['p1', 'd1', 'img1', 't1', 'db1', 'p2']);

  await page.locator('.nb-block[data-block-id="d1"] .nb-divider').click();
  const imgDrag = page.locator('.nb-block[data-block-id="img1"] > .nb-row .nb-drag');
  await page.locator('.nb-block[data-block-id="img1"]').hover();
  await imgDrag.click({ modifiers: ['Shift'] });
  expect(await getSelectedBlockIds(page)).toEqual(['d1', 'img1']);

  // Toggle t1 on then off with ControlOrMeta+Click on its drag handle
  const t1Drag = page.locator('.nb-block[data-block-id="t1"] > .nb-row .nb-drag');
  await page.locator('.nb-block[data-block-id="t1"]').hover();
  await t1Drag.click({ modifiers: ['ControlOrMeta'] });
  expect(await getSelectedBlockIds(page)).toEqual(['d1', 'img1', 't1']);
  await t1Drag.click({ modifiers: ['ControlOrMeta'] });
  expect(await getSelectedBlockIds(page)).toEqual(['d1', 'img1']);

  // Mod+D duplicates [d1, img1] right after img1 and selects the duplicated copies
  await page.keyboard.press('ControlOrMeta+d');
  const dupIds = await getSelectedBlockIds(page);
  expect(dupIds).toHaveLength(2);
  expect(dupIds.every(id => id !== 'd1' && id !== 'img1')).toBe(true);
  doc = await getDoc(page);
  expect(doc.blocks.map(b => b.id)).toEqual(['p1', 'd1', 'img1', ...dupIds, 't1', 'db1', 'p2']);
  expect(doc.blocks[3]?.type).toBe('divider');
  expect(doc.blocks[4]?.type).toBe('image');
});

test('batch copy, cut, and paste in block selection mode', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'copy-cut-paste',
    title: '',
    blocks: [
      { id: 'p1', type: 'paragraph', text: [{ text: 'First' }], props: {}, children: [] },
      { id: 'd1', type: 'divider', text: [], props: {}, children: [] },
      { id: 'h1', type: 'heading', text: [{ text: 'Second' }], props: { level: 2 }, children: [] },
      { id: 'p2', type: 'paragraph', text: [{ text: 'Keep' }], props: {}, children: [] },
    ],
  });

  // Select [p1, d1, h1] via Escape + Shift+ArrowDown
  await focusBlock(page, 'p1', 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  expect(await getSelectedBlockIds(page)).toEqual(['p1', 'd1', 'h1']);

  // Copy serialized payload
  const copied = await page.evaluate(() => {
    const body = document.querySelector('nobita-editor')?.shadowRoot?.querySelector('.nb-body');
    if (!body) throw new Error('Missing body');
    const data = new DataTransfer();
    body.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
    return {
      plain: data.getData('text/plain'),
      html: data.getData('text/html'),
      json: data.getData('application/x-nobita+json'),
    };
  });
  expect(copied.plain).toContain('First');
  expect(copied.plain).toContain('Second');
  expect(copied.html).toContain('<hr');
  expect(copied.html).toContain('<h2');
  const parsedJson = JSON.parse(copied.json) as { blocks: Array<{ id: string; type: string }> };
  expect(parsedJson.blocks.map(b => b.id)).toEqual(['p1', 'd1', 'h1']);

  // Cut removes all 3 selected blocks in one step
  const cutPlain = await page.evaluate(() => {
    const body = document.querySelector('nobita-editor')?.shadowRoot?.querySelector('.nb-body');
    if (!body) throw new Error('Missing body');
    const data = new DataTransfer();
    body.dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: data }));
    return data.getData('text/plain');
  });
  expect(cutPlain).toContain('First');
  expect(await getSelectedBlockIds(page)).toEqual([]);
  let doc = await getDoc(page);
  expect(doc.blocks.map(b => b.id)).toEqual(['p2']);

  // Select remaining block p2 and paste the copied payload to replace p2 in one undoable step
  await focusBlock(page, 'p2', 0);
  await page.keyboard.press('Escape');
  expect(await getSelectedBlockIds(page)).toEqual(['p2']);
  await page.evaluate(json => {
    const body = document.querySelector('nobita-editor')?.shadowRoot?.querySelector('.nb-body');
    if (!body) throw new Error('Missing body');
    const data = new DataTransfer();
    data.setData('application/x-nobita+json', json);
    data.setData('text/plain', 'First\n---\nSecond');
    body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, copied.json);

  expect(await getSelectedBlockIds(page)).toEqual([]);
  doc = await getDoc(page);
  expect(doc.blocks.map(b => b.type)).toEqual(['paragraph', 'divider', 'heading']);
  expect(doc.blocks.map(b => b.text)).toEqual(['First', '', 'Second']);

  // Single undo restores p2
  await page.keyboard.press('ControlOrMeta+z');
  doc = await getDoc(page);
  expect(doc.blocks.map(b => b.id)).toEqual(['p2']);
});

test('multi-block drag-and-drop, readonly guards, and nested field focus clearing', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, mixedDoc());

  // Select [p1, d1] via Escape + Shift+ArrowDown, then drag p1 handle below p2
  await focusBlock(page, 'p1', 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown');
  expect(await getSelectedBlockIds(page)).toEqual(['p1', 'd1']);

  await page.locator('.nb-block[data-block-id="p1"]').hover();
  const handleBox = await page
    .locator('.nb-block[data-block-id="p1"] > .nb-row .nb-drag')
    .boundingBox();
  const targetBox = await page
    .locator('.nb-block[data-block-id="p2"] > .nb-row')
    .boundingBox();
  if (!handleBox || !targetBox) throw new Error('Missing drag boxes');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + 12, targetBox.y + targetBox.height - 3, { steps: 8 });
  await page.mouse.up();

  let doc = await getDoc(page);
  expect(doc.blocks.map(b => b.id)).toEqual(['img1', 't1', 'db1', 'p2', 'p1', 'd1']);
  expect(await getSelectedBlockIds(page)).toEqual(['p1', 'd1']);

  // Focusing a cell inside a table or database clears active block selection
  await page.locator('.nb-block[data-block-id="t1"] .nb-table-cell').first().click();
  expect(await getSelectedBlockIds(page)).toEqual([]);

  await page.locator('.nb-block[data-block-id="d1"] .nb-divider').click();
  expect(await getSelectedBlockIds(page)).toEqual(['d1']);
  await page.locator('.nb-block[data-block-id="db1"] .nb-db-cell').first().click();
  expect(await getSelectedBlockIds(page)).toEqual([]);

  // Readonly mode: navigation/selection/copy work, mutations are ignored
  await page.evaluate(() => {
    const element = document.querySelector('nobita-editor') as unknown as {
      setReadonly(value: boolean): void;
    };
    element.setReadonly(true);
  });

  await page.locator('.nb-block[data-block-id="d1"] .nb-divider').click();
  expect(await getSelectedBlockIds(page)).toEqual(['d1']);

  await page.keyboard.press('ArrowUp');
  expect(await getSelectedBlockIds(page)).toEqual(['p1']);

  await page.keyboard.press('Shift+ArrowDown');
  expect(await getSelectedBlockIds(page)).toEqual(['p1', 'd1']);

  const readonlyCopy = await page.evaluate(() => {
    const body = document.querySelector('nobita-editor')?.shadowRoot?.querySelector('.nb-body');
    if (!body) throw new Error('Missing body');
    const data = new DataTransfer();
    body.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
    return data.getData('text/plain');
  });
  expect(readonlyCopy).toContain('Intro');

  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+d');
  await page.evaluate(() => {
    const body = document.querySelector('nobita-editor')?.shadowRoot?.querySelector('.nb-body');
    if (!body) throw new Error('Missing body');
    const data = new DataTransfer();
    body.dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: data }));
  });

  doc = await getDoc(page);
  expect(doc.blocks.map(b => b.id)).toEqual(['img1', 't1', 'db1', 'p2', 'p1', 'd1']);

  await page.keyboard.press('ControlOrMeta+a');
  expect(await getSelectedBlockIds(page)).toEqual(['img1', 't1', 'db1', 'p2', 'p1', 'd1']);
});
