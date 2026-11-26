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
  | 'progress'
  | 'select'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'image'
  | 'multi-select'
  | 'files'
  | 'people'
  | 'relation'
  | 'formula';

/** Legacy schema variant. New simple tables use the separate `table` block. */
export type DatabaseVariant = 'table' | 'database';

export interface TableCell {
  colspan?: number;
  rowspan?: number;
  text: string;
  /** Rich-text runs; `text` remains the plain projection. */
  runs?: InlineRun[];
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

export interface DatabaseRelationConfig {
  databaseId: string;
  pageId?: string;
  limit?: 1;
  syncedColumnId?: string;
}

export interface DatabaseFormulaConfig {
  expression: string;
  format?: {
    numberFormat?: 'number' | 'percent' | 'currency';
    decimals?: number;
    currency?: string;
  };
}

export interface DatabaseRelationRef {
  rowId: string;
  label?: string;
}
export interface DatabaseTarget {
  databaseId: string;
  title: string;
  pageId?: string;
}
export type DatabaseResolver = (
  id: string,
  pageId?: string
) => DatabaseData | null | undefined;

export interface DatabaseColumn {
  relation?: DatabaseRelationConfig;
  formula?: DatabaseFormulaConfig;
  id: string;
  name: string;
  type: DatabaseColumnType;
  /** Available values for a select or multi-select column. */
  options?: string[];
  /** Optional per-type settings such as number format and decimals. */
  data?: Record<string, unknown>;
  /** Persisted table width in CSS pixels (legacy, view columns take precedence). */
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
  relations?: DatabaseRelationRef[];
  text?: string;
  /** Rich-text runs for text columns; `text` remains the plain projection. */
  runs?: InlineRun[];
  checked?: boolean;
  /** Values for a multi-select column. */
  values?: string[];
  /** File references for a files column. */
  files?: DatabaseFile[];
  /** Person references for a people column. */
  people?: DatabasePerson[];
}

export interface DatabaseRowPage {
  /** Rich-text body shown in the row detail page. */
  content: InlineRun[];
}

export interface DatabaseRow {
  id: string;
  /** Keyed by column id. Missing cells are empty. */
  cells: Record<string, DatabaseCell>;
  /** Optional rich-text page body for the row detail view. */
  page?: DatabaseRowPage;
}

export interface DatabaseSort {
  columnId: string;
  direction: 'asc' | 'desc';
}

export type DatabaseStatType =
  | 'count'
  | 'countValues'
  | 'countUnique'
  | 'countEmpty'
  | 'countNotEmpty'
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'range';

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
  type?: 'filter';
  columnId: string;
  operator: DatabaseFilterOperator;
  value?: string;
}

export interface DatabaseFilterGroup {
  type: 'group';
  op: 'and' | 'or';
  conditions: DatabaseFilterNode[];
}

export type DatabaseFilterNode = DatabaseFilter | DatabaseFilterGroup;

export interface DatabaseViewColumn {
  id: string;
  width?: number;
  hide?: boolean;
  stat?: DatabaseStatType;
}

export interface DatabaseGroupProperty {
  key: string;
  hide?: boolean;
  collapsed?: boolean;
  /** Manual row order inside this group (used when the view has no sort). */
  manuallyCardSort?: string[];
}

export interface DatabaseView {
  id?: string;
  name?: string;
  type: DatabaseViewType;
  filters: DatabaseFilter[];
  filterMode?: 'and' | 'or';
  /** Nested AND/OR filter tree. Takes precedence over legacy filters. */
  filter?: DatabaseFilterGroup;
  groupBy?: string | null;
  /** Group order, visibility and collapsed state. */
  groupProperties?: DatabaseGroupProperty[];
  /** Hide groups with no rows. */
  hideEmptyGroups?: boolean;
  /** Multiple sort keys. `sort` is the legacy single-key form. */
  sorts?: DatabaseSort[];
  sort?: DatabaseSort | null;
  /** Ordered view columns with per-view width/visibility/statistics. */
  columns?: DatabaseViewColumn[];
  hiddenColumns?: string[];
  stats?: Record<string, DatabaseStatType>;
  header?: {
    titleColumnId?: string;
    iconColumnId?: string;
  };
  /** Optional image column displayed as board card covers. */
  coverColumnId?: string | null;
}

export interface DatabaseData {
  variant: DatabaseVariant;
  /** Optional database title displayed by the data view. */
  title?: string;
  /** The column used as the record title. Defaults to the first column. */
  titleColumnId?: string;
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
  page?: PageInfo;
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
  previousSelection?: EditorSelection | null;
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
