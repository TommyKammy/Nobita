import {
  BOOLEAN_MARK_KEYS,
  isHighlightColor,
  isTextColor,
  normalizeRuns,
  safeHref,
} from '@nobita/core';
import type { InlineMark, InlineRun, PageInfo } from '@nobita/core';
import { childIndex } from './dom.js';

function marksFromElement(element: Element, inherited: InlineMark | undefined): InlineMark | undefined {
  let next: InlineMark | undefined = inherited ? { ...inherited } : undefined;
  const attr = element.getAttribute('data-mark');
  if (attr) {
    const tokens = new Set(attr.split(/\s+/u));
    for (const token of BOOLEAN_MARK_KEYS) {
      if (!tokens.has(token)) continue;
      next = { ...(next ?? {}), [token]: true };
    }
  }
  const tag = element.tagName;
  if (tag === 'STRONG' || tag === 'B') next = { ...(next ?? {}), bold: true };
  if (tag === 'EM' || tag === 'I') next = { ...(next ?? {}), italic: true };
  if (tag === 'U') next = { ...(next ?? {}), underline: true };
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') {
    next = { ...(next ?? {}), strike: true };
  }
  if (tag === 'CODE') next = { ...(next ?? {}), code: true };
  const pageId =
    element.getAttribute('data-nb-page-id') ??
    element.getAttribute('data-page-id');
  if (pageId) {
    const pageTitle =
      element.getAttribute('data-nb-page-title') ??
      element.getAttribute('data-page-title') ??
      element.textContent?.trim() ??
      'Untitled page';
    const pageIcon =
      element.getAttribute('data-nb-page-icon') ??
      element.getAttribute('data-page-icon');
    next = {
      ...(next ?? {}),
      page: {
        id: pageId,
        title: pageTitle || 'Untitled page',
        ...(pageIcon ? { icon: pageIcon } : {}),
      },
    };
  }
  const href = element.getAttribute('data-link') ?? element.getAttribute('href');
  if (href && !pageId) {
    const safe = safeHref(href);
    if (safe) next = { ...(next ?? {}), link: safe };
  }
  const mentionId =
    element.getAttribute('data-nb-mention-id') ??
    element.getAttribute('data-mention-id');
  const mentionLabel =
    element.getAttribute('data-nb-mention-label') ??
    element.getAttribute('data-mention-label');
  const mentionKind =
    element.getAttribute('data-nb-mention-kind') ??
    element.getAttribute('data-mention-kind');
  if (mentionId && mentionLabel) {
    next = {
      ...(next ?? {}),
      mention: {
        id: mentionId,
        label: mentionLabel,
        ...(mentionKind ? { kind: mentionKind } : {}),
      },
    };
  }
  const highlight =
    element.getAttribute('data-highlight') ??
    element.getAttribute('data-nb-highlight');
  if (isHighlightColor(highlight)) {
    next = { ...(next ?? {}), highlight };
  }
  const color =
    element.getAttribute('data-text-color') ??
    element.getAttribute('data-nb-color');
  if (isTextColor(color)) {
    next = { ...(next ?? {}), color };
  }
  return next;
}

const isBlockElement = (node: Node): boolean => {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = (node as Element).tagName;
  return tag === 'DIV' || tag === 'P' || tag === 'LI';
};

const stripZeroWidth = (text: string): string => text.replace(/\u200B|\uFEFF/gu, '');

function rawOffsetForCleanOffset(raw: string, cleanOffset: number): number {
  if (cleanOffset <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (ch === '\u200B' || ch === '\uFEFF') continue;
    seen += 1;
    if (seen === cleanOffset) return i + 1;
  }
  return raw.length;
}

/**
 * Convert a DOM point inside `root` to an offset in the plain text produced by
 * `readRunsFromDom(root)`, accounting for block-generated newlines and stripped zero-width chars.
 */
export function domPointToRunsOffset(
  root: HTMLElement,
  node: Node,
  offset: number
): number {
  let total = 0;
  let endsWithNewline = false;
  let result = 0;
  let found = false;

  const addText = (text: string): void => {
    const clean = stripZeroWidth(text);
    if (!clean) return;
    total += clean.length;
    endsWithNewline = clean.endsWith('\n');
  };

  const addNewline = (): void => {
    total += 1;
    endsWithNewline = true;
  };

  const visit = (current: Node): void => {
    if (found) return;
    if (current.nodeType === Node.TEXT_NODE) {
      const data = (current as Text).data;
      if (current === node) {
        const clamped = Math.max(0, Math.min(offset, data.length));
        result = total + stripZeroWidth(data.slice(0, clamped)).length;
        found = true;
        return;
      }
      addText(data);
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    const element = current as Element;
    const atomicLenAttr =
      current !== root ? element.getAttribute('data-atomic-length') : null;
    if (atomicLenAttr !== null) {
      const len = Number(atomicLenAttr) || 0;
      if (current === node || current.contains(node)) {
        result = total + (offset > 0 ? len : 0);
        found = true;
        return;
      }
      total += len;
      if (len > 0) endsWithNewline = false;
      return;
    }
    if (element.tagName === 'BR') {
      if (current === node) {
        result = total;
        found = true;
        return;
      }
      addNewline();
      return;
    }
    if (current !== root && isBlockElement(element) && total > 0 && !endsWithNewline) {
      addNewline();
    }
    const isTarget = current === node;
    let index = 0;
    for (
      let child = element.firstChild;
      child && (!isTarget || index < offset);
      child = child.nextSibling, index += 1
    ) {
      if (current === root && child.nodeName === 'BR' && child === root.lastChild) {
        continue;
      }
      visit(child);
      if (found) return;
    }
    if (isTarget) {
      result = total;
      found = true;
    }
  };

  visit(root);
  return found ? result : total;
}

/**
 * Convert an offset in `readRunsFromDom(root)` plain text back to a DOM point inside `root`.
 */
export function runsOffsetToDomPoint(
  root: HTMLElement,
  offset: number
): { node: Node; offset: number } {
  const target = Math.max(0, offset);
  let total = 0;
  let endsWithNewline = false;
  let lastText: Text | null = null;

  const visit = (node: Node): { node: Node; offset: number } | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const clean = stripZeroWidth(textNode.data);
      const end = total + clean.length;
      if (target <= end) {
        const localClean = Math.max(0, target - total);
        return {
          node: textNode,
          offset: rawOffsetForCleanOffset(textNode.data, localClean),
        };
      }
      total = end;
      if (clean.length > 0) endsWithNewline = clean.endsWith('\n');
      lastText = textNode;
      return null;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const element = node as Element;
    if (element.tagName === 'BR') {
      const parent = element.parentNode ?? root;
      const index = childIndex(element as ChildNode);
      if (target <= total) return { node: parent, offset: Math.max(0, index) };
      if (target <= total + 1) return { node: parent, offset: Math.max(0, index + 1) };
      total += 1;
      endsWithNewline = true;
      lastText = null;
      return null;
    }
    if (
      element !== root &&
      element.getAttribute('contenteditable') === 'false'
    ) {
      const atomicLenAttr = element.getAttribute('data-atomic-length');
      const length =
        atomicLenAttr !== null
          ? Number(atomicLenAttr) || 0
          : domPointToRunsOffset(
              element as HTMLElement,
              element,
              element.childNodes.length
            );
      const end = total + length;
      const parent = element.parentNode ?? root;
      const index = childIndex(element as ChildNode);
      if (target <= total) return { node: parent, offset: Math.max(0, index) };
      if (target <= end) return { node: parent, offset: Math.max(0, index + 1) };
      total = end;
      if (length > 0) endsWithNewline = false;
      lastText = null;
      return null;
    }
    if (element !== root && isBlockElement(element) && total > 0 && !endsWithNewline) {
      if (target <= total) {
        if (lastText) return { node: lastText, offset: lastText.data.length };
        const parent = element.parentNode ?? root;
        const index = childIndex(element as ChildNode);
        return { node: parent, offset: Math.max(0, index) };
      }
      total += 1;
      endsWithNewline = true;
      lastText = null;
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (element === root && child.nodeName === 'BR' && child === root.lastChild) {
        continue;
      }
      const point = visit(child);
      if (point) return point;
    }
    if (
      element !== root &&
      isBlockElement(element) &&
      target <= total &&
      element.childNodes.length === 0
    ) {
      return { node: element, offset: 0 };
    }
    return null;
  };

  const point = visit(root);
  if (point) return point;
  const last = lastText as Text | null;
  if (last) return { node: last, offset: last.data.length };
  if (root.lastChild?.nodeName === 'BR' && target <= total) {
    return { node: root, offset: Math.max(0, root.childNodes.length - 1) };
  }
  return { node: root, offset: root.childNodes.length };
}

/**
 * Reconstruct runs from whatever the browser produced. Used for composition,
 * autocorrect, spellcheck replacements and other inputs we deliberately do not
 * intercept.
 */
export function readRunsFromDom(root: HTMLElement): InlineRun[] {
  const runs: InlineRun[] = [];
  let buffer = '';
  let bufferMarks: InlineMark | undefined;

  const flush = (): void => {
    if (!buffer) return;
    const clean = buffer.replace(/\u200B|\uFEFF/gu, '');
    if (clean) {
      runs.push(bufferMarks ? { text: clean, marks: bufferMarks } : { text: clean });
    }
    buffer = '';
  };

  const append = (text: string, marks: InlineMark | undefined): void => {
    if (!text) return;
    const same =
      (bufferMarks === undefined && marks === undefined) ||
      (bufferMarks !== undefined &&
        marks !== undefined &&
        BOOLEAN_MARK_KEYS.every(key => Boolean(bufferMarks?.[key]) === Boolean(marks[key])) &&
        bufferMarks.link === marks.link &&
        bufferMarks.highlight === marks.highlight &&
        bufferMarks.color === marks.color &&
        bufferMarks.mention?.id === marks.mention?.id &&
        bufferMarks.mention?.label === marks.mention?.label &&
        bufferMarks.mention?.kind === marks.mention?.kind &&
        bufferMarks.page?.id === marks.page?.id &&
        bufferMarks.page?.title === marks.page?.title &&
        bufferMarks.page?.icon === marks.page?.icon);
    if (!same) {
      flush();
      bufferMarks = marks;
    }
    buffer += text;
  };

  const walk = (node: Node, marks: InlineMark | undefined): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      append((node as Text).data, marks);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.tagName === 'BR') {
      append('\n', marks);
      return;
    }
    const nextMarks = marksFromElement(element, marks);
    const cleanBuffer = stripZeroWidth(buffer);
    const lastChar = cleanBuffer
      ? cleanBuffer[cleanBuffer.length - 1]
      : runs[runs.length - 1]?.text.slice(-1);
    if (isBlockElement(element) && lastChar && lastChar !== '\n') {
      append('\n', undefined);
    }
    const modelText = element.getAttribute('data-model-text');
    if (modelText !== null && nextMarks?.page) {
      append(modelText, nextMarks);
      flush();
      return;
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      walk(child, nextMarks);
    }
    const mentionId =
      element.getAttribute('data-nb-mention-id') ??
      element.getAttribute('data-mention-id');
    const mentionLabel =
      element.getAttribute('data-nb-mention-label') ??
      element.getAttribute('data-mention-label');
    const pageId =
      element.getAttribute('data-nb-page-id') ??
      element.getAttribute('data-page-id');
    // Distinct atomic reference elements stay separate even when metadata matches.
    if ((mentionId && mentionLabel) || pageId) flush();
  };

  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child.nodeName === 'BR' && child === root.lastChild) continue;
    walk(child, undefined);
  }
  flush();
  return normalizeRuns(runs);
}

/** Render runs into a contenteditable host using the editor's inline markup. */
export function renderInlineRuns(
  root: HTMLElement,
  runs: readonly InlineRun[],
  resolvePage?: (pageId: string) => PageInfo | null
): void {
  const fragment = document.createDocumentFragment();
  for (const run of runs) {
    const span = document.createElement('span');
    span.textContent = run.text;
    const marks = run.marks;
    if (marks) {
      const classes: string[] = [];
      const tokens: string[] = [];
      if (marks.bold) {
        classes.push('nb-m-bold');
        tokens.push('bold');
      }
      if (marks.italic) {
        classes.push('nb-m-italic');
        tokens.push('italic');
      }
      if (marks.underline) {
        classes.push('nb-m-underline');
        tokens.push('underline');
      }
      if (marks.strike) {
        classes.push('nb-m-strike');
        tokens.push('strike');
      }
      if (marks.code) {
        classes.push('nb-m-code');
        tokens.push('code');
      }
      if (marks.link && !marks.page) {
        const safe = safeHref(marks.link);
        if (safe) {
          classes.push('nb-m-link');
          span.dataset.link = safe;
          span.title = safe;
        }
      }
      if (marks.highlight) span.dataset.highlight = marks.highlight;
      if (marks.color) span.dataset.textColor = marks.color;
      if (marks.mention) {
        classes.push('nb-m-mention');
        span.dataset.mentionId = marks.mention.id;
        span.dataset.mentionLabel = marks.mention.label;
        if (marks.mention.kind) span.dataset.mentionKind = marks.mention.kind;
        span.dataset.atomicLength = String(run.text.length);
        span.contentEditable = 'false';
      }
      if (marks.page) {
        const info = resolvePage?.(marks.page.id) ?? null;
        const displayTitle =
          (info?.title ?? marks.page.title ?? run.text).trim() || 'Untitled page';
        const displayIcon = (info?.icon ?? marks.page.icon ?? '').trim();
        classes.push('nb-m-page');
        span.dataset.pageId = marks.page.id;
        span.dataset.pageTitle = displayTitle;
        span.dataset.pageFallbackTitle = marks.page.title;
        if (marks.page.icon) span.dataset.pageFallbackIcon = marks.page.icon;
        if (displayIcon) span.dataset.pageIcon = displayIcon;
        span.dataset.atomicLength = String(run.text.length);
        span.dataset.modelText = run.text;
        span.textContent = displayTitle;
        span.title = displayTitle;
        span.setAttribute('role', 'link');
        span.setAttribute('aria-label', `Open page: ${displayTitle}`);
        span.contentEditable = 'false';
      }
      if (classes.length > 0) span.className = classes.join(' ');
      if (tokens.length > 0) span.dataset.mark = tokens.join(' ');
    }
    fragment.append(span);
  }
  root.replaceChildren(fragment);
}

/** Re-sync live title/icon metadata on all rendered `.nb-m-page` chips inside `container`. */
export function refreshInlinePageChips(
  container: ParentNode,
  resolvePage?: (pageId: string) => PageInfo | null
): void {
  for (const chip of container.querySelectorAll<HTMLElement>('.nb-m-page')) {
    const pageId = chip.dataset.pageId;
    if (!pageId) continue;
    const info = resolvePage?.(pageId) ?? null;
    const displayTitle =
      (info?.title ?? chip.dataset.pageFallbackTitle ?? chip.dataset.modelText ?? '').trim() ||
      'Untitled page';
    const displayIcon = (info?.icon ?? chip.dataset.pageFallbackIcon ?? '').trim();
    chip.textContent = displayTitle;
    chip.dataset.pageTitle = displayTitle;
    if (displayIcon) chip.dataset.pageIcon = displayIcon;
    else delete chip.dataset.pageIcon;
    chip.title = displayTitle;
    chip.setAttribute('aria-label', `Open page: ${displayTitle}`);
  }
}
