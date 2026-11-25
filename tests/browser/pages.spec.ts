import { expect, test, type Page } from '@playwright/test';
import { blockById, getDoc, openFixture } from './helpers';

const pageDoc = () => ({
  version: 1,
  id: 'pages',
  title: '',
  blocks: [
    { id: 'b1', type: 'paragraph', text: [{ text: 'Before' }], props: {}, children: [] },
    { id: 'b2', type: 'paragraph', text: [{ text: 'After' }], props: {}, children: [] },
  ],
});

async function setDoc(page: Page, doc: unknown): Promise<void> {
  await page.evaluate(value => {
    const editor = (window as unknown as { __editor?: { setDoc(value: string): void } })
      .__editor;
    editor?.setDoc(JSON.stringify(value));
  }, doc);
  await page.waitForTimeout(80);
}

test('inserts a page reference after the target block', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, pageDoc());
  const blockId = await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        focus(blockId: string, offset?: number): void;
        insertPageLink(
          page: { id: string; title: string; icon?: string },
          options?: { afterBlockId?: string }
        ): string | null;
      };
    }).__editor;
    editor?.focus('b1', 0);
    return editor?.insertPageLink(
      { id: 'p1', title: 'Roadmap', icon: '🗺️' },
      { afterBlockId: 'b1' }
    );
  });
  expect(blockId).toBeTruthy();

  const doc = await getDoc(page);
  expect(doc.blocks[1]?.type).toBe('page');
  expect(doc.blocks[1]?.props).toMatchObject({
    pageId: 'p1',
    pageTitle: 'Roadmap',
    pageIcon: '🗺️',
  });
  expect(blockById(doc, 'b1')?.text).toBe('Before');
  await expect(page.locator('.nb-page-label')).toHaveText('Roadmap');
});

test('opens page references and refreshes resolved metadata', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'page-open',
    title: '',
    blocks: [
      {
        id: 'page',
        type: 'page',
        text: [],
        props: { pageId: 'p1', pageTitle: 'Roadmap' },
        children: [],
      },
    ],
  });
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        onOpenPage?: (pageId: string) => void;
        resolvePage?: (pageId: string) => { id: string; title: string; icon?: string } | null;
        refreshPageLinks(): void;
      };
    }).__editor;
    if (!editor) return;
    (window as unknown as { __openedPage: string }).__openedPage = '';
    (window as unknown as { __eventPage: string }).__eventPage = '';
    const host = document.querySelector('nobita-editor') as HTMLElement & {
      onOpenPage?: (pageId: string) => void;
    };
    host.onOpenPage = pageId => {
      (window as unknown as { __openedPage: string }).__openedPage = pageId;
    };
    host.addEventListener('nobita-page-open', event => {
      (window as unknown as { __eventPage: string }).__eventPage = (
        event as CustomEvent<{ pageId: string }>
      ).detail.pageId;
    });
    host.resolvePage = pageId => ({ id: pageId, title: 'Live roadmap', icon: '🚀' });
  });
  await expect(page.locator('.nb-page-label')).toHaveText('Live roadmap');
  await expect(page.locator('.nb-page-icon')).toHaveText('🚀');
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        resolvePage?: (pageId: string) => { id: string; title: string } | null;
      };
    }).__editor;
    if (editor) editor.resolvePage = pageId => ({ id: pageId, title: 'Renamed roadmap' });
  });
  await expect(page.locator('.nb-page-label')).toHaveText('Renamed roadmap');

  await page.locator('.nb-page-link').click();
  expect(
    await page.evaluate(() => (window as unknown as { __openedPage: string }).__openedPage)
  ).toBe('p1');
  expect(
    await page.evaluate(() => (window as unknown as { __eventPage: string }).__eventPage)
  ).toBe('p1');

  await page.locator('.nb-page-link').focus();
  await page.keyboard.press('Backspace');
  expect((await getDoc(page)).blocks[0]?.type).toBe('page');
  await page.keyboard.press('Enter');
  expect(
    await page.evaluate(() => (window as unknown as { __openedPage: string }).__openedPage)
  ).toBe('p1');
});

test('opens page references in readonly mode and handles missing pages', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'page-readonly',
    title: '',
    blocks: [
      {
        id: 'page',
        type: 'page',
        text: [],
        props: { pageId: 'p1', pageTitle: 'Roadmap' },
        children: [],
      },
      {
        id: 'missing',
        type: 'page',
        text: [],
        props: {},
        children: [],
      },
    ],
  });
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        onOpenPage?: (pageId: string) => void;
        setReadonly(value: boolean): void;
      };
    }).__editor;
    if (!editor) return;
    (window as unknown as { __openedPage: string }).__openedPage = '';
    editor.onOpenPage = pageId => {
      (window as unknown as { __openedPage: string }).__openedPage = pageId;
    };
    editor.setReadonly(true);
  });
  await expect(page.locator('.nb-page-link').nth(1)).toHaveAttribute('data-missing', 'true');
  await expect(page.locator('.nb-page-label').nth(1)).toHaveText('Missing page');
  await page.locator('.nb-page-link').first().click();
  expect(
    await page.evaluate(() => (window as unknown as { __openedPage: string }).__openedPage)
  ).toBe('p1');
});


test('inserts after a focused page card without an explicit anchor', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'page-focus',
    title: '',
    blocks: [
      {
        id: 'page',
        type: 'page',
        text: [],
        props: { pageId: 'p1', pageTitle: 'Roadmap' },
        children: [],
      },
      { id: 'after', type: 'paragraph', text: [{ text: 'After' }], props: {}, children: [] },
    ],
  });
  const blocks = await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        focus(blockId: string, offset?: number): void;
        insertPageLink(page: { id: string; title: string }): string | null;
      };
    }).__editor;
    editor?.focus('after', 0);
    editor?.focus('page', 0);
    editor?.insertPageLink({ id: 'p2', title: 'Second page' });
    return document.querySelector('nobita-editor')?.doc?.blocks.map(block => block.id);
  });
  expect(blocks).toEqual(['page', expect.any(String), 'after']);
});

test('inserts an inline page link via [[ picker with spaces in query and keeps it atomic', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'wiki-link',
    title: '',
    blocks: [
      { id: 'b1', type: 'paragraph', text: [{ text: 'See ' }], props: {}, children: [] },
    ],
  });
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setPageProvider(provider: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setPageProvider({
      search: (query: string) => {
        const all = [
          { id: 'p-data', title: 'Data views', icon: '📊' },
          { id: 'p-road', title: 'Roadmap', icon: '🗺️' },
        ];
        const q = query.trim().toLowerCase();
        return all.filter(item => !q || item.title.toLowerCase().includes(q));
      },
    });
    editor?.focus('b1', 4);
  });

  await page.keyboard.type('[[Data vi');
  await expect(page.locator('.nb-menu')).toBeVisible();
  await expect(page.locator('.nb-menu-item', { hasText: 'Data views' })).toBeVisible();
  await page.keyboard.press('Enter');

  let doc = await getDoc(page);
  expect(blockById(doc, 'b1')?.text).toBe('See Data views');
  expect(blockById(doc, 'b1')?.runs.some(run => run.marks?.page?.id === 'p-data')).toBe(true);
  await expect(page.locator('.nb-m-page')).toHaveText('Data views');

  // Typing immediately after does not extend marks.page.
  await page.keyboard.type('!');
  doc = await getDoc(page);
  const runs = blockById(doc, 'b1')?.runs ?? [];
  expect(runs.find(r => r.text === '!')?.marks?.page).toBeUndefined();

  // Backspace deletes '!', then next Backspace deletes the entire inline page chip atomically.
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  doc = await getDoc(page);
  expect(blockById(doc, 'b1')?.text).toBe('See ');
  expect(blockById(doc, 'b1')?.runs.some(run => run.marks?.page)).toBe(false);
});

test('creates a new page from [[ picker when no exact match exists', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'wiki-create',
    title: '',
    blocks: [{ id: 'b1', type: 'paragraph', text: [], props: {}, children: [] }],
  });
  await page.evaluate(() => {
    const created: string[] = [];
    (window as unknown as { __createdPages: string[] }).__createdPages = created;
    const editor = (window as unknown as {
      __editor?: {
        setPageProvider(provider: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setPageProvider({
      search: () => [],
      create: async (title: string) => {
        created.push(title);
        return { id: 'p-new', title, icon: '✨' };
      },
    });
    editor?.focus('b1', 0);
  });

  await page.keyboard.type('[[Release notes');
  await expect(page.locator('.nb-menu-item', { hasText: 'Create "Release notes"' })).toBeVisible();
  await page.locator('.nb-menu-item', { hasText: 'Create "Release notes"' }).click();

  await expect
    .poll(async () => blockById(await getDoc(page), 'b1')?.text)
    .toBe('Release notes');
  expect(
    await page.evaluate(() => (window as unknown as { __createdPages: string[] }).__createdPages)
  ).toEqual(['Release notes']);
  expect(blockById(await getDoc(page), 'b1')?.runs[0]?.marks?.page).toEqual({
    id: 'p-new',
    title: 'Release notes',
    icon: '✨',
  });
});

test('converts [[Exact Title]] on closing brackets and ignores [[ in code blocks', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'wiki-brackets',
    title: '',
    blocks: [
      { id: 'b1', type: 'paragraph', text: [], props: {}, children: [] },
      { id: 'c1', type: 'code', text: [], props: { language: 'ts' }, children: [] },
    ],
  });
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setPageProvider(provider: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setPageProvider({
      search: () => [{ id: 'p-road', title: 'Roadmap', icon: '🗺️' }],
    });
    editor?.focus('b1', 0);
  });

  await page.keyboard.type('[[Roadmap]]');
  await expect(page.locator('.nb-menu')).toHaveCount(0);
  expect(blockById(await getDoc(page), 'b1')?.runs[0]?.marks?.page?.id).toBe('p-road');

  // Inside code block, [[ must never open the page picker.
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { focus(blockId: string, offset?: number): void };
    }).__editor;
    editor?.focus('c1', 0);
  });
  await page.keyboard.type('[[');
  await expect(page.locator('.nb-menu')).toHaveCount(0);
  expect(blockById(await getDoc(page), 'c1')?.text).toBe('[[');
});

test('navigates inline page chips, refreshes live titles without offset drift, and round-trips HTML paste', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'inline-nav',
    title: '',
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        text: [
          { text: 'Open ' },
          { text: 'Roadmap', marks: { page: { id: 'p1', title: 'Roadmap', icon: '🗺️' } } },
          { text: ' and ' },
          { text: 'Legacy', marks: { link: '#page-p2' } },
        ],
        props: {},
        children: [],
      },
      { id: 'b2', type: 'paragraph', text: [{ text: 'Paste' }], props: {}, children: [] },
    ],
  });
  await page.evaluate(() => {
    const opened: string[] = [];
    (window as unknown as { __openedPages: string[] }).__openedPages = opened;
    const host = document.querySelector('nobita-editor') as HTMLElement & {
      onOpenPage?: (pageId: string) => void;
      resolvePage?: (pageId: string) => { id: string; title: string; icon?: string } | null;
    };
    host.onOpenPage = pageId => opened.push(pageId);
    host.resolvePage = pageId =>
      pageId === 'p1' ? { id: 'p1', title: 'Q4 Product Roadmap', icon: '🚀' } : null;
  });

  await expect(page.locator('.nb-m-page')).toHaveText('Q4 Product Roadmap');
  await expect(page.locator('.nb-m-page')).toHaveAttribute('data-page-icon', '🚀');

  // Click inline page chip and #page- link.
  await page.locator('.nb-m-page').click();
  await page.locator('.nb-m-link').click();
  expect(
    await page.evaluate(() => (window as unknown as { __openedPages: string[] }).__openedPages)
  ).toEqual(['p1', 'p2']);

  // Typing after a renamed inline chip preserves exact model offsets (no drift).
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { focus(blockId: string, offset?: number): void };
    }).__editor;
    editor?.focus('b1', 12); // 'Open ' (5) + 'Roadmap' (7) = 12
  });
  await page.keyboard.type('!');
  expect(blockById(await getDoc(page), 'b1')?.text).toBe('Open Roadmap! and Legacy');

  // Readonly click still navigates.
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { setReadonly(value: boolean): void };
    }).__editor;
    editor?.setReadonly(true);
  });
  await page.locator('.nb-m-page').click();
  expect(
    await page.evaluate(() => (window as unknown as { __openedPages: string[] }).__openedPages)
  ).toEqual(['p1', 'p2', 'p1']);

  // Exported HTML pastes back as marks.page without a redundant link mark.
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setReadonly(value: boolean): void;
        getHTML(): string;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setReadonly(false);
    const html = editor?.getHTML() ?? '';
    editor?.focus('b2', 5);
    const data = new DataTransfer();
    data.setData('text/html', html);
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('[data-block-id="b2"] .nb-text')
      ?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
  });
  await expect
    .poll(async () => {
      const doc = await getDoc(page);
      return doc.blocks.filter(b => b.runs.some(r => r.marks?.page?.id === 'p1')).length;
    })
    .toBeGreaterThanOrEqual(2);
  const pastedBlock = (await getDoc(page)).blocks.find(
    b => b.id !== 'b1' && b.runs.some(r => r.marks?.page?.id === 'p1')
  );
  const pastedRun = pastedBlock?.runs.find(r => r.marks?.page?.id === 'p1');
  expect(pastedRun?.marks?.link).toBeUndefined();
});

test('inserts a block-level page card via /page and creates one via /new-page', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'slash-pages',
    title: '',
    blocks: [
      { id: 'b1', type: 'paragraph', text: [], props: {}, children: [] },
      { id: 'b2', type: 'paragraph', text: [], props: {}, children: [] },
    ],
  });
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setPageProvider(provider: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setPageProvider({
      search: () => [{ id: 'p-guide', title: 'Embedding guide', icon: '🧩' }],
      create: () => ({ id: 'p-created', title: 'Untitled', icon: '📄' }),
    });
    editor?.focus('b1', 0);
  });

  await page.keyboard.type('/link');
  await expect(page.locator('.nb-menu-item', { hasText: 'Link page' })).toBeVisible();
  await page.locator('.nb-menu-item', { hasText: 'Link page' }).click();
  await expect(page.locator('.nb-menu-item', { hasText: 'Embedding guide' })).toBeVisible();
  await page.locator('.nb-menu-item', { hasText: 'Embedding guide' }).click();

  let doc = await getDoc(page);
  expect(doc.blocks[0]?.type).toBe('page');
  expect(doc.blocks[0]?.props).toMatchObject({
    pageId: 'p-guide',
    pageTitle: 'Embedding guide',
    pageIcon: '🧩',
  });

  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { focus(blockId: string, offset?: number): void };
    }).__editor;
    editor?.focus('b2', 0);
  });
  await page.keyboard.type('/new');
  await expect(page.locator('.nb-menu-item', { hasText: 'New page' })).toBeVisible();
  await page.locator('.nb-menu-item', { hasText: 'New page' }).click();

  await expect
    .poll(async () => (await getDoc(page)).blocks[1]?.type)
    .toBe('page');
  doc = await getDoc(page);
  expect(doc.blocks[1]?.props.pageId).toBe('p-created');
});
