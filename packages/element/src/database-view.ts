import {
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
  filteredDatabaseRows,
  groupedDatabaseRows,
  safeHref,
  searchDatabaseRows,
  sortedDatabaseRows,
} from '@nobita/core';
import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseData,
  DatabaseFilter,
  DatabaseFilterGroup,
  DatabaseFilterOperator,
  DatabaseFile,
  DatabasePerson,
  DatabaseRow,
  DatabaseStatType,
  DatabaseView as DatabaseViewConfig,
  DatabaseViewColumn,
} from '@nobita/core';
import { nativeSelection } from './dom.js';
import { dismissFloating, placeFloating } from './floating.js';
import { icon } from './icons.js';

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
  const fraction =
    decimals === undefined
      ? {}
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  if (format === 'percent') {
    return new Intl.NumberFormat(undefined, {
      style: 'percent',
      useGrouping: false,
      ...fraction,
    }).format(number);
  }
  if (format === 'decimal') {
    return new Intl.NumberFormat(undefined, {
      style: 'decimal',
      useGrouping: false,
      ...(decimals === undefined ? { maximumFractionDigits: 0 } : fraction),
    }).format(number);
  }
  if (format === 'currency') {
    const currency =
      typeof column.data?.currency === 'string' ? column.data.currency : 'USD';
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        ...fraction,
      }).format(number);
    } catch {
      return number.toFixed(decimals ?? 0);
    }
  }
  return new Intl.NumberFormat(undefined, {
    style: 'decimal',
    useGrouping: false,
    ...(decimals === undefined ? { maximumFractionDigits: 0 } : fraction),
  }).format(number);
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

/** Parse spreadsheet-friendly TSV, including quoted tabs/newlines and quotes. */
function parseTsv(source: string): string[][] {
  const text = source.replace(/\r\n?/gu, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        fieldStarted = true;
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
        fieldStarted = true;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      fieldStarted = true;
    } else if (char === '\t') {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (fieldStarted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function tsvField(value: string): string {
  if (value === '') return '""';
  return /[\t\n\r"]/u.test(value)
    ? `"${value.replace(/"/gu, '""')}"`
    : value;
}

function placeCaret(element: HTMLElement, at: 'start' | 'end'): void {
  const root = element.getRootNode() as ShadowRoot;
  const selection = nativeSelection(root);
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(at === 'start');
  selection.removeAllRanges();
  selection.addRange(range);
}

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
  const startRange = document.createRange();
  startRange.selectNodeContents(element);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = document.createRange();
  endRange.selectNodeContents(element);
  endRange.setEnd(range.endContainer, range.endOffset);
  return {
    start: startRange.toString().length,
    end: endRange.toString().length,
  };
}

function setSelectionOffsets(
  element: HTMLElement,
  start: number,
  end: number
): void {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!startNode && start <= offset + length) {
      startNode = node;
      startOffset = start - offset;
    }
    if (!endNode && end <= offset + length) {
      endNode = node;
      endOffset = end - offset;
    }
    if (startNode && endNode) break;
    offset += length;
  }
  if (!startNode) {
    startNode = element;
    startOffset = element.childNodes.length;
  }
  if (!endNode) {
    endNode = element;
    endOffset = element.childNodes.length;
  }
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = nativeSelection(element.getRootNode() as ShadowRoot);
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function caretAtBoundary(element: HTMLElement, side: 'start' | 'end'): boolean {  const root = element.getRootNode() as ShadowRoot;
  const selection = nativeSelection(root);
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return false;
  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  const beforeLength = before.toString().length;
  return side === 'start' ? beforeLength === 0 : beforeLength === (element.textContent ?? '').length;
}

export class DatabaseView {
  readonly element: HTMLElement;

  #host: DatabaseHost;
  #data: DatabaseData;
  #readonly: boolean;
  #structureKey = '';
  #events = new AbortController();
  #cells = new Map<string, CellNodes[]>();
  #titleInput: HTMLInputElement | null = null;
  #active: { rowId: string; columnId: string; groupKey?: string } | null = null;
  #pendingFocus: { rowId: string; columnId: string; at: 'start' | 'end' } | null = null;
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
  #selectedRows = new Set<string>();
  #groupOverrides = new Map<string, { hide?: boolean; collapsed?: boolean }>();
  #dragSelect: {
    anchorRowId: string;
    anchorColumnId: string;
    groupKey?: string;
    moved: boolean;
  } | null = null;
  #fillHandle: HTMLElement | null = null;
  #detail: HTMLElement | null = null;
  #detailRowId: string | null = null;
  #detailEvents = new AbortController();
  #visibleKey = '';
  #boardTitleEditing: { rowId: string; columnId: string } | null = null;
  #suppressClick = false;
  #boardBlurTimer: number | null = null;
  #instanceId = createId('db');
  #searchQuery = '';
  #searchFocusPending = false;
  #searchSelection: { start: number; end: number } | null = null;

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
    if (!readonly) this.#groupOverrides.clear();
    if (readonly) this.#closeDetailPanel();
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
    this.#events.abort();
    this.#closePopover();
    this.#closeDetailPanel();
    this.element.remove();
  }

  /** ---- rendering ---- */

  #views(): (DatabaseViewConfig & { id: string; name: string })[] {
    return databaseViews(this.#data).map((view, index) => ({
      ...view,
      id: view.id ?? (index === 0 ? 'view-default' : `view-${index}`),
      name: view.name ?? (view.type === 'board' ? 'Board' : 'Table'),
      filters: view.filters ?? [],
    }));
  }

  #activeView(): DatabaseViewConfig & { id: string; name: string } {
    const views = this.#views();
    return views.find(view => view.id === this.#data.activeViewId) ?? views[0]!;
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
      this.render();
      return;
    }
    const view = this.#activeView();
    const existing = new Map(
      (view.groupProperties ?? []).map(group => [group.key, { ...group }])
    );
    const keys = this.#groupsFor(view).map(group => group.key);
    for (const groupKey of existing.keys()) {
      if (!keys.includes(groupKey)) keys.push(groupKey);
    }
    if (!keys.includes(key)) keys.push(key);
    const groups = keys.map(groupKey => existing.get(groupKey) ?? { key: groupKey });
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
    return databaseViewColumnStates(this.#data, view);
  }

  #visibleColumns(view: DatabaseViewConfig = this.#activeView()): DatabaseColumn[] {
    return databaseVisibleColumns(this.#data, view);
  }

  #titleColumn(view: DatabaseViewConfig = this.#activeView()): DatabaseColumn | undefined {
    return databaseTitleColumn(this.#data, view);
  }

  #rowsFor(view: DatabaseViewConfig = this.#activeView()): DatabaseRow[] {
    return searchDatabaseRows(
      this.#data,
      filteredDatabaseRows(this.#data, view),
      this.#searchQuery
    );
  }

  #groupsFor(
    view: DatabaseViewConfig = this.#activeView()
  ): ReturnType<typeof groupedDatabaseRows> {
    const allowed = new Set(this.#rowsFor(view).map(row => row.id));
    const groups = groupedDatabaseRows(this.#data, view).map(group => {
      const override = this.#readonly
        ? this.#groupOverrides.get(group.key)
        : undefined;
      return {
        ...group,
        ...(override?.hide !== undefined ? { hidden: override.hide } : {}),
        ...(override?.collapsed !== undefined
          ? { collapsed: override.collapsed }
          : {}),
        rows: group.rows.filter(row => allowed.has(row.id)),
      };
    });
    return view.hideEmptyGroups
      ? groups.filter(group => group.rows.length > 0)
      : groups;
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
    view: DatabaseViewConfig = databaseView(data)
  ): string {
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
    this.#events.abort();
    this.#events = new AbortController();
    this.#closePopover();
    this.#cells.clear();
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
    this.#updateCount(view);

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
    headTop.append(title, count, tools);
    head.append(headTop, this.#renderViewBar(view));

    const scroll = document.createElement('div');
    scroll.className = 'nb-db-scroll';
    scroll.dataset.view = view.type;
    const fillHandle = document.createElement('div');
    fillHandle.className = 'nb-db-fill-handle';
    fillHandle.dataset.visible = 'false';
    fillHandle.setAttribute('role', 'button');
    fillHandle.setAttribute('aria-label', 'Fill selected cells');
    fillHandle.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      this.#beginFillDrag(event);
    }, { signal: this.#events.signal });
    this.element.append(fillHandle);
    this.#fillHandle = fillHandle;
    scroll.addEventListener('scroll', () => this.#positionFillHandle(), {
      signal: this.#events.signal,
      passive: true,
    });
    window.addEventListener('scroll', () => this.#positionFillHandle(), {
      signal: this.#events.signal,
      passive: true,
    });
    scroll.append(
      view.type === 'board' ? this.#renderBoard(view) : this.#renderTable(view)
    );

    const filterBar = this.#renderFilterBar(view);
    this.element.append(head);
    if (filterBar) this.element.append(filterBar);
    this.element.append(scroll);

    if (this.#searchFocusPending) {
      this.#searchFocusPending = false;
      const selection = this.#searchSelection;
      this.#searchSelection = null;
      requestAnimationFrame(() => {
        const input = this.element.querySelector<HTMLInputElement>('.nb-db-search');
        if (!input) return;
        input.focus();
        const start = Math.min(selection?.start ?? input.value.length, input.value.length);
        const end = Math.min(selection?.end ?? start, input.value.length);
        input.setSelectionRange(start, end);
      });
    }
    if (view.type === 'table' && this.#pendingFocus) {
      const pending = this.#pendingFocus;
      this.#pendingFocus = null;
      this.focusCell(pending.rowId, pending.columnId, pending.at);
    } else if (view.type === 'table' && hadFocus && this.#active) {
      this.focusCell(this.#active.rowId, this.#active.columnId, 'end');
    }
    this.#syncDetailPanel();
    this.#syncRowSelection();
  }

  #renderFilterBar(view: DatabaseViewConfig): HTMLElement | null {
    const group = databaseFilterGroup(view);
    if (group.conditions.length === 0) return null;
    const bar = document.createElement('div');
    bar.className = 'nb-db-filter-bar';
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
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'nb-db-viewtab nb-db-viewmore';
      more.textContent = '⋯';
      more.title = 'View actions';
      more.addEventListener('click', () => this.#openViewMenu(more), {
        signal: this.#events.signal,
      });
      bar.append(more);
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'nb-db-viewtab nb-db-viewadd';
      add.textContent = '+';
      add.title = 'Add view';
      add.addEventListener('click', () => this.#openAddViewMenu(add), {
        signal: this.#events.signal,
      });
      bar.append(add);
    }
    return bar;
  }

  #renderToolButtons(view: DatabaseViewConfig, tools: HTMLElement): void {
    const search = document.createElement('input');
    search.className = 'nb-db-search';
    search.type = 'search';
    search.placeholder = 'Search';
    search.value = this.#searchQuery;
    search.setAttribute('aria-label', 'Search rows');
    search.addEventListener('input', () => {
      this.#searchQuery = search.value;
      this.#searchSelection = {
        start: search.selectionStart ?? search.value.length,
        end: search.selectionEnd ?? search.value.length,
      };
      this.#searchFocusPending = true;
      this.render();
    }, { signal: this.#events.signal });
    tools.append(search);

    if (this.#readonly) return;
    const filter = document.createElement('button');
    filter.type = 'button';
    filter.className = 'nb-db-btn';
    const activeFilterCount = databaseFilterGroup(view).conditions.length;
    filter.dataset.active = String(activeFilterCount > 0);
    filter.innerHTML = `${icon.filter}<span>${activeFilterCount > 0 ? `Filter (${activeFilterCount})` : 'Filter'}</span>`;
    filter.title = 'Filter rows';
    filter.addEventListener('click', () => this.#openFilterPopover(filter), {
      signal: this.#events.signal,
    });
    tools.append(filter);

    const sortCount = (view.sorts ?? (view.sort ? [view.sort] : [])).length;
    const sort = document.createElement('button');
    sort.type = 'button';
    sort.className = 'nb-db-btn';
    sort.dataset.active = String(sortCount > 0);
    sort.innerHTML = `${icon.sort}<span>${sortCount > 0 ? `Sort (${sortCount})` : 'Sort'}</span>`;
    sort.title = 'Sort rows';
    sort.addEventListener('click', () => this.#openSortPopover(sort), {
      signal: this.#events.signal,
    });
    tools.append(sort);

    const columns = document.createElement('button');
    columns.type = 'button';
    columns.className = 'nb-db-btn';
    columns.innerHTML = `${icon.columns}<span>Columns</span>`;
    columns.title = 'Show or hide columns';
    columns.addEventListener('click', () => this.#openColumnsPopover(columns), {
      signal: this.#events.signal,
    });
    tools.append(columns);

    const group = document.createElement('button');
    group.type = 'button';
    group.className = 'nb-db-btn';
    const groupColumn = view.groupBy
      ? this.#data.columns.find(item => item.id === view.groupBy)
      : undefined;
    group.dataset.active = String(Boolean(groupColumn));
    group.innerHTML = icon.group;
    const groupLabel = document.createElement('span');
    groupLabel.textContent = groupColumn ? `Group: ${groupColumn.name}` : 'Group';
    group.append(groupLabel);
    group.title = 'Group rows';
    group.addEventListener('click', () => this.#openGroupPopover(group), {
      signal: this.#events.signal,
    });
    tools.append(group);
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

  #openColumnsPopover(anchor: HTMLElement): void {
    const view = this.#activeView();
    const hidden = new Set(
      this.#columnStates(view)
        .filter(item => item.hide)
        .map(item => item.column.id)
    );
    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = 'Columns';
    content.append(title);
    const list = document.createElement('div');
    list.className = 'nb-db-column-list';
    const render = (): void => {
      list.replaceChildren();
      for (const column of this.#data.columns) {
        const label = document.createElement('label');
        label.className = 'nb-db-column-toggle';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !hidden.has(column.id);
        input.addEventListener('change', () => {
          if (input.checked) hidden.delete(column.id);
          else hidden.add(column.id);
        });
        const name = document.createElement('span');
        name.textContent = column.name;
        label.append(input, name);
        list.append(label);
      }
    };
    const actions = document.createElement('div');
    actions.className = 'nb-db-pop-actions';
    const showAll = document.createElement('button');
    showAll.type = 'button';
    showAll.textContent = 'Show all';
    showAll.addEventListener('click', () => {
      hidden.clear();
      render();
    });
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => {
      const columns = this.#viewColumns(view).map(column => {
        const next = { ...column };
        if (hidden.has(column.id)) next.hide = true;
        else delete next.hide;
        return next;
      });
      this.#updateActiveView({
        columns,
        hiddenColumns: [...hidden],
      });
      this.#closePopover();
    });
    actions.append(showAll, apply);
    content.append(list, actions);
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
        heading.setAttribute('aria-expanded', String(!collapsed));
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
        }, { signal: this.#events.signal });
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
        }, { signal: this.#events.signal });
        heading.append(toggle, label, count, addRow);
        heading.addEventListener('click', () => {
          this.#setGroupProperty(group.key, { collapsed: !collapsed });
        }, { signal: this.#events.signal });
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
    const addCol = document.createElement('col');
    addCol.style.width = '40px';
    colgroup.append(addCol);
    table.append(colgroup);

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'nb-db-handle nb-db-corner';
    headRow.append(corner);
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
      const sorts = databaseSorts(view);
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
        { signal: this.#events.signal }
      );
      th.addEventListener(
        'contextmenu',
        event => {
          event.preventDefault();
          this.#openColumnPopover(column.id, th);
        },
        { signal: this.#events.signal }
      );
      th.addEventListener(
        'pointerdown',
        event => this.#beginColumnDrag(event, column.id),
        { signal: this.#events.signal }
      );
      const resizer = document.createElement('span');
      resizer.className = 'nb-db-resizer';
      resizer.setAttribute('role', 'separator');
      resizer.setAttribute('aria-orientation', 'vertical');
      resizer.setAttribute('aria-label', `Resize ${column.name}`);
      resizer.addEventListener(
        'pointerdown',
        event => this.#startColumnResize(event, column),
        { signal: this.#events.signal }
      );
      th.append(button, resizer);
      headRow.append(th);
    }
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
        signal: this.#events.signal,
      });
      addHead.append(add);
    }
    headRow.append(addHead);
    thead.append(headRow);
    table.append(thead);

    const tbody = document.createElement('tbody');
    for (const row of rows) {
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
        }, { signal: this.#events.signal });
        grip.addEventListener('click', () => this.#toggleRowSelection(row.id), {
          signal: this.#events.signal,
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
        }, { signal: this.#events.signal });
        handle.append(grip, check);
      }
      tr.append(handle);
      for (const column of columns) {
        const td = this.#createCell(row, column);
        if (column.id === opsColumnId && !this.#readonly) {
          td.classList.add('has-row-ops');
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
            this.#openDetailPanel(row.id);
          }, { signal: this.#events.signal });
          const menu = document.createElement('button');
          menu.type = 'button';
          menu.className = 'nb-db-rowmenu';
          menu.title = 'Row actions';
          menu.setAttribute('aria-label', 'Row actions');
          menu.innerHTML = icon.more;
          menu.addEventListener('click', event => {
            event.stopPropagation();
            this.#openRowPopover(row.id, menu);
          }, { signal: this.#events.signal });
          ops.append(expand, menu);
          td.append(ops);
        }
        tr.append(td);
      }
      const addCell = document.createElement('td');
      addCell.className = 'nb-db-add-cell';
      tr.append(addCell);
      tbody.append(tr);
    }
    if (rows.length === 0) {
      const empty = document.createElement('tr');
      empty.className = 'nb-db-empty-row';
      const td = document.createElement('td');
      td.className = 'nb-db-empty';
      td.colSpan = Math.max(1, columns.length + 2);
      td.textContent = this.#readonly ? 'No rows' : 'No rows yet. Add one below.';
      empty.append(td);
      tbody.append(empty);
    }
    table.append(tbody);

    if (states.length > 0) {
      const tfoot = document.createElement('tfoot');
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
          signal: this.#events.signal,
        });
        td.append(button);
        footRow.append(td);
      }
      const addFoot = document.createElement('td');
      addFoot.className = 'nb-db-foot nb-db-add-cell';
      footRow.append(addFoot);
      tfoot.append(footRow);
      table.append(tfoot);
    }

    let foot = table.querySelector('tfoot');
    if (!foot) {
      foot = document.createElement('tfoot');
      table.append(foot);
    }
    if (!this.#readonly) {
      const addRowRow = document.createElement('tr');
      addRowRow.className = 'nb-db-new-record-row';
      const addRowCell = document.createElement('td');
      addRowCell.colSpan = Math.max(1, columns.length + 2);
      const addRow = document.createElement('button');
      addRow.type = 'button';
      addRow.className = 'nb-db-new-record';
      addRow.innerHTML = `${icon.plus}<span>New Record</span>`;
      addRow.addEventListener('click', () => this.#addRow(undefined, groupKey), {
        signal: this.#events.signal,
      });
      addRowCell.append(addRow);
      addRowRow.append(addRowCell);
      foot.append(addRowRow);
    }
    return table;
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
          { signal: this.#events.signal }
        );
        column.addEventListener(
          'dragleave',
          () => column.classList.remove('is-drop-target'),
          { signal: this.#events.signal }
        );
        column.addEventListener(
          'drop',
          event => {
            event.preventDefault();
            column.classList.remove('is-drop-target');
            if (event.dataTransfer?.getData('text/nobita-db') !== this.#instanceId) {
              return;
            }
            const rowId = event.dataTransfer?.getData('text/nobita-row');
            if (rowId) this.#moveCardToGroup(rowId, view.groupBy!, group.key);
          },
          { signal: this.#events.signal }
        );
      }
      const heading = document.createElement('div');
      heading.className = 'nb-db-board-heading';
      const label = document.createElement('span');
      label.textContent = group.label;
      const count = document.createElement('span');
      count.className = 'nb-db-board-count';
      count.textContent = String(group.rows.length);
      heading.append(label, count);
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
      column.append(cards);
      board.append(column);
    }
    return board;
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
          event.dataTransfer?.setData('text/plain', row.id);
        },
        { signal: this.#events.signal }
      );
    }
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
        { signal: this.#events.signal }
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
        { signal: this.#events.signal }
      );
      title.addEventListener(
        'input',
        () => {
          const raw = (title.textContent ?? '').replace(/\r?\n/gu, ' ');
          const value =
            titleColumn.type === 'number'
              ? raw.replace(/[^0-9eE+.-]/gu, '')
              : raw;
          this.#commitCell(
            row.id,
            titleColumn.id,
            this.#withText(cell, value),
            `db:${row.id}:${titleColumn.id}`
          );
        },
        { signal: this.#events.signal }
      );
      title.addEventListener(
        'keydown',
        event => {
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
        { signal: this.#events.signal }
      );
    }
    card.append(title);
    const fields = this.#boardFields(row, titleColumn, view, columns);
    if (fields) card.append(fields);
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
      field.textContent = `${column.name}: ${display}`;
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
    for (const card of this.element.querySelectorAll<HTMLElement>('.nb-db-card[data-row-id]')) {
      const row = this.#data.rows.find(item => item.id === card.dataset.rowId);
      if (!row) continue;
      const title = card.querySelector<HTMLElement>('.nb-db-card-title');
      if (title && (force || activeElement !== title)) {
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
    const move = (moveEvent: PointerEvent): void => {
      const width = Math.max(
        MIN_DATABASE_COLUMN_WIDTH,
        Math.min(
          MAX_DATABASE_COLUMN_WIDTH,
          Math.round(startWidth + moveEvent.clientX - startX)
        )
      );
      col.style.width = `${width}px`;
    };
    const end = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const width = Number.parseFloat(col.style.width);
      if (Number.isFinite(width)) {
        this.#commitColumnWidth(column.id, width);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
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

    const renderCondition = (
      filter: DatabaseFilter,
      parent: DatabaseFilterGroup
    ): HTMLElement => {
      const column = this.#data.columns.find(item => item.id === filter.columnId);
      const row = document.createElement('div');
      row.className = 'nb-db-filter-row';
      if (!column) {
        row.textContent = 'This filter references a deleted column.';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'nb-db-filter-remove';
        remove.innerHTML = icon.x;
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
    };

    const renderGroup = (
      group: DatabaseFilterGroup,
      parent: HTMLElement,
      depth: number,
      parentGroup?: DatabaseFilterGroup
    ): void => {
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
          renderGroup(item, box, depth + 1, group);
        } else {
          box.append(renderCondition(item, group));
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
    };

    const render = (): void => {
      list.replaceChildren();
      renderGroup(root, list, 0);
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
        up.addEventListener('click', () => this.#moveGroup(group.key, -1), {
          signal: this.#events.signal,
        });
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'nb-db-property-move';
        down.innerHTML = icon.arrowDown;
        down.disabled = index === groups.length - 1;
        down.title = 'Move group down';
        down.addEventListener('click', () => this.#moveGroup(group.key, 1), {
          signal: this.#events.signal,
        });
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'nb-db-property-eye';
        toggle.dataset.hidden = String(Boolean(group.hidden));
        toggle.title = group.hidden ? 'Show group' : 'Hide group';
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
    const visible = new Set(keys);
    const order: string[] = [];
    let visibleIndex = 0;
    for (const item of settings) {
      if (visible.has(item.key)) {
        const nextKey = keys[visibleIndex];
        if (nextKey !== undefined) {
          order.push(nextKey);
          visibleIndex += 1;
        }
      } else if (!order.includes(item.key)) {
        order.push(item.key);
      }
    }
    while (visibleIndex < keys.length) {
      const nextKey = keys[visibleIndex];
      if (nextKey !== undefined) order.push(nextKey);
      visibleIndex += 1;
    }
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
    const rows = this.#data.rows.filter(row => !ids.has(row.id));
    for (const id of ids) this.#selectedRows.delete(id);
    this.#host.commit({ ...this.#data, rows });
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

  #closeDetailPanel(): void {
    this.#detail?.remove();
    this.#detail = null;
    this.#detailRowId = null;
    this.#detailEvents.abort();
    this.#detailEvents = new AbortController();
  }

  #openDetailPanel(rowId: string): void {
    this.#closeDetailPanel();
    const row = this.#data.rows.find(item => item.id === rowId);
    if (!row) return;
    this.#detailRowId = rowId;
    const view = this.#activeView();
    const titleColumn = this.#titleColumn(view);
    const root = this.element.getRootNode() as ShadowRoot;
    const backdrop = document.createElement('div');
    backdrop.className = 'nb-db-detail-backdrop';
    const panel = document.createElement('section');
    panel.className = 'nb-db-detail';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Record detail');
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
    prev.addEventListener('click', () => navigate(-1));
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'nb-db-detail-navbtn';
    next.dataset.nav = 'next';
    next.innerHTML = icon.arrowDown;
    next.title = 'Next record';
    next.addEventListener('click', () => navigate(1));
    this.#syncDetailNav(prev, next, rowId);
    nav.append(prev, next);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'nb-db-detail-close';
    close.innerHTML = icon.x;
    close.setAttribute('aria-label', 'Close record detail');
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

    const note = document.createElement('div');
    note.className = 'nb-db-detail-note';
    note.textContent = 'Add a note or linked document for this record.';
    panel.append(note);

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
    title.focus();
    title.select();
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
        this.#commitCell(
          row.id,
          titleColumn.id,
          { ...(row.cells[titleColumn.id] ?? {}), text: value },
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

  #renderDetailField(row: DatabaseRow, column: DatabaseColumn): HTMLElement {
    const field = document.createElement('label');
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
      input.value =
        column.type === 'number'
          ? formatDatabaseNumber(cell?.text ?? '', column)
          : cell?.text ?? '';
      input.type = 'text';
      input.inputMode = column.type === 'number' ? 'decimal' : 'text';
      input.disabled = this.#readonly;
      input.addEventListener('input', () => {
        const value =
          column.type === 'number'
            ? input.value.replace(/[^0-9eE+.-]/gu, '')
            : input.value;
        this.#commitCell(
          row.id,
          column.id,
          { ...(cell ?? {}), text: value },
          `db:${row.id}:${column.id}`
        );
      }, { signal: this.#detailEvents.signal });
      if (column.type === 'number') {
        input.addEventListener(
          'focus',
          () => {
            input.value = this.#currentCell(row.id, column.id)?.text ?? '';
            input.select();
          },
          { signal: this.#detailEvents.signal }
        );
        input.addEventListener(
          'blur',
          () => {
            input.value = formatDatabaseNumber(input.value, column);
          },
          { signal: this.#detailEvents.signal }
        );
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
        this.#applyFilesLabel(button, cell?.files ?? []);
      } else {
        this.#applyPeopleLabel(button, cell?.people ?? []);
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
    text.className = 'nb-db-detail-input nb-db-detail-text';
    text.contentEditable = this.#readonly ? 'false' : 'true';
    text.spellcheck = false;
    text.textContent = cell?.text ?? '';
    text.addEventListener('input', () => {
      this.#commitCell(
        row.id,
        column.id,
        { ...(cell ?? {}), text: text.textContent ?? '' },
        `db:${row.id}:${column.id}`
      );
    }, { signal: this.#detailEvents.signal });
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
    const move = (moveEvent: PointerEvent): void => {
      if (Math.abs(moveEvent.clientX - startX) < 6 && Math.abs(moveEvent.clientY - startY) < 6) {
        return;
      }
      moved = true;
    };
    const end = (endEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!moved) return;
      this.#suppressClick = true;
      window.setTimeout(() => {
        this.#suppressClick = false;
      }, 0);
      const target = this.#headerColumnFromEvent(endEvent);
      if (target && target !== columnId) this.#moveColumnTo(columnId, target);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
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
    const move = (moveEvent: PointerEvent): void => {
      if (Math.abs(moveEvent.clientX - startX) < 6 && Math.abs(moveEvent.clientY - startY) < 6) {
        return;
      }
      moved = true;
    };
    const end = (endEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!moved) return;
      this.#suppressClick = true;
      window.setTimeout(() => {
        this.#suppressClick = false;
      }, 0);
      const target = this.#rowFromEvent(endEvent);
      if (target && target !== rowId) this.#moveRowTo(rowId, target, groupKey);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
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
      const settings = view.groupProperties ?? [];
      const visibleOrder = ordered.map(entry => entry.id);
      const visible = new Set(visibleOrder);
      const savedOrder =
        settings.find(item => item.key === group.key)?.manuallyCardSort ?? [];
      const order: string[] = [];
      let visibleIndex = 0;
      for (const id of savedOrder) {
        if (visible.has(id)) {
          const nextId = visibleOrder[visibleIndex];
          if (nextId !== undefined) {
            order.push(nextId);
            visibleIndex += 1;
          }
        } else if (!order.includes(id)) {
          order.push(id);
        }
      }
      while (visibleIndex < visibleOrder.length) {
        const nextId = visibleOrder[visibleIndex];
        if (nextId !== undefined) order.push(nextId);
        visibleIndex += 1;
      }
      const keys = groups.map(item => item.key);
      for (const item of settings) {
        if (!keys.includes(item.key)) keys.push(item.key);
      }
      if (!keys.includes(group.key)) keys.push(group.key);
      const byKey = new Map(settings.map(item => [item.key, item]));
      const groupProperties = keys.map(key =>
        key === group.key
          ? {
              ...(byKey.get(key) ?? {}),
              key,
              manuallyCardSort: order,
            }
          : byKey.get(key) ?? { key }
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
          [column.id]: {
            ...cell,
            ...(cell.values ? { values: [...cell.values] } : {}),
            ...(cell.files ? { files: cell.files.map(file => ({ ...file })) } : {}),
            ...(cell.people
              ? { people: cell.people.map(person => ({ ...person })) }
              : {}),
          },
        },
      };
    });
    const view = this.#activeView();
    const views = this.#views().map(item => {
      const columns = this.#viewColumns(item);
      const index = columns.findIndex(entry => entry.id === columnId);
      if (index < 0) return item;
      columns.splice(index + 1, 0, {
        ...(columns[index] ?? { id: column.id, width: 180 }),
        id: column.id,
      });
      return { ...item, columns };
    });
    this.#host.commit({
      ...this.#data,
      columns,
      rows,
      views,
      activeViewId: view.id,
    });
  }

  #moveCardToGroup(rowId: string, columnId: string, groupKey: string): void {
    const column = this.#data.columns.find(item => item.id === columnId);
    const row = this.#data.rows.find(item => item.id === rowId);
    if (!column || !row) return;
    const current = row.cells[columnId] ?? {};
    let next: DatabaseCell;
    if (column.type === 'checkbox') {
      next = { ...current, checked: groupKey === 'true' };
    } else if (column.type === 'multi-select') {
      next = groupKey
        ? { ...current, values: [groupKey] }
        : { ...current, values: [] };
    } else {
      next = { ...current, text: groupKey };
    }
    this.#commitCell(rowId, columnId, next, `db:${rowId}:${columnId}`);
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

  #syncTitle(): void {
    const input = this.#titleInput;
    if (!input) return;
    const value = this.#data.title ?? '';
    if (input.value !== value) input.value = value;
  }

  #syncValues(): void {
    for (const row of this.#data.rows) {
      for (const column of this.#data.columns) {
        const copies = this.#cells.get(cellKey(row.id, column.id));
        if (!copies) continue;
        const cell = row.cells[column.id];
        const value = column.type === 'checkbox' ? '' : cell?.text ?? '';
        for (const nodes of copies) {
          if (nodes.text && nodes.text.textContent !== value) nodes.text.textContent = value;
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
            this.#applySelectLabel(nodes.button, value, column.options);
          }
          if (nodes.button && column.type === 'multi-select') {
            this.#applyMultiLabel(nodes.button, cell?.values ?? []);
          }
          if (nodes.button && column.type === 'files') {
            this.#applyFilesLabel(nodes.button, cell?.files ?? []);
          }
          if (nodes.button && column.type === 'people') {
            this.#applyPeopleLabel(nodes.button, cell?.people ?? []);
          }
        }
      }
    }
    this.#syncTitle();
    this.#syncBoardValues();
    this.#syncStats();
    this.#syncDetailPanel();
    this.#updateCount(this.#activeView());
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
          this.#applyFilesLabel(picker, cell?.files ?? []);
        } else if (column.type === 'people') {
          this.#applyPeopleLabel(picker, cell?.people ?? []);
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
      if (text && text.textContent !== textValue) {
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
    const groups = this.#groupsFor(view);
    for (const table of this.element.querySelectorAll<HTMLElement>('.nb-db-table')) {
      const groupKey = table.closest<HTMLElement>('.nb-db-group')?.dataset.group;
      const rows = groupKey === undefined
        ? this.#rowsFor(view)
        : groups.find(group => group.key === groupKey)?.rows ?? [];
      for (const button of table.querySelectorAll<HTMLButtonElement>('.nb-db-stat[data-stat-column]')) {
        const column = this.#data.columns.find(item => item.id === button.dataset.statColumn);
        if (!column) continue;
        const stat = this.#columnStates(view).find(
          item => item.column.id === column.id
        )?.stat;
        button.dataset.calculated = String(Boolean(stat));
        button.textContent = stat
          ? `${DATABASE_STAT_LABELS[stat]}: ${databaseStatValue(rows, column, stat)}`
          : 'Calculate';
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
      { signal: this.#events.signal }
    );

    if (column.type === 'checkbox') {
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
          this.#commitCell(row.id, column.id, { ...(cell?.text ? { text: cell.text } : {}), checked }, `db:${row.id}:${column.id}`);
        },
        { signal: this.#events.signal }
      );
      button.addEventListener(
        'keydown',
        event => this.#onCellKeyDown(event, row.id, column.id, 'checkbox'),
        { signal: this.#events.signal }
      );
      td.append(button);
      nodes.button = button;
      this.#registerCell(key, nodes);
      return td;
    }

    if (column.type === 'select') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-db-select';
      button.disabled = this.#readonly;
      this.#applySelectLabel(button, cell?.text ?? '', column.options);
      button.addEventListener(
        'click',
        () => this.#openSelectPopover(column.id, row.id, button),
        { signal: this.#events.signal }
      );
      button.addEventListener(
        'keydown',
        event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.#openSelectPopover(column.id, row.id, button);
            return;
          }
          this.#onCellKeyDown(event, row.id, column.id, 'select');
        },
        { signal: this.#events.signal }
      );
      td.append(button);
      nodes.button = button;
      this.#registerCell(key, nodes);
      return td;
    }

    if (column.type === 'multi-select' || column.type === 'files' || column.type === 'people') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-db-select nb-db-multi';
      button.disabled = this.#readonly;
      if (column.type === 'multi-select') {
        this.#applyMultiLabel(button, cell?.values ?? []);
      } else if (column.type === 'files') {
        this.#applyFilesLabel(button, cell?.files ?? []);
      } else {
        this.#applyPeopleLabel(button, cell?.people ?? []);
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
        { signal: this.#events.signal }
      );
      button.addEventListener(
        'keydown',
        event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            button.click();
            return;
          }
          this.#onCellKeyDown(event, row.id, column.id, column.type as CellKind);
        },
        { signal: this.#events.signal }
      );
      td.append(button);
      nodes.button = button;
      this.#registerCell(key, nodes);
      return td;
    }

    if (column.type === 'number' || column.type === 'date') {
      const input = document.createElement('input');
      input.className = 'nb-db-input';
      input.type = 'text';
      input.inputMode = column.type === 'number' ? 'decimal' : 'text';
      if (column.type === 'date') input.placeholder = 'YYYY-MM-DD';
      input.value =
        column.type === 'number'
          ? formatDatabaseNumber(cell?.text ?? '', column)
          : cell?.text ?? '';
      input.disabled = this.#readonly;
      input.setAttribute('aria-label', column.name);
      input.addEventListener(
        'input',
        () => {
          const value =
            column.type === 'number'
              ? input.value.replace(/[^0-9eE+.-]/gu, '')
              : input.value;
          this.#commitCell(row.id, column.id, this.#withText(cell, value), `db:${row.id}:${column.id}`);
        },
        { signal: this.#events.signal }
      );
      input.addEventListener(
        'focus',
        () => {
          const groupKey = input.closest<HTMLElement>('.nb-db-group')?.dataset.group;
          this.#active = {
            rowId: row.id,
            columnId: column.id,
            ...(groupKey !== undefined ? { groupKey } : {}),
          };
          if (column.type === 'number') {
            input.value = this.#currentCell(row.id, column.id)?.text ?? '';
            input.select();
          }
        },
        { signal: this.#events.signal }
      );
      if (column.type === 'number') {
        input.addEventListener(
          'blur',
          () => {
            input.value = formatDatabaseNumber(input.value, column);
          },
          { signal: this.#events.signal }
        );
      }
      input.addEventListener(
        'keydown',
        event => this.#onCellKeyDown(event, row.id, column.id, column.type as CellKind),
        { signal: this.#events.signal }
      );
      td.append(input);
      nodes.input = input;
      this.#registerCell(key, nodes);
      return td;
    }

    const text = document.createElement('div');
    text.className = 'nb-db-text';
    text.contentEditable = this.#readonly ? 'false' : 'true';
    text.spellcheck = false;
    text.dataset.placeholder = column.type === 'url' ? 'https://…' : 'Empty';
    text.setAttribute('role', 'textbox');
    text.setAttribute('aria-label', column.name);
    text.textContent = cell?.text ?? '';
    if (!this.#readonly) {
      text.addEventListener(
        'input',
        () => {
          const value = (text.textContent ?? '').replace(/\r?\n/gu, ' ');
          this.#commitCell(row.id, column.id, this.#withText(cell, value), `db:${row.id}:${column.id}`);
        },
        { signal: this.#events.signal }
      );
      text.addEventListener(
        'focus',
        () => {
          const groupKey = text.closest<HTMLElement>('.nb-db-group')?.dataset.group;
          this.#active = {
            rowId: row.id,
            columnId: column.id,
            ...(groupKey !== undefined ? { groupKey } : {}),
          };
        },
        { signal: this.#events.signal }
      );
      text.addEventListener(
        'keydown',
        event => this.#onCellKeyDown(event, row.id, column.id, 'text'),
        { signal: this.#events.signal }
      );
      text.addEventListener(
        'paste',
        event => {
          event.preventDefault();
          const value = event.clipboardData?.getData('text/plain') ?? '';
          if (!value) return;
          document.execCommand('insertText', false, value.replace(/\r?\n/gu, ' '));
        },
        { signal: this.#events.signal }
      );
    }
    td.append(text);
    nodes.text = text;
    this.#registerCell(key, nodes);
    return td;
  }

  #applySelectLabel(button: HTMLButtonElement, value: string, options: string[] = []): void {
    button.replaceChildren();
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

  #applyMultiLabel(button: HTMLButtonElement, values: string[]): void {
    button.replaceChildren();
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

  #applyFilesLabel(button: HTMLButtonElement, files: DatabaseFile[]): void {
    button.replaceChildren();
    button.classList.toggle('is-empty', files.length === 0);
    const label = document.createElement('span');
    label.textContent =
      files.length === 0
        ? 'Add file…'
        : files.length === 1
          ? files[0]!.name
          : `${files.length} files`;
    button.append(label);
  }

  #applyPeopleLabel(button: HTMLButtonElement, people: DatabasePerson[]): void {
    button.replaceChildren();
    button.classList.toggle('is-empty', people.length === 0);
    const label = document.createElement('span');
    label.textContent =
      people.length === 0
        ? 'Add people…'
        : people.map(person => person.label).join(', ');
    button.append(label);
  }

  #withText(cell: DatabaseCell | undefined, value: string): DatabaseCell {
    const next: DatabaseCell = { ...(cell ?? {}) };
    if (value) next.text = value;
    else delete next.text;
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
    const views = this.#views().map(item => {
      const columns = this.#viewColumns(item);
      return columns.some(entry => entry.id === column.id)
        ? item
        : { ...item, columns: [...columns, { id: column.id, width: 180 }] };
    });
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

  #deleteRow(rowId: string): void {
    this.#host.commit({ ...this.#data, rows: this.#data.rows.filter(row => row.id !== rowId) });
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
      cells: Object.fromEntries(Object.entries(row.cells).map(([key, cell]) => [key, { ...cell }])),
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
    const views = this.#views().map(item => {
      const viewColumns = this.#viewColumns(item);
      const viewIndex = viewColumns.findIndex(entry => entry.id === anchorId);
      viewColumns.splice(
        viewIndex < 0 ? viewColumns.length : after ? viewIndex + 1 : viewIndex,
        0,
        { id: column.id, width: 180 }
      );
      return { ...item, columns: viewColumns };
    });
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
    const move = (moveEvent: PointerEvent): void => {
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
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (this.#dragSelect !== drag) return;
      this.#dragSelect = null;
      if (drag.moved) {
        this.#suppressClick = true;
        window.setTimeout(() => {
          this.#suppressClick = false;
        }, 0);
        this.#renderRange();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
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
    for (const [key, copies] of this.#cells) {
      const [rowId, columnId] = key.split('\u0000');
      const selected = this.#rangeCells.has(key);
      for (const nodes of copies) {
        const groupKey = nodes.td.closest<HTMLElement>('.nb-db-group')?.dataset
          .group;
        const activeState = this.#active;
        const active =
          activeState !== null &&
          activeState.rowId === rowId &&
          activeState.columnId === columnId &&
          (activeState.groupKey === undefined ||
            activeState.groupKey === groupKey);
        nodes.td.classList.toggle('is-selected', selected);
        nodes.td.classList.toggle('is-active', active);
        nodes.td.setAttribute('aria-selected', String(selected));
      }
    }
    this.#positionFillHandle();
  }

  #activeBounds():
    | {
        rows: DatabaseRow[];
        columns: DatabaseColumn[];
        startRow: number;
        endRow: number;
        startColumn: number;
        endColumn: number;
      }
    | null {
    const range = this.#rangeBounds();
    if (range) return range;
    const active = this.#active;
    if (!active) return null;
    const rows = this.#renderedRows(this.#activeView());
    const columns = this.#visibleColumns(this.#activeView());
    const row = rows.findIndex(item => item.id === active.rowId);
    const column = columns.findIndex(item => item.id === active.columnId);
    if (row < 0 || column < 0) return null;
    return {
      rows,
      columns,
      startRow: row,
      endRow: row,
      startColumn: column,
      endColumn: column,
    };
  }

  #positionFillHandle(): void {
    const handle = this.#fillHandle;
    if (!handle) return;
    const bounds = this.#activeBounds();
    const active = this.#active;
    if (
      !bounds ||
      !active ||
      bounds.startColumn !== bounds.endColumn
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
    if (!td) {
      handle.dataset.visible = 'false';
      return;
    }
    const rect = td.getBoundingClientRect();
    handle.style.left = `${Math.round(rect.right - 1)}px`;
    handle.style.top = `${Math.round(rect.bottom - 1)}px`;
    handle.dataset.visible = 'true';
  }

  #beginFillDrag(event: PointerEvent): void {
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
    const move = (moveEvent: PointerEvent): void => {
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
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (!moved) return;
      const current = this.#rangeBounds();
      if (!current) return;
      const sourceCell = source.cells[column.id];
      let next = this.#data;
      for (let index = current.startRow; index <= current.endRow; index += 1) {
        const row = current.rows[index];
        if (!row || row.id === active.rowId) continue;
        const cells = { ...row.cells };
        if (sourceCell) cells[column.id] = this.#cloneCell(sourceCell);
        else delete cells[column.id];
        next = {
          ...next,
          rows: next.rows.map(item =>
            item.id === row.id ? { ...item, cells } : item
          ),
        };
      }
      if (next !== this.#data) this.#host.commit(next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  #cloneCell(cell: DatabaseCell): DatabaseCell {
    return {
      ...cell,
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
          tsvField(databaseCellText(dataRow.cells[dataColumn.id], dataColumn.type))
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
          cells[column.id] = { ...(cell ?? {}), text: value };
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
            tsvField(databaseCellText(row.cells[column.id], column.type))
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
      rows: this.#selectedVisibleRows().map(row => ({ cells: row.cells })),
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
          rows?: Array<{ cells?: Record<string, DatabaseCell> }>;
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
          return { id: createId('r'), cells };
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

    const numberField = document.createElement('div');
    numberField.className = 'nb-db-field nb-db-number-format';
    const numberLabel = document.createElement('span');
    numberLabel.textContent = 'Format';
    const formatSelect = document.createElement('select');
    formatSelect.setAttribute('aria-label', 'Number format');
    for (const [value, label] of [
      ['number', 'Number'],
      ['currency', 'Currency'],
      ['percent', 'Percent'],
      ['decimal', 'Decimal'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
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
    numberField.append(numberLabel, formatSelect, decimals);
    numberField.style.display = column.type === 'number' ? '' : 'none';

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
