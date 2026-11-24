import {
  createDatabaseColumn,
  createDatabaseRow,
  sortedDatabaseRows,
} from '@nobita/core';
import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseData,
  DatabaseRow,
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

type CellKind = 'text' | 'number' | 'date' | 'checkbox' | 'select';

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
  { type: 'date', label: 'Date' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'url', label: 'URL' },
];

const TYPE_ICON: Record<DatabaseColumnType, string> = {
  text: icon.text,
  number: icon.hash,
  select: icon.tag,
  date: icon.calendar,
  checkbox: icon.checkboxSquare,
  url: icon.link,
};

const cellKey = (rowId: string, columnId: string): string => `${rowId}\u0000${columnId}`;

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

  constructor(host: DatabaseHost, data: DatabaseData) {
    this.#host = host;
    this.#data = data;
    this.#readonly = host.readonly;
    this.element = document.createElement('div');
    this.element.className = 'nb-db';
    this.element.contentEditable = 'false';
    this.element.dataset.readonly = String(this.#readonly);
    this.render();
  }

  update(data: DatabaseData): void {
    if (data === this.#data) return;
    this.#data = data;
    const nextKey = this.#keyFor(data);
    if (nextKey !== this.#structureKey) this.render();
    else this.#syncValues();
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
    this.#events.abort();
    this.#closePopover();
    this.element.remove();
  }

  /** ---- rendering ---- */

  #keyFor(data: DatabaseData): string {
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
      sort: data.sort ?? null,
    });
  }

  render(): void {
    this.#events.abort();
    this.#events = new AbortController();
    this.#closePopover();
    this.#cells.clear();
    const root = this.element.getRootNode() as ShadowRoot;
    const hadFocus = this.element.contains(root.activeElement);
    this.#structureKey = this.#keyFor(this.#data);
    this.element.dataset.readonly = String(this.#readonly);
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
    this.#updateCount();

    const tools = document.createElement('div');
    tools.className = 'nb-db-tools';
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
    this.#data.columns.forEach((_, index) => {
      const col = document.createElement('col');
      col.style.width = index === 0 ? '200px' : '145px';
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
      if (this.#data.sort?.columnId === column.id) {
        const sort = document.createElement('span');
        sort.className = 'nb-db-sort';
        sort.textContent = this.#data.sort.direction === 'asc' ? '↑' : '↓';
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
      th.append(button);
      headRow.append(th);
    }
    thead.append(headRow);
    table.append(thead);

    const tbody = document.createElement('tbody');
    const rows = sortedDatabaseRows(this.#data);
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
    scroll.append(table);

    this.element.append(head, scroll);
    if (!this.#readonly) {
      const addRow = document.createElement('button');
      addRow.type = 'button';
      addRow.className = 'nb-db-addrow';
      addRow.innerHTML = `${icon.plus}<span>New row</span>`;
      addRow.addEventListener('click', () => this.#addRow(), { signal: this.#events.signal });
      this.element.append(addRow);
    }

    if (this.#pendingFocus) {
      const pending = this.#pendingFocus;
      this.#pendingFocus = null;
      this.focusCell(pending.rowId, pending.columnId, pending.at);
    } else if (hadFocus && this.#active) {
      this.focusCell(this.#active.rowId, this.#active.columnId, 'end');
    }
  }

  #updateCount(): void {
    if (!this.#countElement) return;
    const rowCount = this.#data.rows.length;
    const columnCount = this.#data.columns.length;
    this.#countElement.textContent = `${rowCount} ${rowCount === 1 ? 'row' : 'rows'} · ${columnCount} ${
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
      }
    }
    this.#updateCount();
  }

  #createCell(row: DatabaseRow, column: DatabaseColumn): HTMLTableCellElement {
    const td = document.createElement('td');
    td.className = `nb-db-cell nb-db-cell-${column.type}`;
    td.dataset.rowId = row.id;
    td.dataset.columnId = column.id;
    const cell = row.cells[column.id];
    const key = cellKey(row.id, column.id);
    const nodes: CellNodes = { td };

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
      if (cell.text || cell.checked) cells[columnId] = cell;
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
      };
      if (type === 'select') {
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
    const next: DatabaseData = { variant: this.#data.variant, columns, rows };
    const sort = this.#data.sort;
    if (sort && sort.columnId !== columnId) next.sort = sort;
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
      ...(type === 'select' && options.length > 0 ? { options } : {}),
    });
    this.#host.commit({
      ...this.#data,
      columns: extra ? extra(columns) : columns,
    });
  }

  /** ---- navigation ---- */

  #rows(): DatabaseRow[] {
    return sortedDatabaseRows(this.#data);
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
      if (kind === 'select') {
        const nodes = this.#cells.get(cellKey(rowId, columnId));
        if (nodes?.button) this.#openSelectPopover(columnId, rowId, nodes.button);
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
      optionsField.style.display = typeSelect.value === 'select' ? '' : 'none';
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
      this.#host.commit({
        ...this.#data,
        sort: { columnId, direction: 'asc' },
      });
      this.#closePopover();
    });
    action('Sort ↓', icon.sortDesc, () => {
      apply();
      this.#host.commit({
        ...this.#data,
        sort: { columnId, direction: 'desc' },
      });
      this.#closePopover();
    });
    if (this.#data.sort?.columnId === columnId) {
      action('Clear sort', icon.x, () => {
        apply();
        const next: DatabaseData = { ...this.#data };
        delete next.sort;
        this.#host.commit(next);
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
