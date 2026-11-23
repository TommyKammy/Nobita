import type { BlockProps, BlockType, HeadingLevel, InlineMark } from './types.js';

export interface BlockMarkdownMatch {
  type: BlockType;
  props: BlockProps;
  /** Number of leading characters that form the shortcut. */
  remove: number;
}

/**
 * Recognize a block shortcut at the beginning of a line. Called after the user
 * types a space (or the third backtick of a fence).
 */
export function matchBlockMarkdown(text: string): BlockMarkdownMatch | null {
  const heading = /^(#{1,6})\s$/u.exec(text);
  if (heading?.[1]) {
    return {
      type: 'heading',
      props: { level: heading[1].length as HeadingLevel },
      remove: text.length,
    };
  }
  if (/^[-*+]\s$/u.test(text)) {
    return { type: 'bulleted', props: {}, remove: text.length };
  }
  if (/^1[.)]\s$/u.test(text)) {
    return { type: 'numbered', props: {}, remove: text.length };
  }
  if (/^\[[ xX]?\]\s$/u.test(text)) {
    return {
      type: 'todo',
      props: { checked: /^\[[xX]\]/u.test(text) },
      remove: text.length,
    };
  }
  if (/^>\s$/u.test(text)) {
    return { type: 'quote', props: {}, remove: text.length };
  }
  const fence = /^```([\w+-]*)\s$/u.exec(text);
  if (fence) {
    return {
      type: 'code',
      props: { language: fence[1] || 'text' },
      remove: text.length,
    };
  }
  if (/^(?:---|\*\*\*|___)\s$/u.test(text)) {
    return { type: 'divider', props: {}, remove: text.length };
  }
  return null;
}

export interface InlineMarkdownMatch {
  /** Start of the opening delimiter in the block text. */
  start: number;
  /** End of the closing delimiter (exclusive). */
  end: number;
  /** Replacement plain text. */
  text: string;
  marks: InlineMark;
}

const INLINE_PATTERNS: readonly {
  pattern: RegExp;
  marks: InlineMark;
  textGroup: number;
}[] = [
  { pattern: /\*\*([^*\n]+)\*\*$/u, marks: { bold: true }, textGroup: 1 },
  { pattern: /__([^_\n]+)__$/u, marks: { bold: true }, textGroup: 1 },
  { pattern: /~~([^~\n]+)~~$/u, marks: { strike: true }, textGroup: 1 },
  { pattern: /`([^`\n]+)`$/u, marks: { code: true }, textGroup: 1 },
  { pattern: /(?<![\w*])\*([^*\n]+)\*$/u, marks: { italic: true }, textGroup: 1 },
  { pattern: /(?<![\w_])_([^_\n]+)_$/u, marks: { italic: true }, textGroup: 1 },
  { pattern: /\[([^\]\n]+)\]\(([^)\s]+)\)$/u, marks: { link: '' }, textGroup: 1 },
];

/**
 * Detect an inline shortcut that just closed at the caret, e.g. "**bold**".
 * The caller replaces `[start, end)` with `text` carrying `marks`.
 */
export function matchInlineMarkdown(text: string): InlineMarkdownMatch | null {
  for (const entry of INLINE_PATTERNS) {
    const match = entry.pattern.exec(text);
    if (!match) continue;
    const matched = match[0];
    const value = match[entry.textGroup];
    if (value === undefined) continue;
    const start = text.length - matched.length;
    const marks = { ...entry.marks };
    if (marks.link === ('' as string)) {
      const href = match[2];
      if (!href) continue;
      marks.link = href;
    }
    return { start, end: text.length, text: value, marks };
  }
  return null;
}
