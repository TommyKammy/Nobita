import { expect, test } from '@playwright/test';
import {
  blockById,
  focusBlock,
  getDoc,
  openFixture,
  resetDoc,
  selectRange,
  selectText,
} from './helpers';

test('mounts the public custom element with a document', async ({ page }) => {
  await openFixture(page);
  const doc = await getDoc(page);
  expect(doc.blocks.map(block => block.text)).toEqual([
    'Alpha',
    'Beta',
    'Gamma',
  ]);
  expect(doc.blocks[0]?.type).toBe('paragraph');
});

test('types text and emits nobita-change', async ({ page }) => {
  await openFixture(page);
  await page.locator('.nb-block[data-block-id="b1"] .nb-text').click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');

  const doc = await getDoc(page);
  expect(blockById(doc, 'b1')?.text).toBe('Alpha!');
  const changes = await page.evaluate(
    () => (window as unknown as { __changes: unknown[] }).__changes.length
  );
  expect(changes).toBeGreaterThan(0);
});

test('applies bold, color and alignment from the toolbar', async ({ page }) => {
  await openFixture(page);
  await selectText(page, 'b1', 0, 5);
  await page.locator('[data-key="bold"]').click();

  let doc = await getDoc(page);
  expect(blockById(doc, 'b1')?.runs).toEqual([
    { text: 'Alpha', marks: { bold: true } },
  ]);

  await selectText(page, 'b1', 0, 5);
  await page.locator('[data-key="color"]').click();
  await page.locator('[data-row-key="color:green"]').click();

  doc = await getDoc(page);
  expect(blockById(doc, 'b1')?.runs[0]?.marks).toMatchObject({
    bold: true,
    color: 'green',
  });

  await selectText(page, 'b1', 0, 5);
  await page.locator('[data-key="align"]').click();
  await page.locator('[data-row-key="align:center"]').click();

  doc = await getDoc(page);
  expect(blockById(doc, 'b1')?.props.align).toBe('center');
});

test('turns a block into a heading from the toolbar and slash menu', async ({
  page,
}) => {
  await openFixture(page);
  await selectText(page, 'b1', 0, 5);
  await page.locator('[data-key="turn-into"]').click();
  await page.locator('[data-row-key="turn:heading:2"]').click();

  let doc = await getDoc(page);
  expect(blockById(doc, 'b1')?.type).toBe('heading');
  expect(blockById(doc, 'b1')?.props.level).toBe(2);

  await resetDoc(page);
  await focusBlock(page, 'b1');
  await page.keyboard.type('/');
  await expect(page.locator('.nb-menu')).toBeVisible();
  await page.keyboard.type('head');
  await page.locator('.nb-menu-item').filter({ hasText: 'Heading 2' }).click();

  doc = await getDoc(page);
  expect(blockById(doc, 'b1')?.type).toBe('heading');
  expect(blockById(doc, 'b1')?.text).toBe('Alpha');
});

test('deletes across block boundaries', async ({ page }) => {
  await openFixture(page);
  await selectRange(page, 'b1', 2, 'b2', 3);
  await page.keyboard.press('Backspace');

  const doc = await getDoc(page);
  expect(doc.blocks.map(block => block.text)).toEqual(['Ala', 'Gamma']);
  expect(doc.blocks.map(block => block.id)).toEqual(['b1', 'b3']);
});

test('supports readonly and keeps floating UI inside a mobile viewport', async ({
  page,
}) => {
  await openFixture(page);
  await page.evaluate(() => {
    const element = document.querySelector('nobita-editor') as unknown as {
      setReadonly(value: boolean): void;
    };
    element.setReadonly(true);
  });
  await expect(page.locator('.nb-body')).toHaveAttribute(
    'contenteditable',
    'false'
  );
  await page.evaluate(() => {
    const element = document.querySelector('nobita-editor') as unknown as {
      setReadonly(value: boolean): void;
    };
    element.setReadonly(false);
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await resetDoc(page);
  await selectText(page, 'b1', 0, 5);
  await expect(page.locator('.nb-toolbar')).toBeVisible();
  const toolbar = await page.locator('.nb-toolbar').boundingBox();
  expect(toolbar).not.toBeNull();
  expect(toolbar!.x).toBeGreaterThanOrEqual(0);
  expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(375);

  await page.locator('[data-key="color"]').click();
  const popover = await page.locator('.nb-color-popover').boundingBox();
  expect(popover).not.toBeNull();
  expect(popover!.x).toBeGreaterThanOrEqual(0);
  expect(popover!.x + popover!.width).toBeLessThanOrEqual(375);
});
