import { createBlock, plainText, walkBlocks, type Block } from '@nobita/core';
import type { NobitaEditor } from './editor.js';

const type = 'custom:table-of-contents';
const registrations = new WeakMap<NobitaEditor, () => void>();

interface Heading {
  id: string;
  level: number;
  label: string;
}

// The store path-copies edits. Skip unchanged branches and ignore paragraph text.
function outlineMayDiffer(before: readonly Block[], after: readonly Block[]): boolean {
  if (before === after) return false;
  if (before.length !== after.length) return true;
  return after.some((block, index) => {
    const old = before[index]!;
    if (old === block) return false;
    if (old.id !== block.id || old.type !== block.type) return true;
    if (block.type === 'heading' && (old.text !== block.text || old.props.level !== block.props.level)) return true;
    return outlineMayDiffer(old.children, block.children);
  });
}

/** Install the TOC renderer and slash command in one editor. Returns a disposer. */
export function registerTableOfContents(editor: NobitaEditor): () => void {
  registrations.get(editor)?.();
  const title = editor.t('Table of contents');
  const views = new Map<string, HTMLElement>();
  let snapshot: readonly Block[] | undefined;
  let headings: Heading[] = [];

  function paint(nav: HTMLElement): void {
    const focused = nav.querySelector<HTMLAnchorElement>('a:focus')?.hash;
    const list = document.createElement('ul');
    list.style.cssText = 'list-style:none;padding:0;margin:.25em 0';
    let restoreFocus: HTMLAnchorElement | undefined;
    for (const { id, label, level } of headings) {
      const item = document.createElement('li');
      item.style.marginInlineStart = `${level - 1}em`;
      const link = document.createElement('a');
      link.href = '#block-' + encodeURIComponent(id);
      link.textContent = label;
      link.style.color = 'var(--nb-accent, LinkText)';
      if (focused === link.hash) restoreFocus = link;
      link.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        if (editor.scrollToBlock(id)) editor.focus(id, 0);
      };
      item.append(link);
      list.append(item);
    }
    const content = nav.lastElementChild!;
    if (headings.length) content.replaceChildren(list);
    else content.textContent = editor.t('No headings yet');
    restoreFocus?.focus({ preventScroll: true });
  }

  function sync(): void {
    const blocks = editor.store.doc.blocks;
    const changed = !snapshot || outlineMayDiffer(snapshot, blocks);
    snapshot = blocks;
    if (!changed) return;
    const next: Heading[] = [];
    walkBlocks(blocks, block => {
      if (block.type === 'heading') next.push({
        id: block.id, level: block.props.level ?? 1,
        label: plainText(block.text).trim() || editor.t('Untitled heading'),
      });
    });
    const previous = headings;
    headings = next;
    if (next.length === previous.length && next.every((h, i) => h.id === previous[i]!.id)) {
      // A rename or level change keeps every other link (and keyboard focus) in place.
      next.forEach((heading, i) => {
        const old = previous[i]!;
        if (old.label === heading.label && old.level === heading.level) return;
        for (const nav of views.values()) {
          const item = nav.lastElementChild!.firstElementChild!.children[i] as HTMLLIElement;
          if (old.label !== heading.label) item.firstElementChild!.textContent = heading.label;
          if (old.level !== heading.level) item.style.marginInlineStart = `${heading.level - 1}em`;
        }
      });
    } else {
      for (const nav of views.values()) paint(nav);
    }
  }

  let unsubscribe: (() => void) | undefined;
  let pendingCleanup = false;
  function prune(): void {
    for (const [id, nav] of views) {
      if (!editor.root.contains(nav)) views.delete(id);
    }
    if (!views.size) {
      unsubscribe?.();
      unsubscribe = undefined;
      snapshot = undefined;
      headings = [];
    }
  }

  editor.registerCustomBlock(type, block => {
    sync();
    const nav = document.createElement('nav');
    nav.className = 'nb-toc';
    nav.setAttribute('aria-label', title);
    const caption = document.createElement('strong');
    caption.textContent = title;
    nav.append(caption, document.createElement('div'));
    paint(nav);
    views.set(block.id, nav);
    unsubscribe ??= editor.store.subscribe(() => {
      prune();
      if (views.size) sync();
    });
    // A virtual scroll can replace widgets without producing a store change.
    if (!pendingCleanup) {
      pendingCleanup = true;
      queueMicrotask(() => {
        pendingCleanup = false;
        prune();
      });
    }
    return nav;
  });
  const removeCommand = editor.registerSlashBlock({
    id: type, label: title, keywords: ['toc', 'table of contents', '目次'],
    create: () => createBlock(type),
  });
  function dispose(): void {
    if (registrations.get(editor) !== dispose) return;
    registrations.delete(editor);
    unsubscribe?.();
    removeCommand();
    editor.registerCustomBlock(type, null);
    views.clear();
    snapshot = undefined;
    headings = [];
  }
  registrations.set(editor, dispose);
  return dispose;
}
