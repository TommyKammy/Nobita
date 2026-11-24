import { createBlock } from './doc.js';
import {
  createDatabaseColumn,
  createDatabaseRow,
  databaseCellText,
  sortedDatabaseRows,
} from './database.js';
import { normalizeRuns, plainText, runsLength, sliceRuns } from './text.js';
import type { Block, Doc, InlineMark, InlineRun } from './types.js';
import { safeHref, safeImageSrc } from './url.js';

const ESCAPABLE = new Set(['\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!', '|', '>', '~']);

function withMark(run: InlineRun, patch: InlineMark): InlineRun {
  return { text: run.text, marks: { ...(run.marks ?? {}), ...patch } };
}

/**
 * Parse the inline markdown subset Nobita understands. Unknown syntax is kept
 * literally. This is intentionally forgiving: pasted prose should never break.
 */
export function parseInlineMarkdown(text: string): InlineRun[] {
  if (!text) return [];
  const runs: InlineRun[] = [];
  let buffer = '';

  const flush = (): void => {
    if (!buffer) return;
    runs.push({ text: buffer });
    buffer = '';
  };

  const findClosing = (token: string, from: number): number => {
    const index = text.indexOf(token, from);
    return index;
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
      const close = findClosing(fence, index + fence.length);
      if (close > index) {
        flush();
        const inner = text.slice(index + fence.length, close);
        runs.push({ text: inner, marks: { code: true } });
        index = close + fence.length;
        continue;
      }
    }

    if (char === '[') {
      const match = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/u.exec(text.slice(index));
      if (match?.[2]) {
        flush();
        const label = match[1] ?? match[2];
        runs.push({ text: label, marks: { link: match[2] } });
        index += match[0].length;
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
        for (const run of parseInlineMarkdown(inner)) {
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
        for (const run of parseInlineMarkdown(inner)) runs.push(withMark(run, { bold: true }));
        index = close + 2;
        continue;
      }
    }

    if (text.startsWith('~~', index)) {
      const close = findClosing('~~', index + 2);
      if (close > index + 2) {
        flush();
        const inner = text.slice(index + 2, close);
        for (const run of parseInlineMarkdown(inner)) runs.push(withMark(run, { strike: true }));
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
          for (const run of parseInlineMarkdown(inner)) runs.push(withMark(run, { italic: true }));
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
      if (column.type === 'checkbox') return row.cells[column.id]?.checked ? '[x]' : '[ ]';
      return escapeCell(databaseCellText(row.cells[column.id], column.type));
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
      const columns = headerCells.map((name, columnIndex) =>
        createDatabaseColumn(name || `Column ${columnIndex + 1}`)
      );
      const databaseRows = [];
      index += 2;
      while (index < lines.length) {
        const line = (lines[index] ?? '').trim();
        if (!line.startsWith('|')) break;
        const cells = splitTableRow(line);
        const values: Record<string, { text?: string }> = {};
        columns.forEach((column, columnIndex) => {
          const value = plainText(parseInlineMarkdown(cells[columnIndex] ?? ''));
          if (value) values[column.id] = { text: value };
        });
        databaseRows.push(createDatabaseRow(values));
        index += 1;
      }
      if (databaseRows.length === 0) databaseRows.push(createDatabaseRow());
      blocks.push(
        createBlock('database', {
          props: {
            database: { variant: 'table', columns, rows: databaseRows },
          },
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

function escapeInline(text: string): string {
  let out = '';
  for (const char of text) {
    if (SERIALIZE_ESCAPABLE.has(char)) out += `\\${char}`;
    else out += char;
  }
  return out;
}

function runsToMarkdown(runs: readonly InlineRun[]): string {
  let out = '';
  for (const run of runs) {
    const text = run.text;
    const marks = run.marks;
    if (!marks) {
      out += escapeInline(text);
      continue;
    }
    let body = escapeInline(text);
    if (marks.code) {
      let fence = '`';
      while (body.includes(fence)) fence += '`';
      body = body.includes('`') ? `${fence} ${body} ${fence}` : `${fence}${body}${fence}`;
    }
    if (marks.bold) body = `**${body}**`;
    if (marks.italic) body = `*${body}*`;
    if (marks.strike) body = `~~${body}~~`;
    const href = marks.link ? safeHref(marks.link) : null;
    if (href) body = `[${body}](${href})`;
    out += body;
  }
  return out;
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
      case 'page': {
        const title = escapeInline(
          block.props.pageTitle ?? block.props.pageId ?? 'Untitled page'
        );
        const pageId = block.props.pageId;
        lines.push(
          pageId ? `${pad}[${title}](#page-${encodeURIComponent(pageId)})` : `${pad}${title}`
        );
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
