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
    editor.resolvePage = pageId => ({ id: pageId, title: 'Live roadmap', icon: '🚀' });
    editor.refreshPageLinks();
  });
  await expect(page.locator('.nb-page-label')).toHaveText('Live roadmap');
  await expect(page.locator('.nb-page-icon')).toHaveText('🚀');

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
