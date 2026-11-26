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
  Point,
  TextAlign,
} from '@nobita/core';
import { blockIcon, icon } from './icons.js';
import type { MenuItem } from './menu.js';

export interface SlashMenuContext {
  convert(type: BlockType, props?: Partial<BlockProps>): void;
  insertText(text: string): void;
  alignBlock(align: TextAlign): void;
  moveBlock(position: 'before' | 'after'): void;
  copyBlock(): void;
  linkPage?: () => void;
  createPage?: () => void;
}

export interface BlockMenuContext {
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

interface SlashBlockMeta {
  group: 'Basic blocks' | 'Lists' | 'Blocks';
  keywords: string[];
  shortcut?: string;
  description?: string;
  label?: string;
}

const SLASH_BLOCK_KEYS = [
  'paragraph:',
  'heading:1',
  'heading:2',
  'heading:3',
  'heading:4',
  'heading:5',
  'heading:6',
  'bulleted:',
  'numbered:',
  'todo:',
  'quote:',
  'code:',
  'divider:',
  'callout:',
] as const;

const SLASH_BLOCK_META: Record<string, SlashBlockMeta> = {
  'paragraph:': { group: 'Basic blocks', keywords: ['plain', 'p'], shortcut: '⌥0' },
  'heading:1': { group: 'Basic blocks', keywords: ['h1', 'title'], shortcut: '⌥1' },
  'heading:2': { group: 'Basic blocks', keywords: ['h2', 'subtitle'], shortcut: '⌥2' },
  'heading:3': { group: 'Basic blocks', keywords: ['h3'], shortcut: '⌥3' },
  'heading:4': { group: 'Basic blocks', keywords: ['h4'], shortcut: '⌥4' },
  'heading:5': { group: 'Basic blocks', keywords: ['h5'], shortcut: '⌥5' },
  'heading:6': { group: 'Basic blocks', keywords: ['h6'], shortcut: '⌥6' },
  'bulleted:': {
    group: 'Lists',
    keywords: ['bullet', 'ul', 'unordered'],
    label: 'Bulleted list',
  },
  'numbered:': {
    group: 'Lists',
    keywords: ['number', 'ol', 'ordered'],
    label: 'Numbered list',
  },
  'todo:': {
    group: 'Lists',
    keywords: ['task', 'checkbox', 'check'],
    label: 'To-do list',
  },
  'quote:': { group: 'Blocks', keywords: ['blockquote', 'citation'] },
  'code:': {
    group: 'Blocks',
    keywords: ['code', 'pre', 'snippet'],
    label: 'Code block',
  },
  'divider:': {
    group: 'Blocks',
    keywords: ['hr', 'line', 'separator'],
    description: 'Visually separate content',
  },
  'callout:': { group: 'Blocks', keywords: ['note', 'info', 'warning'] },
};

const TURN_INTO_BY_KEY = new Map(
  TURN_INTO_TYPES.map(entry => [`${entry.type}:${entry.level ?? ''}`, entry])
);

export function buildSlashMenuItems(context: SlashMenuContext): MenuItem[] {
  const mod = /\bMac\b|\biPad\b|\biPhone\b/u.test(navigator.platform);
  const items: MenuItem[] = [];
  for (const key of SLASH_BLOCK_KEYS) {
    const entry = TURN_INTO_BY_KEY.get(key);
    const meta = SLASH_BLOCK_META[key];
    if (!entry || !meta) continue;
    items.push({
      id:
        entry.type === 'divider'
          ? 'divider'
          : `${entry.type}-${entry.level ?? ''}`,
      label: meta.label ?? entry.label,
      icon: blockIcon(entry.type, entry.level),
      group: meta.group,
      keywords: meta.keywords,
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.shortcut
        ? { shortcut: shortcutLabel(mod, meta.shortcut) }
        : {}),
      action: () =>
        context.convert(
          entry.type,
          entry.level ? { level: entry.level } : {}
        ),
    });
  }

  const align = (
    name: string,
    value: TextAlign,
    iconMarkup: string,
    shortcut: string
  ): MenuItem => ({
    id: `align-${value}`,
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
    id: string,
    label: string,
    description: string,
    iconMarkup: string,
    value: () => string
  ): MenuItem => ({
    id,
    label,
    description,
    icon: iconMarkup,
    group: 'Date',
    keywords: ['date', 'time', label.toLowerCase()],
    action: () => context.insertText(value()),
  });
  items.push(
    dateItem('today', 'Today', formatDateValue(new Date()), icon.calendar, () => formatDateValue(new Date())),
    dateItem(
      'tomorrow',
      'Tomorrow',
      formatDateValue(addDays(new Date(), 1)),
      icon.calendar,
      () => formatDateValue(addDays(new Date(), 1))
    ),
    dateItem(
      'yesterday',
      'Yesterday',
      formatDateValue(addDays(new Date(), -1)),
      icon.calendar,
      () => formatDateValue(addDays(new Date(), -1))
    ),
    dateItem('now', 'Now', formatDateTimeValue(new Date()), icon.clock, () =>
      formatDateTimeValue(new Date())
    )
  );

  items.push(
    {
      id: 'table',
      label: 'Table',
      description: 'Simple editable table',
      icon: icon.table,
      group: 'Data',
      keywords: ['grid', 'spreadsheet', 'sheet', 'rows'],
      action: () => context.convert('table'),
    },
    {
      id: 'database',
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
      id: 'link-page',
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
      id: 'new-page',
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
      id: 'move-up',
      label: 'Move Up',
      description: 'Move this block one position up',
      icon: icon.arrowUp,
      group: 'Actions',
      keywords: ['move', 'up', 'moveup', 'shift', 'reorder'],
      action: () => context.moveBlock('before'),
    },
    {
      id: 'move-down',
      label: 'Move Down',
      description: 'Move this block one position down',
      icon: icon.arrowDown,
      group: 'Actions',
      keywords: ['move', 'down', 'movedown', 'shift', 'reorder'],
      action: () => context.moveBlock('after'),
    },
    {
      id: 'copy',
      label: 'Copy',
      description: 'Copy this block to the clipboard',
      icon: icon.copy,
      group: 'Actions',
      keywords: ['copy', 'clipboard', 'duplicate'],
      action: () => context.copyBlock(),
    }
  );

  return items;
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
      id: `turn-${entry.type}-${entry.level ?? ''}`,
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

  items.push(
    {
      id: 'copy',
      label: 'Copy',
      description: 'Copy this block to the clipboard',
      icon: icon.copy,
      group: 'Actions',
      action: () => context.copyBlock(context.pointFromCaret().offset),
    },
    {
      id: 'copy-link',
      label: 'Copy link',
      description: 'Copy a link to this block',
      icon: icon.link,
      group: 'Actions',
      action: () => context.copyLink(),
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: icon.duplicate,
      group: 'Actions',
      shortcut: '⌘D',
      action: () => {
        const copy = duplicateBlockTree(block);
        const next = insertBlockRelative(
          context.getDoc(),
          blockId,
          copy,
          'after'
        );
        const caret: Point = { blockId: copy.id, offset: 0 };
        context.commit(next, { anchor: caret, focus: caret });
        context.focusBlock(copy.id, 0);
      },
    },
    {
      id: 'copy-markdown',
      label: 'Copy as Markdown',
      icon: icon.copy,
      group: 'Actions',
      action: () => context.copyMarkdown(),
    },
    {
      id: 'indent',
      label: 'Indent',
      icon: icon.indent,
      group: 'Actions',
      shortcut: 'Tab',
      action: () => {
        const point = context.pointFromCaret();
        context.commit(indentBlock(context.getDoc(), blockId), {
          anchor: point,
          focus: point,
        });
      },
    },
    {
      id: 'dedent',
      label: 'Outdent',
      icon: icon.outdent,
      group: 'Actions',
      shortcut: '⇧Tab',
      action: () => {
        const point = context.pointFromCaret();
        context.commit(dedentBlock(context.getDoc(), blockId), {
          anchor: point,
          focus: point,
        });
      },
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: icon.trash,
      group: 'Actions',
      action: () => context.deleteBlock(),
    }
  );
  return items;
}

export function buildMultiBlockMenuItems(context: MultiBlockMenuContext): MenuItem[] {
  const label = `${context.count} blocks`;
  return [
    {
      id: 'multi-copy',
      label: `Copy ${label}`,
      icon: icon.copy,
      group: `Selected (${label})`,
      shortcut: '⌘C',
      action: () => context.copyBlocks(),
    },
    {
      id: 'multi-copy-md',
      label: 'Copy as Markdown',
      icon: icon.copy,
      group: `Selected (${label})`,
      action: () => context.copyMarkdown(),
    },
    {
      id: 'multi-duplicate',
      label: `Duplicate ${label}`,
      icon: icon.duplicate,
      group: `Selected (${label})`,
      shortcut: '⌘D',
      action: () => context.duplicateBlocks(),
    },
    {
      id: 'multi-delete',
      label: `Delete ${label}`,
      icon: icon.trash,
      group: `Selected (${label})`,
      shortcut: '⌫',
      action: () => context.deleteBlocks(),
    },
  ];
}
