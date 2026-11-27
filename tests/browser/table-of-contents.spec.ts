import { expect, test, type Page } from '@playwright/test';

const outline = (page: Page) => page.getByRole('navigation', { name: 'Table of contents' });

test('workspace slash insertion survives saving and renders in the readonly embed preview', async ({ page }) => {
  await page.goto(process.env.NOBITA_DEMO_URL ?? '/demo.html');
  await page.locator('#new-page').click();
  await page.locator('.nb-text').first().click();
  await page.keyboard.type('/toc');
  await page.getByRole('menuitem', { name: 'Table of contents' }).click();
  await expect(outline(page)).toContainText('No headings yet');
  await page.keyboard.type('## Milestone');
  await expect(outline(page).getByRole('link')).toHaveText('Milestone');
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  await page.reload();
  await expect(outline(page).getByRole('link')).toHaveText('Milestone');
  await page.locator('#embed-btn').click();
  await expect(page.locator('#embed-preview').getByRole('link', { name: 'Milestone' })).toBeVisible();
});

test('two outlines follow add, rename, level, move, delete and undo without persisting entries', async ({ page }) => {
  await page.goto('/toc.html');
  await page.evaluate(() => {
    const editor = window.__editor!;
    const [a, b, c] = editor.doc.blocks;
    const toc = { ...a!, type: 'custom:table-of-contents' as const, text: [] };
    editor.setDoc({ ...editor.doc, blocks: [
      { ...toc, id: 'toc1' }, { ...a!, type: 'heading' }, b!, c!, { ...toc, id: 'toc2' },
    ] });
    editor.focus('b2', 4);
  });
  const first = outline(page).first();
  await page.keyboard.press('ControlOrMeta+Alt+2');
  await page.evaluate(() => window.__editor!.focus('b2', 4));
  await page.keyboard.type(' revised');
  await expect(first.getByRole('link')).toHaveText(['Alpha', 'Beta revised']);
  await page.keyboard.press('ControlOrMeta+Alt+3');
  expect(await first.locator('li').nth(1).evaluate(item => (item as HTMLElement).style.marginInlineStart)).toBe('2em');
  await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
  await expect(first.getByRole('link')).toHaveText(['Beta revised', 'Alpha']);
  await expect(outline(page).last().getByRole('link')).toHaveText(['Beta revised', 'Alpha']);
  await page.evaluate(() => window.__editor!.selectBlocks(['b2']));
  await page.keyboard.press('Backspace');
  await expect(first.getByRole('link')).toHaveText(['Alpha']);
  await page.evaluate(() => window.__editor!.undo());
  await expect(first.getByRole('link')).toHaveText(['Beta revised', 'Alpha']);
  const preserved = await page.evaluate(() => {
    const editor = window.__editor!;
    document.dispatchEvent(new Event('unregister-toc'));
    return editor.doc.blocks.filter(b => b.type === 'custom:table-of-contents');
  });
  expect(preserved.map(b => [b.text, b.props])).toEqual([[[], {}], [[], {}]]);
  await expect(outline(page)).toHaveCount(0);
});

for (const readonly of [false, true]) {
  test(`navigates by ID to an unmounted heading inside two collapsed ancestors (readonly=${readonly})`, async ({ page }) => {
    await page.goto('/toc.html');
    await page.evaluate(readonly => {
      window.__benchSetSize(10000);
      const editor = window.__editor!, blocks = [...editor.doc.blocks];
      const first = blocks[0]!, last = blocks.at(-1)!;
      const heading = { ...last, type: 'heading' as const, text: [{ text: 'Shared title' }] };
      blocks[0] = { ...first, type: 'custom:table-of-contents', text: [] };
      blocks[1] = { ...heading, id: 'near' };
      blocks[blocks.length - 1] = {
        ...last, props: { collapsed: true }, children: [{
          ...first, id: 'nested', props: { collapsed: true }, children: [{ ...heading, id: 'far/日本' }],
        }],
      };
      editor.setDoc({ ...editor.doc, blocks });
      editor.setReadonly(readonly);
    }, readonly);
    const target = page.locator('[data-block-id="far/日本"] .nb-text');
    await expect(target).toHaveCount(0);
    const links = outline(page).getByRole('link', { name: 'Shared title' });
    await expect(links).toHaveCount(2);
    if (readonly) await links.nth(1).press('Enter');
    else await links.nth(1).click();
    await expect(target).toBeInViewport();
    expect(await page.evaluate(() => {
      const last = window.__editor!.doc.blocks.at(-1)!;
      return [last.props.collapsed, last.children[0]!.props.collapsed];
    })).toEqual([true, true]);
    await page.evaluate(() => window.__editor!.scrollToBlock('bench-0'));
    await expect(outline(page).getByRole('link')).toHaveCount(2);
  });
}

test('paragraph typing and remote heading renames retain existing links and keyboard focus', async ({ page }) => {
  await page.goto('/toc.html');
  await page.evaluate(() => {
    const editor = window.__editor!;
    const [a, b, c] = editor.doc.blocks;
    editor.setDoc({ ...editor.doc, blocks: [
      { ...a!, type: 'custom:table-of-contents', text: [] },
      { ...b!, type: 'heading' }, c!,
    ] });
    editor.root.querySelector('nav a')!.setAttribute('data-original', 'true');
    editor.focus('b3', 0);
  });
  await page.keyboard.type('edited!');
  const link = outline(page).locator('a[data-original]');
  await expect(link).toHaveText('Beta');
  await link.focus();
  await page.evaluate(() => {
    const editor = window.__editor!;
    editor.store.update(doc => ({ ...doc, blocks: doc.blocks.map(b =>
      b.id === 'b2' ? { ...b, text: [{ text: 'Renamed remotely' }] } : b
    ) }), { source: 'remote', history: false });
  });
  await expect(link).toHaveText('Renamed remotely');
  await expect(link).toBeFocused();
});

test('a virtualized outline refreshes after eviction, editing and switching documents', async ({ page }) => {
  await page.goto('/toc.html');
  await page.evaluate(() => {
    window.__benchSetSize(1000);
    const editor = window.__editor!, blocks = [...editor.doc.blocks];
    blocks[0] = { ...blocks[0]!, type: 'custom:table-of-contents', text: [] };
    blocks[999] = { ...blocks[999]!, type: 'heading' };
    editor.setDoc({ ...editor.doc, blocks });
  });
  await outline(page).getByRole('link').click();
  await expect(outline(page)).toHaveCount(0);
  await page.keyboard.type('New ');
  await page.evaluate(() => window.__editor!.scrollToBlock('bench-0'));
  await expect(outline(page).getByRole('link')).toHaveText('New Block 999');
  await page.evaluate(() => {
    const editor = window.__editor!;
    editor.setDoc({ ...editor.doc, id: 'replacement', blocks: editor.doc.blocks.slice(0, 2) });
  });
  await expect(outline(page)).toContainText('No headings yet');
  await expect(outline(page).getByRole('link')).toHaveCount(0);
});

test('an outline tracks structural changes in an unmounted subtree without mounting it', async ({ page }) => {
  await page.goto('/toc.html');
  await page.evaluate(() => {
    window.__benchSetSize(1000);
    const editor = window.__editor!, blocks = [...editor.doc.blocks];
    blocks[0] = { ...blocks[0]!, type: 'custom:table-of-contents', text: [] };
    blocks[999] = { ...blocks[999]!, props: { collapsed: true }, children:
      ([1, 2, 3, 4, 5, 6] as const).map(level => ({
        ...blocks[1]!, id: 'child-' + level, type: 'heading', props: { level },
        text: level === 1 ? [] : [{ text: 'H' + level }],
      })),
    };
    editor.setDoc({ ...editor.doc, blocks });
  });
  const links = outline(page).getByRole('link');
  await expect(links).toHaveText(['Untitled heading', 'H2', 'H3', 'H4', 'H5', 'H6']);
  await page.evaluate(() => {
    const editor = window.__editor!;
    editor.store.update(doc => {
      const blocks = [...doc.blocks], parent = blocks[999]!;
      blocks[999] = { ...parent, children: [
        { ...parent.children[5]!, text: [{ text: 'Moved' }] },
        { ...parent.children[1]!, type: 'paragraph' },
        parent.children[0]!,
      ] };
      return { ...doc, blocks };
    }, { source: 'remote' });
  });
  await expect(links).toHaveText(['Moved', 'Untitled heading']);
  await expect(page.locator('[data-block-id="child-6"]')).toHaveCount(0);
});
