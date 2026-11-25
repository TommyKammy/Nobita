import {
  BOOLEAN_MARK_KEYS,
  isHighlightColor,
  isTextColor,
  normalizeRuns,
  safeHref,
} from '@nobita/core';
import type { InlineMark, InlineRun } from '@nobita/core';

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
  const href = element.getAttribute('data-link') ?? element.getAttribute('href');
  if (href) {
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
        bufferMarks.mention?.kind === marks.mention?.kind);
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
    if (isBlockElement(element) && buffer && !buffer.endsWith('\n')) append('\n', undefined);
    for (const child of Array.from(element.childNodes)) walk(child, nextMarks);
    const mentionId =
      element.getAttribute('data-nb-mention-id') ??
      element.getAttribute('data-mention-id');
    const mentionLabel =
      element.getAttribute('data-nb-mention-label') ??
      element.getAttribute('data-mention-label');
    // Distinct mention elements stay separate even when their metadata matches.
    if (mentionId && mentionLabel) flush();
  };

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeName === 'BR' && child === root.lastChild) continue;
    walk(child, undefined);
  }
  flush();
  return normalizeRuns(runs);
}

/** Render runs into a contenteditable host using the editor's inline markup. */
export function renderInlineRuns(
  root: HTMLElement,
  runs: readonly InlineRun[]
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
      if (marks.link) {
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
        span.contentEditable = 'false';
      }
      if (classes.length > 0) span.className = classes.join(' ');
      if (tokens.length > 0) span.dataset.mark = tokens.join(' ');
    }
    fragment.append(span);
  }
  root.replaceChildren(fragment);
}
