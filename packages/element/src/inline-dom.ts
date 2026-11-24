import { isHighlightColor, isTextColor, normalizeRuns } from '@nobita/core';
import type { InlineMark, InlineRun } from '@nobita/core';

const MARK_TOKENS = ['bold', 'italic', 'underline', 'strike', 'code'] as const;

function marksFromElement(element: Element, inherited: InlineMark | undefined): InlineMark | undefined {
  let next: InlineMark | undefined = inherited ? { ...inherited } : undefined;
  const attr = element.getAttribute('data-mark');
  if (attr) {
    const tokens = new Set(attr.split(/\s+/u));
    for (const token of MARK_TOKENS) {
      if (!tokens.has(token)) continue;
      next = { ...(next ?? {}), [token]: true };
    }
  }
  const href = element.getAttribute('data-link');
  if (href) next = { ...(next ?? {}), link: href };
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
        MARK_TOKENS.every(key => Boolean(bufferMarks?.[key]) === Boolean(marks[key])) &&
        bufferMarks.link === marks.link &&
        bufferMarks.highlight === marks.highlight &&
        bufferMarks.color === marks.color);
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
  };

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeName === 'BR' && child === root.lastChild) continue;
    walk(child, undefined);
  }
  flush();
  return normalizeRuns(runs);
}
