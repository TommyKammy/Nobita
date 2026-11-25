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

test('converts [[Exact Title]] with a filtering provider and triggers [[ mid-sentence', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'wiki-filter-mid',
    title: '',
    blocks: [
      { id: 'b1', type: 'paragraph', text: [{ text: 'See  later' }], props: {}, children: [] },
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
        const pages = [
          { id: 'p-road', title: 'Roadmap', icon: '🗺️' },
          { id: 'p-spec', title: 'Spec', icon: '📐' },
        ];
        const needle = query.trim().toLowerCase();
        return pages.filter(item => !needle || item.title.toLowerCase().includes(needle));
      },
    });
    // Caret in the middle of the paragraph: between "See " and " later".
    editor?.focus('b1', 4);
  });

  await page.keyboard.type('[[Roadmap]]');
  await expect(page.locator('.nb-menu')).toHaveCount(0);
  const block = blockById(await getDoc(page), 'b1');
  expect(block?.text).toBe('See Roadmap later');
  expect(block?.runs.some(run => run.marks?.page?.id === 'p-road')).toBe(true);
});

test('aborts stale async page creation if the triggering block was edited while pending', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'wiki-async-create',
    title: '',
    blocks: [{ id: 'b1', type: 'paragraph', text: [], props: {}, children: [] }],
  });
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setPageProvider(provider: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setPageProvider({
      search: () => [],
      create: (title: string) =>
        new Promise(resolve => {
          (window as unknown as { __resolveCreate: () => void }).__resolveCreate = () =>
            resolve({ id: 'p-late', title });
        }),
    });
    editor?.focus('b1', 0);
  });

  await page.keyboard.type('[[Draft');
  await expect(page.locator('.nb-menu-item', { hasText: 'Create "Draft"' })).toBeVisible();
  await page.locator('.nb-menu-item', { hasText: 'Create "Draft"' }).click();

  // User edits the block before the async create resolves.
  await page.keyboard.type(' edited');
  await page.evaluate(() => {
    (window as unknown as { __resolveCreate?: () => void }).__resolveCreate?.();
  });
  await page.waitForTimeout(80);

  const block = blockById(await getDoc(page), 'b1');
  expect(block?.text).toBe('[[Draft edited');
  expect(block?.runs.some(run => run.marks?.page)).toBe(false);
});

test('preserves model text and caret offset on DOM/IME input after a resolved inline chip', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'wiki-dom-input',
    title: '',
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        text: [
          { text: 'See ' },
          { text: 'Road', marks: { page: { id: 'p1', title: 'Road', icon: '🗺️' } } },
        ],
        props: {},
        children: [],
      },
    ],
  });
  await page.evaluate(() => {
    const host = document.querySelector('nobita-editor') as HTMLElement & {
      resolvePage?: (pageId: string) => { id: string; title: string; icon?: string } | null;
    };
    host.resolvePage = () => ({ id: 'p1', title: 'Much Longer Resolved Title', icon: '🚀' });
  });
  await expect(page.locator('.nb-m-page')).toHaveText('Much Longer Resolved Title');

  // Simulate IME composition inserting text after the resolved chip.
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { domInput(blockId: string): void };
    }).__editor;
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const textEl = root?.querySelector('[data-block-id="b1"] .nb-text');
    if (!textEl || !root) return;
    const composed = document.createTextNode('XYZ');
    textEl.append(composed);
    const sel = (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.() ?? window.getSelection();
    const range = document.createRange();
    range.setStart(composed, 3);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor?.domInput('b1');
  });

  // Subsequent typing must land AFTER 'XYZ', not before it.
  await page.keyboard.type('!');
  const block = blockById(await getDoc(page), 'b1');
  expect(block?.text).toBe('See RoadXYZ!');
  expect(block?.runs[1]?.marks?.page?.id).toBe('p1');
});

test('matches documented /new-page and /link-page slash aliases', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'slash-aliases',
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
      search: () => [{ id: 'p1', title: 'Guide' }],
      create: () => ({ id: 'p2', title: 'Untitled' }),
    });
    editor?.focus('b1', 0);
  });

  await page.keyboard.type('/new-page');
  await expect(page.locator('.nb-menu-item', { hasText: 'New page' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getDoc(page)).blocks[0]?.type).toBe('page');

  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { focus(blockId: string, offset?: number): void };
    }).__editor;
    editor?.focus('b2', 0);
  });
  await page.keyboard.type('/link-page');
  await expect(page.locator('.nb-menu-item', { hasText: 'Link page' })).toBeVisible();
});

test('navigates inline page chips inside database record detail overlays', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'db-overlay-page',
    title: '',
    blocks: [
      {
        id: 'db1',
        type: 'database',
        text: [],
        props: {
          database: {
            variant: 'database',
            columns: [{ id: 'c1', name: 'Task', type: 'text' }],
            rows: [
              {
                id: 'r1',
                cells: {
                  c1: {
                    text: 'Ship Roadmap',
                    runs: [
                      { text: 'Ship ' },
                      {
                        text: 'Roadmap',
                        marks: { page: { id: 'p-road', title: 'Roadmap', icon: '🗺️' } },
                      },
                    ],
                  },
                },
                page: {
                  content: [
                    { text: 'Details in ' },
                    {
                      text: 'Spec',
                      marks: { page: { id: 'p-spec', title: 'Spec', icon: '📐' } },
                    },
                  ],
                },
              },
            ],
          },
        },
        children: [],
      },
    ],
  });

  await page.evaluate(() => {
    const opened: string[] = [];
    (window as unknown as { __openedOverlayPages: string[] }).__openedOverlayPages = opened;
    const host = document.querySelector('nobita-editor') as HTMLElement & {
      onOpenPage?: (pageId: string) => void;
    };
    host.onOpenPage = pageId => opened.push(pageId);
  });

  // Open the record detail modal (mounted inside .nb-overlay).
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="c1"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  await expect(page.locator('.nb-db-detail')).toBeVisible();

  await page.locator('.nb-db-detail .nb-m-page', { hasText: 'Spec' }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { __openedOverlayPages: string[] }).__openedOverlayPages
    )
  ).toEqual(['p-spec']);
});

test('converts [[Exact Title]] when typed faster than an async PageProvider.search', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'wiki-async-brackets',
    title: '',
    blocks: [{ id: 'b1', type: 'paragraph', text: [], props: {}, children: [] }],
  });
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setPageProvider(provider: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setPageProvider({
      search: async (query: string) => {
        await new Promise(resolve => setTimeout(resolve, 120));
        const all = [{ id: 'p-road', title: 'Roadmap', icon: '🗺️' }];
        const q = query.trim().toLowerCase();
        return all.filter(item => !q || item.title.toLowerCase().includes(q));
      },
    });
    editor?.focus('b1', 0);
  });

  await page.keyboard.type('[[Roadmap]]');
  await expect
    .poll(async () => blockById(await getDoc(page), 'b1')?.runs[0]?.marks?.page?.id)
    .toBe('p-road');
  expect(blockById(await getDoc(page), 'b1')?.text).toBe('Roadmap');
});

test('preserves stateful PageProvider this receiver during [[ and /new-page creation', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'wiki-stateful-provider',
    title: '',
    blocks: [
      { id: 'b1', type: 'paragraph', text: [], props: {}, children: [] },
      { id: 'b2', type: 'paragraph', text: [], props: {}, children: [] },
    ],
  });
  await page.evaluate(() => {
    class StatefulProvider {
      prefix = 'ws-';
      counter = 0;
      search() {
        return [];
      }
      create(title: string) {
        this.counter += 1;
        return { id: `${this.prefix}${this.counter}`, title };
      }
    }
    const editor = (window as unknown as {
      __editor?: {
        setPageProvider(provider: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setPageProvider(new StatefulProvider());
    editor?.focus('b1', 0);
  });

  await page.keyboard.type('[[Stateful');
  await expect(page.locator('.nb-menu-item', { hasText: 'Create "Stateful"' })).toBeVisible();
  await page.locator('.nb-menu-item', { hasText: 'Create "Stateful"' }).click();
  await expect
    .poll(async () => blockById(await getDoc(page), 'b1')?.runs[0]?.marks?.page?.id)
    .toBe('ws-1');

  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { focus(blockId: string, offset?: number): void };
    }).__editor;
    editor?.focus('b2', 0);
  });
  await page.keyboard.type('/new-page');
  await expect(page.locator('.nb-menu-item', { hasText: 'New page' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await getDoc(page)).blocks[1]?.props.pageId)
    .toBe('ws-2');
});

test('strips marks.page from pending bold formatting in table cells and refreshes resolved chips in tables and databases', async ({
  page,
}) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'table-db-page-chips',
    title: '',
    blocks: [
      {
        id: 't1',
        type: 'table',
        text: [],
        props: {
          table: {
            columns: [{ id: 'tc1' }],
            rows: [
              {
                id: 'tr1',
                cells: {
                  tc1: {
                    text: 'Road',
                    runs: [
                      { text: 'Road', marks: { page: { id: 'p1', title: 'Road', icon: '🗺️' } } },
                    ],
                  },
                },
              },
            ],
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
            columns: [{ id: 'c1', name: 'Task', type: 'text' }],
            rows: [
              {
                id: 'r1',
                cells: {
                  c1: {
                    text: 'Road',
                    runs: [
                      { text: 'Road', marks: { page: { id: 'p1', title: 'Road', icon: '🗺️' } } },
                    ],
                  },
                },
                page: {
                  content: [
                    { text: 'Road', marks: { page: { id: 'p1', title: 'Road', icon: '🗺️' } } },
                  ],
                },
              },
            ],
          },
        },
        children: [],
      },
    ],
  });

  // Open database detail modal so we can verify live refresh in all 3 surfaces simultaneously.
  await page.locator('.nb-db-cell[data-row-id="r1"][data-column-id="c1"]').hover();
  await page.locator('.nb-db-row-expand').first().click();
  await expect(page.locator('.nb-db-detail')).toBeVisible();

  // Set resolvePage and verify live refresh across simple table, database table, and detail modal.
  await page.evaluate(() => {
    const host = document.querySelector('nobita-editor') as HTMLElement & {
      resolvePage?: (pageId: string) => { id: string; title: string; icon?: string } | null;
    };
    host.resolvePage = pageId =>
      pageId === 'p1' ? { id: 'p1', title: 'Live Roadmap', icon: '🚀' } : null;
  });

  await expect(page.locator('.nb-table .nb-m-page')).toHaveText('Live Roadmap');
  await expect(page.locator('.nb-table .nb-m-page')).toHaveAttribute('data-page-icon', '🚀');
  await expect(page.locator('.nb-db .nb-m-page')).toHaveText('Live Roadmap');
  await expect(page.locator('.nb-db-detail .nb-db-detail-page .nb-m-page')).toHaveText(
    'Live Roadmap'
  );

  // Close detail modal, focus after the page chip in the simple table cell, press Mod+B, and type.
  await page.locator('.nb-db-detail-close').click();
  await expect(page.locator('.nb-db-detail')).toHaveCount(0);

  await page.evaluate(() => {
    const root = document.querySelector('nobita-editor')?.shadowRoot;
    const cell = root?.querySelector<HTMLElement>('.nb-table-cell');
    if (!cell || !root) return;
    cell.focus();
    const sel =
      (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.() ??
      window.getSelection();
    const range = document.createRange();
    range.setStart(cell, cell.childNodes.length);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
  });

  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('X');

  const runs = await page.evaluate(() => {
    const doc = (
      window as unknown as {
        __editor?: {
          getDoc(): {
            blocks: Array<{
              id: string;
              props: {
                table?: {
                  rows: Array<{
                    cells: Record<string, { runs?: Array<{ text: string; marks?: Record<string, unknown> }> }>;
                  }>;
                };
              };
            }>;
          };
        };
      }
    ).__editor?.getDoc();
    const tableBlock = doc?.blocks.find(b => b.id === 't1');
    return tableBlock?.props.table?.rows[0]?.cells.tc1?.runs ?? [];
  });
  const typed = runs.find(r => r.text === 'X');
  expect(typed?.marks?.bold).toBe(true);
  expect(typed?.marks?.page).toBeUndefined();
});
