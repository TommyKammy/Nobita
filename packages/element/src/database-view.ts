import {
  applyMarkPatch,
  cloneRuns,
  createDatabaseColumn,
  createDatabaseRow,
  createId,
  DATABASE_STAT_LABELS,
  DATABASE_STAT_TYPES,
  MAX_DATABASE_COLUMN_WIDTH,
  MIN_DATABASE_COLUMN_WIDTH,
  createDatabaseView,
  databaseCellDisplay,
  databaseCellText,
  databaseFilterGroup,
  databaseSorts,
  databaseStatValue,
  databaseTitleColumn,
  databaseView,
  databaseViewColumnStates,
  databaseViews,
  databaseVisibleColumns,
  deleteTextRange,
  filteredDatabaseRows,
  groupedDatabaseRows,
  insertTextAt,
  markStateInRange,
  marksAt,
  normalizeMark,
  normalizeRuns,
  parseInlineRuns,
  plainText,
  runsLength,
  safeHref,
  searchDatabaseRows,
  toggleMarkInRange,
} from '@nobita/core';
import type {
  BooleanMarkKey,
  DatabaseCell,
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseData,
  DatabaseFilter,
  DatabaseFilterGroup,
  DatabaseFilterOperator,
  DatabaseFile,
  DatabaseGroupProperty,
  DatabasePerson,
  DatabaseRow,
  DatabaseStatType,
  DatabaseView as DatabaseViewConfig,
  DatabaseViewColumn,
  InlineMark,
  InlineRun,
  MarkPatch,
} from '@nobita/core';
import { nativeSelection, placeCaret } from './dom.js';
import { dismissFloating, placeFloating } from './floating.js';
import { icon } from './icons.js';
import {
  domPointToRunsOffset,
  readRunsFromDom,
  renderInlineRuns,
  runsOffsetToDomPoint,
} from './inline-dom.js';
import { parseTsv, tsvCell } from './tsv.js';

export interface DatabaseHost {
  readonly readonly: boolean;
  commit(data: DatabaseData, options?: { mergeKey?: string }): void;
  undo(): void;
  redo(): void;
  focusAfter(): void;
}

type CellKind = 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'multi-select' | 'files' | 'people';

interface CellNodes {
  td: HTMLTableCellElement;
  text?: HTMLElement;
  input?: HTMLInputElement;
  button?: HTMLButtonElement;
}

const COLUMN_TYPES: readonly { type: DatabaseColumnType; label: string }[] = [
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'select', label: 'Select' },
  { type: 'multi-select', label: 'Multi-select' },
  { type: 'date', label: 'Date' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'url', label: 'URL' },
  { type: 'files', label: 'Files' },
  { type: 'people', label: 'People' },
];

const TYPE_ICON: Record<DatabaseColumnType, string> = {
  text: icon.text,
  number: icon.hash,
  select: icon.tag,
  'multi-select': icon.tag,
  date: icon.calendar,
  checkbox: icon.checkboxSquare,
  url: icon.link,
  files: icon.file,
  people: icon.user,
};

const FILTER_LABELS: Record<DatabaseFilterOperator, string> = {
  contains: 'contains',
  doesNotContain: 'does not contain',
  startsWith: 'starts with',
  endsWith: 'ends with',
  is: 'is',
  isNot: 'is not',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  equal: 'equals',
  notEqual: 'does not equal',
  greaterThan: 'greater than',
  lessThan: 'less than',
  greaterThanOrEqual: 'greater than or equal',
  lessThanOrEqual: 'less than or equal',
  before: 'before',
  after: 'after',
  isChecked: 'is checked',
  isUnchecked: 'is not checked',
  isAnyOf: 'is any of',
  isNoneOf: 'is none of',
  containsAny: 'contains any of',
  containsAll: 'contains all of',
  doesNotContainAny: 'does not contain any of',
  doesNotContainAll: 'does not contain all of',
};

function filterOperators(type: DatabaseColumnType): DatabaseFilterOperator[] {
  const empty: DatabaseFilterOperator[] = ['isEmpty', 'isNotEmpty'];
  if (type === 'checkbox') return ['isChecked', 'isUnchecked', 'is', 'isNot'];
  if (type === 'number') {
    return [
      'equal',
      'notEqual',
      'greaterThan',
      'lessThan',
      'greaterThanOrEqual',
      'lessThanOrEqual',
      ...empty,
    ];
  }
  if (type === 'date') return ['before', 'after', 'is', 'isNot', ...empty];
  if (type === 'select') return ['is', 'isNot', 'isAnyOf', 'isNoneOf', ...empty];
  if (type === 'multi-select') {
    return ['containsAny', 'containsAll', 'doesNotContainAny', 'doesNotContainAll', ...empty];
  }
  if (type === 'files' || type === 'people') return empty;
  return ['contains', 'doesNotContain', 'startsWith', 'endsWith', 'is', 'isNot', ...empty];
}

function defaultFilterOperator(type: DatabaseColumnType): DatabaseFilterOperator {
  return filterOperators(type)[0] ?? 'is';
}

const NUMBER_FORMATTERS = new Map<string, Intl.NumberFormat>();

function getNumberFormatter(
  format: string,
  decimals: number | undefined,
  currency: string
): Intl.NumberFormat {
  const normalizedFormat =
    format === 'percent' || format === 'currency' ? format : 'decimal';
  const key = `${normalizedFormat}|${decimals ?? ''}|${
    normalizedFormat === 'currency' ? currency : ''
  }`;
  let formatter = NUMBER_FORMATTERS.get(key);
  if (formatter) return formatter;
  const fraction =
    decimals === undefined
      ? {}
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  if (normalizedFormat === 'percent') {
    formatter = new Intl.NumberFormat(undefined, {
      style: 'percent',
      useGrouping: false,
      ...fraction,
    });
  } else if (normalizedFormat === 'currency') {
    formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      ...fraction,
    });
  } else {
    formatter = new Intl.NumberFormat(undefined, {
      style: 'decimal',
      useGrouping: false,
      ...(decimals === undefined ? { maximumFractionDigits: 0 } : fraction),
    });
  }
  NUMBER_FORMATTERS.set(key, formatter);
  return formatter;
}

function formatDatabaseNumber(value: string, column: DatabaseColumn): string {
  if (!value) return '';
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return value;
  const decimalValue =
    typeof column.data?.decimal === 'number' ? column.data.decimal : undefined;
  const decimals =
    decimalValue === undefined
      ? undefined
      : Math.max(0, Math.min(6, Math.round(decimalValue)));
  const format = typeof column.data?.format === 'string' ? column.data.format : 'number';
  const currency =
    format === 'currency'
      ? typeof column.data?.currency === 'string'
        ? column.data.currency
        : 'USD'
      : '';
  try {
    return getNumberFormatter(format, decimals, currency).format(number);
  } catch {
    return number.toFixed(decimals ?? 0);
  }
}

const cellKey = (rowId: string, columnId: string): string => `${rowId}\u0000${columnId}`;
const DATABASE_ROWS_MIME = 'application/x-nobita-database-rows';

function detailFieldSchema(column: DatabaseColumn): string {
  return `${column.type}\u0000${(column.options ?? []).join('\u0001')}`;
}

function titleTextEditable(column: DatabaseColumn | undefined): boolean {
  return Boolean(
    column && ['text', 'number', 'date', 'url'].includes(column.type)
  );
}

/** Merge a reordered visible sequence into a saved order without dropping hidden entries. */
function mergeOrder(
  saved: readonly string[],
  visible: readonly string[]
): string[] {
  const visibleSet = new Set(visible);
  const order: string[] = [];
  let visibleIndex = 0;
  for (const id of saved) {
    if (visibleSet.has(id)) {
      const next = visible[visibleIndex];
      if (next !== undefined) {
        order.push(next);
        visibleIndex += 1;
      }
    } else if (!order.includes(id)) {
      order.push(id);
    }
  }
  while (visibleIndex < visible.length) {
    const next = visible[visibleIndex];
    if (next !== undefined) order.push(next);
    visibleIndex += 1;
  }
  return order;
}

/** Materialize saved group settings in visible order, keeping omitted groups. */
function seedGroupSettings(
  saved: readonly DatabaseGroupProperty[],
  visibleKeys: readonly string[]
): DatabaseGroupProperty[] {
  const keys = [...visibleKeys];
  for (const setting of saved) {
    if (!keys.includes(setting.key)) keys.push(setting.key);
  }
  const byKey = new Map(saved.map(setting => [setting.key, setting]));
  return keys.map(key => {
    const setting = byKey.get(key);
    return setting
      ? {
          ...setting,
          ...(setting.manuallyCardSort
            ? { manuallyCardSort: [...setting.manuallyCardSort] }
            : {}),
        }
      : { key };
  });
}


const TAG_TO_MARK: Record<string, BooleanMarkKey> = {
  strong: 'bold',
  em: 'italic',
  u: 'underline',
  s: 'strike',
  code: 'code',
};

function selectionOffsets(
  element: HTMLElement
): { start: number; end: number } | null {
  const selection = nativeSelection(element.getRootNode() as ShadowRoot);
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (
    !element.contains(range.startContainer) ||
    !element.contains(range.endContainer)
  ) {
    return null;
  }
  const start = domPointToRunsOffset(element, range.startContainer, range.startOffset);
  const end = domPointToRunsOffset(element, range.endContainer, range.endOffset);
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function setSelectionOffsets(
  element: HTMLElement,
  start: number,
  end: number
): void {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const startPoint = runsOffsetToDomPoint(element, from);
  const endPoint = runsOffsetToDomPoint(element, to);
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  const selection = nativeSelection(element.getRootNode() as ShadowRoot);
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function caretAtBoundary(element: HTMLElement, side: 'start' | 'end'): boolean {
  const root = element.getRootNode() as ShadowRoot;
  const selection = nativeSelection(root);
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return false;
  const offset = domPointToRunsOffset(element, range.startContainer, range.startOffset);
  if (side === 'start') return offset === 0;
  return offset >= domPointToRunsOffset(element, element, element.childNodes.length);
}

export class DatabaseView {
  readonly element: HTMLElement;

  #host: DatabaseHost;
  #data: DatabaseData;
  #readonly: boolean;
  #structureKey = '';
  #events = new AbortController();
  #contentEvents = new AbortController();
  #scrollElement: HTMLElement | null = null;
  #cells = new Map<string, CellNodes[]>();
  #titleInput: HTMLInputElement | null = null;
  #active: { rowId: string; columnId: string; groupKey?: string } | null = null;
  #pendingFocus: { rowId: string; columnId: string; at: 'start' | 'end' } | null = null;
  #pendingBoardFocus: string | null = null;
  #popoverCleanup: (() => void) | null = null;
  #countElement: HTMLElement | null = null;
  #colElements: HTMLTableColElement[] = [];
  #range: {
    startRowId: string;
    startColumnId: string;
    endRowId: string;
    endColumnId: string;
    groupKey?: string;
  } | null = null;
  #rangeCells = new Set<string>();
  #selectedTds = new Set<HTMLTableCellElement>();
  #activeTds = new Set<HTMLTableCellElement>();
  #selectedRows = new Set<string>();
  #groupOverrides = new Map<string, { hide?: boolean; collapsed?: boolean }>();
  #groupOverrideVersion = 0;
  #readonlyActiveViewId: string | null = null;
  #syncedData: DatabaseData | null = null;
  #queryCache: {
    data: DatabaseData;
    searchQuery: string;
    readonly: boolean;
    readonlyActiveViewId: string | null;
    overrideVersion: number;
    views: (DatabaseViewConfig & { id: string; name: string })[];
    activeView: DatabaseViewConfig & { id: string; name: string };
    rowsByViewId: Map<string, DatabaseRow[]>;
    groupsByViewId: Map<string, ReturnType<typeof groupedDatabaseRows>>;
    statesByViewId: Map<string, ReturnType<typeof databaseViewColumnStates>>;
  } | null = null;
  #filterBarOpen = new Set<string>();
  #dragSelect: {
    anchorRowId: string;
    anchorColumnId: string;
    groupKey?: string;
    moved: boolean;
  } | null = null;
  #fillHandle: HTMLElement | null = null;
  #fillHandleRaf: number | null = null;
  #detail: HTMLElement | null = null;
  #detailRowId: string | null = null;
  #detailTrigger: HTMLElement | null = null;
  #detailEvents = new AbortController();
  #visibleKey = '';
  #boardTitleEditing: { rowId: string; columnId: string } | null = null;
  #suppressClick = false;
  #boardBlurTimer: number | null = null;
  #instanceId = createId('db');
  #searchQuery = '';
  #searchOpen = false;
  #cellToolbar: HTMLElement | null = null;
  #pendingMarks: { target: HTMLElement; offset: number; marks: InlineMark } | null = null;
  #composingTargets = new WeakSet<HTMLElement>();
  #globalEvents = new AbortController();
  #onDocumentSelectionChange = (): void => {
    if (this.#pendingMarks) {
      const offsets = selectionOffsets(this.#pendingMarks.target);
      if (
        !offsets ||
        offsets.start !== offsets.end ||
        offsets.start !== this.#pendingMarks.offset
      ) {
        this.#pendingMarks = null;
      }
    }
    this.#syncCellToolbar();
  };
  #hideCellToolbar = (): void => {
    if (this.#cellToolbar) this.#cellToolbar.hidden = true;
  };
  #narrowSearchMedia: MediaQueryList | null = null;
  #onNarrowSearchMedia = (event: MediaQueryListEvent): void => {
    if (!event.matches) return;
    this.#searchOpen = false;
    const wrap = this.element.querySelector<HTMLElement>('.nb-db-search-wrap');
    if (wrap) {
      wrap.dataset.open = 'false';
      wrap
        .querySelector<HTMLElement>('.nb-db-search-toggle')
        ?.setAttribute('aria-expanded', 'false');
    }
    const input = this.element.querySelector<HTMLInputElement>('.nb-db-search');
    if (input) input.value = '';
    if (!this.#searchQuery) return;
    this.#searchQuery = '';
    this.#renderContent();
  };

  constructor(host: DatabaseHost, data: DatabaseData) {
    this.#host = host;
    this.#data = data;
    this.#readonly = host.readonly;
    this.element = document.createElement('div');
    this.element.className = 'nb-db';
    this.element.contentEditable = 'false';
    this.element.tabIndex = -1;
    this.element.dataset.readonly = String(this.#readonly);
    this.element.addEventListener('copy', this.#onCopy, true);
    this.element.addEventListener('cut', this.#onCut, true);
    this.element.addEventListener('paste', this.#onPaste, true);
    this.element.addEventListener('click', this.#onClickCapture, true);
    this.element.addEventListener('keydown', this.#onDatabaseKeyDown, true);
    const view = this.element.ownerDocument.defaultView;
    this.#narrowSearchMedia = view?.matchMedia('(max-width: 560px)') ?? null;
    this.#narrowSearchMedia?.addEventListener('change', this.#onNarrowSearchMedia);
    const doc = this.element.ownerDocument;
    doc.addEventListener('selectionchange', this.#onDocumentSelectionChange, {
      signal: this.#globalEvents.signal,
    });
    view?.addEventListener('scroll', this.#hideCellToolbar, {
      capture: true,
      passive: true,
      signal: this.#globalEvents.signal,
    });
    this.render();
  }

  update(data: DatabaseData): void {
    if (data === this.#data) return;
    this.#data = data;
    const view = databaseView(data);
    if (
      this.#boardTitleEditing &&
      view.type === 'board' &&
      view.groupBy === this.#boardTitleEditing.columnId
    ) {
      this.#updateCount(view);
      return;
    }
    const nextKey = this.#keyFor(data);
    const visibleKey = this.#visibleKeyFor(data);
    if (nextKey !== this.#structureKey || visibleKey !== this.#visibleKey) {
      this.render();
    } else {
      this.#syncValues();
    }
  }

  setReadonly(readonly: boolean): void {
    if (readonly === this.#readonly) return;
    this.#readonly = readonly;
    if (!readonly) {
      this.#readonlyActiveViewId = null;
      if (this.#groupOverrides.size > 0) {
        this.#groupOverrides.clear();
        this.#groupOverrideVersion += 1;
      }
    }
    if (readonly) this.#closeDetailPanel({ restoreFocus: false });
    this.element.dataset.readonly = String(readonly);
    this.render();
  }

  focusFirstCell(): void {
    const rows = this.#rowsFor(this.#activeView());
    const row = rows[0];
    const column = this.#visibleColumns(this.#activeView())[0];
    if (!row || !column) {
      if (this.#data.columns.length === 0) this.#addColumn();
      else this.#addRow();
      return;
    }
    this.focusCell(row.id, column.id, 'start');
  }

  focusCell(rowId: string, columnId: string, at: 'start' | 'end' = 'end'): void {
    const nodes = this.#cells.get(cellKey(rowId, columnId))?.[0];
    if (!nodes) return;
    const target = nodes.text ?? nodes.input ?? nodes.button;
    if (!target) return;
    target.focus();
    if (nodes.text) placeCaret(nodes.text, at);
    const groupKey = nodes.td.closest<HTMLElement>('.nb-db-group')?.dataset.group;
    this.#active = {
      rowId,
      columnId,
      ...(groupKey !== undefined ? { groupKey } : {}),
    };
    this.#syncSelectionVisuals();
  }

  destroy(): void {
    if (this.#boardBlurTimer !== null) {
      window.clearTimeout(this.#boardBlurTimer);
      this.#boardBlurTimer = null;
    }
    this.#cancelFillHandleFrame();
    this.#contentEvents.abort();
    this.#events.abort();
    this.#globalEvents.abort();
    this.#narrowSearchMedia?.removeEventListener('change', this.#onNarrowSearchMedia);
    this.#narrowSearchMedia = null;
    this.#filterBarOpen.clear();
    this.#selectedTds.clear();
    this.#activeTds.clear();
    this.#syncedData = null;
    this.#queryCache = null;
    this.#scrollElement = null;
    this.#cellToolbar = null;
    this.#pendingMarks = null;
    this.#closePopover();
    this.#closeDetailPanel({ restoreFocus: false });
    this.element.remove();
  }

  /** ---- rendering ---- */

  #ensureQueryCache() {
    const readonlyActiveViewId = this.#readonly ? this.#readonlyActiveViewId : null;
    if (
      this.#queryCache &&
      this.#queryCache.data === this.#data &&
      this.#queryCache.searchQuery === this.#searchQuery &&
      this.#queryCache.readonly === this.#readonly &&
      this.#queryCache.readonlyActiveViewId === readonlyActiveViewId &&
      this.#queryCache.overrideVersion === this.#groupOverrideVersion
    ) {
      return this.#queryCache;
    }
    const views = databaseViews(this.#data).map((view, index) => ({
      ...view,
      id: view.id ?? (index === 0 ? 'view-default' : `view-${index}`),
      name: view.name ?? (view.type === 'board' ? 'Board' : 'Table'),
      filters: view.filters ?? [],
    }));
    const activeView =
      (readonlyActiveViewId !== null
        ? views.find(view => view.id === readonlyActiveViewId)
        : undefined) ??
      views.find(view => view.id === this.#data.activeViewId) ??
      views[0]!;
    this.#queryCache = {
      data: this.#data,
      searchQuery: this.#searchQuery,
      readonly: this.#readonly,
      readonlyActiveViewId,
      overrideVersion: this.#groupOverrideVersion,
      views,
      activeView,
      rowsByViewId: new Map(),
      groupsByViewId: new Map(),
      statesByViewId: new Map(),
    };
    return this.#queryCache;
  }

  #views(): (DatabaseViewConfig & { id: string; name: string })[] {
    return this.#ensureQueryCache().views;
  }

  #activeView(): DatabaseViewConfig & { id: string; name: string } {
    return this.#ensureQueryCache().activeView;
  }

  #updateActiveView(patch: Partial<DatabaseViewConfig>): void {
    const active = this.#activeView();
    const views = this.#views().map(view =>
      view.id === active.id
        ? { ...view, ...patch, id: active.id, name: patch.name ?? view.name }
        : view
    );
    const { view: _legacyView, sort: _legacySort, ...rest } = this.#data;
    this.#host.commit({
      ...rest,
      views,
      activeViewId: active.id,
    });
  }

  #setActiveView(id: string): void {
    if (id === this.#activeView().id) return;
    if (this.#readonly) {
      this.#readonlyActiveViewId = id;
      this.render();
      return;
    }
    const { view: _legacyView, sort: _legacySort, ...rest } = this.#data;
    this.#host.commit({ ...rest, views: this.#views(), activeViewId: id });
  }

  #viewColumns(view: DatabaseViewConfig = this.#activeView()): DatabaseViewColumn[] {
    return this.#columnStates(view).map(item => {
      const column: DatabaseViewColumn = { id: item.column.id, width: item.width };
      if (item.hide) column.hide = true;
      if (item.stat) column.stat = item.stat;
      return column;
    });
  }

  #viewsWithColumn(
    columnId: string,
    anchorId: string | null,
    after: boolean,
    width = 180,
    copyFromId?: string
  ): DatabaseViewConfig[] {
    return this.#views().map(view => {
      const columns = this.#viewColumns(view);
      if (columns.some(column => column.id === columnId)) return view;
      let index = anchorId
        ? columns.findIndex(column => column.id === anchorId)
        : columns.length;
      if (index < 0) index = columns.length;
      else if (after) index += 1;
      const template = copyFromId
        ? columns.find(column => column.id === copyFromId)
        : undefined;
      columns.splice(index, 0, {
        ...(template ?? { id: columnId, width }),
        id: columnId,
      });
      return { ...view, columns };
    });
  }

  #patchViewColumn(
    columnId: string,
    patch: Partial<DatabaseViewColumn>,
    options: { move?: number } = {}
  ): void {
    const view = this.#activeView();
    const columns = this.#viewColumns(view);
    const index = columns.findIndex(column => column.id === columnId);
    if (index < 0) return;
    const current = columns[index];
    if (current) {
      columns[index] = {
        ...current,
        ...patch,
        id: current.id,
        ...(patch.width !== undefined ? { width: patch.width } : {}),
      };
    }
    if (options.move) {
      const target = index + options.move;
      if (target >= 0 && target < columns.length) {
        const [column] = columns.splice(index, 1);
        if (column) columns.splice(target, 0, column);
      }
    }
    const hiddenColumns = columns.filter(column => column.hide).map(column => column.id);
    this.#updateActiveView({
      columns,
      ...(hiddenColumns.length > 0 ? { hiddenColumns } : { hiddenColumns: [] }),
    });
  }

  #setFilterTree(filter: DatabaseFilterGroup): void {
    const flat: DatabaseFilter[] = filter.conditions.filter(
      (item): item is DatabaseFilter => item.type !== 'group'
    );
    const view = this.#activeView();
    if (filter.conditions.length > 0) this.#filterBarOpen.add(view.id);
    else this.#filterBarOpen.delete(view.id);
    this.#updateActiveView({
      filter,
      filters: flat,
      filterMode: filter.op,
    });
  }

  #setGroupProperty(key: string, patch: { hide?: boolean; collapsed?: boolean }): void {
    if (this.#readonly) {
      this.#groupOverrides.set(key, {
        ...(this.#groupOverrides.get(key) ?? {}),
        ...patch,
      });
      this.#groupOverrideVersion += 1;
      this.render();
      return;
    }
    const view = this.#activeView();
    const groups = seedGroupSettings(
      view.groupProperties ?? [],
      this.#groupsFor(view).map(group => group.key)
    );
    if (!groups.some(group => group.key === key)) groups.push({ key });
    const index = groups.findIndex(group => group.key === key);
    if (index >= 0) {
      const current = groups[index];
      if (current) groups[index] = { ...current, ...patch };
    }
    this.#updateActiveView({ groupProperties: groups });
  }

  #columnStates(
    view: DatabaseViewConfig = this.#activeView()
  ): ReturnType<typeof databaseViewColumnStates> {
    const cache = this.#ensureQueryCache();
    const key = view.id ?? '';
    const cached = cache.statesByViewId.get(key);
    if (cached) return cached;
    const result = databaseViewColumnStates(this.#data, view);
    cache.statesByViewId.set(key, result);
    return result;
  }

  #visibleColumns(view: DatabaseViewConfig = this.#activeView()): DatabaseColumn[] {
    return databaseVisibleColumns(this.#data, view);
  }

  #titleColumn(view: DatabaseViewConfig = this.#activeView()): DatabaseColumn | undefined {
    return databaseTitleColumn(this.#data, view);
  }

  #rowsFor(view: DatabaseViewConfig = this.#activeView()): DatabaseRow[] {
    const cache = this.#ensureQueryCache();
    const key = view.id ?? '';
    const cached = cache.rowsByViewId.get(key);
    if (cached) return cached;
    const filtered = filteredDatabaseRows(this.#data, view);
    const result =
      this.#searchQuery.trim().length > 0
        ? searchDatabaseRows(this.#data, filtered, this.#searchQuery)
        : filtered;
    cache.rowsByViewId.set(key, result);
    return result;
  }

  #groupsFor(
    view: DatabaseViewConfig = this.#activeView()
  ): ReturnType<typeof groupedDatabaseRows> {
    const cache = this.#ensureQueryCache();
    const key = view.id ?? '';
    const cached = cache.groupsByViewId.get(key);
    if (cached) return cached;
    const hasSearch = this.#searchQuery.trim().length > 0;
    const allowed = hasSearch
      ? new Set(this.#rowsFor(view).map(row => row.id))
      : null;
    const hasOverrides = this.#readonly && this.#groupOverrides.size > 0;
    const baseGroups = groupedDatabaseRows(this.#data, view);
    const groups =
      allowed || hasOverrides
        ? baseGroups.map(group => {
            const override = hasOverrides
              ? this.#groupOverrides.get(group.key)
              : undefined;
            return {
              ...group,
              ...(override?.hide !== undefined ? { hidden: override.hide } : {}),
              ...(override?.collapsed !== undefined
                ? { collapsed: override.collapsed }
                : {}),
              ...(allowed
                ? { rows: group.rows.filter(row => allowed.has(row.id)) }
                : {}),
            };
          })
        : baseGroups;
    const result = view.hideEmptyGroups
      ? groups.filter(group => group.rows.length > 0)
      : groups;
    cache.groupsByViewId.set(key, result);
    return result;
  }

  #keyFor(data: DatabaseData): string {
    const views = data.views ?? (data.view ? [data.view] : []);
    return JSON.stringify({
      readonly: this.#readonly,
      variant: data.variant,
      columns: data.columns.map(column => [
        column.id,
        column.name,
        column.type,
        column.options?.join('\u0001') ?? '',
        column.data ?? null,
      ]),
      rows: data.rows.map(row => row.id),
      activeViewId: data.activeViewId ?? null,
      titleColumnId: data.titleColumnId ?? null,
      views: views.map(view => ({
        id: view.id ?? null,
        name: view.name ?? null,
        type: view.type,
        filter: view.filter ?? null,
        filters: view.filters,
        filterMode: view.filterMode ?? 'and',
        groupBy: view.groupBy ?? null,
        groupProperties: view.groupProperties ?? [],
        hideEmptyGroups: view.hideEmptyGroups === true,
        sorts: view.sorts ?? (view.sort ? [view.sort] : []),
        columns: view.columns ?? [],
        hiddenColumns: view.hiddenColumns ?? [],
        stats: view.stats ?? {},
        header: view.header ?? null,
      })),
      sort: data.sort ?? null,
    });
  }

  #visibleKeyFor(
    data: DatabaseData,
    view: DatabaseViewConfig = data === this.#data ? this.#activeView() : databaseView(data)
  ): string {
    if (data === this.#data) {
      if (view.type === 'board' || view.groupBy) {
        return this.#groupsFor(view)
          .map(group => `${group.key}:${group.rows.map(row => row.id).join(',')}`)
          .join('\u0001');
      }
      return this.#rowsFor(view).map(row => row.id).join('\u0001');
    }
    const allowed = new Set(
      searchDatabaseRows(data, filteredDatabaseRows(data, view), this.#searchQuery).map(row => row.id)
    );
    if (view.type === 'board' || view.groupBy) {
      return groupedDatabaseRows(data, view)
        .map(group => `${group.key}:${group.rows.filter(row => allowed.has(row.id)).map(row => row.id).join(',')}`)
        .join('\u0001');
    }
    return [...allowed].join('\u0001');
  }

  render(): void {
    if (
      this.#detailRowId &&
      !this.#data.rows.some(row => row.id === this.#detailRowId)
    ) {
      this.#closeDetailPanel();
    }
    this.#boardTitleEditing = null;
    if (this.#boardBlurTimer !== null) {
      window.clearTimeout(this.#boardBlurTimer);
      this.#boardBlurTimer = null;
    }
    this.#cancelFillHandleFrame();
    this.#contentEvents.abort();
    this.#contentEvents = new AbortController();
    this.#events.abort();
    this.#events = new AbortController();
    this.#closePopover();
    this.#pendingMarks = null;
    this.#cells.clear();
    this.#selectedTds.clear();
    this.#activeTds.clear();
    this.#clearRange();
    this.#selectedRows = new Set(
      [...this.#selectedRows].filter(id => this.#data.rows.some(row => row.id === id))
    );
    if (
      this.#active &&
      !this.#data.rows.some(row => row.id === this.#active?.rowId)
    ) {
      this.#active = null;
    }
    this.#colElements = [];
    const root = this.element.getRootNode() as ShadowRoot;
    const hadFocus = this.element.contains(root.activeElement);
    const view = this.#activeView();
    this.#structureKey = this.#keyFor(this.#data);
    this.#visibleKey = this.#visibleKeyFor(this.#data, view);
    this.element.dataset.readonly = String(this.#readonly);
    this.element.dataset.view = view.type;
    this.element.replaceChildren();
    this.#cellToolbar = null;
    this.#scrollElement = null;

    const head = document.createElement('div');
    head.className = 'nb-db-head';
    const headTop = document.createElement('div');
    headTop.className = 'nb-db-head-top';
    const title = document.createElement('span');
    title.className = 'nb-db-title';
    const titleIcon = document.createElement('span');
    titleIcon.innerHTML = this.#data.variant === 'table' ? icon.table : icon.database;
    const titleInput = document.createElement('input');
    titleInput.className = 'nb-db-title-input';
    titleInput.value = this.#data.title ?? '';
    titleInput.placeholder = this.#data.variant === 'table' ? 'Untitled table' : 'Untitled database';
    titleInput.disabled = this.#readonly;
    titleInput.setAttribute('aria-label', 'Database title');
    titleInput.addEventListener('input', () => {
      const value = titleInput.value.replace(/\r?\n/gu, ' ').slice(0, 200);
      if ((this.#data.title ?? '') === value) return;
      this.#host.commit({ ...this.#data, title: value }, { mergeKey: 'db:title' });
    }, { signal: this.#events.signal });
    this.#titleInput = titleInput;
    title.append(titleIcon, titleInput);
    const count = document.createElement('span');
    count.className = 'nb-db-count';
    this.#countElement = count;

    const tools = document.createElement('div');
    tools.className = 'nb-db-tools';
    this.#renderToolButtons(view, tools);
    if (!this.#readonly) {
      const addRecord = document.createElement('button');
      addRecord.type = 'button';
      addRecord.className = 'nb-db-btn nb-db-new-record-toolbar';
      addRecord.innerHTML = `${icon.plus}<span>New Record</span>`;
      addRecord.title = 'Add record';
      addRecord.addEventListener('click', () => {
        const rowId = this.#addRow();
        if (rowId) {
          requestAnimationFrame(() => this.#openDetailPanel(rowId));
        }
      }, {
        signal: this.#events.signal,
      });
      tools.append(addRecord);
    }
    headTop.append(title, count);
    const bar = document.createElement('div');
    bar.className = 'nb-db-bar';
    bar.append(this.#renderViewBar(view), tools);
    head.append(headTop, bar);

    const scroll = document.createElement('div');
    scroll.className = 'nb-db-scroll';
    scroll.dataset.view = view.type;
    this.#scrollElement = scroll;
    const fillHandle = document.createElement('div');
    fillHandle.className = 'nb-db-fill-handle';
    fillHandle.dataset.visible = 'false';
    fillHandle.setAttribute('role', 'button');
    fillHandle.setAttribute('aria-label', 'Fill selected cells');
    fillHandle.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      this.#beginFillDrag();
    }, { signal: this.#events.signal });
    this.element.append(fillHandle);
    this.#fillHandle = fillHandle;
    scroll.addEventListener('scroll', () => this.#scheduleFillHandlePosition(), {
      signal: this.#events.signal,
      passive: true,
    });
    window.addEventListener('scroll', () => this.#scheduleFillHandlePosition(), {
      signal: this.#events.signal,
      passive: true,
    });

    const filterBar = this.#renderFilterBar(view);
    this.element.append(head);
    if (filterBar) this.element.append(filterBar);
    this.element.append(scroll);
    this.#renderContent();

    if (view.type === 'table' && this.#pendingFocus) {
      const pending = this.#pendingFocus;
      this.#pendingFocus = null;
      this.focusCell(pending.rowId, pending.columnId, pending.at);
    } else if (view.type === 'table' && hadFocus && this.#active) {
      this.focusCell(this.#active.rowId, this.#active.columnId, 'end');
    } else if (view.type === 'board' && this.#pendingBoardFocus) {
      const rowId = this.#pendingBoardFocus;
      this.#pendingBoardFocus = null;
      requestAnimationFrame(() => {
        const title = this.element.querySelector<HTMLElement>(
          `.nb-db-card[data-row-id="${CSS.escape(rowId)}"] .nb-db-card-title`
        );
        if (!title || title.contentEditable !== 'true') return;
        title.focus();
        placeCaret(title, 'end');
      });
    }
    this.#syncedData = this.#data;
  }

  #renderContent(): void {
    const scroll = this.#scrollElement;
    if (!scroll) return;
    const view = this.#activeView();
    this.#boardTitleEditing = null;
    if (this.#boardBlurTimer !== null) {
      window.clearTimeout(this.#boardBlurTimer);
      this.#boardBlurTimer = null;
    }
    this.#cancelFillHandleFrame();
    this.#contentEvents.abort();
    this.#contentEvents = new AbortController();
    this.#closePopover();
    if (this.#pendingMarks && scroll.contains(this.#pendingMarks.target)) {
      this.#pendingMarks = null;
    }
    this.#cells.clear();
    this.#selectedTds.clear();
    this.#activeTds.clear();
    this.#clearRange();
    this.#colElements = [];
    this.#visibleKey = this.#visibleKeyFor(this.#data, view);
    scroll.dataset.view = view.type;
    scroll.replaceChildren(
      view.type === 'board' ? this.#renderBoard(view) : this.#renderTable(view)
    );
    this.#updateCount(view);
    this.#syncDetailPanel();
    this.#syncRowSelection();
    this.#syncedData = this.#data;
  }

  #renderFilterBar(view: DatabaseViewConfig): HTMLElement | null {
    const group = databaseFilterGroup(view);
    if (group.conditions.length === 0) return null;
    const viewId = this.#activeView().id;
    if (!this.#readonly && !this.#filterBarOpen.has(viewId)) return null;
    const bar = document.createElement('div');
    bar.className = 'nb-db-filter-bar';
    bar.id = `${this.#instanceId}-filters`;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Active filters');
    for (const condition of group.conditions) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'nb-db-filter-chip';
      if (condition.type === 'group') {
        const count = condition.conditions.length;
        chip.textContent = `${count} ${count === 1 ? 'rule' : 'rules'}`;
      } else {
        const column = this.#data.columns.find(item => item.id === condition.columnId);
        if (!column) continue;
        const operator = FILTER_LABELS[condition.operator] ?? condition.operator;
        chip.textContent = `${column.name} ${operator}${condition.value ? ` ${condition.value}` : ''}`;
      }
      chip.addEventListener('click', () => this.#openFilterPopover(chip), {
        signal: this.#events.signal,
      });
      bar.append(chip);
    }
    if (!this.#readonly) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'nb-db-filter-add-chip';
      add.textContent = '+ Add filter';
      add.addEventListener('click', () => this.#openFilterPopover(add), {
        signal: this.#events.signal,
      });
      bar.append(add);
    }
    return bar;
  }

  #renderViewBar(view: DatabaseViewConfig): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'nb-db-viewbar';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Database views');
    for (const item of this.#views()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-db-viewtab';
      button.dataset.active = String(item.id === view.id);
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(item.id === view.id));
      button.title = item.name;
      const typeIcon = document.createElement('span');
      typeIcon.className = 'nb-db-viewtab-icon';
      typeIcon.innerHTML = item.type === 'board' ? icon.database : icon.table;
      const label = document.createElement('span');
      label.textContent = item.name;
      button.append(typeIcon, label);
      button.addEventListener(
        'click',
        () => {
          if (item.id === view.id) this.#openViewMenu(button);
          else this.#setActiveView(item.id);
        },
        { signal: this.#events.signal }
      );
      bar.append(button);
    }
    if (!this.#readonly) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'nb-db-viewtab nb-db-viewadd';
      add.textContent = '+';
      add.title = 'Add view';
      add.setAttribute('aria-label', 'Add view');
      add.addEventListener('click', () => this.#openAddViewMenu(add), {
        signal: this.#events.signal,
      });
      bar.append(add);
    }
    return bar;
  }

  #renderToolButtons(view: DatabaseViewConfig, tools: HTMLElement): void {
    if (!this.#readonly) {
      const viewId = this.#activeView().id;
      const filter = document.createElement('button');
      filter.type = 'button';
      filter.className = 'nb-db-btn';
      const activeFilterCount = databaseFilterGroup(view).conditions.length;
      filter.dataset.active = String(activeFilterCount > 0);
      filter.dataset.filterToggle = 'true';
      filter.innerHTML = `${icon.filter}<span class="nb-db-btn-label">${activeFilterCount > 0 ? `Filter (${activeFilterCount})` : 'Filter'}</span>`;
      filter.title = 'Filter rows';
      filter.setAttribute(
        'aria-label',
        activeFilterCount > 0 ? `Filter, ${activeFilterCount} active` : 'Filter rows'
      );
      if (activeFilterCount > 0) {
        const open = this.#filterBarOpen.has(viewId);
        filter.setAttribute('aria-expanded', String(open));
        if (open) {
          filter.setAttribute('aria-controls', `${this.#instanceId}-filters`);
        } else {
          filter.removeAttribute('aria-controls');
        }
      }
      filter.addEventListener('click', () => {
        if (databaseFilterGroup(view).conditions.length === 0) {
          this.#openFilterPopover(filter);
          return;
        }
        if (this.#filterBarOpen.has(viewId)) this.#filterBarOpen.delete(viewId);
        else this.#filterBarOpen.add(viewId);
        this.render();
        requestAnimationFrame(() => {
          if (!this.element.isConnected) return;
          this.element
            .querySelector<HTMLButtonElement>('[data-filter-toggle="true"]')
            ?.focus();
        });
      }, { signal: this.#events.signal });
      tools.append(filter);
    }

    this.#renderSearch(tools);

    if (this.#readonly) return;
    const options = document.createElement('button');
    options.type = 'button';
    options.className = 'nb-db-btn nb-db-viewmore';
    options.innerHTML = icon.more;
    options.title = 'View settings';
    options.setAttribute('aria-label', 'View settings');
    options.addEventListener('click', () => this.#openViewMenu(options), {
      signal: this.#events.signal,
    });
    tools.append(options);
  }

  #renderSearch(tools: HTMLElement): void {
    const wrap = document.createElement('div');
    wrap.className = 'nb-db-search-wrap';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nb-db-search-toggle';
    toggle.title = 'Search rows';
    toggle.setAttribute('aria-label', 'Search');
    toggle.innerHTML = icon.search;

    const search = document.createElement('input');
    search.className = 'nb-db-search';
    search.type = 'search';
    search.placeholder = 'Search';
    search.value = this.#searchQuery;
    search.setAttribute('aria-label', 'Search rows');

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'nb-db-search-clear';
    clear.title = 'Clear search';
    clear.setAttribute('aria-label', 'Clear search');
    clear.innerHTML = icon.x;

    const setOpen = (open: boolean): void => {
      this.#searchOpen = open;
      wrap.dataset.open = String(open);
      toggle.setAttribute('aria-expanded', String(open));
      clear.tabIndex = open ? 0 : -1;
    };
    setOpen(this.#searchOpen || this.#searchQuery.length > 0);

    let composing = false;
    const applySearch = (): void => {
      setOpen(true);
      this.#searchQuery = search.value;
      this.#renderContent();
    };
    const clearSearch = (): void => {
      composing = false;
      search.value = '';
      this.#searchQuery = '';
      setOpen(true);
      search.focus();
      this.#renderContent();
    };

    toggle.addEventListener('click', () => {
      setOpen(true);
      search.focus();
    }, { signal: this.#events.signal });
    search.addEventListener('focus', () => setOpen(true), {
      signal: this.#events.signal,
    });
    search.addEventListener('blur', () => {
      if (!wrap.isConnected || search.value) return;
      setOpen(false);
    }, { signal: this.#events.signal });
    search.addEventListener('compositionstart', () => {
      composing = true;
    }, { signal: this.#events.signal });
    search.addEventListener('compositionend', () => {
      composing = false;
      applySearch();
    }, { signal: this.#events.signal });
    search.addEventListener('input', event => {
      if (composing || (event as InputEvent).isComposing) return;
      applySearch();
    }, { signal: this.#events.signal });
    search.addEventListener('keydown', event => {
      if (composing || this.#isComposingKey(event, search)) return;
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (search.value) {
        clearSearch();
        return;
      }
      setOpen(false);
      search.blur();
      toggle.focus();
    }, { signal: this.#events.signal });
    clear.addEventListener('mousedown', event => event.preventDefault(), {
      signal: this.#events.signal,
    });
    clear.addEventListener('click', () => {
      if (!search.value && !this.#searchQuery) {
        setOpen(false);
        search.blur();
        toggle.focus();
        return;
      }
      clearSearch();
    }, { signal: this.#events.signal });

    wrap.append(toggle, search, clear);
    tools.append(wrap);
  }

  #nextViewName(type: 'table' | 'board'): string {
    const base = type === 'board' ? 'Board' : 'Table';
    const names = new Set(this.#views().map(view => view.name));
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }

  #addView(type: 'table' | 'board'): void {
    if (this.#views().length >= 100) return;
    const view = createDatabaseView(type, this.#nextViewName(type));
    view.columns = this.#columnStates().map(item => ({
      id: item.column.id,
      width: item.width,
      ...(item.hide ? { hide: true } : {}),
      ...(item.stat ? { stat: item.stat } : {}),
    }));
    if (type === 'board') {
      const groupBy = this.#defaultGroupColumn();
      if (groupBy) view.groupBy = groupBy;
    }
    const views = [...this.#views(), view];
    const { view: _legacyView, sort: _legacySort, ...rest } = this.#data;
    this.#host.commit({ ...rest, views, activeViewId: view.id });
  }

  #openAddViewMenu(anchor: HTMLElement): void {
    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = 'Add view';
    content.append(title);
    const actions = document.createElement('div');
    actions.className = 'nb-db-pop-actions';
    for (const type of ['table', 'board'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = type === 'board' ? 'Board view' : 'Table view';
      button.addEventListener('click', () => {
        this.#closePopover();
        this.#addView(type);
      });
      actions.append(button);
    }
    content.append(actions);
    this.#showPopover(anchor, content);
  }

  #openViewMenu(anchor: HTMLElement): void {
    if (this.#readonly) return;
    const view = this.#activeView();
    const content = document.createElement('div');
    content.className = 'nb-db-view-menu';
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = 'View settings';
    content.append(title);
    const name = document.createElement('input');
    name.className = 'nb-db-view-name';
    name.value = view.name;
    name.placeholder = 'View name';
    name.setAttribute('aria-label', 'View name');
    name.addEventListener('change', () => {
      const value = name.value.trim();
      if (value && value !== view.name) this.#updateActiveView({ name: value });
    }, { signal: this.#events.signal });
    content.append(name);

    const layout = document.createElement('div');
    layout.className = 'nb-db-view-layout';
    const label = document.createElement('span');
    label.textContent = 'Layout';
    const buttons = document.createElement('div');
    for (const type of ['table', 'board'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-db-view-layout-btn';
      button.dataset.active = String(view.type === type);
      button.innerHTML = `${type === 'table' ? icon.table : icon.database}<span>${type === 'table' ? 'Table' : 'Board'}</span>`;
      button.addEventListener('click', () => {
        if (view.type === type) return;
        this.#closePopover();
        const groupBy =
          type === 'board' && !view.groupBy ? this.#defaultGroupColumn() : undefined;
        this.#updateActiveView({
          type,
          ...(groupBy ? { groupBy } : {}),
        });
      }, { signal: this.#events.signal });
      buttons.append(button);
    }
    layout.append(label, buttons);
    content.append(layout);

    const actions = document.createElement('div');
    actions.className = 'nb-db-pop-actions';
    const add = (label: string, action: () => void, danger = false): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = danger ? 'danger' : '';
      button.textContent = label;
      button.addEventListener('click', action);
      actions.append(button);
    };
    const propertyCount = this.#columnStates(view).filter(item => !item.hide).length;
    add(`Properties (${propertyCount} shown)`, () => {
      this.#closePopover();
      this.#openViewProperties(anchor);
    });
    add('Filter', () => {
      this.#closePopover();
      this.#openFilterPopover(anchor);
    });
    add(`Sort${databaseSorts(view).length > 0 ? ` (${databaseSorts(view).length})` : ''}`, () => {
      this.#closePopover();
      this.#openSortPopover(anchor);
    });
    add(`Group${view.groupBy ? `: ${this.#data.columns.find(column => column.id === view.groupBy)?.name ?? ''}` : ''}`, () => {
      this.#closePopover();
      this.#openGroupPopover(anchor);
    });
    add('Rename view', () => {
      this.#closePopover();
      this.#openRenameView(anchor);
    });
    add('Duplicate view', () => {
      this.#closePopover();
      if (this.#views().length >= 100) return;
      const active = this.#activeView();
      const views = this.#views();
      const index = views.findIndex(item => item.id === active.id);
      const copy = {
        ...active,
        id: createId('v'),
        name: `${active.name} copy`,
        filters: active.filters.map(filter => ({ ...filter })),
        ...(active.filter
          ? { filter: JSON.parse(JSON.stringify(active.filter)) as DatabaseFilterGroup }
          : {}),
        ...(active.groupProperties
          ? {
              groupProperties: active.groupProperties.map(group => ({
                ...group,
                ...(group.manuallyCardSort
                  ? { manuallyCardSort: [...group.manuallyCardSort] }
                  : {}),
              })),
            }
          : {}),
        ...(active.sorts ? { sorts: active.sorts.map(sort => ({ ...sort })) } : {}),
        ...(active.columns ? { columns: active.columns.map(column => ({ ...column })) } : {}),
        ...(active.hiddenColumns ? { hiddenColumns: [...active.hiddenColumns] } : {}),
        ...(active.stats ? { stats: { ...active.stats } } : {}),
        ...(active.header ? { header: { ...active.header } } : {}),
      } satisfies DatabaseViewConfig;
      const next = [...views];
      next.splice(index + 1, 0, copy);
      const { view: _legacyView, sort: _legacySort, ...rest } = this.#data;
      this.#host.commit({ ...rest, views: next, activeViewId: copy.id });
    });
    const index = this.#views().findIndex(item => item.id === view.id);
    if (index > 0) {
      add('Move view left', () => {
        this.#closePopover();
        this.#moveView(-1);
      });
    }
    if (index >= 0 && index < this.#views().length - 1) {
      add('Move view right', () => {
        this.#closePopover();
        this.#moveView(1);
      });
    }
    if (this.#views().length > 1) {
      add('Delete view', () => {
        this.#closePopover();
        const active = this.#activeView();
        const views = this.#views().filter(item => item.id !== active.id);
        const { view: _legacyView, sort: _legacySort, ...rest } = this.#data;
        const nextActive = views[0]?.id;
        this.#host.commit({ ...rest, views, ...(nextActive ? { activeViewId: nextActive } : {}) });
      }, true);
    }
    content.append(actions);
    this.#showPopover(anchor, content);
    name.focus();
    name.select();
  }

  #moveView(direction: 1 | -1): void {
    const views = this.#views();
    const active = this.#activeView();
    const index = views.findIndex(view => view.id === active.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= views.length) return;
    const next = [...views];
    const [view] = next.splice(index, 1);
    if (!view) return;
    next.splice(target, 0, view);
    const { view: _legacyView, sort: _legacySort, ...rest } = this.#data;
    this.#host.commit({ ...rest, views: next, activeViewId: view.id });
  }

  #openViewProperties(anchor: HTMLElement): void {
    const view = this.#activeView();
    const content = document.createElement('div');
    content.className = 'nb-db-view-properties';
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = 'Properties';
    content.append(title);
    const states = this.#columnStates(view);
    const bulk = document.createElement('div');
    bulk.className = 'nb-db-properties-bulk';
    const showAll = document.createElement('button');
    showAll.type = 'button';
    showAll.textContent = 'Show all';
    showAll.addEventListener('click', () => {
      this.#closePopover();
      this.#updateActiveView({
        columns: this.#viewColumns(view).map(column => ({ ...column, hide: false })),
        hiddenColumns: [],
      });
    }, { signal: this.#events.signal });
    const hideAll = document.createElement('button');
    hideAll.type = 'button';
    hideAll.textContent = 'Hide all';
    hideAll.addEventListener('click', () => {
      this.#closePopover();
      const columns = this.#viewColumns(view).map(column => ({
        ...column,
        hide: column.id !== this.#titleColumn(view)?.id,
      }));
      this.#updateActiveView({
        columns,
        hiddenColumns: columns.filter(column => column.hide).map(column => column.id),
      });
    }, { signal: this.#events.signal });
    bulk.append(showAll, hideAll);
    content.append(bulk);
    const list = document.createElement('div');
    list.className = 'nb-db-column-list';
    states.forEach((state, index) => {
      const row = document.createElement('div');
      row.className = 'nb-db-property-row';
      const label = document.createElement('span');
      label.className = 'nb-db-property-name';
      label.textContent = state.column.name;
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'nb-db-property-move';
      up.innerHTML = icon.arrowUp;
      up.disabled = index === 0;
      up.title = 'Move up';
      up.setAttribute('aria-label', `Move ${state.column.name} up`);
      up.addEventListener('click', () => {
        this.#closePopover();
        this.#patchViewColumn(state.column.id, {}, { move: -1 });
      }, { signal: this.#events.signal });
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'nb-db-property-move';
      down.innerHTML = icon.arrowDown;
      down.disabled = index === states.length - 1;
      down.title = 'Move down';
      down.setAttribute('aria-label', `Move ${state.column.name} down`);
      down.addEventListener('click', () => {
        this.#closePopover();
        this.#patchViewColumn(state.column.id, {}, { move: 1 });
      }, { signal: this.#events.signal });
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'nb-db-property-eye';
      toggle.dataset.hidden = String(state.hide);
      toggle.title = state.hide ? 'Show property' : 'Hide property';
      toggle.setAttribute('aria-label', state.hide ? 'Show property' : 'Hide property');
      toggle.innerHTML = state.hide ? icon.expand : icon.checkboxSquare;
      toggle.addEventListener('click', () => {
        this.#closePopover();
        this.#patchViewColumn(state.column.id, { hide: !state.hide });
      }, { signal: this.#events.signal });
      row.append(label, up, down, toggle);
      list.append(row);
    });
    content.append(list);
    this.#showPopover(anchor, content);
  }

  #openRenameView(anchor: HTMLElement): void {
    const view = this.#activeView();
    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = 'Rename view';
    const field = document.createElement('label');
    field.className = 'nb-db-field';
    const label = document.createElement('span');
    label.textContent = 'Name';
    const input = document.createElement('input');
    input.value = view.name;
    field.append(label, input);
    const actions = document.createElement('div');
    actions.className = 'nb-db-pop-actions';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = 'Done';
    apply.addEventListener('click', () => {
      const name = input.value.trim();
      if (name) this.#updateActiveView({ name });
      this.#closePopover();
    });
    actions.append(apply);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      apply.click();
    });
    content.append(title, field, actions);
    this.#showPopover(anchor, content);
    input.focus();
    input.select();
  }

  #openSortPopover(anchor: HTMLElement): void {
    const view = this.#activeView();
    const draft = (view.sorts ?? (view.sort ? [view.sort] : [])).map(sort => ({ ...sort }));
    const content = document.createElement('div');
    content.className = 'nb-db-sort-popover';
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = 'Sort';
    const list = document.createElement('div');
    list.className = 'nb-db-filter-list';
    const render = (): void => {
      list.replaceChildren();
      if (draft.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'nb-db-filter-empty';
        empty.textContent = 'No sort keys.';
        list.append(empty);
      }
      draft.forEach((sort, index) => {
        const row = document.createElement('div');
        row.className = 'nb-db-filter-row';
        const column = document.createElement('select');
        column.setAttribute('aria-label', 'Sort column');
        for (const item of this.#data.columns) {
          const option = document.createElement('option');
          option.value = item.id;
          option.textContent = item.name;
          option.selected = item.id === sort.columnId;
          column.append(option);
        }
        column.addEventListener('change', () => {
          sort.columnId = column.value;
        });
        const direction = document.createElement('select');
        direction.setAttribute('aria-label', 'Sort direction');
        for (const [value, label] of [['asc', 'Ascending'], ['desc', 'Descending']] as const) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          option.selected = sort.direction === value;
          direction.append(option);
        }
        direction.addEventListener('change', () => {
          sort.direction = direction.value === 'desc' ? 'desc' : 'asc';
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'nb-db-filter-remove';
        remove.innerHTML = icon.x;
        remove.title = 'Remove sort';
        remove.setAttribute('aria-label', 'Remove sort');
        remove.addEventListener('click', () => {
          draft.splice(index, 1);
          render();
        });
        row.append(column, direction, remove);
        list.append(row);
      });
    };
    const footer = document.createElement('div');
    footer.className = 'nb-db-pop-actions';
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = '+ Add sort';
    add.addEventListener('click', () => {
      const first = this.#data.columns[0];
      if (!first) return;
      draft.push({ columnId: first.id, direction: 'asc' });
      render();
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      draft.length = 0;
      render();
    });
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => {
      this.#updateActiveView({
        sorts: draft.filter(sort => this.#data.columns.some(column => column.id === sort.columnId)),
        sort: null,
      });
      this.#closePopover();
    });
    footer.append(add, clear, apply);
    content.append(title, list, footer);
    render();
    this.#showPopover(anchor, content);
  }

  #renderTable(view: DatabaseViewConfig): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'nb-db-table-area';
    const columns = this.#visibleColumns(view);
    if (view.groupBy) {
      const groups = this.#groupsFor(view);
      if (groups.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'nb-db-empty';
        empty.textContent = 'No groups';
        wrapper.append(empty);
        return wrapper;
      }
      const visibleGroups = groups.filter(group => !group.hidden);
      if (visibleGroups.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'nb-db-empty';
        empty.textContent = 'All groups are hidden';
        wrapper.append(empty);
        return wrapper;
      }
      for (const group of visibleGroups) {
        const section = document.createElement('section');
        section.className = 'nb-db-group';
        section.dataset.group = group.key;
        const heading = document.createElement('div');
        heading.className = 'nb-db-group-head';
        const collapsed = Boolean(group.collapsed);
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'nb-db-group-toggle';
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? 'Expand group' : 'Collapse group');
        const chevron = document.createElement('span');
        chevron.className = 'nb-db-group-chevron';
        chevron.textContent = collapsed ? '▸' : '▾';
        toggle.append(chevron);
        toggle.addEventListener('click', event => {
          event.stopPropagation();
          this.#setGroupProperty(group.key, { collapsed: !collapsed });
        }, { signal: this.#contentEvents.signal });
        const label = document.createElement('span');
        label.className = 'nb-db-group-label';
        label.textContent = group.label || 'No value';
        const count = document.createElement('span');
        count.className = 'nb-db-group-count';
        count.textContent = String(group.rows.length);
        const addRow = document.createElement('button');
        addRow.type = 'button';
        addRow.className = 'nb-db-group-add';
        addRow.innerHTML = icon.plus;
        addRow.title = 'Add row to group';
        addRow.setAttribute('aria-label', `Add row to ${group.label || 'group'}`);
        addRow.disabled = this.#readonly;
        addRow.addEventListener('click', event => {
          event.stopPropagation();
          this.#addRow(undefined, group.key);
        }, { signal: this.#contentEvents.signal });
        heading.append(toggle, label, count, addRow);
        heading.addEventListener('click', () => {
          this.#setGroupProperty(group.key, { collapsed: !collapsed });
        }, { signal: this.#contentEvents.signal });
        section.append(heading);
        if (!collapsed) {
          section.append(this.#renderTableGrid(view, columns, group.rows, group.key));
        }
        wrapper.append(section);
      }
      return wrapper;
    }
    wrapper.append(this.#renderTableGrid(view, columns, this.#rowsFor(view)));
    return wrapper;
  }

  #renderTableGrid(
    view: DatabaseViewConfig,
    columns: readonly DatabaseColumn[],
    rows: readonly DatabaseRow[],
    groupKey?: string
  ): HTMLTableElement {
    const table = document.createElement('table');
    table.className = 'nb-db-table';
    table.setAttribute('aria-label', this.#data.title?.trim() || 'Database');
    const states = this.#columnStates(view).filter(state =>
      columns.some(column => column.id === state.column.id)
    );
    const titleColumn = this.#titleColumn(view);
    const opsColumnId =
      titleColumn && columns.some(column => column.id === titleColumn.id)
        ? titleColumn.id
        : columns[0]?.id;
    table.append(this.#renderTableColgroup(states));
    table.append(this.#renderTableHead(view, states));
    table.append(this.#renderTableBody(columns, rows, opsColumnId, groupKey));
    table.append(this.#renderTableFoot(columns, rows, states, groupKey));
    return table;
  }

  #renderTableColgroup(
    states: ReturnType<typeof databaseViewColumnStates>
  ): HTMLTableColElement {
    const colgroup = document.createElement('colgroup');
    const handleCol = document.createElement('col');
    handleCol.style.width = '24px';
    colgroup.append(handleCol);
    for (const state of states) {
      const col = document.createElement('col');
      col.style.width = `${state.width}px`;
      this.#colElements.push(col);
      colgroup.append(col);
    }
    // Absorb leftover width so the 24px gutter and 40px add-column stay fixed.
    const spacerCol = document.createElement('col');
    colgroup.append(spacerCol);
    const addCol = document.createElement('col');
    addCol.style.width = '40px';
    colgroup.append(addCol);
    return colgroup;
  }

  #renderTableHead(
    view: DatabaseViewConfig,
    states: ReturnType<typeof databaseViewColumnStates>
  ): HTMLTableSectionElement {
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'nb-db-handle nb-db-corner';
    headRow.append(corner);
    const sorts = databaseSorts(view);
    for (const state of states) {
      const column = state.column;
      const th = document.createElement('th');
      th.className = 'nb-db-th';
      th.scope = 'col';
      th.dataset.columnId = column.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-db-col-head';
      button.disabled = this.#readonly;
      const typeIcon = document.createElement('span');
      typeIcon.className = 'nb-db-typeicon';
      typeIcon.innerHTML = TYPE_ICON[column.type] ?? icon.text;
      const name = document.createElement('span');
      name.className = 'nb-db-colname';
      name.textContent = column.name;
      button.append(typeIcon, name);
      const sortIndex = sorts.findIndex(sort => sort.columnId === column.id);
      if (sortIndex >= 0) {
        const sort = document.createElement('span');
        sort.className = 'nb-db-sort';
        const direction = sorts[sortIndex]?.direction === 'desc' ? '↓' : '↑';
        sort.textContent = sorts.length > 1 ? `${sortIndex + 1}${direction}` : direction;
        button.append(sort);
      }
      const chevron = document.createElement('span');
      chevron.className = 'nb-db-colhead-chevron';
      chevron.innerHTML = icon.chevron;
      button.append(chevron);
      button.setAttribute('aria-label', `Edit column ${column.name}`);
      button.addEventListener(
        'click',
        () => this.#openColumnPopover(column.id, button),
        { signal: this.#contentEvents.signal }
      );
      th.addEventListener(
        'contextmenu',
        event => {
          event.preventDefault();
          this.#openColumnPopover(column.id, th);
        },
        { signal: this.#contentEvents.signal }
      );
      th.addEventListener(
        'pointerdown',
        event => this.#beginColumnDrag(event, column.id),
        { signal: this.#contentEvents.signal }
      );
      const resizer = document.createElement('span');
      resizer.className = 'nb-db-resizer';
      resizer.setAttribute('role', 'separator');
      resizer.setAttribute('aria-orientation', 'vertical');
      resizer.setAttribute('aria-label', `Resize ${column.name}`);
      resizer.addEventListener(
        'pointerdown',
        event => this.#startColumnResize(event, column),
        { signal: this.#contentEvents.signal }
      );
      th.append(button, resizer);
      headRow.append(th);
    }
    const spacerHead = document.createElement('th');
    spacerHead.className = 'nb-db-spacer';
    spacerHead.setAttribute('aria-hidden', 'true');
    headRow.append(spacerHead);
    const addHead = document.createElement('th');
    addHead.className = 'nb-db-add-column-head';
    if (!this.#readonly) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'nb-db-add-column';
      add.title = 'Add column';
      add.setAttribute('aria-label', 'Add column');
      add.innerHTML = icon.plus;
      add.addEventListener('click', () => this.#addColumn(), {
        signal: this.#contentEvents.signal,
      });
      addHead.append(add);
    }
    headRow.append(addHead);
    thead.append(headRow);
    return thead;
  }

  #renderTableBody(
    columns: readonly DatabaseColumn[],
    rows: readonly DatabaseRow[],
    opsColumnId: string | undefined,
    groupKey?: string
  ): HTMLTableSectionElement {
    const tbody = document.createElement('tbody');
    for (const row of rows) {
      tbody.append(this.#renderTableRow(row, columns, opsColumnId, groupKey));
    }
    if (rows.length === 0) {
      const empty = document.createElement('tr');
      empty.className = 'nb-db-empty-row';
      const td = document.createElement('td');
      td.className = 'nb-db-empty';
      td.colSpan = Math.max(1, columns.length + 3);
      td.textContent = this.#readonly ? 'No rows' : 'No rows yet. Add one below.';
      empty.append(td);
      tbody.append(empty);
    }
    return tbody;
  }

  #renderTableRow(
    row: DatabaseRow,
    columns: readonly DatabaseColumn[],
    opsColumnId: string | undefined,
    groupKey?: string
  ): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.dataset.rowId = row.id;
    tr.classList.toggle('is-row-selected', this.#selectedRows.has(row.id));
    const handle = document.createElement('td');
    handle.className = 'nb-db-handle';
    if (!this.#readonly) {
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'nb-db-row-grip';
      grip.title = 'Select row';
      grip.setAttribute('aria-label', 'Select row');
      grip.innerHTML = icon.more;
      grip.addEventListener('pointerdown', event => {
        this.#beginRowDrag(event, row.id, groupKey);
      }, { signal: this.#contentEvents.signal });
      grip.addEventListener('click', () => this.#toggleRowSelection(row.id), {
        signal: this.#contentEvents.signal,
      });
      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'nb-db-row-check';
      check.dataset.rowId = row.id;
      check.setAttribute('role', 'checkbox');
      check.setAttribute('aria-checked', String(this.#selectedRows.has(row.id)));
      check.setAttribute('aria-label', 'Select row');
      check.innerHTML = icon.checkboxSquare;
      check.addEventListener('click', event => {
        event.preventDefault();
        this.#toggleRowSelection(row.id);
      }, { signal: this.#contentEvents.signal });
      handle.append(grip, check);
    }
    tr.append(handle);
    for (const column of columns) {
      const td = this.#createCell(row, column);
      if (column.id === opsColumnId) {
        td.classList.add('has-row-ops');
        td.append(this.#renderRowOperations(row.id));
      }
      tr.append(td);
    }
    const spacer = document.createElement('td');
    spacer.className = 'nb-db-spacer';
    tr.append(spacer);
    const addCell = document.createElement('td');
    addCell.className = 'nb-db-add-cell';
    tr.append(addCell);
    return tr;
  }

  #renderRowOperations(rowId: string): HTMLElement {
    const ops = document.createElement('div');
    ops.className = 'nb-db-row-ops';
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'nb-db-row-expand';
    expand.title = 'Expand row';
    expand.setAttribute('aria-label', 'Expand row');
    expand.innerHTML = icon.expand;
    expand.addEventListener('click', event => {
      event.stopPropagation();
      this.#openDetailPanel(rowId);
    }, { signal: this.#contentEvents.signal });
    if (this.#readonly) {
      ops.append(expand);
      return ops;
    }
    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'nb-db-rowmenu';
    menu.title = 'Row actions';
    menu.setAttribute('aria-label', 'Row actions');
    menu.innerHTML = icon.more;
    menu.addEventListener('click', event => {
      event.stopPropagation();
      this.#openRowPopover(rowId, menu);
    }, { signal: this.#contentEvents.signal });
    ops.append(expand, menu);
    return ops;
  }

  #renderTableFoot(
    columns: readonly DatabaseColumn[],
    rows: readonly DatabaseRow[],
    states: ReturnType<typeof databaseViewColumnStates>,
    groupKey?: string
  ): HTMLTableSectionElement {
    const tfoot = document.createElement('tfoot');
    if (states.length > 0) {
      const footRow = document.createElement('tr');
      const cornerFoot = document.createElement('td');
      cornerFoot.className = 'nb-db-handle nb-db-foot-handle';
      footRow.append(cornerFoot);
      for (const state of states) {
        const td = document.createElement('td');
        td.className = 'nb-db-foot';
        const stat = state.stat;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'nb-db-stat';
        button.dataset.statColumn = state.column.id;
        button.dataset.calculated = String(Boolean(stat));
        button.textContent = stat
          ? `${DATABASE_STAT_LABELS[stat]}: ${databaseStatValue(rows, state.column, stat)}`
          : 'Calculate';
        button.disabled = this.#readonly;
        button.addEventListener('click', () =>
          this.#openStatPopover(state.column.id, button, rows), {
          signal: this.#contentEvents.signal,
        });
        td.append(button);
        footRow.append(td);
      }
      const spacerFoot = document.createElement('td');
      spacerFoot.className = 'nb-db-spacer';
      footRow.append(spacerFoot);
      const addFoot = document.createElement('td');
      addFoot.className = 'nb-db-foot nb-db-add-cell';
      footRow.append(addFoot);
      tfoot.append(footRow);
    }
    if (!this.#readonly) {
      const addRowRow = document.createElement('tr');
      addRowRow.className = 'nb-db-new-record-row';
      const addRowCell = document.createElement('td');
      addRowCell.colSpan = Math.max(1, columns.length + 3);
      const addRow = document.createElement('button');
      addRow.type = 'button';
      addRow.className = 'nb-db-new-record';
      const addRowLabel = document.createElement('span');
      addRowLabel.className = 'nb-db-new-record-label';
      addRowLabel.innerHTML = `${icon.plus}<span>New Record</span>`;
      addRow.append(addRowLabel);
      addRow.addEventListener('click', () => this.#addRow(undefined, groupKey), {
        signal: this.#contentEvents.signal,
      });
      addRowCell.append(addRow);
      addRowRow.append(addRowCell);
      tfoot.append(addRowRow);
    }
    return tfoot;
  }

  #openStatPopover(
    columnId: string,
    anchor: HTMLElement,
    rows: readonly DatabaseRow[]
  ): void {
    const column = this.#data.columns.find(item => item.id === columnId);
    if (!column) return;
    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = `Calculate ${column.name}`;
    content.append(title);
    const list = document.createElement('div');
    list.className = 'nb-db-stat-list';
    const current =
      this.#columnStates().find(item => item.column.id === columnId)?.stat;
    const add = (label: string, type: DatabaseStatType | null): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-db-stat-option';
      button.dataset.active = String((current ?? null) === type);
      button.textContent = type
        ? `${label} (${databaseStatValue(rows, column, type)})`
        : 'None';
      button.addEventListener('click', () => {
        const view = this.#activeView();
        const stats = { ...(view.stats ?? {}) };
        if (type) stats[columnId] = type;
        else delete stats[columnId];
        const columns = this.#viewColumns(view).map(item => {
          if (item.id !== columnId) return item;
          const next = { ...item };
          if (type) next.stat = type;
          else delete next.stat;
          return next;
        });
        this.#updateActiveView({ stats, columns });
        this.#closePopover();
      });
      list.append(button);
    };
    add('None', null);
    const available = column.type === 'number'
      ? DATABASE_STAT_TYPES
      : DATABASE_STAT_TYPES.filter(
          type =>
            type === 'count' ||
            type === 'countValues' ||
            type === 'countUnique' ||
            type === 'countEmpty' ||
            type === 'countNotEmpty'
        );
    for (const type of available) {
      add(DATABASE_STAT_LABELS[type], type);
    }
    content.append(list);
    this.#showPopover(anchor, content);
  }

  #renderBoard(view: DatabaseViewConfig): HTMLElement {
    const board = document.createElement('div');
    board.className = 'nb-db-board';
    const groups = this.#groupsFor(view).filter(group => !group.hidden);
    const columns = this.#visibleColumns(view);
    const titleColumn = this.#titleColumn(view) ?? columns[0];
    for (const group of groups) {
      const column = document.createElement('section');
      column.className = 'nb-db-board-column';
      column.dataset.group = group.key;
      if (!this.#readonly && view.groupBy) {
        column.addEventListener(
          'dragover',
          event => {
            event.preventDefault();
            column.classList.add('is-drop-target');
          },
          { signal: this.#contentEvents.signal }
        );
        column.addEventListener(
          'dragleave',
          event => {
            if (column.contains(event.relatedTarget as Node | null)) return;
            column.classList.remove('is-drop-target');
          },
          { signal: this.#contentEvents.signal }
        );
        column.addEventListener(
          'drop',
          event => {
            event.preventDefault();
            this.#clearBoardDropIndicators();
            if (event.dataTransfer?.getData('text/nobita-db') !== this.#instanceId) {
              return;
            }
            const rowId = event.dataTransfer?.getData('text/nobita-row');
            if (rowId) {
              this.#moveBoardCard(
                rowId,
                group.key,
                undefined,
                false,
                event.dataTransfer?.getData('text/nobita-group')
              );
            }
          },
          { signal: this.#contentEvents.signal }
        );
      }
      const heading = document.createElement('div');
      heading.className = 'nb-db-board-heading';
      const titleWrap = document.createElement('div');
      titleWrap.className = 'nb-db-board-group-title';
      const groupColumn = view.groupBy
        ? this.#data.columns.find(column => column.id === view.groupBy)
        : undefined;
      const groupIcon = document.createElement('span');
      groupIcon.className = 'nb-db-board-group-icon';
      groupIcon.innerHTML = groupColumn
        ? TYPE_ICON[groupColumn.type] ?? icon.text
        : icon.database;
      const label = document.createElement('span');
      label.className = 'nb-db-board-group-label';
      label.textContent = group.label;
      const count = document.createElement('span');
      count.className = 'nb-db-board-count';
      count.textContent = String(group.rows.length);
      titleWrap.append(groupIcon, label, count);
      heading.append(titleWrap);
      if (!this.#readonly) {
        const ops = document.createElement('div');
        ops.className = 'nb-db-board-group-ops';
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'nb-db-board-group-op';
        add.innerHTML = icon.plus;
        add.title = 'Add card';
        add.setAttribute('aria-label', 'Add card');
        add.addEventListener('click', event => {
          event.stopPropagation();
          this.#addBoardCard(view, view.groupBy ? group.key : undefined, 'start');
        }, { signal: this.#contentEvents.signal });
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'nb-db-board-group-op';
        more.innerHTML = icon.more;
        more.title = 'Group actions';
        more.setAttribute('aria-label', 'Group actions');
        more.addEventListener('click', event => {
          event.stopPropagation();
          this.#openBoardGroupMenu(more, view, group.key, group.rows);
        }, { signal: this.#contentEvents.signal });
        ops.append(add, more);
        heading.append(ops);
      }
      column.append(heading);

      const cards = document.createElement('div');
      cards.className = 'nb-db-board-cards';
      for (const row of group.rows) {
        cards.append(this.#renderBoardCard(row, titleColumn, view, columns));
      }
      if (group.rows.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'nb-db-board-empty';
        empty.textContent = 'No cards';
        cards.append(empty);
      }
      if (!this.#readonly) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'nb-db-board-add';
        add.innerHTML = `${icon.plus}<span>Add</span>`;
        add.addEventListener('click', () => {
          this.#addBoardCard(view, view.groupBy ? group.key : undefined, 'end');
        }, { signal: this.#contentEvents.signal });
        cards.append(add);
      }
      column.append(cards);
      board.append(column);
    }
    return board;
  }

  #clearBoardDropIndicators(): void {
    const scope = this.#scrollElement ?? this.element;
    for (const el of scope.querySelectorAll<HTMLElement>(
      '.is-drop-target, .is-drop-before, .is-drop-after'
    )) {
      el.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after');
    }
  }

  #renderBoardCard(
    row: DatabaseRow,
    titleColumn: DatabaseColumn | undefined,
    view: DatabaseViewConfig,
    columns: readonly DatabaseColumn[]
  ): HTMLElement {
    const card = document.createElement('article');
    card.className = 'nb-db-card';
    card.dataset.rowId = row.id;
    if (!this.#readonly && view.groupBy) {
      card.draggable = true;
      card.addEventListener(
        'dragstart',
        event => {
          event.dataTransfer?.setData('text/nobita-db', this.#instanceId);
          event.dataTransfer?.setData('text/nobita-row', row.id);
          event.dataTransfer?.setData(
            'text/nobita-group',
            card.closest<HTMLElement>('.nb-db-board-column')?.dataset.group ?? ''
          );
          event.dataTransfer?.setData('text/plain', row.id);
          card.classList.add('is-dragging');
        },
        { signal: this.#contentEvents.signal }
      );
      card.addEventListener(
        'dragend',
        () => {
          card.classList.remove('is-dragging');
          this.#clearBoardDropIndicators();
        },
        { signal: this.#contentEvents.signal }
      );
      card.addEventListener(
        'dragover',
        event => {
          event.preventDefault();
          event.stopPropagation();
          const rect = card.getBoundingClientRect();
          const before = event.clientY < rect.top + rect.height / 2;
          card.classList.toggle('is-drop-before', before);
          card.classList.toggle('is-drop-after', !before);
        },
        { signal: this.#contentEvents.signal }
      );
      card.addEventListener(
        'dragleave',
        event => {
          if (card.contains(event.relatedTarget as Node | null)) return;
          card.classList.remove('is-drop-before', 'is-drop-after');
        },
        { signal: this.#contentEvents.signal }
      );
      card.addEventListener(
        'drop',
        event => {
          event.preventDefault();
          event.stopPropagation();
          this.#clearBoardDropIndicators();
          if (event.dataTransfer?.getData('text/nobita-db') !== this.#instanceId) {
            return;
          }
          const sourceId = event.dataTransfer?.getData('text/nobita-row');
          if (!sourceId || sourceId === row.id) return;
          const rect = card.getBoundingClientRect();
          const before = event.clientY < rect.top + rect.height / 2;
          const targetGroup = card.closest<HTMLElement>('.nb-db-board-column')?.dataset.group;
          if (targetGroup !== undefined) {
            this.#moveBoardCard(
              sourceId,
              targetGroup,
              row.id,
              before,
              event.dataTransfer?.getData('text/nobita-group')
            );
          }
        },
        { signal: this.#contentEvents.signal }
      );
    }
    card.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (target.closest('.nb-db-card-title, .nb-db-card-ops')) return;
      this.#openDetailPanel(row.id);
    }, { signal: this.#contentEvents.signal });
    const title = document.createElement('div');
    title.className = 'nb-db-card-title';
    const cell = titleColumn ? row.cells[titleColumn.id] : undefined;
    const value = titleColumn
      ? titleColumn.type === 'number'
        ? formatDatabaseNumber(cell?.text ?? '', titleColumn)
        : databaseCellDisplay(cell, titleColumn.type)
      : '';
    const editable =
      titleColumn !== undefined &&
      !this.#readonly &&
      (titleColumn.type === 'text' ||
        titleColumn.type === 'number' ||
        titleColumn.type === 'date' ||
        titleColumn.type === 'url');
    title.textContent = value || (editable ? '' : 'Untitled');
    if (titleColumn && editable) {
      title.contentEditable = 'true';
      title.spellcheck = false;
      title.setAttribute('role', 'textbox');
      title.setAttribute('aria-label', titleColumn.name);
      title.addEventListener(
        'focus',
        () => {
          if (this.#boardBlurTimer !== null) {
            window.clearTimeout(this.#boardBlurTimer);
            this.#boardBlurTimer = null;
          }
          if (titleColumn.type === 'number') {
            title.textContent =
              this.#currentCell(row.id, titleColumn.id)?.text ?? '';
            placeCaret(title, 'end');
          }
          if (view.groupBy === titleColumn.id) {
            this.#boardTitleEditing = { rowId: row.id, columnId: titleColumn.id };
          }
        },
        { signal: this.#contentEvents.signal }
      );
      title.addEventListener(
        'blur',
        () => {
          const editing = this.#boardTitleEditing;
          if (editing?.rowId === row.id && editing.columnId === titleColumn.id) {
            this.#boardTitleEditing = null;
            if (this.#boardBlurTimer !== null) {
              window.clearTimeout(this.#boardBlurTimer);
            }
            this.#boardBlurTimer = window.setTimeout(() => {
              this.#boardBlurTimer = null;
              this.render();
            }, 0);
          } else if (titleColumn.type === 'number') {
            title.textContent = formatDatabaseNumber(
              this.#currentCell(row.id, titleColumn.id)?.text ?? '',
              titleColumn
            );
          }
        },
        { signal: this.#contentEvents.signal }
      );
      const commitTitle = (): void => {
        const raw = (title.textContent ?? '').replace(/\r?\n/gu, ' ');
        const value =
          titleColumn.type === 'number'
            ? raw.replace(/[^0-9eE+.-]/gu, '')
            : raw;
        const current = this.#currentCell(row.id, titleColumn.id);
        if ((current?.text ?? '') === value) return;
        this.#commitCell(
          row.id,
          titleColumn.id,
          this.#withText(current, value),
          `db:${row.id}:${titleColumn.id}`
        );
      };
      this.#attachCompositionHandlers(title, commitTitle, this.#contentEvents.signal);
      title.addEventListener(
        'input',
        event => {
          if (this.#composingTargets.has(title) || (event as InputEvent).isComposing) {
            return;
          }
          commitTitle();
        },
        { signal: this.#contentEvents.signal }
      );
      title.addEventListener(
        'keydown',
        event => {
          if (this.#isComposingKey(event, title)) return;
          const mod = event.metaKey || event.ctrlKey;
          if (mod && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            this.#history(event.shiftKey);
            return;
          }
          if (mod && event.key.toLowerCase() === 'y') {
            event.preventDefault();
            this.#history(true);
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            title.blur();
          }
        },
        { signal: this.#contentEvents.signal }
      );
      title.addEventListener(
        'paste',
        event => {
          event.preventDefault();
          const raw = (event.clipboardData?.getData('text/plain') ?? '').replace(
            /\r?\n/gu,
            ' '
          );
          const value =
            titleColumn.type === 'number'
              ? raw.replace(/[^0-9eE+.-]/gu, '')
              : raw;
          if (!value) return;
          this.#pastePlainText(title, value);
        },
        { signal: this.#contentEvents.signal }
      );
    }
    card.append(title);
    const fields = this.#boardFields(row, titleColumn, view, columns);
    if (fields) card.append(fields);
    if (!this.#readonly) {
      const ops = document.createElement('div');
      ops.className = 'nb-db-card-ops';
      const expand = document.createElement('button');
      expand.type = 'button';
      expand.className = 'nb-db-card-op';
      expand.innerHTML = icon.expand;
      expand.title = 'Open record';
      expand.setAttribute('aria-label', 'Open record');
      expand.addEventListener('click', event => {
        event.stopPropagation();
        this.#openDetailPanel(row.id);
      }, { signal: this.#contentEvents.signal });
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'nb-db-card-op';
      more.innerHTML = icon.more;
      more.title = 'Card actions';
      more.setAttribute('aria-label', 'Card actions');
      more.addEventListener('click', event => {
        event.stopPropagation();
        this.#openRowPopover(row.id, more);
      }, { signal: this.#contentEvents.signal });
      ops.append(expand, more);
      card.append(ops);
    }
    return card;
  }

  #boardFields(
    row: DatabaseRow,
    titleColumn: DatabaseColumn | undefined,
    view: DatabaseViewConfig,
    columns: readonly DatabaseColumn[]
  ): HTMLElement | null {
    const fields = document.createElement('div');
    fields.className = 'nb-db-card-fields';
    for (const column of columns) {
      if (column.id === titleColumn?.id || column.id === view.groupBy) continue;
      const display =
        column.type === 'number'
          ? formatDatabaseNumber(row.cells[column.id]?.text ?? '', column)
          : databaseCellDisplay(row.cells[column.id], column.type);
      if (!display) continue;
      const field = document.createElement('span');
      field.className = 'nb-db-card-field';
      field.title = `${column.name}: ${display}`;
      const fieldIcon = document.createElement('span');
      fieldIcon.className = 'nb-db-card-field-icon';
      fieldIcon.innerHTML = TYPE_ICON[column.type] ?? icon.text;
      const fieldValue = document.createElement('span');
      fieldValue.textContent = display;
      field.append(fieldIcon, fieldValue);
      fields.append(field);
    }
    return fields.childElementCount > 0 ? fields : null;
  }

  #history(redo: boolean): void {
    if (this.#readonly) return;
    if (redo) this.#host.redo();
    else this.#host.undo();
    this.#syncBoardValues(true);
  }

  #syncBoardValues(force = false): void {
    const view = this.#activeView();
    if (view.type !== 'board') return;
    const root = this.element.getRootNode() as ShadowRoot;
    const activeElement = root.activeElement;
    const columns = this.#visibleColumns(view);
    const titleColumn = this.#titleColumn(view) ?? columns[0];
    const rowById = new Map(this.#data.rows.map(row => [row.id, row]));
    const prev = this.#syncedData;
    const prevColumnsSame = prev !== null && prev.columns === this.#data.columns;
    const prevRowById =
      !force && prev ? new Map(prev.rows.map(row => [row.id, row])) : null;
    for (const card of this.element.querySelectorAll<HTMLElement>('.nb-db-card[data-row-id]')) {
      const rowId = card.dataset.rowId;
      if (!rowId) continue;
      const row = rowById.get(rowId);
      if (!row) continue;
      if (!force && prevColumnsSame && prevRowById?.get(rowId) === row) continue;
      const title = card.querySelector<HTMLElement>('.nb-db-card-title');
      if (title && !this.#composingTargets.has(title) && (force || activeElement !== title)) {
        const raw = titleColumn
          ? row.cells[titleColumn.id]?.text ?? ''
          : '';
        const editing = activeElement === title;
        const value = titleColumn
          ? titleColumn.type === 'number'
            ? editing
              ? raw
              : formatDatabaseNumber(raw, titleColumn)
            : databaseCellDisplay(row.cells[titleColumn.id], titleColumn.type)
          : '';
        const nextText =
          value || (title.contentEditable === 'true' ? '' : 'Untitled');
        if (title.textContent !== nextText) title.textContent = nextText;
      }
      const previous = card.querySelector('.nb-db-card-fields');
      const next = this.#boardFields(row, titleColumn, view, columns);
      if (previous && next) previous.replaceWith(next);
      else if (previous) previous.remove();
      else if (next) card.append(next);
    }
  }

  #defaultGroupColumn(): string | undefined {
    const columns = this.#visibleColumns();
    return (
      columns.find(column =>
        ['select', 'multi-select', 'checkbox'].includes(column.type)
      )?.id ?? columns[0]?.id
    );
  }

  #startColumnResize(event: PointerEvent, column: DatabaseColumn): void {
    if (this.#readonly) return;
    const index = this.#visibleColumns(this.#activeView()).findIndex(item => item.id === column.id);
    const col = this.#colElements[index];
    if (!col) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = col.getBoundingClientRect().width;
    this.#beginWindowDrag(
      moveEvent => {
        const width = Math.max(
          MIN_DATABASE_COLUMN_WIDTH,
          Math.min(
            MAX_DATABASE_COLUMN_WIDTH,
            Math.round(startWidth + moveEvent.clientX - startX)
          )
        );
        col.style.width = `${width}px`;
      },
      () => {
        const width = Number.parseFloat(col.style.width);
        if (Number.isFinite(width)) {
          this.#commitColumnWidth(column.id, width);
        }
      }
    );
  }

  #openFilterPopover(anchor: HTMLElement): void {
    const view = this.#activeView();
    const root = JSON.parse(
      JSON.stringify(databaseFilterGroup(view))
    ) as DatabaseFilterGroup;
    const content = document.createElement('div');
    content.className = 'nb-db-filter-popover';
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = 'Filters';
    content.append(title);
    const modeRow = document.createElement('label');
    modeRow.className = 'nb-db-field';
    const modeLabel = document.createElement('span');
    modeLabel.textContent = 'Match';
    const modeSelect = document.createElement('select');
    modeSelect.setAttribute('aria-label', 'Filter mode');
    for (const [value, label] of [['and', 'All filters'], ['or', 'Any filter']] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = root.op === value;
      modeSelect.append(option);
    }
    modeSelect.addEventListener('change', () => {
      root.op = modeSelect.value === 'or' ? 'or' : 'and';
    });
    modeRow.append(modeLabel, modeSelect);
    content.append(modeRow);

    const list = document.createElement('div');
    list.className = 'nb-db-filter-list';
    content.append(list);



    const render = (): void => {
      list.replaceChildren();
      this.#renderFilterGroup(root, list, 0, undefined, render);
      if (root.conditions.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'nb-db-filter-empty';
        empty.textContent = 'No filters. Showing all rows.';
        list.append(empty);
      }
    };
    const footer = document.createElement('div');
    footer.className = 'nb-db-pop-actions';
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = '+ Add filter';
    add.addEventListener('click', () => {
      const first = this.#data.columns[0];
      if (!first) return;
      root.conditions.push(this.#defaultFilter(first));
      render();
    });
    const addGroup = document.createElement('button');
    addGroup.type = 'button';
    addGroup.textContent = '+ Add group';
    addGroup.addEventListener('click', () => {
      root.conditions.push({ type: 'group', op: 'and', conditions: [] });
      render();
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear all';
    clear.addEventListener('click', () => {
      root.conditions = [];
      render();
    });
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => {
      root.op = modeSelect.value === 'or' ? 'or' : 'and';
      this.#setFilterTree(root);
      this.#closePopover();
    });
    footer.append(add, addGroup, clear, apply);
    content.append(footer);
    render();
    this.#showPopover(anchor, content);
  }

  #renderFilterCondition(
    filter: DatabaseFilter,
    parent: DatabaseFilterGroup,
    render: () => void
  ): HTMLElement {
    const column = this.#data.columns.find(item => item.id === filter.columnId);
    const row = document.createElement('div');
    row.className = 'nb-db-filter-row';
    if (!column) {
      row.textContent = 'This filter references a deleted column.';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'nb-db-filter-remove';
      remove.innerHTML = icon.x;
      remove.title = 'Remove filter';
      remove.setAttribute('aria-label', 'Remove filter');
      remove.addEventListener('click', () => {
        parent.conditions = parent.conditions.filter(item => item !== filter);
        render();
      });
      row.append(remove);
      return row;
    }
    const columnSelect = document.createElement('select');
    columnSelect.setAttribute('aria-label', 'Filter column');
    for (const item of this.#data.columns) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      option.selected = item.id === filter.columnId;
      columnSelect.append(option);
    }
    columnSelect.addEventListener('change', () => {
      const next = this.#data.columns.find(item => item.id === columnSelect.value);
      if (!next) return;
      filter.columnId = next.id;
      filter.operator = defaultFilterOperator(next.type);
      filter.value = next.type === 'checkbox' ? 'true' : '';
      render();
    });

    const operatorSelect = document.createElement('select');
    operatorSelect.setAttribute('aria-label', 'Filter operator');
    const operators = filterOperators(column.type);
    if (!operators.includes(filter.operator)) operators.unshift(filter.operator);
    for (const value of operators) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = FILTER_LABELS[value];
      option.selected = filter.operator === value;
      operatorSelect.append(option);
    }
    operatorSelect.addEventListener('change', () => {
      filter.operator = operatorSelect.value as DatabaseFilterOperator;
      render();
    });
    row.append(columnSelect, operatorSelect);

    const needsValue =
      filter.operator !== 'isEmpty' &&
      filter.operator !== 'isNotEmpty' &&
      filter.operator !== 'isChecked' &&
      filter.operator !== 'isUnchecked';
    if (needsValue) {
      if (column.type === 'select') {
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Filter value');
        const single = document.createElement('option');
        single.value = '';
        single.textContent = 'Choose…';
        select.append(single);
        for (const optionValue of column.options ?? []) {
          const option = document.createElement('option');
          option.value = optionValue;
          option.textContent = optionValue;
          option.selected = filter.value === optionValue;
          select.append(option);
        }
        select.addEventListener('change', () => {
          filter.value = select.value;
        });
        row.append(select);
      } else if (column.type === 'multi-select') {
        const input = document.createElement('input');
        input.value = filter.value ?? '';
        input.placeholder = 'Option, Option';
        input.setAttribute('aria-label', 'Filter value');
        input.addEventListener('input', () => {
          filter.value = input.value;
        });
        row.append(input);
      } else if (column.type === 'number') {
        const input = document.createElement('input');
        input.type = 'number';
        input.value = filter.value ?? '';
        input.setAttribute('aria-label', 'Filter value');
        input.addEventListener('input', () => {
          filter.value = input.value;
        });
        row.append(input);
      } else if (column.type === 'date') {
        const input = document.createElement('input');
        input.type = 'date';
        input.value = filter.value ?? '';
        input.setAttribute('aria-label', 'Filter value');
        input.addEventListener('input', () => {
          filter.value = input.value;
        });
        row.append(input);
      } else if (column.type === 'checkbox') {
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Filter value');
        for (const value of ['true', 'false']) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value === 'true' ? 'Checked' : 'Unchecked';
          option.selected = (filter.value ?? 'true') === value;
          select.append(option);
        }
        select.addEventListener('change', () => {
          filter.value = select.value;
        });
        row.append(select);
      } else {
        const input = document.createElement('input');
        input.value = filter.value ?? '';
        input.placeholder = 'Value';
        input.setAttribute('aria-label', 'Filter value');
        input.addEventListener('input', () => {
          filter.value = input.value;
        });
        row.append(input);
      }
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'nb-db-filter-remove';
    remove.innerHTML = icon.x;
    remove.title = 'Remove filter';
    remove.setAttribute('aria-label', 'Remove filter');
    remove.addEventListener('click', () => {
      parent.conditions = parent.conditions.filter(item => item !== filter);
      render();
    });
    row.append(remove);
    return row;
  }

  #renderFilterGroup(
    group: DatabaseFilterGroup,
    parent: HTMLElement,
    depth: number,
    parentGroup: DatabaseFilterGroup | undefined,
    render: () => void
  ): void {
    const box = document.createElement('div');
    box.className = depth === 0 ? 'nb-db-filter-root-group' : 'nb-db-filter-group';
    if (depth > 0) {
      const head = document.createElement('div');
      head.className = 'nb-db-filter-group-head';
      const op = document.createElement('select');
      op.setAttribute('aria-label', 'Filter group mode');
      for (const [value, label] of [['and', 'All'], ['or', 'Any']] as const) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = group.op === value;
        op.append(option);
      }
      op.addEventListener('change', () => {
        group.op = op.value === 'or' ? 'or' : 'and';
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'nb-db-filter-remove';
      remove.innerHTML = icon.x;
      remove.title = 'Remove group';
      remove.setAttribute('aria-label', 'Remove group');
      remove.addEventListener('click', () => {
        if (!parentGroup) return;
        parentGroup.conditions = parentGroup.conditions.filter(item => item !== group);
        render();
      });
      head.append(op, remove);
      box.append(head);
    }
    for (const item of group.conditions) {
      if (item.type === 'group') {
        this.#renderFilterGroup(item, box, depth + 1, group, render);
      } else {
        box.append(this.#renderFilterCondition(item, group, render));
      }
    }
    if (depth > 0) {
      const footer = document.createElement('div');
      footer.className = 'nb-db-filter-group-actions';
      const addCondition = document.createElement('button');
      addCondition.type = 'button';
      addCondition.className = 'nb-db-filter-add';
      addCondition.textContent = '+ Add condition';
      addCondition.addEventListener('click', () => {
        const first = this.#data.columns[0];
        if (!first) return;
        group.conditions.push(this.#defaultFilter(first));
        render();
      });
      footer.append(addCondition);
      if (depth < 4) {
        const addGroup = document.createElement('button');
        addGroup.type = 'button';
        addGroup.className = 'nb-db-filter-add';
        addGroup.textContent = '+ Add group';
        addGroup.addEventListener('click', () => {
          group.conditions.push({ type: 'group', op: 'and', conditions: [] });
          render();
        });
        footer.append(addGroup);
      }
      box.append(footer);
    }
    parent.append(box);
  }

  #openGroupPopover(anchor: HTMLElement): void {
    const view = this.#activeView();
    const content = document.createElement('div');
    content.className = 'nb-db-group-popover';
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = 'Group';
    content.append(title);
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Group by column');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'None';
    none.selected = !view.groupBy;
    select.append(none);
    const groupable = view.type === 'board'
      ? ['select', 'multi-select', 'checkbox']
      : ['text', 'number', 'date', 'select', 'multi-select', 'checkbox'];
    for (const column of this.#data.columns) {
      if (!groupable.includes(column.type)) continue;
      const option = document.createElement('option');
      option.value = column.id;
      option.textContent = column.name;
      option.selected = view.groupBy === column.id;
      select.append(option);
    }
    select.addEventListener('change', () => {
      const groupBy = select.value || null;
      if (!groupBy) {
        this.#updateActiveView({ groupBy: null });
        this.#closePopover();
        return;
      }
      const groups = groupedDatabaseRows(this.#data, { ...view, groupBy });
      this.#updateActiveView({
        groupBy,
        groupProperties: groups.map(group => {
          const existing = view.groupProperties?.find(item => item.key === group.key);
          return existing ? { ...existing } : { key: group.key };
        }),
      });
      this.#closePopover();
    });
    content.append(select);

    const hideEmpty = document.createElement('label');
    hideEmpty.className = 'nb-db-check-row';
    const hideEmptyInput = document.createElement('input');
    hideEmptyInput.type = 'checkbox';
    hideEmptyInput.checked = Boolean(view.hideEmptyGroups);
    hideEmptyInput.addEventListener('change', () => {
      this.#updateActiveView({ hideEmptyGroups: hideEmptyInput.checked });
    }, { signal: this.#events.signal });
    const hideEmptyLabel = document.createElement('span');
    hideEmptyLabel.textContent = 'Hide empty groups';
    hideEmpty.append(hideEmptyInput, hideEmptyLabel);
    content.append(hideEmpty);

    if (view.groupBy) {
      const groups = this.#groupsFor(view);
      const list = document.createElement('div');
      list.className = 'nb-db-group-setting-list';
      groups.forEach((group, index) => {
        const row = document.createElement('div');
        row.className = 'nb-db-group-setting';
        const label = document.createElement('span');
        label.className = 'nb-db-group-setting-name';
        label.textContent = group.label || 'No value';
        const count = document.createElement('span');
        count.className = 'nb-db-group-count';
        count.textContent = String(group.rows.length);
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'nb-db-property-move';
        up.innerHTML = icon.arrowUp;
        up.disabled = index === 0;
        up.title = 'Move group up';
        up.setAttribute('aria-label', `Move ${group.label || 'group'} up`);
        up.addEventListener('click', () => this.#moveGroup(group.key, -1), {
          signal: this.#events.signal,
        });
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'nb-db-property-move';
        down.innerHTML = icon.arrowDown;
        down.disabled = index === groups.length - 1;
        down.title = 'Move group down';
        down.setAttribute('aria-label', `Move ${group.label || 'group'} down`);
        down.addEventListener('click', () => this.#moveGroup(group.key, 1), {
          signal: this.#events.signal,
        });
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'nb-db-property-eye';
        toggle.dataset.hidden = String(Boolean(group.hidden));
        toggle.title = group.hidden ? 'Show group' : 'Hide group';
        toggle.setAttribute(
          'aria-label',
          group.hidden ? `Show ${group.label || 'group'}` : `Hide ${group.label || 'group'}`
        );
        toggle.innerHTML = group.hidden ? icon.expand : icon.checkboxSquare;
        toggle.addEventListener('click', () => {
          this.#closePopover();
          this.#setGroupProperty(group.key, { hide: !group.hidden });
        }, { signal: this.#events.signal });
        row.append(label, count, up, down, toggle);
        list.append(row);
      });
      content.append(list);
    }
    this.#showPopover(anchor, content);
    select.focus();
  }

  #moveGroup(key: string, direction: 1 | -1): void {
    const view = this.#activeView();
    if (!view.groupBy) return;
    const groups = this.#groupsFor(view);
    const index = groups.findIndex(group => group.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= groups.length) return;
    const keys = groups.map(group => group.key);
    const [keyValue] = keys.splice(index, 1);
    if (keyValue === undefined) return;
    keys.splice(target, 0, keyValue);
    const settings = view.groupProperties ?? [];
    const byKey = new Map(settings.map(group => [group.key, group]));
    const order = mergeOrder(
      settings.map(group => group.key),
      keys
    );
    this.#updateActiveView({
      groupProperties: order.map(groupKey => byKey.get(groupKey) ?? { key: groupKey }),
    });
  }

  #toggleRowSelection(rowId: string): void {
    if (this.#readonly) return;
    if (this.#selectedRows.has(rowId)) this.#selectedRows.delete(rowId);
    else this.#selectedRows.add(rowId);
    this.#syncRowSelection();
    this.element.focus({ preventScroll: true });
  }

  #syncRowSelection(): void {
    for (const tr of this.element.querySelectorAll<HTMLElement>(
      '.nb-db-table tbody tr[data-row-id]'
    )) {
      const selected = tr.dataset.rowId ? this.#selectedRows.has(tr.dataset.rowId) : false;
      tr.classList.toggle('is-row-selected', selected);
      const check = tr.querySelector<HTMLElement>('.nb-db-row-check');
      check?.setAttribute('aria-checked', String(selected));
    }
    this.#syncSelectionVisuals();
  }

  #deleteSelectedRows(): void {
    const selected = this.#selectedVisibleRows();
    if (selected.length === 0) return;
    const ids = new Set(selected.map(row => row.id));
    for (const id of ids) this.#selectedRows.delete(id);
    this.#commitDeletedRows(ids);
  }

  #selectedVisibleRows(): DatabaseRow[] {
    if (this.#selectedRows.size === 0) return [];
    const seen = new Set<string>();
    const rows: DatabaseRow[] = [];
    for (const row of this.#renderedRows(this.#activeView())) {
      if (!this.#selectedRows.has(row.id) || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    return rows;
  }

  #closeDetailPanel(
    options: { restoreFocus?: boolean; keepTrigger?: boolean } = {}
  ): void {
    const { restoreFocus = true, keepTrigger = false } = options;
    this.#hideCellToolbar();
    this.#pendingMarks = null;
    this.#detail?.remove();
    this.#detail = null;
    this.#detailRowId = null;
    this.#detailEvents.abort();
    this.#detailEvents = new AbortController();
    if (keepTrigger) return;
    const trigger = this.#detailTrigger;
    this.#detailTrigger = null;
    if (restoreFocus && trigger?.isConnected) {
      trigger.focus();
    }
  }

  #detailFocusables(panel: HTMLElement): HTMLElement[] {
    const candidates = panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
    );
    const result: HTMLElement[] = [];
    for (const element of candidates) {
      if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
        continue;
      }
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (element.getClientRects().length === 0) continue;
      result.push(element);
    }
    return result;
  }

  #openDetailPanel(rowId: string): void {
    const row = this.#data.rows.find(item => item.id === rowId);
    if (!row) return;
    const root = this.element.getRootNode() as ShadowRoot;
    const hadDetail = this.#detail !== null;
    if (!hadDetail) {
      const activeEl = root.activeElement ?? this.element.ownerDocument.activeElement;
      this.#detailTrigger = activeEl instanceof HTMLElement ? activeEl : null;
    }
    this.#closeDetailPanel({ restoreFocus: false, keepTrigger: true });
    this.#detailRowId = rowId;
    const view = this.#activeView();
    const titleColumn = this.#titleColumn(view);
    const backdrop = document.createElement('div');
    backdrop.className = 'nb-db-detail-backdrop';
    const panel = document.createElement('section');
    panel.className = 'nb-db-detail';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Record page');
    const bar = document.createElement('div');
    bar.className = 'nb-db-detail-bar';
    const nav = document.createElement('div');
    nav.className = 'nb-db-detail-nav';
    const navigate = (direction: -1 | 1): void => {
      const rows = this.#navigationRows(this.#activeView());
      const index = rows.findIndex(item => item.id === this.#detailRowId);
      const nextRow = rows[index + direction];
      if (nextRow) this.#openDetailPanel(nextRow.id);
    };
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'nb-db-detail-navbtn';
    prev.dataset.nav = 'prev';
    prev.innerHTML = icon.arrowUp;
    prev.title = 'Previous record';
    prev.setAttribute('aria-label', 'Previous record');
    prev.addEventListener('click', () => navigate(-1));
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'nb-db-detail-navbtn';
    next.dataset.nav = 'next';
    next.innerHTML = icon.arrowDown;
    next.title = 'Next record';
    next.setAttribute('aria-label', 'Next record');
    next.addEventListener('click', () => navigate(1));
    this.#syncDetailNav(prev, next, rowId);
    nav.append(prev, next);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'nb-db-detail-close';
    close.innerHTML = icon.x;
    close.setAttribute('aria-label', 'Close record page');
    close.addEventListener('click', () => this.#closeDetailPanel());
    bar.append(nav, close);
    panel.append(bar);

    const title = this.#renderDetailTitle(row, titleColumn);
    panel.append(title);

    const fields = document.createElement('div');
    fields.className = 'nb-db-detail-fields';
    for (const column of this.#visibleColumns(view)) {
      if (column.id === titleColumn?.id && titleTextEditable(titleColumn)) continue;
      fields.append(this.#renderDetailField(row, column));
    }
    panel.append(fields);

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'nb-db-detail-add';
    add.innerHTML = `${icon.plus}<span>Add Property</span>`;
    add.disabled = this.#readonly;
    add.addEventListener('click', () => this.#openAddPropertyMenu(add));
    panel.append(add);

    panel.append(this.#renderDetailPage(row));

    panel.addEventListener(
      'keydown',
      event => {
        if (event.key !== 'Tab') return;
        const focusables = this.#detailFocusables(panel);
        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }
        const active = root.activeElement as HTMLElement | null;
        const currentIndex = active ? focusables.indexOf(active) : -1;
        event.preventDefault();
        if (event.shiftKey) {
          const prevIndex =
            currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1;
          focusables[prevIndex]?.focus();
        } else {
          const nextIndex =
            currentIndex < 0 || currentIndex >= focusables.length - 1
              ? 0
              : currentIndex + 1;
          focusables[nextIndex]?.focus();
        }
      },
      { signal: this.#detailEvents.signal }
    );

    panel.addEventListener(
      'click',
      event => {
        const target = event.target as Element | null;
        const link = target?.closest<HTMLElement>('[data-link]');
        if (link && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          const href = safeHref(link.dataset.link);
          if (href) window.open(href, '_blank', 'noopener,noreferrer');
        }
      },
      { signal: this.#detailEvents.signal }
    );

    backdrop.append(panel);
    backdrop.addEventListener('pointerdown', event => {
      if (event.target === backdrop) this.#closeDetailPanel();
    });
    backdrop.addEventListener('keydown', event => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.stopPropagation();
        this.#history(event.shiftKey);
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        event.stopPropagation();
        this.#history(true);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.#closeDetailPanel();
      }
    });
    (root.querySelector('.nb-overlay') ?? root).append(backdrop);
    this.#detail = backdrop;
    if (this.#readonly) {
      close.focus();
    } else {
      title.focus();
      title.select();
    }
  }

  #renderDetailTitle(
    row: DatabaseRow,
    titleColumn: DatabaseColumn | undefined
  ): HTMLInputElement {
    const title = document.createElement('input');
    title.className = 'nb-db-detail-title';
    title.value = titleColumn
      ? titleColumn.type === 'number'
        ? formatDatabaseNumber(row.cells[titleColumn.id]?.text ?? '', titleColumn)
        : databaseCellText(row.cells[titleColumn.id], titleColumn.type)
      : '';
    title.placeholder = 'Untitled';
    title.setAttribute('aria-label', 'Record title');
    title.disabled = this.#readonly;
    if (titleColumn) title.dataset.columnId = titleColumn.id;
    if (titleTextEditable(titleColumn)) {
      title.addEventListener('input', () => {
        if (!titleColumn) return;
        const value =
          titleColumn.type === 'number'
            ? title.value.replace(/[^0-9eE+.-]/gu, '')
            : title.value;
        const current = this.#currentCell(row.id, titleColumn.id);
        if ((current?.text ?? '') === value) return;
        this.#commitCell(
          row.id,
          titleColumn.id,
          this.#withText(current, value),
          `db:${row.id}:${titleColumn.id}`
        );
      }, { signal: this.#detailEvents.signal });
      if (titleColumn?.type === 'number') {
        title.addEventListener('focus', () => {
          title.value = this.#currentCell(row.id, titleColumn.id)?.text ?? '';
          title.select();
        }, { signal: this.#detailEvents.signal });
        title.addEventListener('blur', () => {
          title.value = formatDatabaseNumber(
            this.#currentCell(row.id, titleColumn.id)?.text ?? '',
            titleColumn
          );
        }, { signal: this.#detailEvents.signal });
      }
    } else {
      title.readOnly = true;
      title.dataset.readonly = 'true';
    }
    return title;
  }

  #renderDetailPage(row: DatabaseRow): HTMLElement {
    const section = document.createElement('section');
    section.className = 'nb-db-detail-page';
    const head = document.createElement('div');
    head.className = 'nb-db-detail-page-head';
    const pageIcon = document.createElement('span');
    pageIcon.innerHTML = icon.page;
    const pageLabel = document.createElement('span');
    pageLabel.textContent = 'Page';
    head.append(pageIcon, pageLabel);
    const body = document.createElement('div');
    body.className = 'nb-db-page-text nb-db-rich-text';
    body.contentEditable = this.#readonly ? 'false' : 'true';
    body.spellcheck = false;
    body.dataset.placeholder = 'Write about this record…';
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-label', 'Record page body');
    this.#renderPageContent(body, row);
    if (!this.#readonly) {
      const commitPage = (): void => {
        const runs = normalizeRuns(readRunsFromDom(body));
        body.dataset.runs = this.#runsSignature(runs);
        this.#commitRowPage(row.id, runs, `db:${row.id}:page`);
      };
      this.#attachCompositionHandlers(body, commitPage, this.#detailEvents.signal, true);
      body.addEventListener(
        'input',
        event => {
          if (this.#composingTargets.has(body) || (event as InputEvent).isComposing) {
            return;
          }
          commitPage();
        },
        { signal: this.#detailEvents.signal }
      );
      this.#attachRichTextHandlers(body, this.#detailEvents.signal);
      body.addEventListener(
        'paste',
        event => {
          event.preventDefault();
          event.stopPropagation();
          const value = (event.clipboardData?.getData('text/plain') ?? '').replace(
            /\r\n?/gu,
            '\n'
          );
          if (!value) return;
          this.#pasteIntoRichText(body, value);
        },
        { signal: this.#detailEvents.signal }
      );
      body.addEventListener(
        'keydown',
        event => {
          if (this.#isComposingKey(event, body)) return;
          const tag = this.#shortcutTag(event);
          if (!tag) return;
          event.preventDefault();
          this.#toggleInlineTag(tag);
        },
        { signal: this.#detailEvents.signal }
      );
    }
    section.append(head, body);
    return section;
  }

  #renderPageContent(element: HTMLElement, row: DatabaseRow): void {
    const runs = row.page?.content ?? [];
    element.dataset.runs = this.#runsSignature(runs);
    if (runs.length > 0) renderInlineRuns(element, runs);
    else element.replaceChildren();
  }

  #commitRowPage(rowId: string, runs: readonly InlineRun[], mergeKey?: string): void {
    const rows = this.#data.rows.map(row => {
      if (row.id !== rowId) return row;
      if (runs.length === 0) {
        const { page: _page, ...rest } = row;
        return rest;
      }
      return {
        ...row,
        page: { content: cloneRuns(runs) },
      };
    });
    this.#host.commit({ ...this.#data, rows }, mergeKey ? { mergeKey } : undefined);
  }

  #renderDetailField(row: DatabaseRow, column: DatabaseColumn): HTMLElement {
    const field = document.createElement(column.type === 'text' ? 'div' : 'label');
    field.className = 'nb-db-detail-field';
    field.dataset.columnId = column.id;
    field.dataset.schema = detailFieldSchema(column);
    const name = document.createElement('span');
    name.className = 'nb-db-detail-field-name';
    const typeIcon = document.createElement('span');
    typeIcon.className = 'nb-db-detail-field-icon';
    typeIcon.innerHTML = TYPE_ICON[column.type] ?? icon.text;
    const label = document.createElement('span');
    label.textContent = column.name;
    name.append(typeIcon, label);
    field.append(name);

    const cell = row.cells[column.id];
    if (column.type === 'checkbox') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-db-check nb-db-detail-check';
      button.setAttribute('role', 'checkbox');
      button.setAttribute('aria-checked', String(Boolean(cell?.checked)));
      button.innerHTML = icon.check;
      button.disabled = this.#readonly;
      button.addEventListener('click', () => {
        const checked = button.getAttribute('aria-checked') !== 'true';
        button.setAttribute('aria-checked', String(checked));
        this.#commitCell(
          row.id,
          column.id,
          { ...(cell ?? {}), checked },
          `db:${row.id}:${column.id}`
        );
      }, { signal: this.#detailEvents.signal });
      field.append(button);
      return field;
    }

    if (column.type === 'select' || column.type === 'multi-select') {
      const select = document.createElement('select');
      select.className = 'nb-db-detail-input';
      select.disabled = this.#readonly;
      select.multiple = column.type === 'multi-select';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'Empty';
      select.append(empty);
      const selected = column.type === 'multi-select'
        ? new Set(cell?.values ?? [])
        : new Set(cell?.text ? [cell.text] : []);
      const options = [...(column.options ?? [])];
      for (const value of selected) {
        if (!options.includes(value)) options.push(value);
      }
      for (const option of options) {
        const item = document.createElement('option');
        item.value = option;
        item.textContent = option;
        item.selected = selected.has(option);
        select.append(item);
      }
      select.addEventListener('change', () => {
        const values = Array.from(select.selectedOptions)
          .map(item => item.value)
          .filter(Boolean);
        const next: DatabaseCell =
          column.type === 'multi-select'
            ? { ...(values.length > 0 ? { values } : {}) }
            : { ...(values[0] ? { text: values[0] } : {}) };
        this.#commitCell(row.id, column.id, next, `db:${row.id}:${column.id}`);
      }, { signal: this.#detailEvents.signal });
      field.append(select);
      return field;
    }

    if (column.type === 'number' || column.type === 'date' || column.type === 'url') {
      const input = document.createElement('input');
      input.className = 'nb-db-detail-input';
      input.disabled = this.#readonly;
      if (column.type === 'number') {
        this.#attachNumberInput(
          input,
          row,
          column,
          this.#detailEvents.signal
        );
      } else {
        input.type = 'text';
        input.value = cell?.text ?? '';
        input.addEventListener('input', () => {
          this.#commitCell(
            row.id,
            column.id,
            this.#withText(this.#currentCell(row.id, column.id), input.value),
            `db:${row.id}:${column.id}`
          );
        }, { signal: this.#detailEvents.signal });
      }
      field.append(input);
      return field;
    }

    if (column.type === 'files' || column.type === 'people') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-db-select nb-db-multi nb-db-detail-picker';
      button.disabled = this.#readonly;
      if (column.type === 'files') {
        this.#applyFilesLabel(button, cell?.files ?? [], column.name);
      } else {
        this.#applyPeopleLabel(button, cell?.people ?? [], column.name);
      }
      button.addEventListener('click', () => {
        if (column.type === 'files') {
          this.#openFilesPopover(column.id, row.id, button);
        } else {
          this.#openPeoplePopover(column.id, row.id, button);
        }
      }, { signal: this.#detailEvents.signal });
      field.append(button);
      return field;
    }

    const text = document.createElement('div');
    text.className = 'nb-db-detail-input nb-db-detail-text nb-db-rich-text';
    text.contentEditable = this.#readonly ? 'false' : 'true';
    text.spellcheck = false;
    text.dataset.richText = 'true';
    text.setAttribute('role', 'textbox');
    text.setAttribute('aria-label', column.name);
    text.setAttribute('aria-multiline', 'false');
    this.#renderTextCellContent(text, cell);
    if (!this.#readonly) {
      const commitField = (): void => {
        const runs = this.#readCellRuns(text);
        text.dataset.runs = this.#runsSignature(
          runs.some(run => run.marks) ? runs : undefined
        );
        this.#commitTextRuns(row.id, column.id, runs, `db:${row.id}:${column.id}`);
      };
      this.#attachCompositionHandlers(text, commitField, this.#detailEvents.signal, true);
      text.addEventListener('input', event => {
        if (this.#composingTargets.has(text) || (event as InputEvent).isComposing) {
          return;
        }
        commitField();
      }, { signal: this.#detailEvents.signal });
      this.#attachRichTextHandlers(text, this.#detailEvents.signal);
      text.addEventListener('paste', event => {
        event.preventDefault();
        event.stopPropagation();
        const value = (event.clipboardData?.getData('text/plain') ?? '').replace(
          /\r?\n/gu,
          ' '
        );
        if (!value) return;
        this.#pasteIntoRichText(text, value);
      }, { signal: this.#detailEvents.signal });
      text.addEventListener('keydown', event => {
        if (this.#isComposingKey(event, text)) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          text.blur();
          return;
        }
        const tag = this.#shortcutTag(event);
        if (!tag) return;
        event.preventDefault();
        this.#toggleInlineTag(tag);
      }, { signal: this.#detailEvents.signal });
    }
    field.append(text);
    return field;
  }

  #addFilterForColumn(columnId: string): void {
    const column = this.#data.columns.find(item => item.id === columnId);
    if (!column) return;
    const group = databaseFilterGroup(this.#activeView());
    this.#setFilterTree({
      ...group,
      conditions: [...group.conditions, this.#defaultFilter(column)],
    });
  }

  #defaultFilter(column: DatabaseColumn): DatabaseFilter {
    if (column.type === 'checkbox') {
      return { columnId: column.id, operator: 'isChecked' };
    }
    if (column.type === 'select') {
      return {
        columnId: column.id,
        operator: 'is',
        value: column.options?.[0] ?? '',
      };
    }
    if (column.type === 'multi-select') {
      return {
        columnId: column.id,
        operator: 'containsAny',
        value: column.options?.[0] ?? '',
      };
    }
    if (column.type === 'number') {
      return { columnId: column.id, operator: 'equal', value: '' };
    }
    if (column.type === 'date') {
      return { columnId: column.id, operator: 'is', value: '' };
    }
    return { columnId: column.id, operator: 'contains', value: '' };
  }

  #moveColumn(columnId: string, direction: 1 | -1): void {
    this.#patchViewColumn(columnId, {}, { move: direction });
  }

  #beginColumnDrag(event: PointerEvent, columnId: string): void {
    if (this.#readonly || event.button !== 0) return;
    if ((event.target as Element | null)?.closest('.nb-db-resizer')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    this.#beginWindowDrag(
      moveEvent => {
        if (Math.abs(moveEvent.clientX - startX) < 6 && Math.abs(moveEvent.clientY - startY) < 6) {
          return;
        }
        moved = true;
      },
      endEvent => {
        if (!moved) return;
        this.#suppressClick = true;
        window.setTimeout(() => {
          this.#suppressClick = false;
        }, 0);
        const target = this.#headerColumnFromEvent(endEvent);
        if (target && target !== columnId) this.#moveColumnTo(columnId, target);
      }
    );
  }

  #headerColumnFromEvent(event: Event): string | undefined {
    for (const node of event.composedPath()) {
      if (node instanceof HTMLElement && node.classList.contains('nb-db-th')) {
        return node.dataset.columnId;
      }
    }
    return undefined;
  }

  #moveColumnTo(columnId: string, targetId: string): void {
    const view = this.#activeView();
    const columns = this.#viewColumns(view);
    const from = columns.findIndex(column => column.id === columnId);
    const to = columns.findIndex(column => column.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const [column] = columns.splice(from, 1);
    if (!column) return;
    columns.splice(to, 0, column);
    this.#updateActiveView({ columns });
  }

  #beginRowDrag(event: PointerEvent, rowId: string, groupKey?: string): void {
    if (this.#readonly || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    this.#beginWindowDrag(
      moveEvent => {
        if (Math.abs(moveEvent.clientX - startX) < 6 && Math.abs(moveEvent.clientY - startY) < 6) {
          return;
        }
        moved = true;
      },
      endEvent => {
        if (!moved) return;
        this.#suppressClick = true;
        window.setTimeout(() => {
          this.#suppressClick = false;
        }, 0);
        const target = this.#rowFromEvent(endEvent);
        if (target && target !== rowId) this.#moveRowTo(rowId, target, groupKey);
      }
    );
  }

  #rowFromEvent(event: Event): string | undefined {
    for (const node of event.composedPath()) {
      if (node instanceof HTMLElement && node instanceof HTMLTableRowElement) {
        return node.dataset.rowId;
      }
    }
    return undefined;
  }

  #moveRowTo(rowId: string, targetId: string, groupKey?: string): void {
    const view = this.#activeView();
    if (view.type === 'table' && view.groupBy) {
      if (databaseSorts(view).length > 0) return;
      const groups = this.#groupsFor(view);
      const group =
        groupKey !== undefined
          ? groups.find(item => item.key === groupKey)
          : groups.find(item => item.rows.some(entry => entry.id === rowId));
      if (!group?.rows.some(entry => entry.id === targetId)) return;
      const ordered = [...group.rows];
      const groupFrom = ordered.findIndex(entry => entry.id === rowId);
      const groupTo = ordered.findIndex(entry => entry.id === targetId);
      if (groupFrom < 0 || groupTo < 0 || groupFrom === groupTo) return;
      const [moved] = ordered.splice(groupFrom, 1);
      if (!moved) return;
      ordered.splice(groupTo, 0, moved);
      const settings = seedGroupSettings(
        view.groupProperties ?? [],
        groups.map(item => item.key)
      );
      const visibleOrder = ordered.map(entry => entry.id);
      const savedOrder =
        settings.find(item => item.key === group.key)?.manuallyCardSort ?? [];
      const order = mergeOrder(savedOrder, visibleOrder);
      const groupProperties = settings.map(setting =>
        setting.key === group.key
          ? { ...setting, manuallyCardSort: order }
          : setting
      );
      const views = this.#views().map(item =>
        item.id === view.id ? { ...item, groupProperties } : item
      );
      this.#host.commit({ ...this.#data, views });
      return;
    }
    const rows = [...this.#data.rows];
    const from = rows.findIndex(row => row.id === rowId);
    const to = rows.findIndex(row => row.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const [row] = rows.splice(from, 1);
    if (!row) return;
    rows.splice(to, 0, row);
    this.#host.commit({ ...this.#data, rows });
  }

  #commitColumnWidth(columnId: string, width: number): void {
    const value = Math.max(
      MIN_DATABASE_COLUMN_WIDTH,
      Math.min(MAX_DATABASE_COLUMN_WIDTH, Math.round(width))
    );
    const view = this.#activeView();
    const views = this.#views().map(item => {
      const columns = this.#viewColumns(item).map(column =>
        item.id === view.id && column.id === columnId
          ? { ...column, width: value }
          : column
      );
      return { ...item, columns };
    });
    this.#host.commit({
      ...this.#data,
      columns: this.#data.columns.map(item =>
        item.id === columnId ? { ...item, width: value } : item
      ),
      views,
      activeViewId: view.id,
    });
  }

  #duplicateColumn(columnId: string): void {
    if (this.#data.columns.length >= 200) return;
    const source = this.#data.columns.find(column => column.id === columnId);
    if (!source) return;
    const index = this.#data.columns.findIndex(column => column.id === columnId);
    const column = createDatabaseColumn(
      `${source.name} copy`,
      source.type,
      source.options ?? [],
      source.data
    );
    const columns = [...this.#data.columns];
    columns.splice(index + 1, 0, column);
    const rows = this.#data.rows.map(row => {
      const cell = row.cells[source.id];
      if (!cell) return row;
      return {
        ...row,
        cells: {
          ...row.cells,
          [column.id]: this.#cloneCell(cell),
        },
      };
    });
    const view = this.#activeView();
    const views = this.#viewsWithColumn(column.id, columnId, true, 180, columnId);
    this.#host.commit({
      ...this.#data,
      columns,
      rows,
      views,
      activeViewId: view.id,
    });
  }

  #cellForGroupValue(
    column: DatabaseColumn,
    cell: DatabaseCell | undefined,
    groupKey: string
  ): DatabaseCell {
    const current = cell ?? {};
    if (column.type === 'checkbox') {
      const next = { ...current };
      if (groupKey === 'true') next.checked = true;
      else delete next.checked;
      return next;
    }
    if (column.type === 'multi-select') {
      const next = { ...current };
      if (groupKey) next.values = [groupKey];
      else delete next.values;
      return next;
    }
    const next = { ...current };
    delete next.runs;
    if (groupKey) next.text = groupKey;
    else delete next.text;
    return next;
  }

  #addBoardCard(
    view: DatabaseViewConfig,
    groupKey: string | undefined,
    position: 'start' | 'end'
  ): void {
    if (this.#readonly) return;
    const viewId = this.#activeView().id;
    const row = createDatabaseRow();
    const groupColumn = view.groupBy
      ? this.#data.columns.find(column => column.id === view.groupBy)
      : undefined;
    if (groupColumn && groupKey !== undefined) {
      row.cells[groupColumn.id] = this.#cellForGroupValue(
        groupColumn,
        undefined,
        groupKey
      );
    }
    const rows = [...this.#data.rows, row];
    let views = this.#views();
    if (
      groupColumn &&
      groupKey !== undefined &&
      databaseSorts(view).length === 0
    ) {
      const groups = this.#groupsFor(view);
      const group = groups.find(item => item.key === groupKey);
      const visible = group?.rows.map(item => item.id) ?? [];
      const order =
        position === 'start' ? [row.id, ...visible] : [...visible, row.id];
      const settings = seedGroupSettings(
        view.groupProperties ?? [],
        groups.map(item => item.key)
      );
      const groupProperties = settings.map(setting =>
        setting.key === groupKey
          ? {
              ...setting,
              manuallyCardSort: mergeOrder(
                setting.manuallyCardSort ?? [],
                order
              ),
            }
          : setting
      );
      views = views.map(item =>
        item.id === viewId ? { ...item, groupProperties } : item
      );
    }
    this.#pendingBoardFocus = row.id;
    this.#host.commit({
      ...this.#data,
      rows,
      views,
      activeViewId: viewId,
    });
  }

  #openBoardGroupMenu(
    anchor: HTMLElement,
    view: DatabaseViewConfig,
    groupKey: string,
    rows: readonly DatabaseRow[]
  ): void {
    const content = document.createElement('div');
    content.className = 'nb-db-pop-actions nb-db-board-group-menu';
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = 'Add card';
    add.addEventListener('click', () => {
      this.#closePopover();
      this.#addBoardCard(view, view.groupBy ? groupKey : undefined, 'end');
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Delete cards';
    remove.addEventListener('click', () => {
      this.#closePopover();
      const ids = new Set(rows.map(row => row.id));
      for (const id of ids) this.#selectedRows.delete(id);
      this.#commitDeletedRows(ids);
    });
    content.append(add, remove);
    this.#showPopover(anchor, content);
  }

  #moveBoardCard(
    rowId: string,
    targetGroupKey: string,
    targetRowId?: string,
    before = false,
    sourceGroupKey?: string
  ): void {
    const view = this.#activeView();
    if (view.type !== 'board' || !view.groupBy) return;
    const groupColumn = this.#data.columns.find(
      column => column.id === view.groupBy
    );
    const row = this.#data.rows.find(item => item.id === rowId);
    if (!groupColumn || !row) return;
    const groups = this.#groupsFor(view);
    const sourceGroup =
      (sourceGroupKey !== undefined
        ? groups.find(group => group.key === sourceGroupKey)
        : undefined) ??
      groups.find(group => group.rows.some(item => item.id === rowId));
    if (!sourceGroup) return;
    const sorts = databaseSorts(view).length > 0;
    const sameGroup = sourceGroup.key === targetGroupKey;
    if (sameGroup && sorts) return;
    if (sameGroup && targetRowId === rowId) return;

    let targetOrder = (
      groups.find(group => group.key === targetGroupKey)?.rows ?? []
    ).map(item => item.id);
    targetOrder = targetOrder.filter(id => id !== rowId);
    if (targetRowId) {
      const index = targetOrder.indexOf(targetRowId);
      if (index >= 0) targetOrder.splice(before ? index : index + 1, 0, rowId);
      else targetOrder.push(rowId);
    } else {
      targetOrder.push(rowId);
    }

    let sourceOrder = sourceGroup.rows.map(item => item.id).filter(
      id => id !== rowId
    );

    let rows = this.#data.rows;
    if (!sameGroup) {
      const cells = { ...row.cells };
      let next: DatabaseCell;
      if (groupColumn.type === 'multi-select') {
        const current = row.cells[groupColumn.id] ?? {};
        next = { ...current };
        if (!targetGroupKey) {
          delete next.values;
        } else {
          const existing = current.values ?? [];
          const filtered = sourceGroup.key
            ? existing.filter(value => value !== sourceGroup.key)
            : [...existing];
          if (!filtered.includes(targetGroupKey)) {
            filtered.push(targetGroupKey);
          }
          next.values = filtered;
        }
      } else {
        next = this.#cellForGroupValue(
          groupColumn,
          row.cells[groupColumn.id],
          targetGroupKey
        );
      }
      if (Object.keys(next).length > 0) cells[groupColumn.id] = next;
      else delete cells[groupColumn.id];
      rows = rows.map(item =>
        item.id === rowId ? { ...item, cells } : item
      );
    }

    let views = this.#views();
    if (!sorts) {
      const settings = seedGroupSettings(
        view.groupProperties ?? [],
        groups.map(group => group.key)
      );
      const groupProperties = settings.map(setting => {
        if (setting.key === targetGroupKey) {
          return {
            ...setting,
            manuallyCardSort: mergeOrder(
              (setting.manuallyCardSort ?? []).filter(id => id !== rowId),
              targetOrder
            ),
          };
        }
        if (!sameGroup && setting.key === sourceGroup.key) {
          return {
            ...setting,
            manuallyCardSort: mergeOrder(
              (setting.manuallyCardSort ?? []).filter(id => id !== rowId),
              sourceOrder
            ),
          };
        }
        return setting;
      });
      views = views.map(item =>
        item.id === view.id ? { ...item, groupProperties } : item
      );
    }

    const { view: _legacyView, sort: _legacySort, ...rest } = this.#data;
    this.#host.commit({
      ...rest,
      rows,
      views,
      activeViewId: view.id,
    });
  }

  #updateCount(view: DatabaseViewConfig = this.#activeView()): void {
    if (!this.#countElement) return;
    const total = this.#data.rows.length;
    const shown = this.#rowsFor(view).length;
    const rowText =
      shown === total ? `${total}` : `${shown} of ${total}`;
    const columnCount = this.#data.columns.length;
    this.#countElement.textContent = `${rowText} ${shown === 1 && total === 1 ? 'row' : 'rows'} · ${columnCount} ${
      columnCount === 1 ? 'column' : 'columns'
    }`;
  }

  #registerCell(key: string, nodes: CellNodes): void {
    const list = this.#cells.get(key);
    if (list) list.push(nodes);
    else this.#cells.set(key, [nodes]);
  }

  #currentCell(rowId: string, columnId: string): DatabaseCell | undefined {
    return this.#data.rows.find(row => row.id === rowId)?.cells[columnId];
  }

  #activateCellInput(
    element: HTMLElement,
    rowId: string,
    columnId: string
  ): void {
    const groupKey = element.closest<HTMLElement>('.nb-db-group')?.dataset.group;
    this.#active = {
      rowId,
      columnId,
      ...(groupKey !== undefined ? { groupKey } : {}),
    };
  }

  #attachNumberInput(
    input: HTMLInputElement,
    row: DatabaseRow,
    column: DatabaseColumn,
    signal: AbortSignal,
    onFocus?: () => void
  ): void {
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = formatDatabaseNumber(
      this.#currentCell(row.id, column.id)?.text ?? '',
      column
    );
    input.addEventListener(
      'input',
      () => {
        const value = input.value.replace(/[^0-9eE+.-]/gu, '');
        this.#commitCell(
          row.id,
          column.id,
          this.#withText(this.#currentCell(row.id, column.id), value),
          `db:${row.id}:${column.id}`
        );
      },
      { signal }
    );
    input.addEventListener(
      'focus',
      () => {
        onFocus?.();
        input.value = this.#currentCell(row.id, column.id)?.text ?? '';
        input.select();
      },
      { signal }
    );
    input.addEventListener(
      'blur',
      () => {
        input.value = formatDatabaseNumber(
          this.#currentCell(row.id, column.id)?.text ?? '',
          column
        );
      },
      { signal }
    );
  }

  #syncTitle(): void {
    const input = this.#titleInput;
    if (!input) return;
    const value = this.#data.title ?? '';
    if (input.value !== value) input.value = value;
  }

  #syncValues(): void {
    const root = this.element.getRootNode() as ShadowRoot;
    const prev = this.#syncedData;
    const prevColumnsSame = prev !== null && prev.columns === this.#data.columns;
    const prevRowById = prev
      ? new Map(prev.rows.map(row => [row.id, row]))
      : null;
    const prevColById =
      prev && !prevColumnsSame
        ? new Map(prev.columns.map(column => [column.id, column]))
        : null;

    for (const row of this.#data.rows) {
      const prevRow = prevRowById?.get(row.id);
      if (prevRow === row && prevColumnsSame) continue;
      for (const column of this.#data.columns) {
        const cell = row.cells[column.id];
        if (prevRow) {
          const prevCol = prevColumnsSame ? column : prevColById?.get(column.id);
          if (prevCol === column && prevRow.cells[column.id] === cell) continue;
        }
        const copies = this.#cells.get(cellKey(row.id, column.id));
        if (!copies) continue;
        const value = column.type === 'checkbox' ? '' : cell?.text ?? '';
        for (const nodes of copies) {
          if (nodes.text && !this.#composingTargets.has(nodes.text)) {
            const target = nodes.text;
            const updateText = (apply: () => void, nextLength: number): void => {
              const focused = root.activeElement === target;
              const saved = focused ? selectionOffsets(target) : null;
              apply();
              if (focused && saved) {
                setSelectionOffsets(
                  target,
                  Math.min(saved.start, nextLength),
                  Math.min(saved.end, nextLength)
                );
              }
            };
            if (target.dataset.richText === 'true') {
              const signature = this.#runsSignature(cell?.runs);
              if (target.dataset.runs !== signature) {
                const nextLength = cell?.runs ? runsLength(cell.runs) : value.length;
                updateText(() => this.#renderTextCellContent(target, cell), nextLength);
              } else if (!cell?.runs && target.textContent !== value) {
                updateText(() => {
                  target.textContent = value;
                }, value.length);
              }
            } else if (target.textContent !== value) {
              updateText(() => {
                target.textContent = value;
              }, value.length);
            }
          }
          if (nodes.input) {
            const inputValue =
              column.type === 'number' && !nodes.input.matches(':focus')
                ? formatDatabaseNumber(value, column)
                : value;
            if (nodes.input.value !== inputValue) nodes.input.value = inputValue;
          }
          if (nodes.button && column.type === 'checkbox') {
            nodes.button.setAttribute('aria-checked', String(Boolean(cell?.checked)));
          }
          if (nodes.button && column.type === 'select') {
            this.#applySelectLabel(nodes.button, value, column.options, column.name);
          }
          if (nodes.button && column.type === 'multi-select') {
            this.#applyMultiLabel(nodes.button, cell?.values ?? [], column.name);
          }
          if (nodes.button && column.type === 'files') {
            this.#applyFilesLabel(nodes.button, cell?.files ?? [], column.name);
          }
          if (nodes.button && column.type === 'people') {
            this.#applyPeopleLabel(nodes.button, cell?.people ?? [], column.name);
          }
        }
      }
    }
    this.#syncTitle();
    this.#syncBoardValues();
    this.#syncStats();
    this.#syncDetailPanel();
    this.#updateCount(this.#activeView());
    this.#syncedData = this.#data;
  }

  #syncDetailPanel(): void {
    const detail = this.#detail;
    const rowId = this.#detailRowId;
    if (!detail || !rowId) return;
    const row = this.#data.rows.find(item => item.id === rowId);
    if (!row) return;
    const prev = detail.querySelector<HTMLButtonElement>(
      '.nb-db-detail-navbtn[data-nav="prev"]'
    );
    const next = detail.querySelector<HTMLButtonElement>(
      '.nb-db-detail-navbtn[data-nav="next"]'
    );
    if (prev && next) this.#syncDetailNav(prev, next, rowId);
    const pageBody = detail.querySelector<HTMLElement>('.nb-db-page-text');
    if (pageBody && !this.#composingTargets.has(pageBody)) {
      const root = this.element.getRootNode() as ShadowRoot;
      const signature = this.#runsSignature(row.page?.content ?? []);
      if (pageBody.dataset.runs !== signature) {
        const focused = root.activeElement === pageBody;
        this.#renderPageContent(pageBody, row);
        if (focused) placeCaret(pageBody, 'end');
      }
    }
    const view = this.#activeView();
    const titleColumn = this.#titleColumn(view);
    const fields = detail.querySelector<HTMLElement>('.nb-db-detail-fields');
    if (fields) {
      const columns = this.#visibleColumns(view).filter(
        column => !(column.id === titleColumn?.id && titleTextEditable(titleColumn))
      );
      const current = [
        ...fields.querySelectorAll<HTMLElement>('.nb-db-detail-field'),
      ];
      const currentKeys = current.map(
        field => `${field.dataset.columnId ?? ''}\u0000${field.dataset.schema ?? ''}`
      );
      const desiredKeys = columns.map(
        column => `${column.id}\u0000${detailFieldSchema(column)}`
      );
      if (
        currentKeys.length !== desiredKeys.length ||
        currentKeys.some((key, index) => key !== desiredKeys[index])
      ) {
        const byId = new Map(
          current.map(field => [field.dataset.columnId ?? '', field])
        );
        const wanted = new Set(columns.map(column => column.id));
        for (const field of current) {
          if (!wanted.has(field.dataset.columnId ?? '')) field.remove();
        }
        for (const column of columns) {
          const schema = detailFieldSchema(column);
          let field = byId.get(column.id);
          if (field?.dataset.schema !== schema) {
            field?.remove();
            field = this.#renderDetailField(row, column);
          }
          fields.append(field);
        }
      }
    }
    let title = detail.querySelector<HTMLInputElement>('.nb-db-detail-title');
    if (title) {
      if (title.dataset.columnId !== (titleColumn?.id ?? '')) {
        const focused = title.matches(':focus');
        const replacement = this.#renderDetailTitle(row, titleColumn);
        title.replaceWith(replacement);
        if (focused) {
          replacement.focus();
          const end = replacement.value.length;
          replacement.setSelectionRange(end, end);
        }
        title = replacement;
      }
      const input = title;
      const column = input.dataset.columnId
        ? this.#data.columns.find(item => item.id === input.dataset.columnId)
        : undefined;
      if (column) {
        const cell = row.cells[column.id];
        const value =
          column.type === 'number'
            ? cell?.text ?? ''
            : databaseCellText(cell, column.type);
        const formatted =
          column.type === 'number'
            ? formatDatabaseNumber(value, column)
            : value;
        this.#syncDetailInput(input, value, formatted);
      }
    }
    for (const field of detail.querySelectorAll<HTMLElement>(
      '.nb-db-detail-field[data-column-id]'
    )) {
      const column = this.#data.columns.find(
        item => item.id === field.dataset.columnId
      );
      if (!column) continue;
      const cell = row.cells[column.id];
      const check = field.querySelector<HTMLButtonElement>(
        'button[role="checkbox"]'
      );
      if (check) {
        check.setAttribute('aria-checked', String(Boolean(cell?.checked)));
        continue;
      }
      const picker = field.querySelector<HTMLButtonElement>(
        'button.nb-db-detail-picker'
      );
      if (picker) {
        if (column.type === 'files') {
          this.#applyFilesLabel(picker, cell?.files ?? [], column.name);
        } else if (column.type === 'people') {
          this.#applyPeopleLabel(picker, cell?.people ?? [], column.name);
        }
        continue;
      }
      const select = field.querySelector<HTMLSelectElement>('select');
      if (select) {
        const selected =
          column.type === 'multi-select'
            ? new Set(cell?.values ?? [])
            : new Set(cell?.text ? [cell.text] : []);
        const optionValues = new Set(
          Array.from(select.options).map(option => option.value)
        );
        for (const value of selected) {
          if (!value || optionValues.has(value)) continue;
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          select.append(option);
          optionValues.add(value);
        }
        for (const option of select.options) {
          if (!option.value) continue;
          option.selected = selected.has(option.value);
        }
        continue;
      }
      const input = field.querySelector<HTMLInputElement>('input');
      if (input) {
        const value = cell?.text ?? '';
        const formatted =
          column.type === 'number'
            ? formatDatabaseNumber(value, column)
            : value;
        this.#syncDetailInput(input, value, formatted);
        continue;
      }
      const text = field.querySelector<HTMLElement>('.nb-db-detail-text');
      const textValue = cell?.text ?? '';
      if (text && this.#composingTargets.has(text)) continue;
      if (text && text.dataset.richText === 'true') {
        const signature = this.#runsSignature(cell?.runs);
        if (
          text.dataset.runs !== signature ||
          text.textContent !== textValue
        ) {
          const focused = text.matches(':focus');
          const offsets = focused ? selectionOffsets(text) : null;
          this.#renderTextCellContent(text, cell);
          if (offsets) {
            setSelectionOffsets(
              text,
              Math.min(offsets.start, textValue.length),
              Math.min(offsets.end, textValue.length)
            );
          }
        }
      } else if (text && text.textContent !== textValue) {
        if (text.matches(':focus')) {
          const offsets = selectionOffsets(text);
          text.textContent = textValue;
          if (offsets) {
            setSelectionOffsets(
              text,
              Math.min(offsets.start, textValue.length),
              Math.min(offsets.end, textValue.length)
            );
          }
        } else {
          text.textContent = textValue;
        }
      }
    }
  }

  #syncDetailNav(
    prev: HTMLButtonElement,
    next: HTMLButtonElement,
    rowId: string
  ): void {
    const rows = this.#navigationRows(this.#activeView());
    const index = rows.findIndex(item => item.id === rowId);
    prev.disabled = index <= 0;
    next.disabled = index < 0 || index >= rows.length - 1;
  }

  #syncDetailInput(
    input: HTMLInputElement,
    value: string,
    formatted: string
  ): void {    const focused = input.matches(':focus');
    const next = focused ? value : formatted;
    if (input.value === next) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = next;
    if (focused && start !== null && end !== null) {
      try {
        input.setSelectionRange(start, end);
      } catch {
        // Some input types do not support selection ranges.
      }
    }
  }

  #syncStats(): void {
    const view = this.#activeView();
    const states = this.#columnStates(view);
    const stateByColId = new Map<string, (typeof states)[number]>();
    let hasAnyStat = false;
    for (const state of states) {
      stateByColId.set(state.column.id, state);
      if (!state.hide && state.stat) hasAnyStat = true;
    }
    if (!hasAnyStat) {
      for (const button of this.element.querySelectorAll<HTMLButtonElement>(
        '.nb-db-table .nb-db-stat[data-stat-column]'
      )) {
        if (button.dataset.calculated !== 'false') {
          button.dataset.calculated = 'false';
          button.textContent = 'Calculate';
        }
      }
      return;
    }
    let groups: ReturnType<typeof groupedDatabaseRows> | null = null;
    for (const table of this.element.querySelectorAll<HTMLElement>('.nb-db-table')) {
      const groupKey = table.closest<HTMLElement>('.nb-db-group')?.dataset.group;
      let rows: DatabaseRow[] | null = null;
      for (const button of table.querySelectorAll<HTMLButtonElement>('.nb-db-stat[data-stat-column]')) {
        const columnId = button.dataset.statColumn;
        const state = columnId ? stateByColId.get(columnId) : undefined;
        if (!state) continue;
        const stat = state.stat;
        if (!stat) {
          if (button.dataset.calculated !== 'false') {
            button.dataset.calculated = 'false';
            button.textContent = 'Calculate';
          }
          continue;
        }
        if (!rows) {
          if (groupKey === undefined) {
            rows = this.#rowsFor(view);
          } else {
            groups ??= this.#groupsFor(view);
            rows = groups.find(group => group.key === groupKey)?.rows ?? [];
          }
        }
        button.dataset.calculated = 'true';
        button.textContent = `${DATABASE_STAT_LABELS[stat]}: ${databaseStatValue(rows, state.column, stat)}`;
      }
    }
  }

  #createCell(row: DatabaseRow, column: DatabaseColumn): HTMLTableCellElement {
    const td = document.createElement('td');
    td.className = `nb-db-cell nb-db-cell-${column.type}`;
    td.dataset.rowId = row.id;
    td.dataset.columnId = column.id;
    const cell = row.cells[column.id];
    const key = cellKey(row.id, column.id);
    const nodes: CellNodes = { td };
    td.addEventListener(
      'pointerdown',
      event => this.#onCellPointerDown(event, row.id, column.id),
      { signal: this.#contentEvents.signal }
    );

    if (column.type === 'checkbox') {
      this.#createCheckboxCell(td, nodes, row, column, cell);
    } else if (column.type === 'select') {
      this.#createSelectCell(td, nodes, row, column, cell);
    } else if (
      column.type === 'multi-select' ||
      column.type === 'files' ||
      column.type === 'people'
    ) {
      this.#createPickerCell(td, nodes, row, column, cell);
    } else if (column.type === 'number' || column.type === 'date') {
      this.#createValueCell(td, nodes, row, column, cell);
    } else {
      this.#createTextCell(td, nodes, row, column, cell);
    }

    this.#registerCell(key, nodes);
    return td;
  }

  #createCheckboxCell(
    td: HTMLTableCellElement,
    nodes: CellNodes,
    row: DatabaseRow,
    column: DatabaseColumn,
    cell: DatabaseCell | undefined
  ): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nb-db-check';
    button.setAttribute('role', 'checkbox');
    button.setAttribute('aria-checked', String(Boolean(cell?.checked)));
    button.setAttribute('aria-label', column.name);
    button.innerHTML = icon.check;
    button.disabled = this.#readonly;
    button.addEventListener(
      'click',
      event => {
        event.preventDefault();
        const checked = button.getAttribute('aria-checked') !== 'true';
        button.setAttribute('aria-checked', String(checked));
        this.#commitCell(
          row.id,
          column.id,
          { ...(cell?.text ? { text: cell.text } : {}), checked },
          `db:${row.id}:${column.id}`
        );
      },
      { signal: this.#contentEvents.signal }
    );
    button.addEventListener(
      'keydown',
      event => this.#onCellKeyDown(event, row.id, column.id, 'checkbox'),
      { signal: this.#contentEvents.signal }
    );
    td.append(button);
    nodes.button = button;
  }

  #createSelectCell(
    td: HTMLTableCellElement,
    nodes: CellNodes,
    row: DatabaseRow,
    column: DatabaseColumn,
    cell: DatabaseCell | undefined
  ): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nb-db-select';
    button.disabled = this.#readonly;
    this.#applySelectLabel(button, cell?.text ?? '', column.options, column.name);
    button.addEventListener(
      'click',
      () => this.#openSelectPopover(column.id, row.id, button),
      { signal: this.#contentEvents.signal }
    );
    button.addEventListener(
      'keydown',
      event => {
        if (!(event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          this.#openSelectPopover(column.id, row.id, button);
          return;
        }
        this.#onCellKeyDown(event, row.id, column.id, 'select');
      },
      { signal: this.#contentEvents.signal }
    );
    td.append(button);
    nodes.button = button;
  }

  #createPickerCell(
    td: HTMLTableCellElement,
    nodes: CellNodes,
    row: DatabaseRow,
    column: DatabaseColumn,
    cell: DatabaseCell | undefined
  ): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nb-db-select nb-db-multi';
    button.disabled = this.#readonly;
    if (column.type === 'multi-select') {
      this.#applyMultiLabel(button, cell?.values ?? [], column.name);
    } else if (column.type === 'files') {
      this.#applyFilesLabel(button, cell?.files ?? [], column.name);
    } else {
      this.#applyPeopleLabel(button, cell?.people ?? [], column.name);
    }
    button.addEventListener(
      'click',
      () => {
        if (column.type === 'multi-select') {
          this.#openMultiSelectPopover(column.id, row.id, button);
        } else if (column.type === 'files') {
          this.#openFilesPopover(column.id, row.id, button);
        } else {
          this.#openPeoplePopover(column.id, row.id, button);
        }
      },
      { signal: this.#contentEvents.signal }
    );
    button.addEventListener(
      'keydown',
      event => {
        if (!(event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          button.click();
          return;
        }
        this.#onCellKeyDown(event, row.id, column.id, column.type as CellKind);
      },
      { signal: this.#contentEvents.signal }
    );
    td.append(button);
    nodes.button = button;
  }

  #createValueCell(
    td: HTMLTableCellElement,
    nodes: CellNodes,
    row: DatabaseRow,
    column: DatabaseColumn,
    cell: DatabaseCell | undefined
  ): void {
    const input = document.createElement('input');
    input.className = 'nb-db-input';
    input.disabled = this.#readonly;
    input.setAttribute('aria-label', column.name);
    if (column.type === 'number') {
      this.#attachNumberInput(
        input,
        row,
        column,
        this.#contentEvents.signal,
        () => this.#activateCellInput(input, row.id, column.id)
      );
    } else {
      input.type = 'text';
      input.placeholder = 'YYYY-MM-DD';
      input.value = cell?.text ?? '';
      input.addEventListener(
        'input',
        () => {
          this.#commitCell(
            row.id,
            column.id,
            this.#withText(this.#currentCell(row.id, column.id), input.value),
            `db:${row.id}:${column.id}`
          );
        },
        { signal: this.#contentEvents.signal }
      );
      input.addEventListener(
        'focus',
        () => this.#activateCellInput(input, row.id, column.id),
        { signal: this.#contentEvents.signal }
      );
    }
    input.addEventListener(
      'keydown',
      event => this.#onCellKeyDown(event, row.id, column.id, column.type as CellKind),
      { signal: this.#contentEvents.signal }
    );
    td.append(input);
    nodes.input = input;
  }

  #createTextCell(
    td: HTMLTableCellElement,
    nodes: CellNodes,
    row: DatabaseRow,
    column: DatabaseColumn,
    cell: DatabaseCell | undefined
  ): void {
    const text = document.createElement('div');
    text.className = 'nb-db-text';
    text.contentEditable = this.#readonly ? 'false' : 'true';
    text.spellcheck = false;
    text.dataset.placeholder = column.type === 'url' ? 'https://…' : 'Empty';
    text.dataset.richText = String(column.type === 'text');
    text.setAttribute('role', 'textbox');
    text.setAttribute('aria-label', column.name);
    if (column.type === 'text') {
      text.classList.add('nb-db-rich-text');
      this.#renderTextCellContent(text, cell);
    } else {
      text.textContent = cell?.text ?? '';
    }
    if (!this.#readonly) {
      const commitCellText = (): void => {
        if (column.type !== 'text') {
          const value = (text.textContent ?? '').replace(/\r?\n/gu, ' ');
          this.#commitCell(
            row.id,
            column.id,
            this.#withText(this.#currentCell(row.id, column.id), value),
            `db:${row.id}:${column.id}`
          );
          return;
        }
        const runs = this.#readCellRuns(text);
        text.dataset.runs = this.#runsSignature(
          runs.some(run => run.marks) ? runs : undefined
        );
        this.#commitTextRuns(row.id, column.id, runs, `db:${row.id}:${column.id}`);
      };
      this.#attachCompositionHandlers(
        text,
        commitCellText,
        this.#contentEvents.signal,
        column.type === 'text'
      );
      text.addEventListener(
        'input',
        event => {
          if (this.#composingTargets.has(text) || (event as InputEvent).isComposing) {
            return;
          }
          commitCellText();
        },
        { signal: this.#contentEvents.signal }
      );
      if (column.type === 'text') {
        this.#attachRichTextHandlers(text, this.#contentEvents.signal);
      }
      text.addEventListener(
        'focus',
        () => this.#activateCellInput(text, row.id, column.id),
        { signal: this.#contentEvents.signal }
      );
      text.addEventListener(
        'keydown',
        event => this.#onCellKeyDown(event, row.id, column.id, 'text'),
        { signal: this.#contentEvents.signal }
      );
      text.addEventListener(
        'paste',
        event => {
          event.preventDefault();
          const value = (event.clipboardData?.getData('text/plain') ?? '').replace(
            /\r?\n/gu,
            ' '
          );
          if (!value) return;
          if (column.type === 'text') {
            this.#pasteIntoRichText(text, value);
          } else {
            this.#pastePlainText(text, value);
          }
        },
        { signal: this.#contentEvents.signal }
      );
    }
    td.append(text);
    nodes.text = text;
  }

  #runsSignature(runs: readonly InlineRun[] | undefined): string {
    return JSON.stringify(runs ?? []);
  }

  #renderTextCellContent(element: HTMLElement, cell: DatabaseCell | undefined): void {
    const runs = cell?.runs;
    element.dataset.runs = this.#runsSignature(runs);
    if (runs && runs.length > 0) {
      renderInlineRuns(element, runs);
    } else {
      element.textContent = cell?.text ?? '';
    }
  }

  #readCellRuns(element: HTMLElement): InlineRun[] {
    return normalizeRuns(
      readRunsFromDom(element).map(run => ({
        ...run,
        text: run.text.replace(/\r?\n/gu, ' '),
        ...(run.marks ? { marks: { ...run.marks } } : {}),
      }))
    );
  }

  #commitTextRuns(
    rowId: string,
    columnId: string,
    runs: readonly InlineRun[],
    mergeKey?: string
  ): void {
    const current = this.#currentCell(rowId, columnId);
    const cell: DatabaseCell = { ...(current ?? {}) };
    const text = plainText(runs);
    if (text) cell.text = text;
    else delete cell.text;
    if (runs.some(run => run.marks)) cell.runs = cloneRuns(runs);
    else delete cell.runs;
    this.#commitCell(rowId, columnId, cell, mergeKey);
  }

  #applySelectLabel(
    button: HTMLButtonElement,
    value: string,
    options: string[] = [],
    columnName?: string
  ): void {
    button.replaceChildren();
    if (columnName) {
      button.setAttribute('aria-label', value ? `${columnName}: ${value}` : columnName);
    }
    if (!value) {
      button.classList.add('is-empty');
      const label = document.createElement('span');
      label.textContent = 'Select…';
      button.append(label);
      return;
    }
    button.classList.remove('is-empty');
    const dot = document.createElement('span');
    dot.className = 'nb-db-dot';
    const palette = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4'];
    const optionIndex = options.indexOf(value);
    let hash = 2166136261;
    for (const char of value) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    const index = optionIndex >= 0 ? optionIndex : Math.abs(hash);
    dot.style.background = palette[index % palette.length] ?? '#3b82f6';
    const label = document.createElement('span');
    label.textContent = value;
    button.append(dot, label);
  }

  #applyMultiLabel(
    button: HTMLButtonElement,
    values: string[],
    columnName?: string
  ): void {
    button.replaceChildren();
    if (columnName) {
      button.setAttribute(
        'aria-label',
        values.length > 0 ? `${columnName}: ${values.join(', ')}` : columnName
      );
    }
    button.classList.toggle('is-empty', values.length === 0);
    if (values.length === 0) {
      const label = document.createElement('span');
      label.textContent = 'Select…';
      button.append(label);
      return;
    }
    for (const value of values.slice(0, 3)) {
      const chip = document.createElement('span');
      chip.className = 'nb-db-chip';
      chip.textContent = value;
      button.append(chip);
    }
    if (values.length > 3) {
      const more = document.createElement('span');
      more.className = 'nb-db-chip';
      more.textContent = `+${values.length - 3}`;
      button.append(more);
    }
  }

  #applyFilesLabel(
    button: HTMLButtonElement,
    files: DatabaseFile[],
    columnName?: string
  ): void {
    button.replaceChildren();
    button.classList.toggle('is-empty', files.length === 0);
    const summary =
      files.length === 0
        ? ''
        : files.length === 1
          ? files[0]!.name
          : `${files.length} files`;
    if (columnName) {
      button.setAttribute('aria-label', summary ? `${columnName}: ${summary}` : columnName);
    }
    const label = document.createElement('span');
    label.textContent = summary || 'Add file…';
    button.append(label);
  }

  #applyPeopleLabel(
    button: HTMLButtonElement,
    people: DatabasePerson[],
    columnName?: string
  ): void {
    button.replaceChildren();
    button.classList.toggle('is-empty', people.length === 0);
    const summary = people.map(person => person.label).join(', ');
    if (columnName) {
      button.setAttribute('aria-label', summary ? `${columnName}: ${summary}` : columnName);
    }
    const label = document.createElement('span');
    label.textContent = summary || 'Add people…';
    button.append(label);
  }

  #withText(cell: DatabaseCell | undefined, value: string): DatabaseCell {
    const next: DatabaseCell = { ...(cell ?? {}) };
    if (value) next.text = value;
    else delete next.text;
    delete next.runs;
    return next;
  }

  /** ---- cell data ---- */

  #commitCell(rowId: string, columnId: string, cell: DatabaseCell, mergeKey?: string): void {
    const rows = this.#data.rows.map(row => {
      if (row.id !== rowId) return row;
      const cells = { ...row.cells };
      const empty =
        !cell.text &&
        !cell.checked &&
        !(cell.values?.length) &&
        !(cell.files?.length) &&
        !(cell.people?.length);
      if (!empty) cells[columnId] = cell;
      else delete cells[columnId];
      return { ...row, cells };
    });
    this.#host.commit({ ...this.#data, rows }, mergeKey ? { mergeKey } : undefined);
  }

  #addRow(columnId = this.#data.columns[0]?.id ?? '', groupKey?: string): string | null {
    if (this.#readonly) return null;
    const row = createDatabaseRow();
    const view = this.#activeView();
    const groupColumn =
      groupKey !== undefined && view.groupBy
        ? this.#data.columns.find(column => column.id === view.groupBy)
        : undefined;
    if (groupColumn) {
      if (groupColumn.type === 'checkbox') {
        row.cells[groupColumn.id] = { checked: groupKey === 'true' };
      } else if (groupColumn.type === 'multi-select') {
        if (groupKey) row.cells[groupColumn.id] = { values: [groupKey] };
      } else if (groupKey) {
        row.cells[groupColumn.id] = { text: groupKey };
      }
    }
    this.#pendingFocus = {
      rowId: row.id,
      columnId: columnId || this.#titleColumn()?.id || '',
      at: 'start',
    };
    this.#host.commit({ ...this.#data, rows: [...this.#data.rows, row] });
    return row.id;
  }

  #openAddPropertyMenu(anchor: HTMLElement): void {
    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = 'Add property';
    content.append(title);
    const list = document.createElement('div');
    list.className = 'nb-db-pop-actions';
    for (const type of COLUMN_TYPES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = type.label;
      button.addEventListener('click', () => {
        this.#closePopover();
        this.#addColumnOfType(type.type, false);
      });
      list.append(button);
    }
    content.append(list);
    this.#showPopover(anchor, content);
  }

  #addColumn(): void {
    this.#addColumnOfType('text');
  }

  #addColumnOfType(type: DatabaseColumnType, openSettings = true): void {
    if (this.#readonly) return;
    const column = createDatabaseColumn(
      `Column ${this.#data.columns.length + 1}`,
      type
    );
    const view = this.#activeView();
    const views = this.#viewsWithColumn(column.id, null, false);
    this.#host.commit({
      ...this.#data,
      columns: [...this.#data.columns, column],
      views,
      activeViewId: view.id,
    });
    queueMicrotask(() => {
      if (!openSettings) return;
      const button = this.element.querySelector<HTMLElement>(
        `th[data-column-id="${CSS.escape(column.id)}"] .nb-db-col-head`
      );
      if (button) this.#openColumnPopover(column.id, button);
    });
  }

  #pruneRowIdsFromViews(
    views: readonly DatabaseViewConfig[],
    deletedIds: ReadonlySet<string>
  ): DatabaseViewConfig[] {
    if (deletedIds.size === 0) return [...views];
    let anyChanged = false;
    const nextViews = views.map(view => {
      if (!view.groupProperties?.length) return view;
      let viewChanged = false;
      const groupProperties = view.groupProperties.map(group => {
        if (!group.manuallyCardSort?.length) return group;
        const nextSort = group.manuallyCardSort.filter(id => !deletedIds.has(id));
        if (nextSort.length === group.manuallyCardSort.length) return group;
        viewChanged = true;
        const { manuallyCardSort: _removed, ...rest } = group;
        return nextSort.length > 0 ? { ...rest, manuallyCardSort: nextSort } : rest;
      });
      if (!viewChanged) return view;
      anyChanged = true;
      return { ...view, groupProperties };
    });
    return anyChanged ? nextViews : [...views];
  }

  #commitDeletedRows(deletedIds: ReadonlySet<string>): void {
    const views = this.#data.views
      ? this.#pruneRowIdsFromViews(this.#data.views, deletedIds)
      : undefined;
    const view = this.#data.view
      ? this.#pruneRowIdsFromViews([this.#data.view], deletedIds)[0]
      : undefined;
    this.#host.commit({
      ...this.#data,
      rows: this.#data.rows.filter(row => !deletedIds.has(row.id)),
      ...(views ? { views } : {}),
      ...(view ? { view } : {}),
    });
  }

  #deleteRow(rowId: string): void {
    this.#commitDeletedRows(new Set([rowId]));
    if (this.#active?.rowId === rowId) this.#active = null;
  }

  #insertRow(anchorId: string | null, after: boolean): void {
    const row = createDatabaseRow();
    const index = anchorId ? this.#data.rows.findIndex(item => item.id === anchorId) : -1;
    const rows = [...this.#data.rows];
    if (index < 0) rows.push(row);
    else rows.splice(after ? index + 1 : index, 0, row);
    this.#pendingFocus = {
      rowId: row.id,
      columnId: this.#data.columns[0]?.id ?? '',
      at: 'start',
    };
    this.#host.commit({ ...this.#data, rows });
  }

  #duplicateRow(rowId: string): void {
    const row = this.#data.rows.find(item => item.id === rowId);
    if (!row) return;
    const copy: DatabaseRow = {
      id: createDatabaseRow().id,
      cells: Object.fromEntries(
        Object.entries(row.cells).map(([key, cell]) => [key, this.#cloneCell(cell)])
      ),
      ...(row.page
        ? {
            page: { content: cloneRuns(row.page.content) },
          }
        : {}),
    };
    const index = this.#data.rows.findIndex(item => item.id === rowId);
    const rows = [...this.#data.rows];
    rows.splice(index + 1, 0, copy);
    this.#pendingFocus = {
      rowId: copy.id,
      columnId: this.#data.columns[0]?.id ?? '',
      at: 'start',
    };
    this.#host.commit({ ...this.#data, rows });
  }

  #patchColumn(columnId: string, patch: Partial<DatabaseColumn>): DatabaseColumn[] {
    return this.#data.columns.map(column => {
      if (column.id !== columnId) return column;
      const type = patch.type ?? column.type;
      const next: DatabaseColumn = {
        id: column.id,
        name: patch.name ?? column.name,
        type,
        ...(column.width ? { width: column.width } : {}),
        ...((patch.data ?? column.data)
          ? { data: { ...(patch.data ?? column.data) } }
          : {}),
      };
      if (type === 'select' || type === 'multi-select') {
        const options = patch.options ?? column.options;
        if (options && options.length > 0) next.options = options;
      }
      return next;
    });
  }

  #deleteColumn(columnId: string): void {
    if (this.#data.columns.length <= 1) return;
    const columns = this.#data.columns.filter(column => column.id !== columnId);
    const rows = this.#data.rows.map(row => {
      const cells = { ...row.cells };
      delete cells[columnId];
      return { ...row, cells };
    });
    const next: DatabaseData = {
      ...this.#data,
      columns,
      rows,
      ...(this.#data.titleColumnId === columnId && columns[0]
        ? { titleColumnId: columns[0].id }
        : {}),
    };
    if (this.#data.sort?.columnId === columnId) delete next.sort;
    if (this.#data.views) {
      next.views = this.#data.views.map(view => this.#removeColumnFromView(view, columnId));
    }
    if (this.#data.view) {
      next.view = this.#removeColumnFromView(this.#data.view, columnId);
    }
    if (this.#detail?.querySelector(`[data-column-id="${CSS.escape(columnId)}"]`)) {
      this.#closeDetailPanel();
    }
    this.#host.commit(next);
  }

  #removeColumnFromView(view: DatabaseViewConfig, columnId: string): DatabaseViewConfig {
    const filters = view.filters.filter(filter => filter.columnId !== columnId);
    const filter = view.filter
      ? this.#removeFilterColumn(view.filter, columnId)
      : undefined;
    const groupBy = view.groupBy && view.groupBy !== columnId ? view.groupBy : undefined;
    const groupRemoved = view.groupBy === columnId;
    const sorts = (view.sorts ?? (view.sort ? [view.sort] : [])).filter(
      sort => sort.columnId !== columnId
    );
    const sort = view.sort && view.sort.columnId !== columnId ? view.sort : undefined;
    const hiddenColumns = (view.hiddenColumns ?? []).filter(id => id !== columnId);
    const stats = { ...(view.stats ?? {}) };
    delete stats[columnId];
    const columns = view.columns?.filter(column => column.id !== columnId);
    const header = view.header
      ? {
          ...(view.header.titleColumnId === columnId
            ? {}
            : { titleColumnId: view.header.titleColumnId }),
          ...(view.header.iconColumnId === columnId
            ? {}
            : { iconColumnId: view.header.iconColumnId }),
        }
      : undefined;
    return {
      ...view,
      filters,
      ...(filter ? { filter } : {}),
      ...(groupBy ? { groupBy } : groupRemoved ? { groupProperties: [] } : {}),
      ...(groupRemoved ? { hideEmptyGroups: false } : {}),
      ...(sorts.length > 0 ? { sorts } : {}),
      ...(sort ? { sort } : {}),
      ...(columns ? { columns } : {}),
      ...(hiddenColumns.length > 0 ? { hiddenColumns } : {}),
      ...(Object.keys(stats).length > 0 ? { stats } : {}),
      ...(header && Object.keys(header).length > 0 ? { header } : {}),
    };
  }

  #removeFilterColumn(
    group: DatabaseFilterGroup,
    columnId: string
  ): DatabaseFilterGroup {
    const conditions: DatabaseFilterGroup['conditions'] = [];
    for (const item of group.conditions) {
      if (item.type === 'group') {
        const next = this.#removeFilterColumn(item, columnId);
        if (next.conditions.length > 0) conditions.push(next);
      } else if (item.columnId !== columnId) {
        conditions.push(item);
      }
    }
    return { ...group, conditions };
  }

  #insertColumn(anchorId: string, after: boolean): void {
    const column = createDatabaseColumn(`Column ${this.#data.columns.length + 1}`);
    const columns = [...this.#data.columns];
    const index = columns.findIndex(item => item.id === anchorId);
    columns.splice(index < 0 ? columns.length : after ? index + 1 : index, 0, column);
    const view = this.#activeView();
    const views = this.#viewsWithColumn(column.id, anchorId, after);
    this.#host.commit({
      ...this.#data,
      columns,
      views,
      activeViewId: view.id,
    });
    queueMicrotask(() => {
      const button = this.element.querySelector<HTMLElement>(
        `th[data-column-id="${CSS.escape(column.id)}"] .nb-db-col-head`
      );
      if (button) this.#openColumnPopover(column.id, button);
    });
  }

  #commitColumnFields(
    columnId: string,
    name: string,
    type: DatabaseColumnType,
    optionsText: string,
    extra?: (columns: DatabaseColumn[]) => DatabaseColumn[]
  ): void {
    const options = optionsText
      .split(',')
      .map(option => option.trim())
      .filter(Boolean);
    const columns = this.#patchColumn(columnId, {
      name: name.trim() || 'Column',
      type,
      ...((type === 'select' || type === 'multi-select') && options.length > 0
        ? { options }
        : {}),
    });
    this.#host.commit({
      ...this.#data,
      columns: extra ? extra(columns) : columns,
    });
  }

  /** ---- navigation ---- */

  #rows(): DatabaseRow[] {
    return this.#navigationRows(this.#activeView());
  }

  #renderedRows(view: DatabaseViewConfig = this.#activeView()): DatabaseRow[] {
    if (view.type === 'table' && view.groupBy) {
      return this.#groupsFor(view).flatMap(group =>
        group.collapsed || group.hidden ? [] : group.rows
      );
    }
    return this.#rowsFor(view);
  }

  #navigationRows(view: DatabaseViewConfig = this.#activeView()): DatabaseRow[] {
    const seen = new Set<string>();
    const rows: DatabaseRow[] = [];
    for (const row of this.#renderedRows(view)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    return rows;
  }

  #moveTab(rowId: string, columnId: string, backwards: boolean): void {
    const rows = this.#rows();
    const columns = this.#visibleColumns(this.#activeView());
    const rowIndex = rows.findIndex(row => row.id === rowId);
    const columnIndex = columns.findIndex(column => column.id === columnId);
    if (rowIndex < 0 || columnIndex < 0) return;
    let nextRow = rowIndex;
    let nextColumn = columnIndex + (backwards ? -1 : 1);
    if (nextColumn >= columns.length) {
      nextColumn = 0;
      nextRow += 1;
    } else if (nextColumn < 0) {
      nextColumn = columns.length - 1;
      nextRow -= 1;
    }
    if (nextRow >= rows.length) {
      if (this.#readonly) return;
      this.#addRow();
      return;
    }
    if (nextRow < 0) return;
    const targetRow = rows[nextRow];
    const targetColumn = columns[nextColumn];
    if (targetRow && targetColumn) this.focusCell(targetRow.id, targetColumn.id, 'end');
  }

  #moveVertical(rowId: string, columnId: string, direction: 1 | -1): void {
    const rows = this.#rows();
    const index = rows.findIndex(row => row.id === rowId);
    if (index < 0) return;
    const next = rows[index + direction];
    if (!next) {
      if (direction > 0 && !this.#readonly) this.#addRow(columnId);
      return;
    }
    this.focusCell(next.id, columnId, direction > 0 ? 'start' : 'end');
  }

  #moveHorizontal(rowId: string, columnId: string, direction: 1 | -1): void {
    const rows = this.#rows();
    const columns = this.#visibleColumns(this.#activeView());
    const rowIndex = rows.findIndex(row => row.id === rowId);
    const columnIndex = columns.findIndex(column => column.id === columnId);
    if (rowIndex < 0 || columnIndex < 0) return;
    let nextColumn = columnIndex + direction;
    let nextRow = rowIndex;
    if (nextColumn >= columns.length) {
      nextColumn = 0;
      nextRow += 1;
    } else if (nextColumn < 0) {
      nextColumn = columns.length - 1;
      nextRow -= 1;
    }
    const targetRow = rows[nextRow];
    const targetColumn = columns[nextColumn];
    if (targetRow && targetColumn) {
      this.focusCell(targetRow.id, targetColumn.id, direction > 0 ? 'start' : 'end');
    }
  }

  #onCellKeyDown(
    event: KeyboardEvent,
    rowId: string,
    columnId: string,
    kind: CellKind
  ): void {
    if (
      this.#isComposingKey(
        event,
        event.target instanceof HTMLElement ? event.target : null
      )
    ) {
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.#host.redo();
      else this.#host.undo();
      return;
    }
    if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.#host.redo();
      return;
    }
    if (mod && kind === 'text') {
      const tag = this.#shortcutTag(event);
      if (tag) {
        event.preventDefault();
        this.#toggleInlineTag(tag);
        return;
      }
    }
    if (mod && ['b', 'i', 'u', 'e', 'k'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      return;
    }
    const copies = this.#cells.get(cellKey(rowId, columnId)) ?? [];
    const activeNode =
      copies.find(copy => copy.td.contains(event.target as Node)) ?? copies[0];
    if (event.key === 'Tab') {
      event.preventDefault();
      this.#moveTab(rowId, columnId, event.shiftKey);
      return;
    }
    if (mod && event.key === 'Enter') {
      event.preventDefault();
      this.#openDetailPanel(rowId);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const nodes = activeNode;
      if (kind === 'select') {
        if (nodes?.button) this.#openSelectPopover(columnId, rowId, nodes.button);
        return;
      }
      if (kind === 'multi-select' || kind === 'files' || kind === 'people') {
        nodes?.button?.click();
        return;
      }
      this.#moveVertical(rowId, columnId, 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.#closePopover();
      this.#host.focusAfter();
      return;
    }
    if (kind === 'text' || kind === 'select' || kind === 'checkbox') {
      const node = activeNode;
      if (event.key === 'ArrowDown') {
        if (kind === 'text' && node?.text && !caretAtBoundary(node.text, 'end')) return;
        event.preventDefault();
        this.#moveVertical(rowId, columnId, 1);
      } else if (event.key === 'ArrowUp') {
        if (kind === 'text' && node?.text && !caretAtBoundary(node.text, 'start')) return;
        event.preventDefault();
        this.#moveVertical(rowId, columnId, -1);
      } else if (event.key === 'ArrowLeft' && kind === 'text' && node?.text) {
        if (!caretAtBoundary(node.text, 'start')) return;
        event.preventDefault();
        this.#moveHorizontal(rowId, columnId, -1);
      } else if (event.key === 'ArrowRight' && kind === 'text' && node?.text) {
        if (!caretAtBoundary(node.text, 'end')) return;
        event.preventDefault();
        this.#moveHorizontal(rowId, columnId, 1);
      }
    }
  }

  /** ---- inline formatting ---- */

  #syncCellToolbar(): void {
    if (this.#readonly) {
      this.#hideCellToolbar();
      return;
    }
    const root = this.element.getRootNode() as ShadowRoot;
    const active = root.activeElement as HTMLElement | null;
    if (
      active &&
      active.isContentEditable !== true &&
      !active.closest('.nb-db-rich-text')
    ) {
      this.#hideCellToolbar();
      return;
    }
    const selection = nativeSelection(root);
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      this.#hideCellToolbar();
      return;
    }
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as HTMLElement)
        : node.parentElement;
    const target = element?.closest<HTMLElement>('.nb-db-rich-text') ?? null;
    if (
      !target ||
      target.isContentEditable !== true ||
      (!this.element.contains(target) && !this.#detail?.contains(target))
    ) {
      this.#hideCellToolbar();
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      this.#hideCellToolbar();
      return;
    }
    const offsets = selectionOffsets(target);
    const activeMarks = offsets
      ? markStateInRange(this.#readRichTextRuns(target), offsets.start, offsets.end)
      : {};
    const toolbar = this.#ensureCellToolbar();
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('.nb-db-inline-tool')) {
      const markKey = button.dataset.tag ? TAG_TO_MARK[button.dataset.tag] : undefined;
      const active = Boolean(markKey && activeMarks[markKey] === true);
      button.dataset.active = String(active);
      button.setAttribute('aria-pressed', String(active));
    }
    toolbar.hidden = false;
    placeFloating(toolbar, rect, {
      align: 'center',
      side: 'above',
      gap: 8,
      margin: 8,
    });
  }

  #ensureCellToolbar(): HTMLElement {
    if (this.#cellToolbar?.isConnected) return this.#cellToolbar;
    const toolbar = document.createElement('div');
    toolbar.className = 'nb-db-inline-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Text formatting');
    toolbar.hidden = true;
    const commands: Array<{ tag: string; label: string; glyph: string }> = [
      { tag: 'strong', label: 'Bold', glyph: icon.bold },
      { tag: 'em', label: 'Italic', glyph: icon.italic },
      { tag: 'u', label: 'Underline', glyph: icon.underline },
      { tag: 's', label: 'Strikethrough', glyph: icon.strike },
      { tag: 'code', label: 'Inline code', glyph: icon.inlineCode },
    ];
    for (const command of commands) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-db-inline-tool';
      button.title = command.label;
      button.setAttribute('aria-label', command.label);
      button.dataset.tag = command.tag;
      button.innerHTML = command.glyph;
      button.addEventListener('mousedown', event => event.preventDefault(), {
        signal: this.#events.signal,
      });
      button.addEventListener('click', () => {
        this.#toggleInlineTag(command.tag);
      }, { signal: this.#events.signal });
      toolbar.append(button);
    }
    this.element.append(toolbar);
    this.#cellToolbar = toolbar;
    return toolbar;
  }

  #isComposingKey(event: KeyboardEvent, target?: HTMLElement | null): boolean {
    return (
      event.isComposing ||
      event.keyCode === 229 ||
      Boolean(target && this.#composingTargets.has(target))
    );
  }

  #shortcutTag(event: KeyboardEvent): string | null {
    if (!(event.metaKey || event.ctrlKey)) return null;
    const key = event.key.toLowerCase();
    if (key === 'b') return 'strong';
    if (key === 'i') return 'em';
    if (key === 'u') return 'u';
    if (key === 'e') return 'code';
    if (key === 's' && event.shiftKey) return 's';
    return null;
  }

  #isMultilineRichText(target: HTMLElement): boolean {
    return target.classList.contains('nb-db-page-text');
  }

  #readRichTextRuns(target: HTMLElement): InlineRun[] {
    return this.#isMultilineRichText(target)
      ? normalizeRuns(readRunsFromDom(target))
      : this.#readCellRuns(target);
  }

  #renderRichTextRuns(target: HTMLElement, runs: readonly InlineRun[]): void {
    if (this.#isMultilineRichText(target)) {
      if (runs.length > 0) renderInlineRuns(target, runs);
      else target.replaceChildren();
      return;
    }
    if (runs.some(run => run.marks)) renderInlineRuns(target, runs);
    else target.textContent = plainText(runs);
  }

  #attachCompositionHandlers(
    target: HTMLElement,
    onCommit: () => void,
    signal: AbortSignal,
    richText = false
  ): void {
    let pendingOnStart: { offset: number; marks: InlineMark } | null = null;
    target.addEventListener(
      'compositionstart',
      () => {
        this.#composingTargets.add(target);
        if (
          richText &&
          this.#pendingMarks &&
          this.#pendingMarks.target === target
        ) {
          pendingOnStart = {
            offset: this.#pendingMarks.offset,
            marks: this.#pendingMarks.marks,
          };
          this.#pendingMarks = null;
        } else {
          pendingOnStart = null;
        }
      },
      { signal }
    );
    target.addEventListener(
      'compositionend',
      () => {
        this.#composingTargets.delete(target);
        if (richText && pendingOnStart) {
          const { offset, marks } = pendingOnStart;
          pendingOnStart = null;
          const offsets = selectionOffsets(target);
          const endOffset = offsets ? offsets.end : offset;
          if (endOffset > offset) {
            const runs = this.#readRichTextRuns(target);
            const patch: MarkPatch = {
              bold: marks.bold === true,
              italic: marks.italic === true,
              underline: marks.underline === true,
              strike: marks.strike === true,
              code: marks.code === true,
            };
            const nextRuns = applyMarkPatch(runs, offset, endOffset, patch);
            this.#renderRichTextRuns(target, nextRuns);
            setSelectionOffsets(target, endOffset, endOffset);
          }
        }
        onCommit();
      },
      { signal }
    );
  }

  #attachRichTextHandlers(target: HTMLElement, signal: AbortSignal): void {
    target.addEventListener(
      'beforeinput',
      event => {
        const inputEvent = event as InputEvent;
        if (inputEvent.isComposing) return;
        const pending = this.#pendingMarks;
        if (!pending || pending.target !== target) return;
        if (
          inputEvent.inputType !== 'insertText' ||
          typeof inputEvent.data !== 'string' ||
          inputEvent.data.length === 0
        ) {
          this.#pendingMarks = null;
          return;
        }
        const offsets = selectionOffsets(target);
        if (
          !offsets ||
          offsets.start !== offsets.end ||
          offsets.start !== pending.offset
        ) {
          this.#pendingMarks = null;
          return;
        }
        event.preventDefault();
        const { marks } = pending;
        this.#pendingMarks = null;
        const data = this.#isMultilineRichText(target)
          ? inputEvent.data
          : inputEvent.data.replace(/\r?\n/gu, ' ');
        const runs = this.#readRichTextRuns(target);
        const nextRuns = insertTextAt(runs, offsets.start, data, marks);
        this.#renderRichTextRuns(target, nextRuns);
        const pos = offsets.start + data.length;
        setSelectionOffsets(target, pos, pos);
        target.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data,
          })
        );
        this.#syncCellToolbar();
      },
      { signal }
    );
    target.addEventListener(
      'blur',
      () => {
        if (this.#pendingMarks?.target === target) {
          this.#pendingMarks = null;
        }
      },
      { signal }
    );
  }

  #pasteIntoRichText(target: HTMLElement, value: string): void {
    const runs = this.#readRichTextRuns(target);
    const fallback = runsLength(runs);
    const offsets = selectionOffsets(target) ?? { start: fallback, end: fallback };
    const pending =
      this.#pendingMarks &&
      this.#pendingMarks.target === target &&
      offsets.start === offsets.end &&
      offsets.start === this.#pendingMarks.offset
        ? this.#pendingMarks.marks
        : undefined;
    this.#pendingMarks = null;
    const deleted = deleteTextRange(runs, offsets.start, offsets.end);
    const nextRuns = insertTextAt(deleted, offsets.start, value, pending);
    this.#renderRichTextRuns(target, nextRuns);
    const pos = offsets.start + value.length;
    setSelectionOffsets(target, pos, pos);
    target.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertFromPaste',
        data: value,
      })
    );
    this.#syncCellToolbar();
  }

  #pastePlainText(target: HTMLElement, value: string): void {
    const current = target.textContent ?? '';
    const offsets = selectionOffsets(target) ?? {
      start: current.length,
      end: current.length,
    };
    const next = current.slice(0, offsets.start) + value + current.slice(offsets.end);
    target.textContent = next;
    const pos = offsets.start + value.length;
    setSelectionOffsets(target, pos, pos);
    target.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertFromPaste',
        data: value,
      })
    );
  }

  #toggleInlineTag(tag: string): void {
    const markKey = TAG_TO_MARK[tag];
    if (!markKey) return;
    const root = this.element.getRootNode() as ShadowRoot;
    const selection = nativeSelection(root);
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as HTMLElement)
        : node.parentElement;
    const target = element?.closest<HTMLElement>('.nb-db-rich-text') ?? null;
    if (
      !target ||
      target.isContentEditable !== true ||
      (!this.element.contains(target) && !this.#detail?.contains(target))
    ) {
      return;
    }
    const offsets = selectionOffsets(target);
    if (!offsets) return;
    const { start, end } = offsets;
    const runs = this.#readRichTextRuns(target);
    if (end > start) {
      this.#pendingMarks = null;
      const nextRuns = toggleMarkInRange(runs, start, end, markKey);
      this.#renderRichTextRuns(target, nextRuns);
      setSelectionOffsets(target, start, end);
      target.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'format' })
      );
      this.#syncCellToolbar();
      return;
    }
    const baseSource =
      this.#pendingMarks &&
      this.#pendingMarks.target === target &&
      this.#pendingMarks.offset === start
        ? this.#pendingMarks.marks
        : (marksAt(runs, start) ?? {});
    const next: InlineMark = { ...baseSource };
    // Typing next to an atomic mention must not extend it.
    delete next.mention;
    if (next[markKey] === true) delete next[markKey];
    else next[markKey] = true;
    this.#pendingMarks = {
      target,
      offset: start,
      marks: normalizeMark(next) ?? {},
    };
  }

  /** ---- popovers ---- */

  #showPopover(anchor: HTMLElement, content: HTMLElement): void {
    this.#closePopover();
    const popover = document.createElement('div');
    popover.className = 'nb-db-popover';
    popover.append(content);
    this.element.append(popover);
    placeFloating(popover, anchor.getBoundingClientRect(), {
      align: 'start',
      side: 'below',
      gap: 6,
      margin: 10,
    });

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.#closePopover();
    };
    const dismiss = dismissFloating({
      element: popover,
      pointerTarget: document,
      scroll: true,
      dismissOnInsideScroll: true,
      onDismiss: () => this.#closePopover(),
    });
    window.addEventListener('keydown', onKey, true);
    this.#popoverCleanup = () => {
      dismiss();
      window.removeEventListener('keydown', onKey, true);
      popover.remove();
    };
  }

  #closePopover(): void {
    const cleanup = this.#popoverCleanup;
    this.#popoverCleanup = null;
    cleanup?.();
  }

  #onCellPointerDown(
    event: PointerEvent,
    rowId: string,
    columnId: string
  ): void {
    if (this.#readonly || event.button !== 0) return;
    const previous = this.#active;
    const groupKey = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>(
      '.nb-db-group'
    )?.dataset.group;
    this.#active = {
      rowId,
      columnId,
      ...(groupKey !== undefined ? { groupKey } : {}),
    };
    this.#selectedRows.clear();
    this.#syncRowSelection();
    if (!event.shiftKey) {
      this.#suppressClick = false;
      if (this.#range) {
        this.#clearRange();
        this.#renderRange();
      }
    } else {
      const startRowId = previous?.rowId ?? rowId;
      const startColumnId = previous?.columnId ?? columnId;
      const rangeGroupKey = previous?.groupKey ?? groupKey;
      this.#range = {
        startRowId,
        startColumnId,
        endRowId: rowId,
        endColumnId: columnId,
        ...(rangeGroupKey !== undefined ? { groupKey: rangeGroupKey } : {}),
      };
      this.#suppressClick = true;
      this.#renderRange();
      event.preventDefault();
      return;
    }

    const drag = {
      anchorRowId: rowId,
      anchorColumnId: columnId,
      moved: false,
    };
    this.#dragSelect = drag;
    const root = this.element.getRootNode() as ShadowRoot;
    this.#beginWindowDrag(
      moveEvent => {
        if (this.#dragSelect !== drag) return;
        const cell = this.#cellFromEvent(moveEvent);
        const targetRowId = cell?.dataset.rowId;
        const targetColumnId = cell?.dataset.columnId;
        if (!cell || !targetRowId || !targetColumnId) return;
        if (
          !drag.moved &&
          targetRowId === drag.anchorRowId &&
          targetColumnId === drag.anchorColumnId
        ) {
          return;
        }
        drag.moved = true;
        this.#range = {
          startRowId: drag.anchorRowId,
          startColumnId: drag.anchorColumnId,
          endRowId: targetRowId,
          endColumnId: targetColumnId,
          ...(groupKey !== undefined ? { groupKey } : {}),
        };
        nativeSelection(root)?.removeAllRanges();
        moveEvent.preventDefault();
        this.#renderRange();
      },
      () => {
        if (this.#dragSelect !== drag) return;
        this.#dragSelect = null;
        if (drag.moved) {
          this.#suppressClick = true;
          window.setTimeout(() => {
            this.#suppressClick = false;
          }, 0);
          this.#renderRange();
        }
      },
      () => {
        if (this.#dragSelect === drag) this.#dragSelect = null;
      }
    );
  }

  #cellFromEvent(event: Event): HTMLElement | null {
    for (const node of event.composedPath()) {
      if (node instanceof HTMLElement && node.classList.contains('nb-db-cell')) {
        return node;
      }
    }
    return null;
  }

  #rangeBounds(): {
    rows: DatabaseRow[];
    columns: DatabaseColumn[];
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
  } | null {
    if (!this.#range) return null;
    const view = this.#activeView();
    const groupKey = this.#range.groupKey;
    const rows =
      groupKey !== undefined
        ? this.#groupsFor(view).find(group => group.key === groupKey)?.rows ?? []
        : this.#renderedRows(view);
    const columns = this.#visibleColumns(view);
    const startRow = rows.findIndex(row => row.id === this.#range?.startRowId);
    const endRow = rows.findIndex(row => row.id === this.#range?.endRowId);
    const startColumn = columns.findIndex(column => column.id === this.#range?.startColumnId);
    const endColumn = columns.findIndex(column => column.id === this.#range?.endColumnId);
    if (startRow < 0 || endRow < 0 || startColumn < 0 || endColumn < 0) return null;
    return {
      rows,
      columns,
      startRow: Math.min(startRow, endRow),
      endRow: Math.max(startRow, endRow),
      startColumn: Math.min(startColumn, endColumn),
      endColumn: Math.max(startColumn, endColumn),
    };
  }

  #renderRange(): void {
    this.#rangeCells.clear();
    const bounds = this.#rangeBounds();
    if (bounds) {
      for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
        const dataRow = bounds.rows[row];
        if (!dataRow) continue;
        for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
          const dataColumn = bounds.columns[column];
          if (dataColumn) this.#rangeCells.add(cellKey(dataRow.id, dataColumn.id));
        }
      }
    }
    this.#syncSelectionVisuals();
  }

  #clearRange(): void {
    this.#range = null;
    this.#rangeCells.clear();
    this.#syncSelectionVisuals();
  }

  #syncSelectionVisuals(): void {
    const nextSelected = new Set<HTMLTableCellElement>();
    for (const key of this.#rangeCells) {
      const copies = this.#cells.get(key);
      if (!copies) continue;
      for (const nodes of copies) {
        nextSelected.add(nodes.td);
      }
    }

    const nextActive = new Set<HTMLTableCellElement>();
    const activeState = this.#active;
    if (activeState) {
      const copies = this.#cells.get(cellKey(activeState.rowId, activeState.columnId));
      if (copies) {
        for (const nodes of copies) {
          if (
            activeState.groupKey === undefined ||
            nodes.td.closest<HTMLElement>('.nb-db-group')?.dataset.group ===
              activeState.groupKey
          ) {
            nextActive.add(nodes.td);
          }
        }
      }
    }

    for (const td of this.#selectedTds) {
      if (!nextSelected.has(td)) {
        td.classList.remove('is-selected');
        td.setAttribute('aria-selected', 'false');
      }
    }
    for (const td of nextSelected) {
      if (!this.#selectedTds.has(td)) {
        td.classList.add('is-selected');
        td.setAttribute('aria-selected', 'true');
      }
    }
    for (const td of this.#activeTds) {
      if (!nextActive.has(td)) {
        td.classList.remove('is-active');
      }
    }
    for (const td of nextActive) {
      if (!this.#activeTds.has(td)) {
        td.classList.add('is-active');
      }
    }

    this.#selectedTds = nextSelected;
    this.#activeTds = nextActive;
    this.#positionFillHandle();
  }

  #cancelFillHandleFrame(): void {
    if (this.#fillHandleRaf !== null) {
      cancelAnimationFrame(this.#fillHandleRaf);
      this.#fillHandleRaf = null;
    }
  }

  #scheduleFillHandlePosition(): void {
    if (this.#fillHandleRaf !== null) return;
    this.#fillHandleRaf = requestAnimationFrame(() => {
      this.#fillHandleRaf = null;
      this.#positionFillHandle();
    });
  }

  #positionFillHandle(): void {
    const handle = this.#fillHandle;
    if (!handle) return;
    const active = this.#active;
    if (
      !active ||
      (this.#range && this.#range.startColumnId !== this.#range.endColumnId)
    ) {
      handle.dataset.visible = 'false';
      return;
    }
    const copies = this.#cells.get(cellKey(active.rowId, active.columnId)) ?? [];
    const cell =
      copies.find(copy => {
        if (active.groupKey === undefined) return true;
        return (
          copy.td.closest<HTMLElement>('.nb-db-group')?.dataset.group ===
          active.groupKey
        );
      }) ?? copies[0];
    const td = cell?.td;
    if (!td || !td.isConnected) {
      handle.dataset.visible = 'false';
      return;
    }
    const rect = td.getBoundingClientRect();
    handle.style.left = `${Math.round(rect.right - 1)}px`;
    handle.style.top = `${Math.round(rect.bottom - 1)}px`;
    handle.dataset.visible = 'true';
  }

  #beginWindowDrag(
    onMove: (event: PointerEvent) => void,
    onFinish: (event: PointerEvent) => void,
    onCancel?: () => void
  ): void {
    const contentSignal = this.#contentEvents.signal;
    if (contentSignal.aborted) return;
    const controller = new AbortController();
    const { signal } = controller;
    contentSignal.addEventListener(
      'abort',
      () => {
        onCancel?.();
        controller.abort();
      },
      { once: true, signal }
    );
    window.addEventListener('pointermove', onMove, { signal });
    const finish = (event: PointerEvent): void => {
      controller.abort();
      onFinish(event);
    };
    window.addEventListener('pointerup', finish, { signal });
    window.addEventListener('pointercancel', finish, { signal });
  }

  #beginFillDrag(): void {
    if (this.#readonly) return;
    const active = this.#active;
    if (!active) return;
    const view = this.#activeView();
    const visibleRows = this.#renderedRows(view);
    const sourceRowIndex = visibleRows.findIndex(row => row.id === active.rowId);
    const column = this.#data.columns.find(item => item.id === active.columnId);
    if (sourceRowIndex < 0 || !column) return;
    const source = visibleRows[sourceRowIndex];
    if (!source) return;
    const groupKey = active.groupKey;
    let moved = false;
    this.#beginWindowDrag(
      moveEvent => {
        const target = this.#cellFromEvent(moveEvent);
        if (!target || target.dataset.columnId !== active.columnId) return;
        const targetRowId = target.dataset.rowId;
        const targetIndex = visibleRows.findIndex(row => row.id === targetRowId);
        if (targetIndex < 0) return;
        moved = true;
        const start = Math.min(sourceRowIndex, targetIndex);
        const end = Math.max(sourceRowIndex, targetIndex);
        const firstRow = visibleRows[start];
        const lastRow = visibleRows[end];
        if (!firstRow || !lastRow) return;
        this.#range = {
          startRowId: firstRow.id,
          startColumnId: active.columnId,
          endRowId: lastRow.id,
          endColumnId: active.columnId,
          ...(groupKey !== undefined ? { groupKey } : {}),
        };
        this.#renderRange();
      },
      () => {
        if (!moved) return;
        const current = this.#rangeBounds();
        if (!current) return;
        const sourceCell = source.cells[column.id];
        const updated = new Map<string, DatabaseRow>();
        for (let index = current.startRow; index <= current.endRow; index += 1) {
          const row = current.rows[index];
          if (!row || row.id === active.rowId) continue;
          const cells = { ...row.cells };
          if (sourceCell) cells[column.id] = this.#cloneCell(sourceCell);
          else delete cells[column.id];
          updated.set(row.id, { ...row, cells });
        }
        if (updated.size > 0) {
          this.#host.commit({
            ...this.#data,
            rows: this.#data.rows.map(item => updated.get(item.id) ?? item),
          });
        }
      }
    );
  }

  #cloneCell(cell: DatabaseCell): DatabaseCell {
    return {
      ...cell,
      ...(cell.runs ? { runs: cloneRuns(cell.runs) } : {}),
      ...(cell.values ? { values: [...cell.values] } : {}),
      ...(cell.files ? { files: cell.files.map(file => ({ ...file })) } : {}),
      ...(cell.people ? { people: cell.people.map(person => ({ ...person })) } : {}),
    };
  }

  #convertCell(
    cell: DatabaseCell,
    sourceType: DatabaseColumnType,
    targetType: DatabaseColumnType
  ): DatabaseCell | null {
    if (targetType === 'files' || targetType === 'people') return null;
    const value = databaseCellText(cell, sourceType);
    if (targetType === 'checkbox') {
      return { checked: /^(true|1|yes|✓)$/iu.test(value.trim()) };
    }
    if (targetType === 'multi-select') {
      const values = value
        .split(/[,;]/u)
        .map(item => item.trim())
        .filter(Boolean);
      return values.length > 0 ? { values } : {};
    }
    return value ? { text: value } : {};
  }

  #rangeText(): string {
    const bounds = this.#rangeBounds();
    if (!bounds) return '';
    const lines: string[] = [];
    for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
      const dataRow = bounds.rows[row];
      if (!dataRow) continue;
      const cells: string[] = [];
      for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
        const dataColumn = bounds.columns[column];
        if (!dataColumn) continue;
        cells.push(
          tsvCell(databaseCellText(dataRow.cells[dataColumn.id], dataColumn.type))
        );
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  }

  #applyGrid(
    startRowId: string,
    startColumnId: string,
    grid: string[][],
    clearReferences = false,
    groupKey?: string
  ): void {
    const view = this.#activeView();
    const group =
      groupKey !== undefined
        ? this.#groupsFor(view).find(item => item.key === groupKey)
        : undefined;
    const rows = group ? group.rows : this.#renderedRows(view);
    const groupColumn =
      group && view.groupBy
        ? this.#data.columns.find(column => column.id === view.groupBy)
        : undefined;
    const visibleColumns = this.#visibleColumns(view);
    const startRow = rows.findIndex(row => row.id === startRowId);
    const startColumn = visibleColumns.findIndex(column => column.id === startColumnId);
    if (startRow < 0 || startColumn < 0) return;

    const columns = [...visibleColumns];
    const width = Math.max(0, ...grid.map(line => line.length));
    while (columns.length < startColumn + width) {
      columns.push(createDatabaseColumn(`Column ${columns.length + 1}`));
    }
    const newColumns = columns.slice(visibleColumns.length);

    const byId = new Map(this.#data.rows.map(row => [row.id, row]));
    const added: DatabaseRow[] = [];
    let firstRowId: string | null = null;
    let firstColumnId: string | null = null;
    grid.forEach((values, rowOffset) => {
      let target = rows[startRow + rowOffset];
      if (!target) {
        target = createDatabaseRow();
        if (group && groupColumn) {
          const cells = { ...target.cells };
          if (groupColumn.type === 'checkbox') {
            cells[groupColumn.id] = { checked: group.key === 'true' };
          } else if (groupColumn.type === 'multi-select') {
            if (group.key) cells[groupColumn.id] = { values: [group.key] };
          } else if (group.key) {
            cells[groupColumn.id] = { text: group.key };
          }
          target = { ...target, cells };
        }
        added.push(target);
      }
      const current = byId.get(target.id) ?? target;
      const cells = { ...current.cells };
      values.forEach((value, columnOffset) => {
        const column = columns[startColumn + columnOffset];
        if (!column) return;
        const cell = cells[column.id];
        if (column.type === 'checkbox') {
          const checked = /^(true|1|yes|✓)$/iu.test(value.trim());
          cells[column.id] = { ...(cell ?? {}), checked };
        } else if (column.type === 'multi-select') {
          const next = value
            .split(/[,;]/u)
            .map(item => item.trim())
            .filter(Boolean);
          if (next.length > 0) cells[column.id] = { ...(cell ?? {}), values: next };
          else delete cells[column.id];
        } else if (column.type === 'files' || column.type === 'people') {
          if (clearReferences) delete cells[column.id];
        } else if (value) {
          cells[column.id] = this.#withText(cell, value);
        } else {
          delete cells[column.id];
        }
        if (!firstRowId) {
          firstRowId = target.id;
          firstColumnId = column.id;
        }
      });
      byId.set(target.id, { ...current, cells });
    });
    this.#host.commit({
      ...this.#data,
      columns: [...this.#data.columns, ...newColumns],
      rows: [
        ...this.#data.rows.map(row => byId.get(row.id) ?? row),
        ...added.map(row => byId.get(row.id) ?? row),
      ],
    });
    if (firstRowId && firstColumnId) {
      this.#pendingFocus = {
        rowId: firstRowId,
        columnId: firstColumnId,
        at: 'start',
      };
    }
    this.#clearRange();
  }

  #onClickCapture = (event: MouseEvent): void => {
    if (!this.#suppressClick) return;
    this.#suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  #onDatabaseKeyDown = (event: KeyboardEvent): void => {
    if (this.#readonly) return;
    const target = event.target;
    if (target === this.element) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.stopPropagation();
        this.#history(event.shiftKey);
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        event.stopPropagation();
        this.#history(true);
        return;
      }
    }
    const editing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement &&
        (target.matches('[contenteditable="true"]') ||
          Boolean(target.closest('.nb-db-text[contenteditable="true"]'))));
    const editingCell =
      target instanceof HTMLElement && Boolean(target.closest('.nb-db-cell'));
    const rangeDelete =
      (event.key === 'Delete' || event.key === 'Backspace') &&
      !event.metaKey &&
      !event.ctrlKey &&
      this.#selectedRows.size === 0 &&
      this.#range !== null &&
      this.#rangeCells.size > 1 &&
      (!editing || editingCell);
    if (editing && !rangeDelete) return;
    if (!editing && this.#selectedRows.size > 0) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.#selectedRows.clear();
        this.#syncRowSelection();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        this.#deleteSelectedRows();
        return;
      }
    }
    if (rangeDelete) {
      event.preventDefault();
      const bounds = this.#rangeBounds();
      if (!bounds) return;
      const firstRow = bounds.rows[bounds.startRow];
      const firstColumn = bounds.columns[bounds.startColumn];
      if (!firstRow || !firstColumn) return;
      this.#applyGrid(
        firstRow.id,
        firstColumn.id,
        Array.from({ length: bounds.endRow - bounds.startRow + 1 }, () =>
          Array.from({ length: bounds.endColumn - bounds.startColumn + 1 }, () => '')
        ),
        true,
        this.#range?.groupKey
      );
    }
  };

  #selectedRowsText(): string {
    if (this.#selectedRows.size === 0) return '';
    const view = this.#activeView();
    const columns = this.#visibleColumns(view);
    return this.#selectedVisibleRows()
      .map(row =>
        columns
          .map(column =>
            tsvCell(databaseCellText(row.cells[column.id], column.type))
          )
          .join('\t')
      )
      .join('\n');
  }

  #selectedRowsPayload(): string {
    return JSON.stringify({
      columns: this.#data.columns.map(column => ({
        id: column.id,
        name: column.name,
        type: column.type,
      })),
      rows: this.#selectedVisibleRows().map(row => ({
        cells: row.cells,
        ...(row.page ? { page: row.page } : {}),
      })),
    });
  }

  #onCopy = (event: ClipboardEvent): void => {
    const target = event.target as Element | null;
    if (target?.closest('.nb-db-popover, .nb-db-detail')) return;
    if (
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
      !target.closest('.nb-db-cell')
    ) {
      return;
    }
    const rowText = this.#selectedRowsText();
    const text = rowText || (this.#rangeCells.size > 1 ? this.#rangeText() : '');
    if (!text) return;
    event.clipboardData?.setData('text/plain', text);
    if (rowText) {
      event.clipboardData?.setData(
        DATABASE_ROWS_MIME,
        this.#selectedRowsPayload()
      );
    }
    event.preventDefault();
  };

  #onCut = (event: ClipboardEvent): void => {
    if (this.#readonly) return;
    const target = event.target as Element | null;
    if (target?.closest('.nb-db-popover, .nb-db-detail')) return;
    if (
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
      !target.closest('.nb-db-cell')
    ) {
      return;
    }
    const rowText = this.#selectedRowsText();
    if (rowText) {
      event.clipboardData?.setData('text/plain', rowText);
      event.clipboardData?.setData(
        DATABASE_ROWS_MIME,
        this.#selectedRowsPayload()
      );
      event.preventDefault();
      this.#deleteSelectedRows();
      return;
    }
    if (this.#rangeCells.size <= 1) return;
    const text = this.#rangeText();
    if (!text) return;
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
    const bounds = this.#rangeBounds();
    if (!bounds) return;
    const firstRow = bounds.rows[bounds.startRow];
    const firstColumn = bounds.columns[bounds.startColumn];
    if (!firstRow || !firstColumn) return;
    this.#applyGrid(
      firstRow.id,
      firstColumn.id,
      Array.from({ length: bounds.endRow - bounds.startRow + 1 }, () =>
        Array.from({ length: bounds.endColumn - bounds.startColumn + 1 }, () => '')
      ),
      true,
      this.#range?.groupKey
    );
  };

  #onPaste = (event: ClipboardEvent): void => {
    if (this.#readonly) return;
    const target = event.target as Element | null;
    if (target?.closest('.nb-db-popover, .nb-db-card-title')) return;
    if (
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
      !target.closest('.nb-db-cell')
    ) {
      return;
    }
    const typed = event.clipboardData?.getData(DATABASE_ROWS_MIME) ?? '';
    if (typed) {
      try {
        const parsed = JSON.parse(typed) as {
          columns?: Array<{
            id?: unknown;
            name?: unknown;
            type?: unknown;
          }>;
          rows?: Array<{
            cells?: Record<string, DatabaseCell>;
            page?: { content?: unknown };
          }>;
        };
        const sourceColumns = Array.isArray(parsed.columns)
          ? parsed.columns
          : [];
        const columnMap = new Map<
          string,
          { id: string; sourceType: DatabaseColumnType; targetType: DatabaseColumnType }
        >();
        if (sourceColumns.length > 0) {
          const used = new Set<string>();
          for (const source of sourceColumns) {
            if (!source || typeof source.id !== 'string') continue;
            const name = typeof source.name === 'string' ? source.name : '';
            const type = typeof source.type === 'string' ? source.type : '';
            const targetColumn =
              this.#data.columns.find(
                column => column.id === source.id && !used.has(column.id)
              ) ??
              this.#data.columns.find(
                column =>
                  column.name === name &&
                  (!type || column.type === type) &&
                  !used.has(column.id)
              ) ??
              this.#data.columns.find(
                column => column.name === name && !used.has(column.id)
              );
            if (targetColumn) {
              used.add(targetColumn.id);
              columnMap.set(source.id, {
                id: targetColumn.id,
                sourceType: (type || targetColumn.type) as DatabaseColumnType,
                targetType: targetColumn.type,
              });
            }
          }
        } else {
          for (const column of this.#data.columns) {
            columnMap.set(column.id, {
              id: column.id,
              sourceType: column.type,
              targetType: column.type,
            });
          }
        }
        const sourceRows = Array.isArray(parsed.rows) ? parsed.rows : [];
        const rows = sourceRows.map(item => {
          const cells: Record<string, DatabaseCell> = {};
          for (const [sourceId, cell] of Object.entries(item.cells ?? {})) {
            const mapping = columnMap.get(sourceId);
            if (!mapping) continue;
            if (!cell || typeof cell !== 'object' || Array.isArray(cell)) {
              continue;
            }
            const next =
              mapping.sourceType === mapping.targetType
                ? this.#cloneCell(cell)
                : this.#convertCell(
                    cell,
                    mapping.sourceType,
                    mapping.targetType
                  );
            if (next) cells[mapping.id] = next;
          }
          const pageContent = Array.isArray(item.page?.content)
            ? parseInlineRuns(item.page.content)
            : [];
          return {
            id: createId('r'),
            cells,
            ...(pageContent.length > 0 ? { page: { content: pageContent } } : {}),
          };
        });
        if (rows.length > 0 && columnMap.size > 0) {
          event.preventDefault();
          event.stopPropagation();
          const targetCell = target?.closest<HTMLElement>(
            '.nb-db-cell[data-row-id]'
          );
          const targetRowId = targetCell?.dataset.rowId ?? this.#active?.rowId;
          const index = targetRowId
            ? this.#data.rows.findIndex(row => row.id === targetRowId)
            : -1;
          const next = [...this.#data.rows];
          next.splice(index < 0 ? next.length : index + 1, 0, ...rows);
          this.#host.commit({ ...this.#data, rows: next });
          return;
        }
      } catch {
        // Fall back to TSV paste.
      }
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    const hasGrid = text.includes('\t') || text.includes('\n');
    if (!hasGrid && this.#rangeCells.size <= 1) return;
    const grid = parseTsv(text);
    if (grid.length === 0) return;
    const cell = target?.closest<HTMLElement>(
      '.nb-db-cell[data-row-id][data-column-id]'
    );
    const bounds = this.#rangeBounds();
    const startRowId =
      bounds?.rows[bounds.startRow]?.id ??
      cell?.dataset.rowId ??
      this.#active?.rowId;
    const startColumnId =
      bounds?.columns[bounds.startColumn]?.id ??
      cell?.dataset.columnId ??
      this.#active?.columnId;
    if (!startRowId || !startColumnId) return;
    const groupKey = cell?.closest<HTMLElement>('.nb-db-group')?.dataset.group;
    event.preventDefault();
    event.stopPropagation();
    this.#applyGrid(startRowId, startColumnId, grid, false, groupKey);
  };

  #openMultiSelectPopover(
    columnId: string,
    rowId: string,
    anchor: HTMLElement
  ): void {
    if (this.#readonly) return;
    const column = this.#data.columns.find(item => item.id === columnId);
    if (!column) return;
    const row = this.#data.rows.find(item => item.id === rowId);
    if (!row) return;
    const draft = [...(row.cells[columnId]?.values ?? [])];
    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = column.name;
    content.append(title);
    const options = [
      ...new Set([...(column.options ?? []), ...draft]),
    ];
    if (options.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'nb-db-filter-empty';
      empty.textContent = 'Add options in the column settings first.';
      content.append(empty);
    }
    for (const option of options) {
      const label = document.createElement('label');
      label.className = 'nb-db-check-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = draft.includes(option);
      input.addEventListener('change', () => {
        if (input.checked) {
          if (!draft.includes(option)) draft.push(option);
        } else {
          const index = draft.indexOf(option);
          if (index >= 0) draft.splice(index, 1);
        }
      });
      const text = document.createElement('span');
      text.textContent = option;
      label.append(input, text);
      content.append(label);
    }
    const actions = document.createElement('div');
    actions.className = 'nb-db-pop-actions';
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = 'Done';
    done.addEventListener('click', () => {
      this.#commitCell(
        rowId,
        columnId,
        { ...(row.cells[columnId] ?? {}), values: draft },
        `db:${rowId}:${columnId}`
      );
      this.#closePopover();
    });
    actions.append(done);
    content.append(actions);
    this.#showPopover(anchor, content);
    content.querySelector<HTMLInputElement>('input')?.focus();
  }

  #openFilesPopover(
    columnId: string,
    rowId: string,
    anchor: HTMLElement
  ): void {
    if (this.#readonly) return;
    const column = this.#data.columns.find(item => item.id === columnId);
    const row = this.#data.rows.find(item => item.id === rowId);
    if (!column || !row) return;
    const files: DatabaseFile[] = (row.cells[columnId]?.files ?? []).map(file => ({
      ...file,
    }));
    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = column.name;
    content.append(title);
    const nameInput = document.createElement('input');
    nameInput.placeholder = 'File name';
    nameInput.setAttribute('aria-label', 'File name');
    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.placeholder = 'https://…';
    urlInput.setAttribute('aria-label', 'File URL');
    const error = document.createElement('div');
    error.className = 'nb-db-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const list = document.createElement('div');
    list.className = 'nb-db-file-list';
    const render = (): void => {
      list.replaceChildren();
      files.forEach((file, index) => {
        const row = document.createElement('div');
        row.className = 'nb-db-filter-row';
        const link = document.createElement('a');
        link.href = file.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = file.name;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'nb-db-filter-remove';
        remove.innerHTML = icon.x;
        remove.title = `Remove ${file.name}`;
        remove.setAttribute('aria-label', `Remove ${file.name}`);
        remove.addEventListener('click', () => {
          files.splice(index, 1);
          render();
        });
        row.append(link, remove);
        list.append(row);
      });
    };
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = 'Add file';
    add.addEventListener('click', () => {
      const name = nameInput.value.trim();
      const url = safeHref(urlInput.value);
      if (!name || !url) {
        error.textContent = 'Name and a valid URL are required.';
        error.hidden = false;
        return;
      }
      files.push({ id: createId('f'), name, url });
      nameInput.value = '';
      urlInput.value = '';
      error.hidden = true;
      render();
    });
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = 'Done';
    done.addEventListener('click', () => {
      this.#commitCell(
        rowId,
        columnId,
        { ...(row.cells[columnId] ?? {}), files },
        `db:${rowId}:${columnId}`
      );
      this.#closePopover();
    });
    const actions = document.createElement('div');
    actions.className = 'nb-db-pop-actions';
    actions.append(add, done);
    content.append(nameInput, urlInput, error, list, actions);
    render();
    this.#showPopover(anchor, content);
    nameInput.focus();
  }

  #openPeoplePopover(
    columnId: string,
    rowId: string,
    anchor: HTMLElement
  ): void {
    if (this.#readonly) return;
    const column = this.#data.columns.find(item => item.id === columnId);
    const row = this.#data.rows.find(item => item.id === rowId);
    if (!column || !row) return;
    const existing = row.cells[columnId]?.people ?? [];
    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = column.name;
    content.append(title);
    const input = document.createElement('input');
    input.value = existing.map(person => person.label).join(', ');
    input.placeholder = 'Ada, Lin';
    input.setAttribute('aria-label', 'People');
    const hint = document.createElement('div');
    hint.className = 'nb-db-filter-empty';
    hint.textContent = 'Separate names with commas.';
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = 'Done';
    const actions = document.createElement('div');
    actions.className = 'nb-db-pop-actions';
    actions.append(done);
    done.addEventListener('click', () => {
      const labels = input.value
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
      const unchanged =
        labels.length === existing.length &&
        labels.every((label, index) => label === existing[index]?.label);
      const used = new Set<string>();
      const people = unchanged
        ? existing
        : labels.map(label => {
            const match = existing.find(
              person => person.label === label && !used.has(person.id)
            );
            if (match) {
              used.add(match.id);
              return match;
            }
            return { id: createId('p'), label };
          });
      this.#commitCell(
        rowId,
        columnId,
        { ...(row.cells[columnId] ?? {}), people },
        `db:${rowId}:${columnId}`
      );
      this.#closePopover();
    });
    content.append(input, hint, actions);
    this.#showPopover(anchor, content);
    input.focus();
    input.select();
  }

  #buildNumberFormatField(column: DatabaseColumn): {
    field: HTMLElement;
    formatSelect: HTMLSelectElement;
    decimals: HTMLInputElement;
    decimalPatch: () => { decimal?: number };
  } {
    const field = document.createElement('div');
    field.className = 'nb-db-field nb-db-number-format';
    const label = document.createElement('span');
    label.textContent = 'Format';
    const formatSelect = document.createElement('select');
    formatSelect.setAttribute('aria-label', 'Number format');
    for (const [value, text] of [
      ['number', 'Number'],
      ['currency', 'Currency'],
      ['percent', 'Percent'],
      ['decimal', 'Decimal'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = (column.data?.format ?? 'number') === value;
      formatSelect.append(option);
    }
    const decimals = document.createElement('input');
    decimals.type = 'number';
    decimals.min = '0';
    decimals.max = '6';
    decimals.step = '1';
    const defaultDecimals =
      typeof column.data?.decimal === 'number'
        ? column.data.decimal
        : column.data?.format === 'currency'
          ? 2
          : 0;
    decimals.value = String(defaultDecimals);
    let decimalTouched = false;
    decimals.addEventListener('input', () => {
      decimalTouched = true;
    });
    decimals.setAttribute('aria-label', 'Decimal places');
    const decimalPatch = (): { decimal?: number } =>
      decimalTouched || typeof column.data?.decimal === 'number'
        ? {
            decimal: Math.max(
              0,
              Math.min(6, Math.round(Number(decimals.value) || 0))
            ),
          }
        : {};
    field.append(label, formatSelect, decimals);
    field.style.display = column.type === 'number' ? '' : 'none';
    return { field, formatSelect, decimals, decimalPatch };
  }

  #openColumnPopover(columnId: string, anchor: HTMLElement): void {
    if (this.#readonly) return;
    const column = this.#data.columns.find(item => item.id === columnId);
    if (!column) return;
    const view = this.#activeView();
    const state = this.#columnStates(view).find(item => item.column.id === columnId);
    const isTitle = this.#titleColumn(view)?.id === columnId;
    const content = document.createElement('div');
    content.className = 'nb-db-column-popover';
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = 'Column';
    content.append(title);

    const nameField = document.createElement('label');
    nameField.className = 'nb-db-field';
    const nameLabel = document.createElement('span');
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.value = column.name;
    nameInput.disabled = isTitle;
    nameField.append(nameLabel, nameInput);

    const typeField = document.createElement('label');
    typeField.className = 'nb-db-field';
    const typeLabel = document.createElement('span');
    typeLabel.textContent = 'Type';
    const typeSelect = document.createElement('select');
    typeSelect.disabled = isTitle;
    for (const type of COLUMN_TYPES) {
      const option = document.createElement('option');
      option.value = type.type;
      option.textContent = type.label;
      option.selected = type.type === column.type;
      typeSelect.append(option);
    }
    typeField.append(typeLabel, typeSelect);

    const optionsField = document.createElement('label');
    optionsField.className = 'nb-db-field';
    const optionsLabel = document.createElement('span');
    optionsLabel.textContent = 'Options (comma separated)';
    const optionsInput = document.createElement('input');
    optionsInput.value = column.options?.join(', ') ?? 'Todo, In progress, Done';
    optionsField.append(optionsLabel, optionsInput);
    const syncOptionsVisibility = (): void => {
      optionsField.style.display =
        typeSelect.value === 'select' || typeSelect.value === 'multi-select'
          ? ''
          : 'none';
    };
    typeSelect.addEventListener('change', syncOptionsVisibility);
    syncOptionsVisibility();

    const numberFormat = this.#buildNumberFormatField(column);
    const { field: numberField, formatSelect, decimals, decimalPatch } =
      numberFormat;
    const actions = document.createElement('div');
    actions.className = 'nb-db-pop-actions';
    const action = (
      label: string,
      iconMarkup: string,
      handler: () => void,
      danger = false
    ): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = danger ? 'danger' : '';
      button.innerHTML = `${iconMarkup}<span>${label}</span>`;
      button.addEventListener('click', handler);
      actions.append(button);
    };
    const apply = (): void => {
      this.#commitColumnFields(
        columnId,
        nameInput.value,
        typeSelect.value as DatabaseColumnType,
        optionsInput.value,
        columns => {
          if (column.type !== 'number') return columns;
          return columns.map(item =>
            item.id === columnId
              ? {
                  ...item,
                  data: {
                    ...(item.data ?? {}),
                    format: formatSelect.value,
                    ...decimalPatch(),
                  },
                }
              : item
          );
        }
      );
    };
    action('Done', icon.check, () => {
      apply();
      this.#closePopover();
    });
    const hidden = state?.hide ?? false;
    action(hidden ? 'Show In View' : 'Hide In View', icon.checkboxSquare, () => {
      this.#closePopover();
      this.#patchViewColumn(columnId, { hide: !hidden });
    });
    action('Filter', icon.filter, () => {
      apply();
      this.#addFilterForColumn(columnId);
      this.#closePopover();
      queueMicrotask(() => {
        const current =
          this.element.querySelector<HTMLElement>(
            `th[data-column-id="${CSS.escape(columnId)}"] .nb-db-col-head`
          ) ?? anchor;
        this.#openFilterPopover(current);
      });
    });
    action('Sort Ascending', icon.sortAsc, () => {
      apply();
      this.#updateActiveView({ sorts: [{ columnId, direction: 'asc' }], sort: null });
      this.#closePopover();
    });
    action('Sort Descending', icon.sortDesc, () => {
      apply();
      this.#updateActiveView({ sorts: [{ columnId, direction: 'desc' }], sort: null });
      this.#closePopover();
    });
    action('Insert Left Column', icon.arrowLeft, () => {
      apply();
      this.#insertColumn(columnId, false);
      this.#closePopover();
    });
    action('Insert Right Column', icon.arrowRight, () => {
      apply();
      this.#insertColumn(columnId, true);
      this.#closePopover();
    });
    if (!isTitle) {
      action('Move Left', icon.arrowLeft, () => {
        this.#closePopover();
        this.#moveColumn(columnId, -1);
      });
      action('Move Right', icon.arrowRight, () => {
        this.#closePopover();
        this.#moveColumn(columnId, 1);
      });
    }
    action('Duplicate', icon.duplicate, () => {
      this.#closePopover();
      this.#duplicateColumn(columnId);
    });
    if (this.#data.columns.length > 1) {
      action('Delete', icon.trashSmall, () => {
        this.#closePopover();
        this.#deleteColumn(columnId);
      }, true);
    }

    if (column.type === 'number') {
      const commitFormat = (): void => {
        const data = {
          ...(column.data ?? {}),
          format: formatSelect.value,
          ...decimalPatch(),
        };
        this.#host.commit({
          ...this.#data,
          columns: this.#data.columns.map(item =>
            item.id === columnId ? { ...item, data } : item
          ),
        });
      };
      formatSelect.addEventListener('change', commitFormat);
      decimals.addEventListener('change', commitFormat);
    }

    nameInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        apply();
        this.#closePopover();
      }
    });

    content.append(nameField, typeField, optionsField, numberField, actions);
    this.#showPopover(anchor, content);
    if (!isTitle) {
      nameInput.focus();
      nameInput.select();
    }
  }

  #openRowPopover(rowId: string, anchor: HTMLElement): void {
    if (this.#readonly) return;
    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = 'Row';
    content.append(title);
    const actions = document.createElement('div');
    actions.className = 'nb-db-pop-actions';
    const add = (label: string, handler: () => void, danger = false): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = danger ? 'danger' : '';
      button.textContent = label;
      button.addEventListener('click', () => {
        handler();
        this.#closePopover();
      });
      actions.append(button);
    };
    add('Insert above', () => this.#insertRow(rowId, false));
    add('Insert below', () => this.#insertRow(rowId, true));
    add('Duplicate', () => this.#duplicateRow(rowId));
    add('Delete', () => this.#deleteRow(rowId), true);
    content.append(actions);
    this.#showPopover(anchor, content);
    actions.querySelector<HTMLButtonElement>('button')?.focus();
  }

  #openSelectPopover(columnId: string, rowId: string, anchor: HTMLElement): void {
    if (this.#readonly) return;
    const column = this.#data.columns.find(item => item.id === columnId);
    if (!column) return;
    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = column.name;
    content.append(title);
    const current = this.#data.rows.find(row => row.id === rowId)?.cells[columnId]?.text ?? '';
    const options = column.options ?? [];
    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-db-opt';
      const dot = document.createElement('span');
      dot.className = 'nb-db-dot';
      const label = document.createElement('span');
      label.textContent = option;
      button.append(dot, label);
      if (option === current) button.style.fontWeight = '600';
      button.addEventListener('click', () => {
        this.#commitCell(rowId, columnId, { text: option }, `db:${rowId}:${columnId}`);
        this.#closePopover();
      });
      content.append(button);
    }
    if (options.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'nb-db-empty';
      empty.style.height = 'auto';
      empty.textContent = 'No options yet.';
      content.append(empty);
    }
    if (current) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'nb-db-opt';
      const label = document.createElement('span');
      label.className = 'nb-db-opt-clear';
      label.textContent = 'Clear';
      clear.append(label);
      clear.addEventListener('click', () => {
        this.#commitCell(rowId, columnId, {}, `db:${rowId}:${columnId}`);
        this.#closePopover();
      });
      content.append(clear);
    }
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'nb-db-opt';
    const editLabel = document.createElement('span');
    editLabel.className = 'nb-db-opt-clear';
    editLabel.textContent = 'Edit options…';
    edit.append(editLabel);
    edit.addEventListener('click', () => {
      this.#closePopover();
      this.#openColumnPopover(columnId, anchor);
    });
    content.append(edit);
    this.#showPopover(anchor, content);
    content.querySelector<HTMLButtonElement>('.nb-db-opt')?.focus();
  }
}
