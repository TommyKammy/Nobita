/** Every block kind the editor ships with. Hosts can extend the registry. */
export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'bulleted'
  | 'numbered'
  | 'todo'
  | 'quote'
  | 'code'
  | 'divider'
  | 'callout'
  | 'image'
  | 'database';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type CalloutTone = 'info' | 'success' | 'warning' | 'danger';

export type TextAlign = 'left' | 'center' | 'right';

export type DatabaseColumnType = 'text' | 'number' | 'select' | 'date' | 'checkbox' | 'url';

export type DatabaseVariant = 'table' | 'database';

export interface DatabaseColumn {
  id: string;
  name: string;
  type: DatabaseColumnType;
  /** Available values for a select column. */
  options?: string[];
}

export interface DatabaseCell {
  text?: string;
  checked?: boolean;
}

export interface DatabaseRow {
  id: string;
  /** Keyed by column id. Missing cells are empty. */
  cells: Record<string, DatabaseCell>;
}

export interface DatabaseSort {
  columnId: string;
  direction: 'asc' | 'desc';
}

export interface DatabaseData {
  variant: DatabaseVariant;
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
  sort?: DatabaseSort | null;
}

/**
 * Inline character formatting. Missing keys mean "off", which keeps serialized
 * documents small and diffs stable.
 */
export const PALETTE_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'grey',
] as const;

export type PaletteColor = (typeof PALETTE_COLORS)[number];
export type HighlightColor = PaletteColor;
export type TextColor = PaletteColor;

export function isHighlightColor(value: unknown): value is PaletteColor {
  return (
    typeof value === 'string' &&
    (PALETTE_COLORS as readonly string[]).includes(value)
  );
}

export const isTextColor = isHighlightColor;

export interface InlineMark {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  code?: true;
  link?: string;
  highlight?: HighlightColor;
  color?: TextColor;
}

export type MarkKey = keyof InlineMark;

/** Marks that are simple on/off toggles. */
export const BOOLEAN_MARK_KEYS = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
] as const;

export type BooleanMarkKey = (typeof BOOLEAN_MARK_KEYS)[number];

/** A run of text sharing one set of marks. */
export interface InlineRun {
  text: string;
  marks?: InlineMark;
}

export type InlineContent = InlineRun[];

export interface BlockProps {
  level?: HeadingLevel;
  checked?: boolean;
  language?: string;
  tone?: CalloutTone;
  align?: TextAlign;
  src?: string;
  alt?: string;
  caption?: string;
  collapsed?: boolean;
  database?: DatabaseData;
}

export interface Block {
  id: string;
  type: BlockType;
  /** Rich text content. Never contains "\r"; empty blocks use an empty array. */
  text: InlineRun[];
  props: BlockProps;
  children: Block[];
}

export interface Doc {
  version: 1;
  id: string;
  title: string;
  icon?: string;
  blocks: Block[];
}

/** A caret or endpoint inside one block's text. Offsets count UTF-16 units. */
export interface Point {
  blockId: string;
  offset: number;
}

export interface EditorSelection {
  anchor: Point;
  focus: Point;
}

export interface BlockLocation {
  block: Block;
  parent: Block | null;
  siblings: Block[];
  index: number;
  depth: number;
}

export type BlockPosition = 'before' | 'after' | 'child';

export interface DocChange {
  doc: Doc;
  previous: Doc;
  selection: EditorSelection | null;
  source: string;
}

export const DOC_VERSION = 1 as const;

export const isTextualBlock = (block: Block): boolean =>
  block.type !== 'divider' && block.type !== 'image' && block.type !== 'database';

export const isListBlock = (block: Block): boolean =>
  block.type === 'bulleted' || block.type === 'numbered' || block.type === 'todo';
