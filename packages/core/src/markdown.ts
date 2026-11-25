import { createBlock } from './doc.js';
import { createTableColumn, createTableData, createTableRow, hasRichMarks } from './table.js';
import { databaseCellDisplay, databaseCellText, sortedDatabaseRows } from './database.js';
import { normalizeRuns, plainText, runsLength, sliceRuns } from './text.js';
import type { Block, Doc, InlineMark, InlineRun, TableCell } from './types.js';
import { safeHref, safeImageSrc } from './url.js';

const ESCAPABLE = new Set(['\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!', '|', '>', '~']);

function withMark(run: InlineRun, patch: InlineMark): InlineRun {
  return { text: run.text, marks: { ...(run.marks ?? {}), ...patch } };
}

/** Find a closing backtick fence with the exact same backtick run length (CommonMark §6.1). */
function findClosingCodeFence(text: string, fence: string, from: number): number {
  let pos = from;
  while (pos < text.length) {
    const hit = text.indexOf(fence, pos);
    if (hit < 0) return -1;
    const prevBacktick = hit > 0 && text[hit - 1] === '`';
    const nextBacktick = text[hit + fence.length] === '`';
    if (!prevBacktick && !nextBacktick) return hit;
    pos = hit + 1;
  }
  return -1;
}

/** CommonMark §6.1: strip one leading + trailing space when both exist and content isn't all spaces. */
function stripCodeSpanPadding(inner: string): string {
  if (
    inner.length >= 2 &&
    inner.startsWith(' ') &&
    inner.endsWith(' ') &&
    /[^ ]/u.test(inner)
  ) {
    return inner.slice(1, -1);
  }
  return inner;
}

/** Match `[label](destination "optional title")` with balanced parentheses in the destination. */
function matchMarkdownLink(
  text: string,
  start: number
): { rawLabel: string; href: string; length: number } | null {
  if (text[start] !== '[') return null;
  let cursor = start + 1;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (ch === '\\' && cursor + 1 < text.length) {
      cursor += 2;
      continue;
    }
    if (ch === ']') break;
    cursor += 1;
  }
  if (text[cursor] !== ']' || text[cursor + 1] !== '(') return null;
  const rawLabel = text.slice(start + 1, cursor);
  let pos = cursor + 2;
  const destStart = pos;
  let depth = 0;
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === '\\' && pos + 1 < text.length) {
      pos += 2;
      continue;
    }
    if (/\s/u.test(ch ?? '')) break;
    if (ch === '(') {
      depth += 1;
      pos += 1;
      continue;
    }
    if (ch === ')') {
      if (depth === 0) break;
      depth -= 1;
      pos += 1;
      continue;
    }
    pos += 1;
  }
  if (depth !== 0 || pos === destStart) return null;
  const href = text.slice(destStart, pos);
  if (text[pos] === ')') {
    return { rawLabel, href, length: pos + 1 - start };
  }
  const titleMatch = /^\s+"[^"]*"\)/u.exec(text.slice(pos));
  if (!titleMatch) return null;
  return { rawLabel, href, length: pos + titleMatch[0].length - start };
}

function hasBalancedParens(value: string): boolean {
  let depth = 0;
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      if (depth === 0) return false;
      depth -= 1;
    }
  }
  return depth === 0;
}

function formatMarkdownHref(href: string, escapePipe: boolean): string {
  let out = hasBalancedParens(href)
    ? href
    : href.replace(/\(/gu, '%28').replace(/\)/gu, '%29');
  if (escapePipe) out = out.replace(/\|/gu, '\\|');
  return out;
}

function parseInline(text: string, allowLinks: boolean): InlineRun[] {
  if (!text) return [];
  const runs: InlineRun[] = [];
  let buffer = '';

  const flush = (): void => {
    if (!buffer) return;
    runs.push({ text: buffer });
    buffer = '';
  };

  const findClosing = (token: string, from: number): number => {
    let pos = from;
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === '\\' && pos + 1 < text.length) {
        pos += 2;
        continue;
      }
      if (ch === '`') {
        let fence = '`';
        while (text[pos + fence.length] === '`') fence += '`';
        const close = findClosingCodeFence(text, fence, pos + fence.length);
        if (close >= 0) {
          pos = close + fence.length;
          continue;
        }
        pos += fence.length;
        continue;
      }
      if (text.startsWith(token, pos)) return pos;
      pos += 1;
    }
    return -1;
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (!char) break;

    if (char === '\\' && index + 1 < text.length) {
      const next = text[index + 1];
      if (next && ESCAPABLE.has(next)) {
        buffer += next;
        index += 2;
        continue;
      }
    }

    if (char === '`') {
      let fence = '`';
      while (text[index + fence.length] === '`') fence += '`';
      const close = findClosingCodeFence(text, fence, index + fence.length);
      if (close > index) {
        flush();
        const inner = stripCodeSpanPadding(text.slice(index + fence.length, close));
        runs.push({ text: inner, marks: { code: true } });
        index = close + fence.length;
        continue;
      }
      buffer += fence;
      index += fence.length;
      continue;
    }

    if (allowLinks && char === '[') {
      const linkMatch = matchMarkdownLink(text, index);
      if (linkMatch) {
        flush();
        for (const run of parseInline(linkMatch.rawLabel, false)) {
          runs.push(withMark(run, { link: linkMatch.href }));
        }
        index += linkMatch.length;
        continue;
      }
    }

    const triple = text.startsWith('***', index) || text.startsWith('___', index);
    if (triple) {
      const token = text.slice(index, index + 3);
      const close = findClosing(token, index + 3);
      if (close > index + 3) {
        flush();
        const inner = text.slice(index + 3, close);
        for (const run of parseInline(inner, allowLinks)) {
          runs.push(withMark(withMark(run, { bold: true }), { italic: true }));
        }
        index = close + 3;
        continue;
      }
    }

    const double = text.startsWith('**', index) || text.startsWith('__', index);
    if (double) {
      const token = text.slice(index, index + 2);
      const close = findClosing(token, index + 2);
      if (close > index + 2) {
        flush();
        const inner = text.slice(index + 2, close);
        for (const run of parseInline(inner, allowLinks)) runs.push(withMark(run, { bold: true }));
        index = close + 2;
        continue;
      }
    }

    if (text.startsWith('~~', index)) {
      const close = findClosing('~~', index + 2);
      if (close > index + 2) {
        flush();
        const inner = text.slice(index + 2, close);
        for (const run of parseInline(inner, allowLinks)) runs.push(withMark(run, { strike: true }));
        index = close + 2;
        continue;
      }
    }

    if (char === '*' || char === '_') {
      const close = findClosing(char, index + 1);
      if (close > index + 1 && text[close + 1] !== char) {
        flush();
        const inner = text.slice(index + 1, close);
        if (inner.trim().length > 0) {
          for (const run of parseInline(inner, allowLinks)) runs.push(withMark(run, { italic: true }));
          index = close + 1;
          continue;
        }
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
  return normalizeRuns(runs);
}

/**
 * Parse the inline markdown subset Nobita understands. Unknown syntax is kept
 * literally. This is intentionally forgiving: pasted prose should never break.
 */
export function parseInlineMarkdown(text: string): InlineRun[] {
  return parseInline(text, true);
}

interface ListFrame {
  block: Block;
  indent: number;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  const placeholder = '\u0000PIPE\u0000';
  return trimmed
    .replace(/\\\|/gu, placeholder)
    .split('|')
    .map(cell => cell.trim().replaceAll(placeholder, '|'));
}

const TABLE_LT = '\u0000LT\u0000';
const TABLE_GT = '\u0000GT\u0000';

function protectTableEscapes(value: string): string {
  let out = '';
  let index = 0;
  while (index < value.length) {
    if (value[index] !== '\\') {
      out += value[index];
      index += 1;
      continue;
    }
    let end = index;
    while (value[end] === '\\') end += 1;
    const count = end - index;
    const next = value[end];
    const pairs = Math.floor(count / 2);
    out += '\\'.repeat(pairs * 2);
    if (count % 2 === 1 && (next === '<' || next === '>')) {
      out += next === '<' ? TABLE_LT : TABLE_GT;
      index = end + 1;
    } else {
      if (count % 2 === 1) out += '\\';
      index = end;
    }
  }
  return out;
}

function decodeTableCell(value: string): TableCell | undefined {
  const codeSpans: string[] = [];
  let protectedText = '';
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === '\\' && index + 1 < value.length) {
      protectedText += value.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === '`') {
      let fence = '`';
      while (value[index + fence.length] === '`') fence += '`';
      const close = findClosingCodeFence(value, fence, index + fence.length);
      if (close >= 0) {
        const token = `\u0000CODE${codeSpans.length}\u0000`;
        codeSpans.push(stripCodeSpanPadding(value.slice(index + fence.length, close)));
        protectedText += token;
        index = close + fence.length;
        continue;
      }
      protectedText += fence;
      index += fence.length;
      continue;
    }
    protectedText += char;
    index += 1;
  }

  const parsed = parseInlineMarkdown(
    protectTableEscapes(protectedText).replace(/<br\s*\/?>/giu, '\n')
  );
  const expanded: InlineRun[] = [];
  const codeTokenRe = /(\u0000CODE\d+\u0000)/gu;
  for (const run of parsed) {
    const restored = run.text.replaceAll(TABLE_LT, '<').replaceAll(TABLE_GT, '>');
    if (codeSpans.length === 0 || !restored.includes('\u0000CODE')) {
      expanded.push(run.marks ? { text: restored, marks: run.marks } : { text: restored });
      continue;
    }
    for (const part of restored.split(codeTokenRe)) {
      if (!part) continue;
      const match = /^\u0000CODE(\d+)\u0000$/u.exec(part);
      if (match?.[1]) {
        const inner = codeSpans[Number(match[1])] ?? '';
        if (inner) {
          expanded.push({
            text: inner,
            marks: { ...(run.marks ?? {}), code: true },
          });
        }
      } else {
        expanded.push(run.marks ? { text: part, marks: run.marks } : { text: part });
      }
    }
  }

  const runs = normalizeRuns(expanded);
  const text = plainText(runs);
  if (!text) return undefined;
  return hasRichMarks(runs) ? { text, runs } : { text };
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/u.test(cell));
}

function databaseTableToLines(data: NonNullable<Block['props']['database']>): string[] {
  const escapeCell = (value: string): string => value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
  const header = `| ${data.columns.map(column => escapeCell(column.name)).join(' | ')} |`;
  const separator = `| ${data.columns.map(() => '---').join(' | ')} |`;
  const lines = [header, separator];
  for (const row of sortedDatabaseRows(data)) {
    const cells = data.columns.map(column => {
      const cell = row.cells[column.id];
      if (column.type === 'checkbox') return cell?.checked ? '[x]' : '[ ]';
      if (column.type === 'progress') return escapeCell(databaseCellDisplay(cell, 'progress'));
      if (column.type === 'image') {
        const src = safeImageSrc(cell?.text);
        if (!src) return '';
        const safeMdSrc = src.replace(/\(/gu, '%28').replace(/\)/gu, '%29');
        return escapeCell(`![image](${safeMdSrc})`);
      }
      if (column.type === 'text' && cell?.runs && cell.runs.length > 0) {
        return escapeCell(inlineToMarkdown(cell.runs));
      }
      return escapeCell(databaseCellText(cell, column.type));
    });
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines;
}

export interface MarkdownParseResult {
  title?: string;
  blocks: Block[];
}

/** Convert markdown into Nobita blocks, including nested lists. */
export function markdownToBlocks(
  markdown: string,
  options: { extractTitle?: boolean } = {}
): MarkdownParseResult {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  const blocks: Block[] = [];
  const stack: ListFrame[] = [];
  let title: string | undefined;
  let index = 0;

  const append = (block: Block, indent: number | null): void => {
    if (indent === null) {
      stack.length = 0;
      blocks.push(block);
      return;
    }
    while (stack.length > 0 && indent <= (stack[stack.length - 1]?.indent ?? 0)) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.block.children.push(block);
    else blocks.push(block);
    stack.push({ block, indent });
  };

  while (index < lines.length) {
    const raw = lines[index] ?? '';
    const line = raw.replace(/\t/gu, '    ');
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      stack.length = 0;
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim() || 'text';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith('```')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      stack.length = 0;
      blocks.push(createBlock('code', { props: { language }, text: body.join('\n') }));
      continue;
    }

    if (
      trimmed.startsWith('|') &&
      index + 1 < lines.length &&
      isTableSeparator((lines[index + 1] ?? '').trim())
    ) {
      stack.length = 0;
      const headerCells = splitTableRow(trimmed);
      const columns = headerCells.map(() => createTableColumn());
      const tableRows = [createTableRow()];
      headerCells.forEach((value, columnIndex) => {
        const column = columns[columnIndex];
        if (!column || !value) return;
        const cell = decodeTableCell(value);
        if (cell) tableRows[0]!.cells[column.id] = cell;
      });
      index += 2;
      while (index < lines.length) {
        const line = (lines[index] ?? '').trim();
        if (!line.startsWith('|')) break;
        const cells = splitTableRow(line);
        const row = createTableRow();
        columns.forEach((column, columnIndex) => {
          const cell = decodeTableCell(cells[columnIndex] ?? '');
          if (cell) row.cells[column.id] = cell;
        });
        tableRows.push(row);
        index += 1;
      }
      blocks.push(
        createBlock('table', {
          props: { table: { columns, rows: tableRows } },
        })
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/u.exec(trimmed);
    if (heading?.[1] && heading[2] !== undefined) {
      stack.length = 0;
      const level = Math.min(6, heading[1].length) as 1 | 2 | 3 | 4 | 5 | 6;
      if (options.extractTitle && !title && level === 1 && blocks.length === 0) {
        title = heading[2].trim();
      } else {
        blocks.push(createBlock('heading', { props: { level }, text: parseInlineMarkdown(heading[2]) }));
      }
      index += 1;
      continue;
    }

    if (/^(?:---+|\*\*\*+|___+)\s*$/u.test(trimmed)) {
      stack.length = 0;
      blocks.push(createBlock('divider'));
      index += 1;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    const list = /^([-*+]|\d+[.)])\s+(.*)$/u.exec(line.trimStart());
    if (list?.[2] !== undefined) {
      const marker = list[1] ?? '-';
      const body = list[2];
      const todo = /^\[([ xX])\]\s+(.*)$/u.exec(body);
      let block: Block;
      if (todo?.[2] !== undefined) {
        block = createBlock('todo', {
          text: parseInlineMarkdown(todo[2]),
          props: { checked: todo[1] === 'x' || todo[1] === 'X' },
        });
      } else if (/^\d/u.test(marker)) {
        block = createBlock('numbered', { text: parseInlineMarkdown(body) });
      } else {
        block = createBlock('bulleted', { text: parseInlineMarkdown(body) });
      }
      append(block, indent);
      index += 1;
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/u.exec(trimmed);
    if (image?.[2]) {
      stack.length = 0;
      blocks.push(
        createBlock('image', {
          props: { src: image[2], ...(image[1] ? { alt: image[1] } : {}) },
        })
      );
      index += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      stack.length = 0;
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const candidate = (lines[index] ?? '').trimStart();
        if (!candidate.startsWith('>')) break;
        quoteLines.push(candidate.replace(/^>\s?/u, ''));
        index += 1;
      }
      blocks.push(createBlock('quote', { text: parseInlineMarkdown(quoteLines.join('\n')) }));
      continue;
    }

    // Paragraph: consume until a blank line or another block marker.
    stack.length = 0;
    const paragraphLines: string[] = [trimmed];
    index += 1;
    while (index < lines.length) {
      const candidate = (lines[index] ?? '').trim();
      if (candidate.length === 0) break;
      if (
        /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|`{3}|---|\*\*\*|___|[|])/u.test(candidate) ||
        /^!\[[^\]]*\]\([^)]*\)$/u.test(candidate)
      ) {
        break;
      }
      paragraphLines.push(candidate);
      index += 1;
    }
    blocks.push(createBlock('paragraph', { text: parseInlineMarkdown(paragraphLines.join('\n')) }));
  }

  if (blocks.length === 0) blocks.push(createBlock('paragraph'));
  return title === undefined ? { blocks } : { title, blocks };
}

const SERIALIZE_ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']']);

function escapeTableText(text: string): string {
  return escapeInline(text)
    .replace(/\|/gu, '\\|')
    .replace(/</gu, '\\<')
    .replace(/>/gu, '\\>')
    .replace(/\n/gu, '<br>');
}

function escapeInline(text: string): string {
  let out = '';
  for (const char of text) {
    if (SERIALIZE_ESCAPABLE.has(char)) out += `\\${char}`;
    else out += char;
  }
  return out;
}

function runStartsWithStar(run: InlineRun | undefined): boolean {
  const marks = run?.marks;
  if (!marks) return false;
  if (marks.link && safeHref(marks.link)) return false;
  if (marks.strike) return false;
  return Boolean(marks.bold || marks.italic);
}

function serializeRunsToMarkdown(
  runs: readonly InlineRun[],
  escapePlain: (text: string) => string,
  escapeCode: (text: string) => string,
  escapeHrefPipe: boolean
): string {
  let out = '';
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i]!;
    const text = run.text;
    const marks = run.marks;
    if (!marks) {
      out += escapePlain(text);
      continue;
    }
    let body = marks.code ? escapeCode(text) : escapePlain(text);
    if (marks.code) {
      let fence = '`';
      while (body.includes(fence)) fence += '`';
      const needsPad =
        body.startsWith('`') ||
        body.endsWith('`') ||
        (body.length >= 2 &&
          body.startsWith(' ') &&
          body.endsWith(' ') &&
          /[^ ]/u.test(body));
      body = needsPad ? `${fence} ${body} ${fence}` : `${fence}${body}${fence}`;
    }
    const href = marks.link ? safeHref(marks.link) : null;
    const outerIsEmphasis = !href && !marks.strike;
    const prevEndsStar = out.endsWith('*');
    const prevEndsUnderscore = out.endsWith('_');
    const nextStartsStar = runStartsWithStar(runs[i + 1]);
    const useUnderscore =
      outerIsEmphasis && !prevEndsUnderscore && (prevEndsStar || nextStartsStar);

    if (marks.bold && marks.italic) {
      body = useUnderscore ? `_**${body}**_` : `***${body}***`;
    } else if (marks.bold) {
      body = useUnderscore ? `__${body}__` : `**${body}**`;
    } else if (marks.italic) {
      body = useUnderscore ? `_${body}_` : `*${body}*`;
    }
    if (marks.strike) body = `~~${body}~~`;
    if (href) {
      body = `[${body}](${formatMarkdownHref(href, escapeHrefPipe)})`;
    }
    out += body;
  }
  return out;
}

function runsToMarkdown(runs: readonly InlineRun[]): string {
  return serializeRunsToMarkdown(runs, escapeInline, escapeInline, false);
}

function expandTableCodeNewlines(runs: readonly InlineRun[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (const run of runs) {
    const marks = run.marks;
    if (!marks?.code || !run.text.includes('\n')) {
      out.push(run);
      continue;
    }
    const parts = run.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) out.push({ text: '\n' });
      if (part) out.push({ text: part, marks });
    });
  }
  return out;
}

function serializeTableCell(cell: TableCell | undefined): string {
  if (!cell) return '';
  if (cell.runs && cell.runs.length > 0) {
    return serializeRunsToMarkdown(
      expandTableCodeNewlines(cell.runs),
      escapeTableText,
      text => text.replace(/\|/gu, '\\|'),
      true
    );
  }
  return escapeTableText(cell.text ?? '');
}

function indentLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map(line => (line.length > 0 ? `${prefix}${line}` : line))
    .join('\n');
}

function serializeBlocks(blocks: readonly Block[], depth: number, lines: string[]): void {
  let number = 0;
  for (const block of blocks) {
    const pad = '  '.repeat(depth);
    const text = runsToMarkdown(block.text);
    switch (block.type) {
      case 'heading':
        lines.push(`${pad}${'#'.repeat(block.props.level ?? 1)} ${text}`);
        break;
      case 'bulleted':
        lines.push(`${pad}- ${text}`);
        break;
      case 'numbered':
        number += 1;
        lines.push(`${pad}${number}. ${text}`);
        break;
      case 'todo':
        lines.push(`${pad}- [${block.props.checked ? 'x' : ' '}] ${text}`);
        break;
      case 'quote':
        lines.push(indentLines(text, `${pad}> `));
        break;
      case 'code':
        lines.push(`${pad}\`\`\`${block.props.language ?? ''}`);
        lines.push(block.text.length > 0 ? plainText(block.text) : '');
        lines.push(`${pad}\`\`\``);
        break;
      case 'divider':
        lines.push(`${pad}---`);
        break;
      case 'image': {
        const src = safeImageSrc(block.props.src);
        if (src) lines.push(`${pad}![${block.props.alt ?? ''}](${src})`);
        else if (block.props.alt) lines.push(`${pad}${escapeInline(block.props.alt)}`);
        if (block.props.caption) lines.push(`${pad}*${escapeInline(block.props.caption)}*`);
        break;
      }
      case 'database': {
        if (block.props.database) {
          for (const line of databaseTableToLines(block.props.database)) {
            lines.push(`${pad}${line}`);
          }
          lines.push('');
        }
        break;
      }
      case 'table': {
        const table = block.props.table ?? createTableData({ rows: 1, columns: 1 });
        const header = table.columns.map(column =>
          serializeTableCell(table.rows[0]?.cells[column.id])
        );
        lines.push(`${pad}| ${header.join(' | ')} |`);
        lines.push(`${pad}| ${table.columns.map(() => '---').join(' | ')} |`);
        for (const row of table.rows.slice(1)) {
          lines.push(
            `${pad}| ${table.columns
              .map(column => serializeTableCell(row.cells[column.id]))
              .join(' | ')} |`
          );
        }
        break;
      }
      case 'page': {
        const title = escapeInline(
          block.props.pageTitle ?? block.props.pageId ?? 'Untitled page'
        );
        const pageId = block.props.pageId;
        const href = pageId
          ? `#page-${encodeURIComponent(pageId)
              .replace(/\(/gu, '%28')
              .replace(/\)/gu, '%29')}`
          : '';
        lines.push(pageId ? `${pad}[${title}](${href})` : `${pad}${title}`);
        break;
      }
      case 'callout':
        lines.push(indentLines(text, `${pad}> `));
        if (block.props.tone && block.props.tone !== 'info') {
          lines.push(`${pad}>`);
          lines.push(`${pad}> _${block.props.tone}_`);
        }
        break;
      case 'paragraph':
      default:
        lines.push(`${pad}${text}`);
        break;
    }
    if (block.type !== 'bulleted' && block.type !== 'numbered' && block.type !== 'todo' && block.children.length > 0) {
      lines.push('');
    }
    if (block.children.length > 0) serializeBlocks(block.children, depth + 1, lines);
    if (block.type === 'code') lines.push('');
  }
}

export function blocksToMarkdown(doc: Doc, options: { title?: boolean } = {}): string {
  const lines: string[] = [];
  if (options.title !== false && doc.title.trim()) {
    lines.push(`# ${doc.title.trim()}`, '');
  }
  serializeBlocks(doc.blocks, 0, lines);
  return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim()}\n`;
}

/** Markdown for a slice of one block plus its neighbours, used by copy. */
export function inlineToMarkdown(runs: InlineRun[]): string {
  return runsToMarkdown(runs);
}

export function blockToPlainText(block: Block): string {
  return plainText(block.text);
}

export function blockRangeToMarkdown(block: Block, start: number, end: number): string {
  const length = runsLength(block.text);
  return runsToMarkdown(sliceRuns(block.text, Math.max(0, start), Math.min(length, end)));
}
