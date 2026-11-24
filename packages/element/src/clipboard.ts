import {
  blocksToHtml,
  blocksToMarkdown,
  blocksToPlainText,
  createBlock,
  createDatabaseColumn,
  createDatabaseRow,
  isHighlightColor,
  isTextColor,
  markdownToBlocks,
  normalizeRuns,
  parseDoc,
  TEXT_COLOR_RGB_REFERENCES,
} from '@nobita/core';
import type {
  Block,
  DatabaseData,
  HighlightColor,
  InlineMark,
  InlineRun,
  TextColor,
} from '@nobita/core';

const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DIV',
  'DL',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'UL',
]);

const isElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;

function tag(element: Element): string {
  return element.tagName.toUpperCase();
}

const TEXT_COLOR_BY_NAME: Record<string, TextColor> = {
  red: 'red',
  orange: 'orange',
  yellow: 'yellow',
  green: 'green',
  teal: 'teal',
  blue: 'blue',
  purple: 'purple',
  grey: 'grey',
  gray: 'grey',
};

function parseCssColor(value: string): [number, number, number] | null {
  const input = value.trim().toLowerCase();
  if (input.startsWith('#')) {
    const hex = input.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex.charAt(0).repeat(2), 16);
      const g = parseInt(hex.charAt(1).repeat(2), 16);
      const b = parseInt(hex.charAt(2).repeat(2), 16);
      return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
        ? [r, g, b]
        : null;
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
        ? [r, g, b]
        : null;
    }
    return null;
  }
  const match =
    /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+))?\s*\)$/u.exec(
      input
    );
  if (!match) return null;
  if (match[4] !== undefined && Number(match[4]) < 1) return null;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  return [r, g, b].every(Number.isFinite) ? [r, g, b] : null;
}

function nearestTextColor(
  rgb: [number, number, number]
): TextColor | undefined {
  let best: { color: TextColor; distance: number } | undefined;
  for (const reference of TEXT_COLOR_RGB_REFERENCES) {
    const distance = Math.hypot(
      rgb[0] - reference.rgb[0],
      rgb[1] - reference.rgb[1],
      rgb[2] - reference.rgb[2]
    );
    if (!best || distance < best.distance) {
      best = { color: reference.color, distance };
    }
  }
  return best && best.distance <= 100 ? best.color : undefined;
}

function cssColorToTextColor(value: string): TextColor | undefined {
  const input = value.trim().toLowerCase();
  const named = TEXT_COLOR_BY_NAME[input];
  if (named) return named;
  const affine =
    /--affine-text-highlight-foreground-(red|orange|yellow|green|teal|blue|purple|grey)/u.exec(
      input
    );
  if (affine?.[1] && isTextColor(affine[1])) return affine[1];
  const own =
    /--nb-fg-(red|orange|yellow|green|teal|blue|purple|grey)/u.exec(input);
  if (own?.[1] && isTextColor(own[1])) return own[1];
  const rgb = parseCssColor(input);
  return rgb ? nearestTextColor(rgb) : undefined;
}

function styleColor(element: Element): string | undefined {
  const style = element.getAttribute('style');
  if (!style) return undefined;
  const match = /(?:^|;)\s*color\s*:\s*([^;]+)/iu.exec(style);
  return match?.[1]?.trim();
}

function textColorForElement(element: Element): TextColor | undefined {
  const explicit =
    element.getAttribute('data-nb-color') ??
    element.getAttribute('data-text-color');
  if (isTextColor(explicit)) return explicit;
  if (tag(element) !== 'MARK') {
    const data = element.getAttribute('data-color');
    if (isTextColor(data)) return data;
  }
  const style = styleColor(element);
  return style ? cssColorToTextColor(style) : undefined;
}

function highlightForElement(element: Element): HighlightColor | undefined {
  const explicit =
    element.getAttribute('data-nb-highlight') ??
    element.getAttribute('data-highlight');
  if (isHighlightColor(explicit)) return explicit;
  if (tag(element) === 'MARK') {
    const style = element.getAttribute('style') ?? '';
    if (/background-color\s*:\s*transparent/iu.test(style)) return undefined;
    const color = element.getAttribute('data-color');
    return isHighlightColor(color) ? color : 'yellow';
  }
  return undefined;
}

function marksForElement(element: Element, inherited: InlineMark | undefined): InlineMark | undefined {
  const next: InlineMark = { ...(inherited ?? {}) };
  const color = textColorForElement(element);
  if (color) next.color = color;
  const highlight = highlightForElement(element);
  if (highlight) next.highlight = highlight;
  const mentionId =
    element.getAttribute('data-nb-mention-id') ??
    element.getAttribute('data-mention-id');
  const mentionLabel =
    element.getAttribute('data-nb-mention-label') ??
    element.getAttribute('data-mention-label');
  if (mentionId && mentionLabel) {
    const kind =
      element.getAttribute('data-nb-mention-kind') ??
      element.getAttribute('data-mention-kind');
    next.mention = {
      id: mentionId,
      label: mentionLabel,
      ...(kind ? { kind } : {}),
    };
  }
  switch (tag(element)) {
    case 'STRONG':
    case 'B':
      next.bold = true;
      break;
    case 'EM':
    case 'I':
      next.italic = true;
      break;
    case 'U':
      next.underline = true;
      break;
    case 'S':
    case 'STRIKE':
    case 'DEL':
      next.strike = true;
      break;
    case 'CODE':
      next.code = true;
      break;
    case 'A': {
      const href = element.getAttribute('href');
      if (href && /^(https?:|mailto:|#|\/)/iu.test(href)) next.link = href;
      break;
    }
    default:
      break;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function pushRun(runs: InlineRun[], text: string, marks: InlineMark | undefined): void {
  if (!text) return;
  runs.push(marks ? { text, marks: { ...marks } } : { text });
}

function inlineRuns(root: Node, inherited: InlineMark | undefined = undefined, skipLists = true): InlineRun[] {
  const runs: InlineRun[] = [];
  const visit = (node: Node, marks: InlineMark | undefined): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node as Text).data.replace(/\u200B|\uFEFF/gu, '');
      pushRun(runs, value, marks);
      return;
    }
    if (!isElement(node)) return;
    const name = tag(node);
    if (skipLists && (name === 'UL' || name === 'OL')) return;
    if (name === 'BR') {
      pushRun(runs, '\n', marks);
      return;
    }
    if (name === 'INPUT' || name === 'BUTTON' || name === 'SCRIPT' || name === 'STYLE') return;
    if (name === 'IMG') return;
    const next = marksForElement(node, marks);
    for (const child of Array.from(node.childNodes)) visit(child, next);
  };
  for (const child of Array.from(root.childNodes)) visit(child, inherited);
  return cleanRuns(runs);
}

function cleanRuns(runs: InlineRun[]): InlineRun[] {
  const collapsed = runs.map(run => ({
    text: run.text.replace(/[^\S\n]+/gu, ' '),
    ...(run.marks ? { marks: run.marks } : {}),
  }));
  const normalized = normalizeRuns(collapsed);
  if (normalized.length === 0) return [];
  const first = normalized[0];
  if (first) {
    first.text = first.text.replace(/^ +/u, '');
    if (!first.text) normalized.shift();
  }
  const last = normalized[normalized.length - 1];
  if (last) {
    last.text = last.text.replace(/ +$/u, '');
    if (!last.text) normalized.pop();
  }
  return normalizeRuns(normalized);
}

function childElements(element: Element): Element[] {
  return Array.from(element.children);
}

function convertList(list: Element, depth: number): Block[] {
  const ordered = tag(list) === 'OL';
  const out: Block[] = [];
  for (const item of childElements(list)) {
    if (tag(item) !== 'LI') continue;
    const checkbox = item.querySelector<HTMLInputElement>(':scope > input[type="checkbox"]');
    const isTask = checkbox !== null;
    const text = inlineRuns(item);
    const block = createBlock(isTask ? 'todo' : ordered ? 'numbered' : 'bulleted', {
      text,
      props: isTask ? { checked: Boolean(checkbox?.checked) } : {},
    });
    for (const nested of childElements(item)) {
      if (tag(nested) === 'UL' || tag(nested) === 'OL') {
        block.children.push(...convertList(nested, depth + 1));
      }
    }
    out.push(block);
  }
  return out;
}

function languageOf(pre: Element): string {
  const code = pre.querySelector('code');
  const className = `${pre.className} ${code?.className ?? ''}`;
  const match = /(?:language-|lang-)([\w+#-]+)/u.exec(className);
  return match?.[1] ?? 'text';
}

function tableToDatabase(table: Element): DatabaseData | null {
  const allRows = Array.from(table.querySelectorAll('tr'));
  if (allRows.length === 0) return null;
  const firstRow = allRows[0];
  if (!firstRow) return null;
  const firstCells = Array.from(firstRow.querySelectorAll('th,td'));
  const hasHeader =
    firstCells.length > 0 &&
    (firstCells.every(cell => tag(cell) === 'TH') || firstRow.closest('thead') !== null);
  const headerCells = hasHeader ? firstCells : [];
  const dataRows = hasHeader ? allRows.slice(1) : allRows;
  const width = Math.max(
    headerCells.length,
    ...dataRows.map(row => row.querySelectorAll('th,td').length)
  );
  if (width === 0) return null;
  const columns = Array.from({ length: width }, (_, index) => {
    const header = headerCells[index];
    const name = header ? inlineRuns(header).map(run => run.text).join('').trim() : '';
    return createDatabaseColumn(name || `Column ${index + 1}`);
  });
  const rows = dataRows.map(row => {
    const cells = Array.from(row.querySelectorAll('th,td'));
    const values: Record<string, { text?: string; checked?: boolean }> = {};
    columns.forEach((column, index) => {
      const cell = cells[index];
      if (!cell) return;
      const checkbox = cell.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const text = inlineRuns(cell)
        .map(run => run.text)
        .join('')
        .trim();
      if (checkbox) {
        if (checkbox.checked) values[column.id] = { checked: true };
      } else if (text) {
        values[column.id] = { text };
      }
    });
    return createDatabaseRow(values);
  });
  if (rows.length === 0) rows.push(createDatabaseRow());
  return { variant: 'table', columns, rows };
}

function convertElement(element: Element, out: Block[]): void {
  const name = tag(element);
  switch (name) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const level = Math.min(6, Number(name.slice(1))) as 1 | 2 | 3 | 4 | 5 | 6;
      const runs = inlineRuns(element);
      if (runs.length > 0) out.push(createBlock('heading', { text: runs, props: { level } }));
      return;
    }
    case 'P': {
      const runs = inlineRuns(element);
      if (runs.length > 0) out.push(createBlock('paragraph', { text: runs }));
      return;
    }
    case 'UL':
    case 'OL':
      out.push(...convertList(element, 0));
      return;
    case 'BLOCKQUOTE': {
      const runs = inlineRuns(element);
      const block = createBlock('quote', { text: runs });
      for (const child of childElements(element)) {
        if (!BLOCK_TAGS.has(tag(child))) continue;
        if (tag(child) === 'P') continue;
        convertElement(child, block.children);
      }
      if (block.text.length > 0 || block.children.length > 0) out.push(block);
      return;
    }
    case 'PRE': {
      const text = element.textContent?.replace(/\u200B/gu, '') ?? '';
      out.push(createBlock('code', { text: text.replace(/\n$/u, ''), props: { language: languageOf(element) } }));
      return;
    }
    case 'HR':
      out.push(createBlock('divider'));
      return;
    case 'IMG': {
      const src = element.getAttribute('src');
      if (src) {
        out.push(
          createBlock('image', {
            props: {
              src,
              ...(element.getAttribute('alt') ? { alt: element.getAttribute('alt') ?? '' } : {}),
            },
          })
        );
      }
      return;
    }
    case 'TABLE': {
      const database = tableToDatabase(element);
      if (database) {
        out.push(createBlock('database', { props: { database } }));
        return;
      }
      for (const row of element.querySelectorAll('tr')) {
        const cells = Array.from(row.querySelectorAll('th,td'))
          .map(cell => (cell.textContent ?? '').trim())
          .filter(Boolean);
        if (cells.length > 0) {
          out.push(createBlock('paragraph', { text: cells.join('  ·  ') }));
        }
      }
      return;
    }
    case 'DIV':
    case 'SECTION':
    case 'ARTICLE':
    case 'MAIN':
    case 'HEADER':
    case 'FOOTER':
    case 'ASIDE':
    case 'FIGURE':
    case 'FIGCAPTION':
    case 'FORM':
    case 'FIELDSET':
    case 'ADDRESS':
    case 'DL':
    case 'NAV': {
      const hasBlocks = childElements(element).some(child => BLOCK_TAGS.has(tag(child)));
      if (hasBlocks) {
        for (const child of Array.from(element.childNodes)) {
          if (isElement(child) && BLOCK_TAGS.has(tag(child))) convertElement(child, out);
          else {
            const runs = inlineRuns(child);
            if (runs.length > 0) out.push(createBlock('paragraph', { text: runs }));
          }
        }
      } else {
        const runs = inlineRuns(element);
        if (runs.length > 0) out.push(createBlock('paragraph', { text: runs }));
      }
      return;
    }
    default: {
      const runs = inlineRuns(element);
      if (runs.length > 0) out.push(createBlock('paragraph', { text: runs }));
    }
  }
}

export function htmlToBlocks(html: string): Block[] {
  if (!html.trim()) return [];
  const document = new DOMParser().parseFromString(html, 'text/html');
  const out: Block[] = [];
  const body = document.body;

  let inlineBuffer: Node[] = [];
  const flushInline = (): void => {
    if (inlineBuffer.length === 0) return;
    const fragment = document.createDocumentFragment();
    for (const node of inlineBuffer) fragment.append(node.cloneNode(true));
    const runs = inlineRuns(fragment);
    if (runs.length > 0) out.push(createBlock('paragraph', { text: runs }));
    inlineBuffer = [];
  };

  for (const child of Array.from(body.childNodes)) {
    if (isElement(child) && BLOCK_TAGS.has(tag(child))) {
      flushInline();
      convertElement(child, out);
    } else if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() === '') {
      continue;
    } else {
      inlineBuffer.push(child);
    }
  }
  flushInline();
  return out;
}

const MARKDOWN_HINT = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|!\[[^\]]*\]\(|\|)/mu;

export function plainTextToBlocks(text: string): Block[] {
  const normalized = text.replace(/\r\n?/gu, '\n');
  if (!normalized.trim()) return [];
  if (MARKDOWN_HINT.test(normalized)) {
    const parsed = markdownToBlocks(normalized);
    if (parsed.blocks.length > 0) return parsed.blocks;
  }
  const blocks: Block[] = [];
  for (const line of normalized.split('\n')) {
    if (!line.trim()) continue;
    blocks.push(createBlock('paragraph', { text: line }));
  }
  return blocks;
}

export interface ClipboardPayload {
  /** Blocks ready to insert. */
  blocks: Block[];
  /** True when the source was a single-line inline fragment. */
  inline: boolean;
  /** Original markdown, when the source was plain text. */
  markdown?: string;
}

export function readClipboardPayload(event: ClipboardEvent): ClipboardPayload | null {
  const data = event.clipboardData;
  if (!data) return null;

  const custom = data.getData('application/x-nobita+json');
  if (custom) {
    try {
      const value = JSON.parse(custom) as { blocks?: unknown };
      const parsed = parseDoc({ blocks: Array.isArray(value.blocks) ? value.blocks : [] });
      if (parsed.blocks.length > 0) return { blocks: parsed.blocks, inline: false };
    } catch {
      // fall through to richer standard formats
    }
  }

  const html = data.getData('text/html');
  if (html) {
    const blocks = htmlToBlocks(html);
    if (blocks.length > 0) return { blocks, inline: false };
  }

  const text = data.getData('text/plain');
  if (text) {
    const normalized = text.replace(/\r\n?/gu, '\n');
    if (!normalized.includes('\n') && normalized.length < 2000) {
      return { blocks: [createBlock('paragraph', { text: normalized })], inline: true };
    }
    return {
      blocks: plainTextToBlocks(normalized),
      inline: false,
      markdown: normalized,
    };
  }

  return null;
}

export interface SerializedSelection {
  html: string;
  text: string;
  markdown: string;
  json: string;
}

export function serializeBlocksForClipboard(blocks: Block[]): SerializedSelection {
  return {
    html: blocksToHtml(blocks),
    text: blocksToPlainText(blocks),
    markdown: blocksToMarkdown({ version: 1, id: 'clipboard', title: '', blocks }),
    json: JSON.stringify({ version: 1, blocks }),
  };
}
