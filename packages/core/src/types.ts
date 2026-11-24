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
  | 'database'
  | 'table'
  | 'page';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type CalloutTone = 'info' | 'success' | 'warning' | 'danger';

export type TextAlign = 'left' | 'center' | 'right';

export type DatabaseColumnType =
  | 'text'
  | 'number'
  | 'select'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'multi-select'
  | 'files'
  | 'people';

/** Legacy schema variant. New simple tables use the separate `table` block. */
export type DatabaseVariant = 'table' | 'database';

export interface TableCell {
  text: string;
}

export interface TableRow {
  id: string;
  backgroundColor?: string;
  cells: Record<string, TableCell>;
}

export interface TableColumn {
  id: string;
  width?: number;
  backgroundColor?: string;
}

export interface TableData {
  columns: TableColumn[];
  rows: TableRow[];
}

export interface DatabaseColumn {
  id: string;
  name: string;
  type: DatabaseColumnType;
  /** Available values for a select or multi-select column. */
  options?: string[];
  /** Persisted table width in CSS pixels. */
  width?: number;
}

export interface DatabaseFile {
  id?: string;
  name: string;
  url: string;
  mime?: string;
  size?: number;
}

export interface DatabasePerson {
  id: string;
  label: string;
  avatarUrl?: string;
}

export interface DatabaseCell {
  text?: string;
  checked?: boolean;
  /** Values for a multi-select column. */
  values?: string[];
  /** File references for a files column. */
  files?: DatabaseFile[];
  /** Person references for a people column. */
  people?: DatabasePerson[];
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

export type DatabaseStatType =
  | 'count'
  | 'countValues'
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max';

export type DatabaseViewType = 'table' | 'board';

export type DatabaseFilterOperator =
  | 'contains'
  | 'doesNotContain'
  | 'startsWith'
  | 'endsWith'
  | 'is'
  | 'isNot'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'equal'
  | 'notEqual'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'before'
  | 'after'
  | 'isChecked'
  | 'isUnchecked'
  | 'isAnyOf'
  | 'isNoneOf'
  | 'containsAny'
  | 'containsAll'
  | 'doesNotContainAny'
  | 'doesNotContainAll';

export interface DatabaseFilter {
  columnId: string;
  operator: DatabaseFilterOperator;
  value?: string;
}

export interface DatabaseView {
  id?: string;
  name?: string;
  type: DatabaseViewType;
  filters: DatabaseFilter[];
  filterMode?: 'and' | 'or';
  groupBy?: string | null;
  /** Multiple sort keys. `sort` is the legacy single-key form. */
  sorts?: DatabaseSort[];
  sort?: DatabaseSort | null;
  hiddenColumns?: string[];
  stats?: Record<string, DatabaseStatType>;
}

export interface DatabaseData {
  variant: DatabaseVariant;
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
  /** Legacy global sort retained for older documents. */
  sort?: DatabaseSort | null;
  /** Saved table or board view. Omitted documents use a computed default. */
  view?: DatabaseView | null;
  /** Named views. When present this supersedes the legacy single `view`. */
  views?: DatabaseView[];
  activeViewId?: string;
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

export interface MentionRef {
  id: string;
  label: string;
  kind?: string;
}

export interface InlineMark {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  code?: true;
  link?: string;
  highlight?: HighlightColor;
  color?: TextColor;
  mention?: MentionRef;
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
  table?: TableData;
  pageId?: string;
  pageTitle?: string;
  pageIcon?: string;
}

export interface Block {
  id: string;
  type: BlockType;
  /** Rich text content. Never contains "\r"; empty blocks use an empty array. */
  text: InlineRun[];
  props: BlockProps;
  children: Block[];
}

export interface PageInfo {
  id: string;
  title: string;
  icon?: string;
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
  block.type !== 'divider' &&
  block.type !== 'image' &&
  block.type !== 'database' &&
  block.type !== 'table' &&
  block.type !== 'page';

export const isListBlock = (block: Block): boolean =>
  block.type === 'bulleted' || block.type === 'numbered' || block.type === 'todo';
