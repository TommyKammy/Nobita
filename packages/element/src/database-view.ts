import {
  createDatabaseColumn,
  createDatabaseRow,
  createId,
  databaseCellDisplay,
  databaseCellText,
  databaseView,
  filteredDatabaseRows,
  groupedDatabaseRows,
  safeHref,
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

const FILTER_OPERATORS: readonly [DatabaseFilterOperator, string][] = [
  ['contains', 'contains'],
  ['is', 'is'],
  ['isNot', 'is not'],
  ['isEmpty', 'is empty'],
  ['isNotEmpty', 'is not empty'],
];

const cellKey = (rowId: string, columnId: string): string => `${rowId}\u0000${columnId}`;

/** Parse spreadsheet-friendly TSV, including quoted tabs/newlines and quotes. */
function parseTsv(source: string): string[][] {
  const text = source.replace(/\r\n?/gu, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === '\t') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function tsvField(value: string): string {
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
  #cells = new Map<string, CellNodes>();
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
    const rows = sortedDatabaseRows(this.#data);
    const row = rows[0];
    const column = this.#data.columns[0];
    if (!row || !column) {
      if (this.#data.columns.length === 0) this.#addColumn();
      else this.#addRow();
      return;
    }
    this.focusCell(row.id, column.id, 'start');
  }

  focusCell(rowId: string, columnId: string, at: 'start' | 'end' = 'end'): void {
    const nodes = this.#cells.get(cellKey(rowId, columnId));
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

  #keyFor(data: DatabaseData): string {
    const view = databaseView(data);
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
      view: {
        type: view.type,
        filters: view.filters,
        groupBy: view.groupBy ?? null,
        sort: view.sort ?? null,
      },
      sort: data.sort ?? null,
    });
  }

  #visibleKeyFor(
    data: DatabaseData,
    view: DatabaseViewConfig = databaseView(data)
  ): string {
    if (view.type === 'board') {
      return groupedDatabaseRows(data, view)
        .map(group => `${group.key}:${group.rows.map(row => row.id).join(',')}`)
        .join('\u0001');
    }
    return filteredDatabaseRows(data, view)
      .map(row => row.id)
      .join('\u0001');
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
    const view = databaseView(this.#data);
    this.#structureKey = this.#keyFor(this.#data);
    this.#visibleKey = this.#visibleKeyFor(this.#data, view);
    this.element.dataset.readonly = String(this.#readonly);
    this.element.dataset.view = view.type;
    this.element.replaceChildren();

    const head = document.createElement('div');
    head.className = 'nb-db-head';
    const title = document.createElement('span');
    title.className = 'nb-db-title';
    const titleIcon = document.createElement('span');
    titleIcon.innerHTML = this.#data.variant === 'table' ? icon.table : icon.database;
    const titleText = document.createElement('span');
    titleText.textContent = this.#data.variant === 'table' ? 'Table' : 'Database';
    title.append(titleIcon, titleText);
    const count = document.createElement('span');
    count.className = 'nb-db-count';
    this.#countElement = count;
    this.#updateCount(view);

    const tools = document.createElement('div');
    tools.className = 'nb-db-tools';
    this.#renderViewControls(view, tools);
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
    head.append(title, count, tools);

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

    if (view.type === 'table' && this.#pendingFocus) {
      const pending = this.#pendingFocus;
      this.#pendingFocus = null;
      this.focusCell(pending.rowId, pending.columnId, pending.at);
    } else if (view.type === 'table' && hadFocus && this.#active) {
      this.focusCell(this.#active.rowId, this.#active.columnId, 'end');
    }
  }

  #renderViewControls(view: DatabaseViewConfig, tools: HTMLElement): void {
    if (this.#readonly) return;
    const group = document.createElement('div');
    group.className = 'nb-db-viewswitch';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Data view');
    for (const type of ['table', 'board'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-db-viewbtn';
      button.dataset.view = type;
      button.dataset.active = String(view.type === type);
      button.setAttribute('aria-pressed', String(view.type === type));
      button.textContent = type === 'table' ? 'Table' : 'Board';
      button.addEventListener(
        'click',
        () => {
          const groupBy =
            type === 'board' && !view.groupBy
              ? this.#defaultGroupColumn()
              : view.groupBy;
          this.#setView({
            type,
            ...(groupBy ? { groupBy } : {}),
          });
        },
        { signal: this.#events.signal }
      );
      group.append(button);
    }
    tools.append(group);

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

    if (view.type === 'board') {
      const groupButton = document.createElement('button');
      groupButton.type = 'button';
      groupButton.className = 'nb-db-btn';
      const column = view.groupBy
        ? this.#data.columns.find(item => item.id === view.groupBy)
        : undefined;
      groupButton.textContent = column ? `Group: ${column.name}` : 'Group';
      groupButton.title = 'Group board columns';
      groupButton.addEventListener(
        'click',
        () => this.#openGroupPopover(groupButton),
        { signal: this.#events.signal }
      );
      tools.append(groupButton);
    }
  }

  #renderTable(view: DatabaseViewConfig): HTMLTableElement {
    const table = document.createElement('table');
    table.className = 'nb-db-table';
    table.setAttribute(
      'aria-label',
      this.#data.variant === 'table' ? 'Table' : 'Database'
    );
    const colgroup = document.createElement('colgroup');
    const handleCol = document.createElement('col');
    handleCol.style.width = '28px';
    colgroup.append(handleCol);
    this.#data.columns.forEach((column, index) => {
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
    for (const column of this.#data.columns) {
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
      if (view.sort?.columnId === column.id) {
        const sort = document.createElement('span');
        sort.className = 'nb-db-sort';
        sort.textContent = view.sort.direction === 'asc' ? '↑' : '↓';
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
    const rows = filteredDatabaseRows(this.#data, view);
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
      for (const column of this.#data.columns) {
        tr.append(this.#createCell(row, column));
      }
      tbody.append(tr);
    }
    if (rows.length === 0) {
      const empty = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'nb-db-empty';
      td.colSpan = Math.max(1, this.#data.columns.length + 1);
      td.textContent = this.#readonly ? 'No rows' : 'No rows yet. Add one below.';
      empty.append(td);
      tbody.append(empty);
    }
    table.append(tbody);
    return table;
  }

  #renderBoard(view: DatabaseViewConfig): HTMLElement {
    const board = document.createElement('div');
    board.className = 'nb-db-board';
    const groups = groupedDatabaseRows(this.#data, view);
    const titleColumn = this.#data.columns[0];
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
        cards.append(this.#renderBoardCard(row, titleColumn, view));
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
    view: DatabaseViewConfig
  ): HTMLElement {
    const card = document.createElement('article');
    card.className = 'nb-db-card';
    card.dataset.rowId = row.id;
    if (!this.#readonly && view.groupBy) {
      card.draggable = true;
      card.addEventListener(
        'dragstart',
        event => {
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
    const fields = this.#boardFields(row, titleColumn, view);
    if (fields) card.append(fields);
    return card;
  }

  #boardFields(
    row: DatabaseRow,
    titleColumn: DatabaseColumn | undefined,
    view: DatabaseViewConfig
  ): HTMLElement | null {
    const fields = document.createElement('div');
    fields.className = 'nb-db-card-fields';
    for (const column of this.#data.columns) {
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
    const view = databaseView(this.#data);
    if (view.type !== 'board') return;
    const root = this.element.getRootNode() as ShadowRoot;
    const activeElement = root.activeElement;
    const titleColumn = this.#data.columns[0];
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
      const next = this.#boardFields(row, titleColumn, view);
      if (previous && next) previous.replaceWith(next);
      else if (previous) previous.remove();
      else if (next) card.append(next);
    }
  }

  #setView(patch: Partial<DatabaseViewConfig> & { groupBy?: string | null }): void {
    const current = databaseView(this.#data);
    const next: DatabaseViewConfig = {
      type: patch.type ?? current.type,
      filters: patch.filters ?? current.filters,
    };
    const groupBy = 'groupBy' in patch ? patch.groupBy : current.groupBy;
    if (groupBy) next.groupBy = groupBy;
    const sort = 'sort' in patch ? patch.sort : current.sort;
    if (sort) next.sort = sort;
    this.#host.commit({ ...this.#data, view: next });
  }

  #defaultGroupColumn(): string | undefined {
    return (
      this.#data.columns.find(column =>
        ['select', 'multi-select', 'checkbox'].includes(column.type)
      )?.id ?? this.#data.columns[0]?.id
    );
  }

  #startColumnResize(event: PointerEvent, column: DatabaseColumn): void {
    if (this.#readonly) return;
    const index = this.#data.columns.findIndex(item => item.id === column.id);
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
    const view = databaseView(this.#data);
    const draft: DatabaseFilter[] = view.filters.map(filter => ({ ...filter }));
    const content = document.createElement('div');
    content.className = 'nb-db-filter-popover';
    const title = document.createElement('div');
    title.className = 'nb-db-pop-title';
    title.textContent = 'Filters';
    content.append(title);

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
          filter.columnId = columnSelect.value;
          const next = this.#data.columns.find(item => item.id === filter.columnId);
          filter.value = next?.type === 'checkbox' ? 'true' : '';
          render();
        });

        const operatorSelect = document.createElement('select');
        operatorSelect.setAttribute('aria-label', 'Filter operator');
        for (const [value, label] of FILTER_OPERATORS) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          option.selected = filter.operator === value;
          operatorSelect.append(option);
        }
        operatorSelect.addEventListener('change', () => {
          filter.operator = operatorSelect.value as DatabaseFilterOperator;
          if (
            column.type === 'checkbox' &&
            (filter.operator === 'is' || filter.operator === 'isNot') &&
            !filter.value
          ) {
            filter.value = 'true';
          }
          render();
        });

        row.append(columnSelect, operatorSelect);
        if (filter.operator !== 'isEmpty' && filter.operator !== 'isNotEmpty') {
          if (column.type === 'checkbox') {
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
        operator: 'contains',
        value: first.type === 'checkbox' ? 'true' : '',
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
      const filters = draft.map(filter => {
        const column = this.#data.columns.find(item => item.id === filter.columnId);
        if (
          column?.type === 'checkbox' &&
          (filter.operator === 'is' || filter.operator === 'isNot') &&
          !filter.value
        ) {
          return { ...filter, value: 'true' };
        }
        return filter;
      });
      this.#setView({ filters });
      this.#closePopover();
    });
    footer.append(add, clear, apply);
    content.append(footer);
    render();
    this.#showPopover(anchor, content);
  }

  #openGroupPopover(anchor: HTMLElement): void {
    const view = databaseView(this.#data);
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
    for (const column of this.#data.columns) {
      if (!['select', 'multi-select', 'checkbox'].includes(column.type)) continue;
      const option = document.createElement('option');
      option.value = column.id;
      option.textContent = column.name;
      option.selected = view.groupBy === column.id;
      select.append(option);
    }
    select.addEventListener('change', () => {
      this.#setView({ groupBy: select.value || null });
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

  #updateCount(view: DatabaseViewConfig = databaseView(this.#data)): void {
    if (!this.#countElement) return;
    const total = this.#data.rows.length;
    const shown = filteredDatabaseRows(this.#data, view).length;
    const rowText =
      shown === total ? `${total}` : `${shown} of ${total}`;
    const columnCount = this.#data.columns.length;
    this.#countElement.textContent = `${rowText} ${shown === 1 && total === 1 ? 'row' : 'rows'} · ${columnCount} ${
      columnCount === 1 ? 'column' : 'columns'
    }`;
  }

  #syncValues(): void {
    for (const row of this.#data.rows) {
      for (const column of this.#data.columns) {
        const nodes = this.#cells.get(cellKey(row.id, column.id));
        if (!nodes) continue;
        const cell = row.cells[column.id];
        const value = column.type === 'checkbox' ? '' : cell?.text ?? '';
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
    this.#syncColumnWidths();
    this.#syncBoardValues();
    this.#updateCount(databaseView(this.#data));
  }

  #syncColumnWidths(): void {
    this.#data.columns.forEach((column, index) => {
      const col = this.#colElements[index];
      if (!col) return;
      col.style.width = column.width
        ? `${column.width}px`
        : index === 0
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
      this.#cells.set(key, nodes);
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
      this.#cells.set(key, nodes);
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
      this.#cells.set(key, nodes);
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
      this.#cells.set(key, nodes);
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
    this.#cells.set(key, nodes);
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
    if (this.#data.view) {
      const view: DatabaseViewConfig = {
        type: this.#data.view.type,
        filters: this.#data.view.filters.filter(filter => filter.columnId !== columnId),
      };
      const groupBy =
        this.#data.view.groupBy && this.#data.view.groupBy !== columnId
          ? this.#data.view.groupBy
          : undefined;
      if (groupBy) view.groupBy = groupBy;
      const sort = this.#data.view.sort;
      if (sort && sort.columnId !== columnId) view.sort = sort;
      next.view = view;
    }
    this.#host.commit(next);
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
    return filteredDatabaseRows(this.#data);
  }

  #moveTab(rowId: string, columnId: string, backwards: boolean): void {
    const rows = this.#rows();
    const columns = this.#data.columns;
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
    const columns = this.#data.columns;
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
    if (event.key === 'Tab') {
      event.preventDefault();
      this.#moveTab(rowId, columnId, event.shiftKey);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const nodes = this.#cells.get(cellKey(rowId, columnId));
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
      const node = this.#cells.get(cellKey(rowId, columnId));
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
    const rows = filteredDatabaseRows(this.#data, databaseView(this.#data));
    const columns = this.#data.columns;
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
    for (const [key, nodes] of this.#cells) {
      const selected = this.#rangeCells.has(key);
      nodes.td.classList.toggle('is-selected', selected);
      nodes.td.setAttribute('aria-selected', String(selected));
    }
  }

  #clearRange(): void {
    this.#range = null;
    this.#rangeCells.clear();
    for (const nodes of this.#cells.values()) {
      nodes.td.classList.remove('is-selected');
      nodes.td.setAttribute('aria-selected', 'false');
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
    clearReferences = false
  ): void {
    const rows = filteredDatabaseRows(this.#data, databaseView(this.#data));
    const startRow = rows.findIndex(row => row.id === startRowId);
    const startColumn = this.#data.columns.findIndex(column => column.id === startColumnId);
    if (startRow < 0 || startColumn < 0) return;

    const columns = [...this.#data.columns];
    const width = Math.max(0, ...grid.map(line => line.length));
    while (columns.length < startColumn + width) {
      columns.push(createDatabaseColumn(`Column ${columns.length + 1}`));
    }

    const byId = new Map(this.#data.rows.map(row => [row.id, row]));
    const added: DatabaseRow[] = [];
    let firstRowId: string | null = null;
    let firstColumnId: string | null = null;
    grid.forEach((values, rowOffset) => {
      let target = rows[startRow + rowOffset];
      if (!target) {
        target = createDatabaseRow();
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
      columns,
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
    event.preventDefault();
    event.stopPropagation();
    this.#applyGrid(startRowId, startColumnId, grid);
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
      const previous = new Map(existing.map(person => [person.label, person]));
      const people = input.value
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
        .map(label => previous.get(label) ?? { id: createId('p'), label });
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
      this.#setView({ sort: { columnId, direction: 'asc' } });
      this.#closePopover();
    });
    action('Sort ↓', icon.sortDesc, () => {
      apply();
      this.#setView({ sort: { columnId, direction: 'desc' } });
      this.#closePopover();
    });
    const currentView = databaseView(this.#data);
    if (currentView.sort?.columnId === columnId) {
      action('Clear sort', icon.x, () => {
        apply();
        this.#setView({ sort: null });
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
