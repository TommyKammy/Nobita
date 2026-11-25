import { HIGHLIGHT_HEX, TEXT_COLOR_HEX } from './palette.js';
import { BOOLEAN_MARK_KEYS, isHighlightColor, isTextColor } from './types.js';
import type {
  BooleanMarkKey,
  HighlightColor,
  InlineMark,
  InlineRun,
  MarkKey,
  TextColor,
} from './types.js';
import { safeHref } from './url.js';

export const MARK_KEYS: readonly MarkKey[] = [
  ...BOOLEAN_MARK_KEYS,
  'color',
  'highlight',
  'link',
  'mention',
];

/** Drop falsy marks and unknown keys, returning `undefined` for "plain". */
export function normalizeMark(mark: InlineMark | undefined): InlineMark | undefined {
  if (!mark) return undefined;
  const out: InlineMark = {};
  if (mark.bold === true) out.bold = true;
  if (mark.italic === true) out.italic = true;
  if (mark.underline === true) out.underline = true;
  if (mark.strike === true) out.strike = true;
  if (mark.code === true) out.code = true;
  if (isTextColor(mark.color)) out.color = mark.color;
  if (isHighlightColor(mark.highlight)) out.highlight = mark.highlight;
  if (typeof mark.link === 'string' && mark.link.length > 0) out.link = mark.link;
  if (
    mark.mention &&
    typeof mark.mention.id === 'string' &&
    mark.mention.id.length > 0 &&
    typeof mark.mention.label === 'string' &&
    mark.mention.label.length > 0
  ) {
    out.mention = {
      id: mark.mention.id.slice(0, 200),
      label: mark.mention.label.slice(0, 120),
      ...(typeof mark.mention.kind === 'string' && mark.mention.kind
        ? { kind: mark.mention.kind.slice(0, 60) }
        : {}),
    };
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

export function markKey(mark: InlineMark | undefined): string {
  const normalized = normalizeMark(mark);
  if (!normalized) return '';
  return MARK_KEYS.filter(key => normalized[key] !== undefined)
    .map(key => `${key}:${JSON.stringify(normalized[key])}`)
    .join('|');
}

export function marksEqual(a: InlineMark | undefined, b: InlineMark | undefined): boolean {
  return markKey(a) === markKey(b);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validate and normalize runs from plain JSON. */
export function parseInlineRuns(value: unknown): InlineRun[] {
  if (!Array.isArray(value)) return [];
  const runs: InlineRun[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const text =
      typeof item.text === 'string'
        ? item.text.replace(/\r\n?/gu, '\n')
        : '';
    if (!text) continue;
    const marks = normalizeMark(item.marks as InlineMark);
    runs.push(marks ? { text, marks } : { text });
  }
  return normalizeRuns(runs);
}

/** Deep-clone runs, including nested mention metadata. */
export function cloneRuns(runs: readonly InlineRun[]): InlineRun[] {
  return runs.map(run => ({
    ...run,
    ...(run.marks
      ? {
          marks: {
            ...run.marks,
            ...(run.marks.mention ? { mention: { ...run.marks.mention } } : {}),
          },
        }
      : {}),
  }));
}

/** Merge adjacent runs with equal marks and drop empty runs. */
export function normalizeRuns(runs: readonly InlineRun[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const marks = normalizeMark(run.marks);
    const previous = out[out.length - 1];
    // Adjacent references stay separate so each remains one atomic mention.
    if (previous && marksEqual(previous.marks, marks) && !marks?.mention) {
      previous.text += run.text;
    } else {
      out.push(marks ? { text: run.text, marks } : { text: run.text });
    }
  }
  return out;
}

export function runsFromText(text: string, marks?: InlineMark): InlineRun[] {
  if (text.length === 0) return [];
  const normalized = normalizeMark(marks);
  return [normalized ? { text, marks: normalized } : { text }];
}

export function plainText(runs: readonly InlineRun[]): string {
  let text = '';
  for (const run of runs) text += run.text;
  return text;
}

export function runsLength(runs: readonly InlineRun[]): number {
  let length = 0;
  for (const run of runs) length += run.text.length;
  return length;
}

export function sliceRuns(runs: readonly InlineRun[], start: number, end: number): InlineRun[] {
  const from = Math.max(0, start);
  const to = Math.max(from, end);
  const out: InlineRun[] = [];
  let cursor = 0;
  for (const run of runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    if (runEnd <= from) continue;
    if (runStart >= to) break;
    const localStart = Math.max(0, from - runStart);
    const localEnd = Math.min(run.text.length, to - runStart);
    if (localEnd <= localStart) continue;
    out.push({ text: run.text.slice(localStart, localEnd), ...(run.marks ? { marks: run.marks } : {}) });
  }
  return normalizeRuns(out);
}

/** Marks that apply to the character immediately before `offset`. */
export function marksAt(runs: readonly InlineRun[], offset: number): InlineMark | undefined {
  if (runs.length === 0) return undefined;
  let cursor = 0;
  const target = Math.max(0, offset - 1);
  for (const run of runs) {
    const runEnd = cursor + run.text.length;
    if (target >= cursor && target < runEnd) return normalizeMark(run.marks);
    cursor = runEnd;
  }
  return normalizeMark(runs[runs.length - 1]?.marks);
}

/**
 * Range of the mention run that contains the character at `offset`.
 * Used to keep mention references atomic when deleting.
 */
export function mentionRangeAt(
  runs: readonly InlineRun[],
  offset: number
): { start: number; end: number } | null {
  let cursor = 0;
  for (const run of runs) {
    const end = cursor + run.text.length;
    if (run.marks?.mention && offset >= cursor && offset < end) {
      return { start: cursor, end };
    }
    cursor = end;
  }
  return null;
}

/**
 * Insert text at an offset. `marks` omitted inherits the mark before the caret;
 * pass `{}` for plain text.
 */
export function insertTextAt(
  runs: readonly InlineRun[],
  offset: number,
  text: string,
  marks?: InlineMark
): InlineRun[] {
  if (text.length === 0) return normalizeRuns(runs as InlineRun[]);
  const at = Math.max(0, Math.min(offset, runsLength(runs)));
  const inherited = marks === undefined ? marksAt(runs, at) : undefined;
  // Mentions are atomic: typing next to one must not extend it.
  let insertMarks = marks === undefined ? inherited : normalizeMark(marks);
  if (marks === undefined && insertMarks?.mention) {
    const { mention: _mention, ...rest } = insertMarks;
    insertMarks = normalizeMark(rest);
  }
  return normalizeRuns([
    ...sliceRuns(runs, 0, at),
    ...runsFromText(text, insertMarks),
    ...sliceRuns(runs, at, runsLength(runs)),
  ]);
}

export function deleteTextRange(
  runs: readonly InlineRun[],
  start: number,
  end: number
): InlineRun[] {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(start, end);
  const length = runsLength(runs);
  if (from === to) return normalizeRuns(runs as InlineRun[]);
  return normalizeRuns([
    ...sliceRuns(runs, 0, Math.min(from, length)),
    ...sliceRuns(runs, Math.min(to, length), length),
  ]);
}

export interface MarkPatch {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  color?: TextColor | null;
  highlight?: HighlightColor | null;
  link?: string | null;
}

function patchedMark(mark: InlineMark | undefined, patch: MarkPatch): InlineMark | undefined {
  const next: InlineMark = { ...(normalizeMark(mark) ?? {}) };
  if (patch.bold !== undefined) {
    if (patch.bold) next.bold = true;
    else delete next.bold;
  }
  if (patch.italic !== undefined) {
    if (patch.italic) next.italic = true;
    else delete next.italic;
  }
  if (patch.underline !== undefined) {
    if (patch.underline) next.underline = true;
    else delete next.underline;
  }
  if (patch.strike !== undefined) {
    if (patch.strike) next.strike = true;
    else delete next.strike;
  }
  if (patch.code !== undefined) {
    if (patch.code) next.code = true;
    else delete next.code;
  }
  if (patch.color !== undefined) {
    if (patch.color) next.color = patch.color;
    else delete next.color;
  }
  if (patch.highlight !== undefined) {
    if (patch.highlight) next.highlight = patch.highlight;
    else delete next.highlight;
  }
  if (patch.link !== undefined) {
    if (patch.link) next.link = patch.link;
    else delete next.link;
  }
  return normalizeMark(next);
}

export function applyMarkPatch(
  runs: readonly InlineRun[],
  start: number,
  end: number,
  patch: MarkPatch
): InlineRun[] {
  const length = runsLength(runs);
  const from = Math.max(0, Math.min(start, length));
  const to = Math.max(from, Math.min(end, length));
  if (from === to) return normalizeRuns(runs as InlineRun[]);
  const middle = sliceRuns(runs, from, to).map(run => {
    const marks = patchedMark(run.marks, patch);
    return { text: run.text, ...(marks ? { marks } : {}) };
  });
  return normalizeRuns([
    ...sliceRuns(runs, 0, from),
    ...middle,
    ...sliceRuns(runs, to, length),
  ]);
}

/** Intersection of marks over a range; a key is set only when it covers everything. */
export function markStateInRange(
  runs: readonly InlineRun[],
  start: number,
  end: number
): InlineMark {
  const length = runsLength(runs);
  const from = Math.max(0, Math.min(start, length));
  const to = Math.max(from, Math.min(end, length));
  if (from === to) {
    const at = marksAt(runs, from) ?? {};
    return { ...at };
  }
  const state: InlineMark = {};
  let initialized = false;
  let cursor = 0;
  for (const run of runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    if (runEnd <= from || runStart >= to) continue;
    const marks = normalizeMark(run.marks) ?? {};
    if (!initialized) {
      Object.assign(state, marks);
      initialized = true;
      continue;
    }
    for (const key of MARK_KEYS) {
      if (key === 'link') {
        if (state.link !== marks.link) delete state.link;
      } else if (key === 'highlight') {
        if (state.highlight !== marks.highlight) delete state.highlight;
      } else if (key === 'color') {
        if (state.color !== marks.color) delete state.color;
      } else if (key === 'mention') {
        if (
          state.mention?.id !== marks.mention?.id ||
          state.mention?.label !== marks.mention?.label ||
          state.mention?.kind !== marks.mention?.kind
        ) {
          delete state.mention;
        }
      } else if (marks[key] !== true) {
        delete state[key];
      }
    }
  }
  return state;
}

export function toggleMarkInRange(
  runs: readonly InlineRun[],
  start: number,
  end: number,
  key: BooleanMarkKey
): InlineRun[] {
  const state = markStateInRange(runs, start, end);
  return applyMarkPatch(runs, start, end, { [key]: state[key] !== true });
}

export function setHighlightInRange(
  runs: readonly InlineRun[],
  start: number,
  end: number,
  highlight: HighlightColor | null
): InlineRun[] {
  return applyMarkPatch(runs, start, end, { highlight });
}

export function setTextColorInRange(
  runs: readonly InlineRun[],
  start: number,
  end: number,
  color: TextColor | null
): InlineRun[] {
  return applyMarkPatch(runs, start, end, { color });
}

export function setLinkInRange(
  runs: readonly InlineRun[],
  start: number,
  end: number,
  link: string | null
): InlineRun[] {
  return applyMarkPatch(runs, start, end, { link });
}

export function runsToHtml(runs: readonly InlineRun[], escape: (text: string) => string): string {
  let html = '';
  for (const run of runs) {
    let inner = escape(run.text).replace(/\n/g, '<br>');
    const marks = normalizeMark(run.marks);
    if (!marks) {
      html += inner;
      continue;
    }
    if (marks.code) inner = `<code>${inner}</code>`;
    if (marks.bold) inner = `<strong>${inner}</strong>`;
    if (marks.italic) inner = `<em>${inner}</em>`;
    if (marks.underline) inner = `<u>${inner}</u>`;
    if (marks.strike) inner = `<s>${inner}</s>`;
    if (marks.color) {
      inner = `<span data-nb-color="${marks.color}" style="color:var(--nb-fg-${marks.color}, ${TEXT_COLOR_HEX[marks.color]})">${inner}</span>`;
    }
    if (marks.highlight) {
      inner = `<mark data-nb-highlight="${marks.highlight}" style="background-color:var(--nb-hl-${marks.highlight}, ${HIGHLIGHT_HEX[marks.highlight]})">${inner}</mark>`;
    }
    if (marks.link) {
      const href = safeHref(marks.link);
      if (href) {
        const escaped = escape(href).replace(/"/g, '&quot;');
        inner = `<a href="${escaped}" rel="noopener noreferrer nofollow">${inner}</a>`;
      }
    }
    if (marks.mention) {
      const id = escape(marks.mention.id).replace(/"/g, '&quot;');
      const label = escape(marks.mention.label).replace(/"/g, '&quot;');
      const kind = marks.mention.kind
        ? ` data-nb-mention-kind="${escape(marks.mention.kind).replace(/"/g, '&quot;')}"`
        : '';
      inner = `<span data-nb-mention-id="${id}" data-nb-mention-label="${label}"${kind} class="nb-m-mention" contenteditable="false">${inner}</span>`;
    }
    html += inner;
  }
  return html;
}
