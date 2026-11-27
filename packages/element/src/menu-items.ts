import type { Translate } from './dictionary.js';
import {
  createDatabaseData,
  dedentBlock,
  duplicateBlockTree,
  indentBlock,
  insertBlockRelative,
  setBlockType,
  TURN_INTO_TYPES,
} from '@nobita/core';
import type {
  Block,
  BlockProps,
  BlockType,
  Doc,
  EditorSelection,
  HeadingLevel,
  Point,
  TextAlign,
} from '@nobita/core';
import { blockIcon, icon } from './icons.js';
import type { MenuItem } from './menu.js';

export interface SlashMenuContext {
  t: Translate;
  convert(type: BlockType, props?: Partial<BlockProps>): void;
  insertText(text: string): void;
  alignBlock(align: TextAlign): void;
  moveBlock(position: 'before' | 'after'): void;
  copyBlock(): void;
  linkPage?: () => void;
  createPage?: () => void;
}

export interface BlockMenuContext {
  t: Translate;
  block: Block;
  getDoc(): Doc;
  pointFromCaret(): Point;
  commit(next: Doc, caret: EditorSelection | null): void;
  focusBlock(blockId: string, offset: number): void;
  copyBlock(offset: number): void;
  copyLink(): void;
  copyMarkdown(): void;
  deleteBlock(): void;
}

export interface MultiBlockMenuContext {
  t: Translate;
  count: number;
  copyBlocks(): void;
  copyMarkdown(): void;
  duplicateBlocks(): void;
  deleteBlocks(): void;
}

function shortcutLabel(mod: boolean, key: string): string {
  return `${mod ? '⌘' : ''}${key}`;
}

function formatDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTimeValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${formatDateValue(date)} ${hours}:${minutes}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

interface SlashBlockPreset {
  type: BlockType;
  label: string;
  group: string;
  keywords: string[];
  level?: HeadingLevel;
  shortcut?: string;
  description?: string;
}

const basic = 'Basic blocks';
const slashBlocks: SlashBlockPreset[] = [
  { type: 'paragraph', label: 'Text', group: basic, keywords: ['plain', 'p'], shortcut: '⌥0' },
  ...([1, 2, 3, 4, 5, 6] as const).map(level => ({
    type: 'heading' as const, level, label: `Heading ${level}`, group: basic,
    keywords: [`h${level}`, ...(level === 1 ? ['title'] : level === 2 ? ['subtitle'] : [])],
    shortcut: `⌥${level}`,
  })),
  { type: 'bulleted', label: 'Bulleted list', group: 'Lists', keywords: ['bullet', 'ul', 'unordered'] },
  { type: 'numbered', label: 'Numbered list', group: 'Lists', keywords: ['number', 'ol', 'ordered'] },
  { type: 'todo', label: 'To-do list', group: 'Lists', keywords: ['task', 'checkbox', 'check'] },
  { type: 'quote', label: 'Quote', group: 'Blocks', keywords: ['blockquote', 'citation'] },
  { type: 'code', label: 'Code block', group: 'Blocks', keywords: ['code', 'pre', 'snippet'] },
  { type: 'divider', label: 'Divider', group: 'Blocks', keywords: ['hr', 'line', 'separator'],
    description: 'Visually separate content' },
  { type: 'callout', label: 'Callout', group: 'Blocks', keywords: ['note', 'info', 'warning'] },
];

function translateItems(items: MenuItem[], t: Translate): MenuItem[] {
  for (const item of items) {
    const label = t(item.label);
    if (label !== item.label) {
      item.englishLabel = item.label;
      item.label = label;
    }
    if (item.description && item.group !== 'Date') item.description = t(item.description);
    if (item.group) item.group = t(item.group);
  }
  return items;
}

export function buildSlashMenuItems(context: SlashMenuContext): MenuItem[] {
  const mod = /\bMac\b|\biPad\b|\biPhone\b/u.test(navigator.platform);
  const items: MenuItem[] = slashBlocks.map(({ type, level, shortcut, ...item }) => ({
    ...item,
    icon: blockIcon(type, level),
    ...(shortcut && { shortcut: shortcutLabel(mod, shortcut) }),
    action: () => context.convert(type, level ? { level } : {}),
  }));

  const align = (
    name: string,
    value: TextAlign,
    iconMarkup: string,
    shortcut: string
  ): MenuItem => ({
    label: name,
    icon: iconMarkup,
    group: 'Alignment',
    keywords: ['align', value, name.toLowerCase()],
    shortcut,
    action: () => context.alignBlock(value),
  });
  items.push(
    align('Align left', 'left', icon.alignLeft, '⇧L'),
    align('Align center', 'center', icon.alignCenter, '⇧E'),
    align('Align right', 'right', icon.alignRight, '⇧R')
  );

  const dateItem = (
    label: string,
    iconMarkup: string,
    value: () => string
  ): MenuItem => ({
    label,
    description: value(),
    icon: iconMarkup,
    group: 'Date',
    keywords: ['date', 'time', label.toLowerCase()],
    action: () => context.insertText(value()),
  });
  items.push(
    dateItem('Today', icon.calendar, () => formatDateValue(new Date())),
    dateItem('Tomorrow', icon.calendar, () => formatDateValue(addDays(new Date(), 1))),
    dateItem('Yesterday', icon.calendar, () => formatDateValue(addDays(new Date(), -1))),
    dateItem('Now', icon.clock, () => formatDateTimeValue(new Date()))
  );

  items.push(
    {
      label: 'Table',
      description: 'Simple editable table',
      icon: icon.table,
      group: 'Data',
      keywords: ['grid', 'spreadsheet', 'sheet', 'rows'],
      action: () => context.convert('table'),
    },
    {
      label: 'Database',
      description: 'Rows with typed properties',
      icon: icon.database,
      group: 'Data',
      keywords: ['properties', 'data', 'table', 'records', 'select'],
      action: () =>
        context.convert('database', {
          database: createDatabaseData({ variant: 'database' }),
        }),
    }
  );

  if (context.linkPage) {
    items.push({
      label: 'Link page',
      description: 'Insert a link to another page',
      icon: icon.page,
      group: 'Pages',
      keywords: ['page', 'link', 'link-page', 'wiki', 'reference', 'subpage', '[['],
      action: () => context.linkPage?.(),
    });
  }
  if (context.createPage) {
    items.push({
      label: 'New page',
      description: 'Create and link a new page',
      icon: icon.plus,
      group: 'Pages',
      keywords: ['page', 'new', 'new-page', 'subpage', 'create', 'doc'],
      action: () => context.createPage?.(),
    });
  }

  items.push(
    {
      label: 'Move Up',
      description: 'Move this block one position up',
      icon: icon.arrowUp,
      group: 'Actions',
      keywords: ['move', 'up', 'moveup', 'shift', 'reorder'],
      action: () => context.moveBlock('before'),
    },
    {
      label: 'Move Down',
      description: 'Move this block one position down',
      icon: icon.arrowDown,
      group: 'Actions',
      keywords: ['move', 'down', 'movedown', 'shift', 'reorder'],
      action: () => context.moveBlock('after'),
    },
    {
      label: 'Copy',
      description: 'Copy this block to the clipboard',
      icon: icon.copy,
      group: 'Actions',
      keywords: ['copy', 'clipboard', 'duplicate'],
      action: () => context.copyBlock(),
    }
  );

  return translateItems(items, context.t);
}

export function buildBlockMenuItems(context: BlockMenuContext): MenuItem[] {
  const block = context.block;
  const blockId = block.id;
  const items: MenuItem[] = [];
  for (const entry of TURN_INTO_TYPES) {
    const active =
      block.type === entry.type &&
      (entry.type !== 'heading' ||
        (block.props.level ?? 1) === (entry.level ?? 1));
    items.push({
      label: entry.label,
      icon: blockIcon(entry.type, entry.level),
      group: 'Turn into',
      ...(active ? { description: 'Current type' } : {}),
      action: () => {
        const point = context.pointFromCaret();
        const next = setBlockType(
          context.getDoc(),
          blockId,
          entry.type,
          entry.level ? { level: entry.level } : {}
        );
        context.commit(next, { anchor: point, focus: point });
      },
    });
  }

  const item = (label: string, glyph: string, action: () => void, shortcut?: string): MenuItem =>
    ({ label, icon: glyph, group: 'Actions', action, ...(shortcut && { shortcut }) });
  const changeIndent = (change: typeof indentBlock) => {
    const point = context.pointFromCaret();
    context.commit(change(context.getDoc(), blockId), { anchor: point, focus: point });
  };
  items.push(
    { ...item('Copy', icon.copy, () => context.copyBlock(context.pointFromCaret().offset)),
      description: 'Copy this block to the clipboard' },
    item('Copy link', icon.link, context.copyLink),
    item('Duplicate', icon.duplicate, () => {
      const copy = duplicateBlockTree(block);
      const next = insertBlockRelative(context.getDoc(), blockId, copy, 'after');
      const caret = { blockId: copy.id, offset: 0 };
      context.commit(next, { anchor: caret, focus: caret });
      context.focusBlock(copy.id, 0);
    }, '⌘D'),
    item('Copy as Markdown', icon.copy, context.copyMarkdown),
    item('Indent', icon.indent, () => changeIndent(indentBlock), 'Tab'),
    item('Outdent', icon.outdent, () => changeIndent(dedentBlock), '⇧Tab'),
    item('Delete', icon.trash, context.deleteBlock)
  );
  return translateItems(items, context.t);
}

export function buildMultiBlockMenuItems(context: MultiBlockMenuContext): MenuItem[] {
  const { t, count } = context;
  const group = t('Selected ({count} blocks)', count);
  const item = (label: string, glyph: string, shortcut: string, action: () => void): MenuItem =>
    ({ group, label: t(label, count), icon: glyph, shortcut, action });
  return [
    item('Copy {count} blocks', icon.copy, '⌘C', context.copyBlocks),
    { group, label: t('Copy as Markdown'), icon: icon.copy, action: context.copyMarkdown },
    item('Duplicate {count} blocks', icon.duplicate, '⌘D', context.duplicateBlocks),
    item('Delete {count} blocks', icon.trash, '⌫', context.deleteBlocks),
  ];
}
