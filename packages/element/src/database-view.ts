import {
  createDatabaseColumn,
  createDatabaseRow,
  createId,
  DATABASE_STAT_LABELS,
  DATABASE_STAT_TYPES,
  createDatabaseView,
  databaseCellDisplay,
  databaseCellText,
  databaseSorts,
  databaseStatValue,
  databaseView,
  databaseViews,
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
  DatabaseFilterOperator,
  DatabaseFile,
  DatabasePerson,
  DatabaseRow,
  DatabaseStatType,
  DatabaseView as DatabaseViewConfig,
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

const cellKey = (rowId: string, columnId: string): string => `${rowId}\u0000${columnId}`;

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

function caretAtBoundary(element: HTMLElement, side: 'start' | 'end'): boolean {
  const root = element.getRootNode() as ShadowRoot;
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
  #active: { rowId: string; columnId: string } | null = null;
  #pendingFocus: { rowId: string; columnId: string; at: 'start' | 'end' } | null = null;
  #popoverCleanup: (() => void) | null = null;
  #countElement: HTMLElement | null = null;
  #colElements: HTMLTableColElement[] = [];
  #range: {
    startRowId: string;
    startColumnId: string;
    endRowId: string;
    endColumnId: string;
  } | null = null;
  #rangeCells = new Set<string>();
  #visibleKey = '';
  #boardTitleEditing: { rowId: string; columnId: string } | null = null;
  #suppressClick = false;
  #boardBlurTimer: number | null = null;
  #instanceId = createId('db');
  #searchQuery = '';
  #searchFocusPending = false;
  #searchSelection: { start: number; end: number } | null = null;
  #collapsedGroups = new Set<string>();

  constructor(host: DatabaseHost, data: DatabaseData) {
    this.#host = host;
    this.#data = data;
    this.#readonly = host.readonly;
    this.element = document.createElement('div');
    this.element.className = 'nb-db';
    this.element.contentEditable = 'false';
    this.element.dataset.readonly = String(this.#readonly);
    this.element.addEventListener('copy', this.#onCopy, true);
    this.element.addEventListener('cut', this.#onCut, true);
    this.element.addEventListener('paste', this.#onPaste, true);
    this.element.addEventListener('click', this.#onClickCapture, true);
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
    this.#active = { rowId, columnId };
  }

  destroy(): void {
    if (this.#boardBlurTimer !== null) {
      window.clearTimeout(this.#boardBlurTimer);
      this.#boardBlurTimer = null;
    }
    this.#events.abort();
    this.#closePopover();
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

  #visibleColumns(view: DatabaseViewConfig = this.#activeView()): DatabaseColumn[] {
    const hidden = new Set(view.hiddenColumns ?? []);
    return this.#data.columns.filter(column => !hidden.has(column.id));
  }

  #rowsFor(view: DatabaseViewConfig = this.#activeView()): DatabaseRow[] {
    return searchDatabaseRows(
      this.#data,
      filteredDatabaseRows(this.#data, view),
      this.#searchQuery
    );
  }

  #groupsFor(view: DatabaseViewConfig = this.#activeView()): { key: string; label: string; rows: DatabaseRow[] }[] {
    const allowed = new Set(this.#rowsFor(view).map(row => row.id));
    return groupedDatabaseRows(this.#data, view).map(group => ({
      ...group,
      rows: group.rows.filter(row => allowed.has(row.id)),
    }));
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
      ]),
      rows: data.rows.map(row => row.id),
      activeViewId: data.activeViewId ?? null,
      views: views.map(view => ({
        id: view.id ?? null,
        name: view.name ?? null,
        type: view.type,
        filters: view.filters,
        filterMode: view.filterMode ?? 'and',
        groupBy: view.groupBy ?? null,
        sorts: view.sorts ?? (view.sort ? [view.sort] : []),
        hiddenColumns: view.hiddenColumns ?? [],
        stats: view.stats ?? {},
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
      const addRow = document.createElement('button');
      addRow.type = 'button';
      addRow.className = 'nb-db-btn';
      addRow.innerHTML = `${icon.plus}<span>Row</span>`;
      addRow.title = 'Add row';
      addRow.addEventListener('click', () => this.#addRow(), { signal: this.#events.signal });
      const addColumn = document.createElement('button');
      addColumn.type = 'button';
      addColumn.className = 'nb-db-btn';
      addColumn.innerHTML = `${icon.plus}<span>Column</span>`;
      addColumn.title = 'Add column';
      addColumn.addEventListener('click', () => this.#addColumn(), { signal: this.#events.signal });
      tools.append(addRow, addColumn);
    }
    headTop.append(title, count, tools);
    head.append(headTop, this.#renderViewBar(view));

    const scroll = document.createElement('div');
    scroll.className = 'nb-db-scroll';
    scroll.dataset.view = view.type;
    scroll.append(
      view.type === 'board' ? this.#renderBoard(view) : this.#renderTable(view)
    );

    this.element.append(head, scroll);
    if (!this.#readonly) {
      const addRow = document.createElement('button');
      addRow.type = 'button';
      addRow.className = 'nb-db-addrow';
      addRow.innerHTML = `${icon.plus}<span>New row</span>`;
      addRow.addEventListener('click', () => this.#addRow(), { signal: this.#events.signal });
      this.element.append(addRow);
    }

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
        () => this.#setActiveView(item.id),
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
    filter.dataset.active = String(view.filters.length > 0);
    filter.textContent = view.filters.length > 0 ? `Filter (${view.filters.length})` : 'Filter';
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
    sort.textContent = sortCount > 0 ? `Sort (${sortCount})` : 'Sort';
    sort.title = 'Sort rows';
    sort.addEventListener('click', () => this.#openSortPopover(sort), {
      signal: this.#events.signal,
    });
    tools.append(sort);

    const columns = document.createElement('button');
    columns.type = 'button';
    columns.className = 'nb-db-btn';
    columns.textContent = 'Columns';
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
    group.textContent = groupColumn ? `Group: ${groupColumn.name}` : 'Group';
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
    const view = this.#activeView();
    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = view.name;
    content.append(title);
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
        ...(active.sorts ? { sorts: active.sorts.map(sort => ({ ...sort })) } : {}),
        ...(active.hiddenColumns ? { hiddenColumns: [...active.hiddenColumns] } : {}),
        ...(active.stats ? { stats: { ...active.stats } } : {}),
      } satisfies DatabaseViewConfig;
      const next = [...views];
      next.splice(index + 1, 0, copy);
      const { view: _legacyView, sort: _legacySort, ...rest } = this.#data;
      this.#host.commit({ ...rest, views: next, activeViewId: copy.id });
    });
    if (this.#views().length > 1) {
      add('Delete view', () => {
        this.#closePopover();
        const active = this.#activeView();
        const views = this.#views().filter(view => view.id !== active.id);
        const { view: _legacyView, sort: _legacySort, ...rest } = this.#data;
        const nextActive = views[0]?.id;
        this.#host.commit({ ...rest, views, ...(nextActive ? { activeViewId: nextActive } : {}) });
      }, true);
    }
    content.append(actions);
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
    const hidden = new Set(view.hiddenColumns ?? []);
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
      this.#updateActiveView({ hiddenColumns: [...hidden] });
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
      for (const group of groups) {
        const section = document.createElement('section');
        section.className = 'nb-db-group';
        section.dataset.group = group.key;
        const heading = document.createElement('button');
        heading.type = 'button';
        heading.className = 'nb-db-group-head';
        const collapsed = this.#collapsedGroups.has(`${view.id}:${group.key}`);
        heading.setAttribute('aria-expanded', String(!collapsed));
        const chevron = document.createElement('span');
        chevron.className = 'nb-db-group-chevron';
        chevron.textContent = collapsed ? '▸' : '▾';
        const label = document.createElement('span');
        label.className = 'nb-db-group-label';
        label.textContent = group.label || 'No value';
        const count = document.createElement('span');
        count.className = 'nb-db-group-count';
        count.textContent = String(group.rows.length);
        heading.append(chevron, label, count);
        heading.addEventListener('click', () => {
          const key = `${view.id}:${group.key}`;
          if (this.#collapsedGroups.has(key)) this.#collapsedGroups.delete(key);
          else this.#collapsedGroups.add(key);
          this.render();
        }, { signal: this.#events.signal });
        section.append(heading);
        if (!collapsed) {
          section.append(this.#renderTableGrid(view, columns, group.rows));
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
    rows: readonly DatabaseRow[]
  ): HTMLTableElement {
    const table = document.createElement('table');
    table.className = 'nb-db-table';
    table.setAttribute('aria-label', this.#data.title?.trim() || 'Database');
    const colgroup = document.createElement('colgroup');
    const handleCol = document.createElement('col');
    handleCol.style.width = '28px';
    colgroup.append(handleCol);
    columns.forEach((column, index) => {
      const col = document.createElement('col');
      col.style.width = column.width
        ? `${column.width}px`
        : index === 0
          ? '200px'
          : '145px';
      this.#colElements.push(col);
      colgroup.append(col);
    });
    table.append(colgroup);

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'nb-db-handle';
    headRow.append(corner);
    for (const column of columns) {
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
    thead.append(headRow);
    table.append(thead);

    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.dataset.rowId = row.id;
      const handle = document.createElement('td');
      handle.className = 'nb-db-handle';
      if (!this.#readonly) {
        const menu = document.createElement('button');
        menu.type = 'button';
        menu.className = 'nb-db-rowmenu';
        menu.innerHTML = icon.more;
        menu.title = 'Row actions';
        menu.setAttribute('aria-label', 'Row actions');
        menu.addEventListener('click', () => this.#openRowPopover(row.id, menu), {
          signal: this.#events.signal,
        });
        handle.append(menu);
      }
      tr.append(handle);
      for (const column of columns) {
        tr.append(this.#createCell(row, column));
      }
      tbody.append(tr);
    }
    if (rows.length === 0) {
      const empty = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'nb-db-empty';
      td.colSpan = Math.max(1, columns.length + 1);
      td.textContent = this.#readonly ? 'No rows' : 'No rows yet. Add one below.';
      empty.append(td);
      tbody.append(empty);
    }
    table.append(tbody);

    if (columns.length > 0) {
      const tfoot = document.createElement('tfoot');
      const footRow = document.createElement('tr');
      const cornerFoot = document.createElement('td');
      cornerFoot.className = 'nb-db-handle nb-db-foot-handle';
      footRow.append(cornerFoot);
      for (const column of columns) {
        const td = document.createElement('td');
        td.className = 'nb-db-foot';
        const stat = view.stats?.[column.id];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'nb-db-stat';
        button.dataset.statColumn = column.id;
        button.dataset.calculated = String(Boolean(stat));
        button.textContent = stat
          ? `${DATABASE_STAT_LABELS[stat]}: ${databaseStatValue(rows, column, stat)}`
          : 'Calculate';
        button.disabled = this.#readonly;
        button.addEventListener('click', () => this.#openStatPopover(column.id, button, rows), {
          signal: this.#events.signal,
        });
        td.append(button);
        footRow.append(td);
      }
      tfoot.append(footRow);
      table.append(tfoot);
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
    const current = this.#activeView().stats?.[columnId];
    const add = (label: string, type: DatabaseStatType | null): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-db-stat-option';
      button.dataset.active = String((current ?? null) === type);
      button.textContent = type
        ? `${label} (${databaseStatValue(rows, column, type)})`
        : 'None';
      button.addEventListener('click', () => {
        const stats = { ...(this.#activeView().stats ?? {}) };
        if (type) stats[columnId] = type;
        else delete stats[columnId];
        this.#updateActiveView({ stats });
        this.#closePopover();
      });
      list.append(button);
    };
    add('None', null);
    const available = column.type === 'number'
      ? DATABASE_STAT_TYPES
      : DATABASE_STAT_TYPES.filter(type => type === 'count' || type === 'countValues');
    for (const type of available) {
      add(DATABASE_STAT_LABELS[type], type);
    }
    content.append(list);
    this.#showPopover(anchor, content);
  }

  #renderBoard(view: DatabaseViewConfig): HTMLElement {
    const board = document.createElement('div');
    board.className = 'nb-db-board';
    const groups = this.#groupsFor(view);
    const columns = this.#visibleColumns(view);
    const titleColumn = columns[0];
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
    const value = titleColumn ? databaseCellDisplay(cell, titleColumn.type) : '';
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
          }
        },
        { signal: this.#events.signal }
      );
      title.addEventListener(
        'input',
        () => {
          this.#commitCell(
            row.id,
            titleColumn.id,
            this.#withText(cell, (title.textContent ?? '').replace(/\r?\n/gu, ' ')),
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
      const display = databaseCellDisplay(row.cells[column.id], column.type);
      if (!display) continue;
      const field = document.createElement('span');
      field.className = 'nb-db-card-field';
      field.textContent = `${column.name}: ${display}`;
      fields.append(field);
    }
    return fields.childElementCount > 0 ? fields : null;
  }

  #history(redo: boolean): void {
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
    const titleColumn = columns[0];
    for (const card of this.element.querySelectorAll<HTMLElement>('.nb-db-card[data-row-id]')) {
      const row = this.#data.rows.find(item => item.id === card.dataset.rowId);
      if (!row) continue;
      const title = card.querySelector<HTMLElement>('.nb-db-card-title');
      if (title && (force || activeElement !== title)) {
        const value = titleColumn
          ? databaseCellDisplay(row.cells[titleColumn.id], titleColumn.type)
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
        80,
        Math.min(800, Math.round(startWidth + moveEvent.clientX - startX))
      );
      col.style.width = `${width}px`;
    };
    const end = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const width = Number.parseFloat(col.style.width);
      if (Number.isFinite(width)) {
        this.#host.commit({
          ...this.#data,
          columns: this.#data.columns.map(item =>
            item.id === column.id
              ? { ...item, width: Math.round(width) }
              : item
          ),
        });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  #openFilterPopover(anchor: HTMLElement): void {
    const view = this.#activeView();
    const draft: DatabaseFilter[] = view.filters
      .filter(filter => this.#data.columns.some(column => column.id === filter.columnId))
      .map(filter => ({ ...filter }));
    const mode = view.filterMode === 'or' ? 'or' : 'and';
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
      option.selected = mode === value;
      modeSelect.append(option);
    }
    modeRow.append(modeLabel, modeSelect);
    content.append(modeRow);

    const list = document.createElement('div');
    list.className = 'nb-db-filter-list';
    content.append(list);

    const render = (): void => {
      list.replaceChildren();
      if (draft.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'nb-db-filter-empty';
        empty.textContent = 'No filters. Showing all rows.';
        list.append(empty);
        return;
      }
      draft.forEach((filter, index) => {
        const column = this.#data.columns.find(item => item.id === filter.columnId);
        if (!column) return;
        const row = document.createElement('div');
        row.className = 'nb-db-filter-row';
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
          filter.value = '';
          render();
        });

        const operatorSelect = document.createElement('select');
        operatorSelect.setAttribute('aria-label', 'Filter operator');
        const operators = filterOperators(column.type);
        if (!operators.includes(filter.operator)) {
          operators.unshift(filter.operator);
        }
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
          draft.splice(index, 1);
          render();
        });
        row.append(remove);
        list.append(row);
      });
    };

    const footer = document.createElement('div');
    footer.className = 'nb-db-pop-actions';
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = '+ Add filter';
    add.addEventListener('click', () => {
      const first = this.#data.columns[0];
      if (!first) return;
      draft.push({
        columnId: first.id,
        operator: defaultFilterOperator(first.type),
        ...(first.type === 'checkbox' ? { value: 'true' } : {}),
      });
      render();
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear all';
    clear.addEventListener('click', () => {
      draft.length = 0;
      render();
    });
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => {
      this.#updateActiveView({
        filters: draft.map(filter => {
          const column = this.#data.columns.find(item => item.id === filter.columnId);
          if (column?.type === 'checkbox' && !filter.value) {
            return { ...filter, value: 'true' };
          }
          return filter;
        }),
        filterMode: modeSelect.value === 'or' ? 'or' : 'and',
      });
      this.#closePopover();
    });
    footer.append(add, clear, apply);
    content.append(footer);
    render();
    this.#showPopover(anchor, content);
  }

  #openGroupPopover(anchor: HTMLElement): void {
    const view = this.#activeView();
    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = 'Group by';
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
      this.#updateActiveView({ groupBy: select.value || null });
      this.#closePopover();
    });
    content.append(select);
    this.#showPopover(anchor, content);
    select.focus();
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
          if (nodes.input && nodes.input.value !== value) nodes.input.value = value;
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
    this.#syncColumnWidths();
    this.#syncBoardValues();
    this.#syncStats();
    this.#updateCount(this.#activeView());
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
        const stat = view.stats?.[column.id];
        button.dataset.calculated = String(Boolean(stat));
        button.textContent = stat
          ? `${DATABASE_STAT_LABELS[stat]}: ${databaseStatValue(rows, column, stat)}`
          : 'Calculate';
      }
    }
  }

  #syncColumnWidths(): void {
    const columns = this.#visibleColumns(this.#activeView());
    if (columns.length === 0) return;
    this.#colElements.forEach((col, index) => {
      const columnIndex = index % columns.length;
      const column = columns[columnIndex];
      if (!column) return;
      col.style.width = column.width
        ? `${column.width}px`
        : columnIndex === 0
          ? '200px'
          : '145px';
    });
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
      input.type = column.type === 'number' ? 'number' : 'text';
      if (column.type === 'number') input.step = 'any';
      if (column.type === 'date') input.placeholder = 'YYYY-MM-DD';
      input.value = cell?.text ?? '';
      input.disabled = this.#readonly;
      input.setAttribute('aria-label', column.name);
      input.addEventListener(
        'input',
        () => {
          this.#commitCell(row.id, column.id, this.#withText(cell, input.value), `db:${row.id}:${column.id}`);
        },
        { signal: this.#events.signal }
      );
      input.addEventListener(
        'focus',
        () => {
          this.#active = { rowId: row.id, columnId: column.id };
        },
        { signal: this.#events.signal }
      );
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
          this.#active = { rowId: row.id, columnId: column.id };
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

  #addRow(columnId = this.#data.columns[0]?.id ?? ''): void {
    if (this.#readonly) return;
    const row = createDatabaseRow();
    this.#pendingFocus = {
      rowId: row.id,
      columnId,
      at: 'start',
    };
    this.#host.commit({ ...this.#data, rows: [...this.#data.rows, row] });
  }

  #addColumn(): void {
    if (this.#readonly) return;
    const column = createDatabaseColumn(`Column ${this.#data.columns.length + 1}`);
    this.#host.commit({ ...this.#data, columns: [...this.#data.columns, column] });
    queueMicrotask(() => {
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
    const next: DatabaseData = { ...this.#data, columns, rows };
    if (this.#data.sort?.columnId === columnId) delete next.sort;
    if (this.#data.views) {
      next.views = this.#data.views.map(view => this.#removeColumnFromView(view, columnId));
    }
    if (this.#data.view) {
      next.view = this.#removeColumnFromView(this.#data.view, columnId);
    }
    this.#host.commit(next);
  }

  #removeColumnFromView(view: DatabaseViewConfig, columnId: string): DatabaseViewConfig {
    const filters = view.filters.filter(filter => filter.columnId !== columnId);
    const groupBy = view.groupBy && view.groupBy !== columnId ? view.groupBy : undefined;
    const sorts = (view.sorts ?? (view.sort ? [view.sort] : [])).filter(
      sort => sort.columnId !== columnId
    );
    const sort = view.sort && view.sort.columnId !== columnId ? view.sort : undefined;
    const hiddenColumns = (view.hiddenColumns ?? []).filter(id => id !== columnId);
    const stats = { ...(view.stats ?? {}) };
    delete stats[columnId];
    return {
      ...view,
      filters,
      ...(groupBy ? { groupBy } : {}),
      ...(sorts.length > 0 ? { sorts } : {}),
      ...(sort ? { sort } : {}),
      ...(hiddenColumns.length > 0 ? { hiddenColumns } : {}),
      ...(Object.keys(stats).length > 0 ? { stats } : {}),
    };
  }

  #insertColumn(anchorId: string, after: boolean): void {
    const column = createDatabaseColumn(`Column ${this.#data.columns.length + 1}`);
    const columns = [...this.#data.columns];
    const index = columns.findIndex(item => item.id === anchorId);
    columns.splice(index < 0 ? columns.length : after ? index + 1 : index, 0, column);
    this.#host.commit({ ...this.#data, columns });
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
    return this.#renderedRows(this.#activeView());
  }

  #renderedRows(view: DatabaseViewConfig = this.#activeView()): DatabaseRow[] {
    if (view.type === 'table' && view.groupBy) {
      return this.#groupsFor(view).flatMap(group =>
        this.#collapsedGroups.has(`${view.id}:${group.key}`) ? [] : group.rows
      );
    }
    return this.#rowsFor(view);
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
    this.#active = { rowId, columnId };
    if (!event.shiftKey) {
      this.#suppressClick = false;
      if (this.#range) {
        this.#clearRange();
        this.#renderRange();
      }
      return;
    }
    const startRowId = previous?.rowId ?? rowId;
    const startColumnId = previous?.columnId ?? columnId;
    this.#range = { startRowId, startColumnId, endRowId: rowId, endColumnId: columnId };
    this.#suppressClick = true;
    this.#renderRange();
    event.preventDefault();
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
    const rows = this.#renderedRows(view);
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
    for (const [key, copies] of this.#cells) {
      const selected = this.#rangeCells.has(key);
      for (const nodes of copies) {
        nodes.td.classList.toggle('is-selected', selected);
        nodes.td.setAttribute('aria-selected', String(selected));
      }
    }
  }

  #clearRange(): void {
    this.#range = null;
    this.#rangeCells.clear();
    for (const copies of this.#cells.values()) {
      for (const nodes of copies) {
        nodes.td.classList.remove('is-selected');
        nodes.td.setAttribute('aria-selected', 'false');
      }
    }
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

  #onCopy = (event: ClipboardEvent): void => {
    if (this.#rangeCells.size <= 1) return;
    if ((event.target as Element | null)?.closest('.nb-db-popover')) return;
    const text = this.#rangeText();
    if (!text) return;
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
  };

  #onCut = (event: ClipboardEvent): void => {
    if (this.#rangeCells.size <= 1) return;
    if ((event.target as Element | null)?.closest('.nb-db-popover')) return;
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
      true
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
    const content = document.createElement('div');
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
    nameField.append(nameLabel, nameInput);

    const typeField = document.createElement('label');
    typeField.className = 'nb-db-field';
    const typeLabel = document.createElement('span');
    typeLabel.textContent = 'Type';
    const typeSelect = document.createElement('select');
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

    const apply = (): void => {
      this.#commitColumnFields(
        columnId,
        nameInput.value,
        typeSelect.value as DatabaseColumnType,
        optionsInput.value
      );
    };

    const actions = document.createElement('div');
    actions.className = 'nb-db-pop-actions';
    const action = (label: string, iconMarkup: string, handler: () => void, danger = false): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = danger ? 'danger' : '';
      button.innerHTML = `${iconMarkup}<span>${label}</span>`;
      button.addEventListener('click', handler);
      actions.append(button);
    };
    action('Done', icon.check, () => {
      apply();
      this.#closePopover();
    });
    action('Left', icon.arrowLeft, () => {
      apply();
      this.#insertColumn(columnId, false);
      this.#closePopover();
    });
    action('Right', icon.arrowRight, () => {
      apply();
      this.#insertColumn(columnId, true);
      this.#closePopover();
    });
    action('Sort ↑', icon.sortAsc, () => {
      apply();
      this.#updateActiveView({ sorts: [{ columnId, direction: 'asc' }], sort: null });
      this.#closePopover();
    });
    action('Sort ↓', icon.sortDesc, () => {
      apply();
      this.#updateActiveView({ sorts: [{ columnId, direction: 'desc' }], sort: null });
      this.#closePopover();
    });
    if (databaseSorts(this.#activeView()).some(sort => sort.columnId === columnId)) {
      action('Clear sort', icon.x, () => {
        apply();
        this.#updateActiveView({
          sorts: databaseSorts(this.#activeView()).filter(sort => sort.columnId !== columnId),
          sort: null,
        });
        this.#closePopover();
      });
    }
    if (this.#data.columns.length > 1) {
      action(
        'Delete',
        icon.trashSmall,
        () => {
          this.#deleteColumn(columnId);
          this.#closePopover();
        },
        true
      );
    }

    nameInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        apply();
        this.#closePopover();
      }
    });

    content.append(nameField, typeField, optionsField, actions);
    this.#showPopover(anchor, content);
    nameInput.focus();
    nameInput.select();
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
