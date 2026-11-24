import { expect, type Page } from '@playwright/test';

export interface RunState {
  text: string;
  marks?: Record<string, unknown>;
}

export interface BlockState {
  id: string;
  type: string;
  text: string;
  runs: RunState[];
  props: Record<string, unknown>;
}

export interface DocState {
  blocks: BlockState[];
}

interface RawBlockState {
  id: string;
  type: string;
  text: RunState[];
  props: Record<string, unknown>;
}

interface RawDocState {
  blocks: RawBlockState[];
}

interface BrowserWindow {
  __ready?: boolean;
  __editor?: {
    focus(blockId?: string, offset?: number): void;
    selectionChanged(): void;
    getDoc(): RawDocState;
  } | null;
  __host?: {
    doc: RawDocState;
    editor: unknown;
  };
  __setDoc?: () => void;
}

export async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as BrowserWindow).__ready === true);
  await expect(page.locator('nobita-editor')).toBeVisible();
}

export async function resetDoc(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as BrowserWindow).__setDoc?.());
  await page.waitForTimeout(50);
}

export async function getDoc(page: Page): Promise<DocState> {
  const raw = await page.evaluate(() => {
    const host = document.querySelector('nobita-editor');
    return (host as unknown as BrowserWindow['__host'])!.doc;
  });
  return {
    blocks: raw.blocks.map(block => ({
      id: block.id,
      type: block.type,
      text: block.text.map(run => run.text).join(''),
      runs: block.text,
      props: block.props,
    })),
  };
}

export async function focusBlock(
  page: Page,
  blockId: string,
  offset = 0
): Promise<void> {
  await page.evaluate(
    ({ blockId, offset }) => {
      const editor = (window as unknown as BrowserWindow).__editor;
      editor?.focus(blockId, offset);
    },
    { blockId, offset }
  );
  await page.waitForTimeout(50);
}

export async function selectRange(
  page: Page,
  startBlockId: string,
  start: number,
  endBlockId: string,
  end: number
): Promise<void> {
  await page.evaluate(
    ({ startBlockId, start, endBlockId, end }) => {
      const host = document.querySelector('nobita-editor');
      const editor = (window as unknown as BrowserWindow).__editor;
      const root = host?.shadowRoot;
      if (!editor || !root) throw new Error('Editor is not ready');
      const textPoint = (blockId: string, offset: number): [Node, number] => {
        const textElement = root.querySelector(
          `.nb-block[data-block-id="${CSS.escape(blockId)}"] .nb-text`
        );
        if (!textElement) throw new Error(`Missing block ${blockId}`);
        const walker = document.createTreeWalker(
          textElement,
          NodeFilter.SHOW_TEXT
        );
        let remaining = offset;
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (remaining <= (node.textContent?.length ?? 0)) {
            return [node, remaining];
          }
          remaining -= node.textContent?.length ?? 0;
        }
        throw new Error(`Offset ${offset} is outside block ${blockId}`);
      };
      const anchor = textPoint(startBlockId, start);
      const focus = textPoint(endBlockId, end);
      editor.focus(startBlockId, start);
      const selection = root.getSelection();
      if (!selection) throw new Error('No shadow selection');
      selection.removeAllRanges();
      selection.setBaseAndExtent(
        anchor[0],
        anchor[1],
        focus[0],
        focus[1]
      );
      editor.selectionChanged();
    },
    { startBlockId, start, endBlockId, end }
  );
  await page.waitForTimeout(100);
}

export async function selectText(
  page: Page,
  blockId: string,
  start: number,
  end: number
): Promise<void> {
  await selectRange(page, blockId, start, blockId, end);
}

export function blockById(doc: DocState, id: string): BlockState | undefined {
  return doc.blocks.find(block => block.id === id);
}
