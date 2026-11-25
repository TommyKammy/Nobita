import { createBlock, createDoc } from './doc.js';
import { cloneDatabaseData, databaseCellDisplay, normalizeDatabaseData, sortedDatabaseRows } from './database.js';
import { cloneRuns, parseInlineRuns, runsToHtml } from './text.js';
import { cloneTableData, normalizeTableData, tableToTsv } from './table.js';
import type {
  Block,
  BlockProps,
  BlockType,
  CalloutTone,
  Doc,
  HeadingLevel,
  InlineRun,
  TextAlign,
} from './types.js';
import { safeImageSrc } from './url.js';

const BLOCK_TYPES: readonly BlockType[] = [
  'paragraph',
  'heading',
  'bulleted',
  'numbered',
  'todo',
  'quote',
  'code',
  'divider',
  'callout',
  'image',
  'database',
  'table',
  'page',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

function parseProps(value: unknown): BlockProps {
  if (!isRecord(value)) return {};
  const props: BlockProps = {};
  const level = value.level;
  if (level === 1 || level === 2 || level === 3 || level === 4 || level === 5 || level === 6) {
    props.level = level;
  }
  if (typeof value.checked === 'boolean') props.checked = value.checked;
  if (typeof value.language === 'string') props.language = value.language;
  const tone = value.tone;
  if (tone === 'info' || tone === 'success' || tone === 'warning' || tone === 'danger') {
    props.tone = tone as CalloutTone;
  }
  const align = value.align;
  if (align === 'left' || align === 'center' || align === 'right') props.align = align as TextAlign;
  if (typeof value.src === 'string') props.src = value.src;
  if (typeof value.alt === 'string') props.alt = value.alt;
  if (typeof value.caption === 'string') props.caption = value.caption;
  if (typeof value.collapsed === 'boolean') props.collapsed = value.collapsed;
  if (typeof value.pageId === 'string' && value.pageId.length > 0) {
    props.pageId = value.pageId;
  }
  if (typeof value.pageTitle === 'string' && value.pageTitle.length > 0) {
    props.pageTitle = value.pageTitle.slice(0, 200);
  }
  if (typeof value.pageIcon === 'string' && value.pageIcon.length > 0) {
    props.pageIcon = value.pageIcon.slice(0, 40);
  }
  if (isRecord(value.table)) {
    props.table = normalizeTableData(value.table);
  }
  return props;
}

function parseBlock(value: unknown, seen: Set<string>): Block | null {
  if (!isRecord(value)) return null;
  let id = typeof value.id === 'string' && value.id.length > 0 ? value.id : '';
  if (!id || seen.has(id)) {
    id = createBlock('paragraph').id;
  }
  seen.add(id);
  const rawType = typeof value.type === 'string' ? value.type : 'paragraph';
  const type = (BLOCK_TYPES as readonly string[]).includes(rawType)
    ? (rawType as BlockType)
    : 'paragraph';
  const text = parseInlineRuns(value.text);
  const props = parseProps(value.props);
  if (type === 'database') {
    const rawProps = isRecord(value.props) ? value.props : {};
    props.database = normalizeDatabaseData(rawProps.database, 'database');
  }
  if (type === 'table') {
    const rawProps = isRecord(value.props) ? value.props : {};
    props.table = normalizeTableData(rawProps.table);
  }
  const children: Block[] = [];
  if (Array.isArray(value.children)) {
    for (const child of value.children) {
      const parsed = parseBlock(child, seen);
      if (parsed) children.push(parsed);
    }
  }
  if (type === 'heading' && props.level === undefined) props.level = 1;
  if (type === 'code' && props.language === undefined) props.language = 'ts';
  if (type === 'todo' && props.checked === undefined) props.checked = false;
  if (type === 'callout' && props.tone === undefined) props.tone = 'info';
  return { id, type, text, props, children };
}

/** Parse untrusted JSON (a string or value) into a safe document. */
export function parseDoc(input: unknown): Doc {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return createDoc();
    }
  }
  if (!isRecord(value)) return createDoc();
  const seen = new Set<string>();
  const blocks: Block[] = [];
  if (Array.isArray(value.blocks)) {
    for (const raw of value.blocks) {
      const block = parseBlock(raw, seen);
      if (block) blocks.push(block);
    }
  }
  if (blocks.length === 0) blocks.push(createBlock('paragraph'));
  const doc = createDoc({
    ...(typeof value.id === 'string' && value.id ? { id: value.id } : {}),
    title: asString(value.title),
    ...(typeof value.icon === 'string' ? { icon: value.icon } : {}),
    blocks,
  });
  return doc;
}

export function docToJSON(doc: Doc, pretty = false): string {
  return JSON.stringify(doc, null, pretty ? 2 : 0);
}

export function cloneDoc(doc: Doc): Doc {
  return {
    ...doc,
    blocks: cloneBlockList(doc.blocks),
  };
}

function cloneBlockList(blocks: readonly Block[]): Block[] {
  return blocks.map(block => ({
    ...block,
    text: cloneRuns(block.text),
    props: {
      ...block.props,
      ...(block.props.database ? { database: cloneDatabaseData(block.props.database) } : {}),
      ...(block.props.table ? { table: cloneTableData(block.props.table) } : {}),
    },
    children: cloneBlockList(block.children),
  }));
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');

export function runsToInlineHtml(runs: readonly InlineRun[]): string {
  return runsToHtml(runs, escapeHtml);
}

function blockInnerHtml(block: Block): string {
  return runsToInlineHtml(block.text);
}

/**
 * Render a document to a semantic HTML fragment. Block ids are included as
 * data attributes so a host can map HTML back to blocks if it wants to.
 */
export function blocksToHtml(blocks: readonly Block[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    const inner = blockInnerHtml(block);
    const align = block.props.align ? ` style="text-align:${block.props.align}"` : '';
    const children = block.children.length > 0 ? `\n${blocksToHtml(block.children)}` : '';
    switch (block.type) {
      case 'heading': {
        const level = block.props.level ?? 1;
        out.push(`<h${level} data-block-id="${block.id}"${align}>${inner}</h${level}>`);
        break;
      }
      case 'bulleted':
        out.push(`<ul><li data-block-id="${block.id}"${align}>${inner}${children}</li></ul>`);
        break;
      case 'numbered':
        out.push(`<ol><li data-block-id="${block.id}"${align}>${inner}${children}</li></ol>`);
        break;
      case 'todo':
        out.push(
          `<ul class="nb-todo"><li data-block-id="${block.id}"${align}>` +
            `<input type="checkbox" disabled${block.props.checked ? ' checked' : ''}> ${inner}${children}</li></ul>`
        );
        break;
      case 'quote':
        out.push(`<blockquote data-block-id="${block.id}"${align}>${inner}${children}</blockquote>`);
        break;
      case 'code':
        out.push(
          `<pre data-block-id="${block.id}"><code data-language="${escapeHtml(
            block.props.language ?? 'text'
          )}">${escapeHtml(blockInnerText(block))}</code></pre>`
        );
        break;
      case 'divider':
        out.push(`<hr data-block-id="${block.id}">`);
        break;
      case 'callout':
        out.push(
          `<aside class="nb-callout nb-callout-${block.props.tone ?? 'info'}" data-block-id="${block.id}">${inner}${children}</aside>`
        );
        break;
      case 'image':
        out.push(
          `<figure data-block-id="${block.id}"><img src="${escapeHtml(safeImageSrc(block.props.src) ?? '')}" alt="${escapeHtml(
            block.props.alt ?? ''
          )}">${
            block.props.caption
              ? `<figcaption>${escapeHtml(block.props.caption)}</figcaption>`
              : ''
          }</figure>`
        );
        break;
      case 'database':
        out.push(
          block.props.database
            ? `<div data-block-id="${block.id}">${databaseToHtml(block.props.database)}</div>`
            : `<div data-block-id="${block.id}"></div>`
        );
        break;
      case 'table':
        out.push(`${tableToHtml(block)}${children}`);
        break;
      case 'page': {
        const pageId = block.props.pageId ?? '';
        const pageTitle = block.props.pageTitle ?? 'Untitled page';
        const icon = block.props.pageIcon
          ? `<span aria-hidden="true">${escapeHtml(block.props.pageIcon)}</span> `
          : '';
        out.push(
          `<a class="nb-page-link" data-block-id="${block.id}" data-page-id="${escapeHtml(
            pageId
          )}" data-page-title="${escapeHtml(pageTitle)}" href="#page-${encodeURIComponent(
            pageId
          )}">${icon}${escapeHtml(pageTitle)}</a>${children}`
        );
        break;
      }
      default:
        out.push(`<p data-block-id="${block.id}"${align}>${inner}${children}</p>`);
        break;
    }
  }
  return out.join('\n');
}

function blockInnerText(block: Block): string {
  let out = '';
  for (const run of block.text) out += run.text;
  return out;
}

function tableToHtml(block: Block): string {
  const table = block.props.table;
  if (!table) return `<table data-block-id="${block.id}"></table>`;
  const rows = table.rows
    .map(row => {
      const cells = table.columns
        .map(column => {
          const cell = row.cells[column.id];
          const color = column.backgroundColor ?? row.backgroundColor;
          const style = color
            ? ` style="background-color:${escapeHtml(color)}"`
            : '';
          return `<td${style}>${escapeHtml(cell?.text ?? '')}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table data-block-id="${block.id}">${rows}</table>`;
}

function databaseToHtml(data: NonNullable<Block['props']['database']>): string {
  const rows = sortedDatabaseRows(data);
  const head = data.columns
    .map(column => `<th>${escapeHtml(column.name)}</th>`)
    .join('');
  const body = rows
    .map(row => {
      const cells = data.columns
        .map(column => {
          const cell = row.cells[column.id];
          if (column.type === 'checkbox') {
            return `<td><input type="checkbox" disabled${cell?.checked ? ' checked' : ''}></td>`;
          }
          if (column.type === 'text' && cell?.runs && cell.runs.length > 0) {
            return `<td>${runsToInlineHtml(cell.runs)}</td>`;
          }
          return `<td>${escapeHtml(databaseCellDisplay(cell, column.type))}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('\n');
  return `<table class="nb-database" data-variant="${escapeHtml(data.variant)}">
<thead><tr>${head}</tr></thead>
<tbody>${body}</tbody>
</table>`;
}

export function docToHtml(doc: Doc): string {
  const title = doc.title.trim()
    ? `<h1 class="nb-doc-title">${escapeHtml(doc.title)}</h1>`
    : '';
  return `${title}\n${blocksToHtml(doc.blocks)}`;
}

export function blocksToPlainText(blocks: readonly Block[], indent = 0): string {
  const lines: string[] = [];
  const pad = '  '.repeat(indent);
  let number = 0;
  for (const block of blocks) {
    const text = blockInnerText(block);
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
        lines.push(`${pad}${block.props.checked ? '[x]' : '[ ]'} ${text}`);
        break;
      case 'quote':
        lines.push(`${pad}> ${text}`);
        break;
      case 'code':
        lines.push(`${pad}${text}`);
        break;
      case 'divider':
        lines.push(`${pad}---`);
        break;
      case 'image':
        lines.push(`${pad}[image: ${block.props.alt ?? block.props.src ?? ''}]`);
        break;
      case 'database': {
        const data = block.props.database;
        if (data) {
          lines.push(`${pad}${data.columns.map(column => column.name).join(' | ')}`);
          for (const row of sortedDatabaseRows(data)) {
            lines.push(
              `${pad}${data.columns
                .map(column =>
                  column.type === 'checkbox'
                    ? row.cells[column.id]?.checked
                      ? '[x]'
                      : '[ ]'
                    : databaseCellDisplay(row.cells[column.id], column.type)
                )
                .join(' | ')}`
            );
          }
        }
        break;
      }
      case 'table':
        for (const line of tableToTsv(block.props.table ?? { columns: [], rows: [] }).split('\n')) {
          lines.push(`${pad}${line}`);
        }
        break;
      case 'page':
        lines.push(
          `${pad}[page: ${block.props.pageTitle ?? block.props.pageId ?? 'Untitled page'}]`
        );
        break;
      default:
        if (text) lines.push(`${pad}${text}`);
        break;
    }
    if (block.children.length > 0) {
      lines.push(blocksToPlainText(block.children, indent + 1));
    }
  }
  return lines.join('\n');
}

export function headingLabel(level: HeadingLevel): string {
  return `Heading ${level}`;
}