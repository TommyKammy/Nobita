import { isHighlightColor, isTextColor } from './types.js';
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
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'color',
  'highlight',
  'link',
];

const KEY_ORDER: readonly MarkKey[] = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'color',
  'highlight',
  'link',
];

const HIGHLIGHT_HTML: Record<HighlightColor, string> = {
  red: '#fee2e2',
  orange: '#ffedd5',
  yellow: '#fef3c7',
  green: '#dcfce7',
  teal: '#ccfbf1',
  blue: '#dbeafe',
  purple: '#ede9fe',
  grey: '#eeeeec',
};

const TEXT_COLOR_HTML: Record<TextColor, string> = {
  red: '#b91c1c',
  orange: '#c2410c',
  yellow: '#a16207',
  green: '#15803d',
  teal: '#0f766e',
  blue: '#1d4ed8',
  purple: '#7e22ce',
  grey: '#6b7280',
};

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
  return Object.keys(out).length === 0 ? undefined : out;
}

export function markKey(mark: InlineMark | undefined): string {
  const normalized = normalizeMark(mark);
  if (!normalized) return '';
  return KEY_ORDER.filter(key => normalized[key] !== undefined)
    .map(key => `${key}:${String(normalized[key])}`)
    .join('|');
}

export function marksEqual(a: InlineMark | undefined, b: InlineMark | undefined): boolean {
  return markKey(a) === markKey(b);
}

export function mergeMarks(a: InlineMark | undefined, b: InlineMark | undefined): InlineMark | undefined {
  return normalizeMark({ ...a, ...b });
}

/** Merge adjacent runs with equal marks and drop empty runs. */
export function normalizeRuns(runs: readonly InlineRun[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const marks = normalizeMark(run.marks);
    const previous = out[out.length - 1];
    if (previous && marksEqual(previous.marks, marks)) {
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
  const insertMarks = marks === undefined ? marksAt(runs, at) : normalizeMark(marks);
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
      inner = `<span data-nb-color="${marks.color}" style="color:var(--nb-fg-${marks.color}, ${TEXT_COLOR_HTML[marks.color]})">${inner}</span>`;
    }
    if (marks.highlight) {
      inner = `<mark data-nb-highlight="${marks.highlight}" style="background-color:var(--nb-hl-${marks.highlight}, ${HIGHLIGHT_HTML[marks.highlight]})">${inner}</mark>`;
    }
    if (marks.link) {
      const href = safeHref(marks.link);
      if (href) {
        const escaped = escape(href).replace(/"/g, '&quot;');
        inner = `<a href="${escaped}" rel="noopener noreferrer nofollow">${inner}</a>`;
      }
    }
    html += inner;
  }
  return html;
}
