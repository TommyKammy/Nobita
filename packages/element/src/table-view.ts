import {
  deleteTableColumn,
  deleteTableRow,
  insertTableColumn,
  insertTableRow,
  setTableCellText,
  setTableColumnWidth,
  tableCellText,
} from '@nobita/core';
import type { TableData } from '@nobita/core';
import { nativeSelection } from './dom.js';
import { dismissFloating, placeFloating } from './floating.js';

export interface TableHost {
  readonly readonly: boolean;
  commit(data: TableData, options?: { mergeKey?: string }): void;
  focusAfter(): void;
}

const DEFAULT_COLUMN_WIDTH = 160;

function cellKey(rowId: string, columnId: string): string {
  return `${rowId}\u0000${columnId}`;
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

export class SimpleTableView {
  readonly element: HTMLElement;

  #host: TableHost;
  #data: TableData;
  #readonly: boolean;
  #events = new AbortController();
  #cells = new Map<string, HTMLElement>();
  #table: HTMLTableElement | null = null;
  #colElements: HTMLTableColElement[] = [];
  #popover: { element: HTMLElement; cleanup: () => void } | null = null;
  #structureKey = '';
  #active: { rowId: string; columnId: string } | null = null;

  constructor(host: TableHost, data: TableData) {
    this.#host = host;
    this.#data = data;
    this.#readonly = host.readonly;
    this.element = document.createElement('div');
    this.element.className = 'nb-table';
    this.element.contentEditable = 'false';
    this.element.dataset.readonly = String(this.#readonly);
    this.render();
  }

  update(data: TableData): void {
    if (data === this.#data) return;
    this.#data = data;
    const key = this.#structuralKey();
    if (key !== this.#structureKey) this.render();
    else this.#syncValues();
  }

  setReadonly(readonly: boolean): void {
    if (readonly === this.#readonly) return;
    this.#readonly = readonly;
    this.render();
  }

  focusFirstCell(): void {
    const row = this.#data.rows[0];
    const column = this.#data.columns[0];
    if (row && column) this.focusCell(row.id, column.id, 'start');
  }

  focusCell(rowId: string, columnId: string, at: 'start' | 'end' = 'end'): void {
    const cell = this.#cells.get(cellKey(rowId, columnId));
    if (!cell) return;
    cell.focus();
    placeCaret(cell, at);
    this.#active = { rowId, columnId };
  }

  destroy(): void {
    this.#events.abort();
    this.#closePopover();
    this.element.remove();
  }

  #structuralKey(): string {
    return JSON.stringify({
      readonly: this.#readonly,
      columns: this.#data.columns.map(column => [column.id, column.width ?? null, column.backgroundColor ?? null]),
      rows: this.#data.rows.map(row => [row.id, row.backgroundColor ?? null]),
    });
  }

  render(): void {
    this.#events.abort();
    this.#events = new AbortController();
    this.#closePopover();
    this.#cells.clear();
    this.#colElements = [];
    this.#structureKey = this.#structuralKey();
    this.element.dataset.readonly = String(this.#readonly);
    this.element.replaceChildren();

    const scroll = document.createElement('div');
    scroll.className = 'nb-table-scroll';
    const table = document.createElement('table');
    table.className = 'nb-table-grid';
    const colgroup = document.createElement('colgroup');
    const handleCol = document.createElement('col');
    handleCol.style.width = '28px';
    colgroup.append(handleCol);
    for (const column of this.#data.columns) {
      const col = document.createElement('col');
      col.style.width = `${column.width ?? DEFAULT_COLUMN_WIDTH}px`;
      this.#colElements.push(col);
      colgroup.append(col);
    }
    table.append(colgroup);

    const body = document.createElement('tbody');
    this.#data.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      tr.dataset.rowId = row.id;
      const handleCell = document.createElement('th');
      handleCell.className = 'nb-table-handle-cell';
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'nb-table-row-handle';
      handle.setAttribute('aria-label', `Row ${rowIndex + 1} actions`);
      handle.textContent = '⋮';
      handle.addEventListener(
        'click',
        event => {
          event.preventDefault();
          event.stopPropagation();
          this.#openMenu(handle, row.id, null);
        },
        { signal: this.#events.signal }
      );
      handleCell.append(handle);
      tr.append(handleCell);

      for (const column of this.#data.columns) {
        const td = document.createElement('td');
        td.className = 'nb-table-cell-wrap';
        const color = row.backgroundColor ?? column.backgroundColor;
        if (color) td.style.backgroundColor = color;
        const cell = document.createElement('div');
        cell.className = 'nb-table-cell';
        cell.contentEditable = this.#readonly ? 'false' : 'true';
        cell.spellcheck = false;
        cell.dataset.rowId = row.id;
        cell.dataset.columnId = column.id;
        cell.setAttribute('role', 'textbox');
        cell.setAttribute('aria-label', `Row ${rowIndex + 1}, column ${this.#data.columns.indexOf(column) + 1}`);
        cell.textContent = tableCellText(row, column.id);
        cell.addEventListener(
          'input',
          () => {
            const value = (cell.textContent ?? '').replace(/\r?\n/gu, '\n');
            this.#commitCell(row.id, column.id, value);
          },
          { signal: this.#events.signal }
        );
        cell.addEventListener(
          'focus',
          () => {
            this.#active = { rowId: row.id, columnId: column.id };
          },
          { signal: this.#events.signal }
        );
        cell.addEventListener(
          'keydown',
          event => this.#onCellKeyDown(event, row.id, column.id),
          { signal: this.#events.signal }
        );
        cell.addEventListener(
          'contextmenu',
          event => {
            event.preventDefault();
            this.#openMenu(cell, row.id, column.id);
          },
          { signal: this.#events.signal }
        );
        td.append(cell);
        if (rowIndex === 0 && !this.#readonly) {
          const resizer = document.createElement('span');
          resizer.className = 'nb-table-resizer';
          resizer.setAttribute('role', 'separator');
          resizer.setAttribute('aria-orientation', 'vertical');
          resizer.setAttribute('aria-label', `Resize column`);
          resizer.addEventListener(
            'pointerdown',
            event => this.#startColumnResize(event, column.id),
            { signal: this.#events.signal }
          );
          td.append(resizer);
        }
        tr.append(td);
        this.#cells.set(cellKey(row.id, column.id), cell);
      }
      body.append(tr);
    });
    table.append(body);
    scroll.append(table);
    this.#table = table;
    this.element.append(scroll);

    if (!this.#readonly) {
      const actions = document.createElement('div');
      actions.className = 'nb-table-actions';
      const addRow = document.createElement('button');
      addRow.type = 'button';
      addRow.className = 'nb-table-action';
      addRow.textContent = '+ Row';
      addRow.addEventListener('click', () => this.#addRow(null), { signal: this.#events.signal });
      const addColumn = document.createElement('button');
      addColumn.type = 'button';
      addColumn.className = 'nb-table-action';
      addColumn.textContent = '+ Column';
      addColumn.addEventListener('click', () => this.#addColumn(null), { signal: this.#events.signal });
      actions.append(addRow, addColumn);
      this.element.append(actions);
    }
  }

  #syncValues(): void {
    for (const row of this.#data.rows) {
      for (const column of this.#data.columns) {
        const cell = this.#cells.get(cellKey(row.id, column.id));
        if (!cell) continue;
        const value = tableCellText(row, column.id);
        if (cell.textContent !== value) cell.textContent = value;
      }
    }
  }

  #startColumnResize(event: PointerEvent, columnId: string): void {
    if (this.#readonly) return;
    const index = this.#data.columns.findIndex(column => column.id === columnId);
    const col = this.#colElements[index];
    if (!col) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = col.getBoundingClientRect().width;
    const move = (moveEvent: PointerEvent): void => {
      const width = Math.max(40, Math.min(2000, Math.round(startWidth + moveEvent.clientX - startX)));
      col.style.width = `${width}px`;
    };
    const end = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const width = Number.parseFloat(col.style.width);
      if (Number.isFinite(width)) {
        this.#host.commit(setTableColumnWidth(this.#data, columnId, width));
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  #commitCell(rowId: string, columnId: string, text: string): void {
    const next = setTableCellText(this.#data, rowId, columnId, text);
    if (next === this.#data) return;
    this.#host.commit(next, { mergeKey: `tb:${rowId}:${columnId}` });
  }

  #addRow(afterRowId: string | null): void {
    const result = insertTableRow(this.#data, afterRowId);
    this.#host.commit(result.data);
    requestAnimationFrame(() => this.focusCell(result.rowId, this.#data.columns[0]?.id ?? '', 'start'));
  }

  #addColumn(afterColumnId: string | null): void {
    const result = insertTableColumn(this.#data, afterColumnId);
    this.#host.commit(result.data);
    requestAnimationFrame(() => this.focusCell(this.#data.rows[0]?.id ?? '', result.columnId, 'start'));
  }

  #deleteRow(rowId: string): void {
    const next = deleteTableRow(this.#data, rowId);
    if (next === this.#data) return;
    this.#host.commit(next);
    this.#host.focusAfter();
  }

  #deleteColumn(columnId: string): void {
    const next = deleteTableColumn(this.#data, columnId);
    if (next === this.#data) return;
    this.#host.commit(next);
  }

  #onCellKeyDown(event: KeyboardEvent, rowId: string, columnId: string): void {
    if (event.isComposing) return;
    if (event.key === 'Tab') {
      event.preventDefault();
      const rowIndex = this.#data.rows.findIndex(row => row.id === rowId);
      const columnIndex = this.#data.columns.findIndex(column => column.id === columnId);
      if (rowIndex < 0 || columnIndex < 0) return;
      const nextColumn = event.shiftKey ? columnIndex - 1 : columnIndex + 1;
      if (nextColumn >= 0 && nextColumn < this.#data.columns.length) {
        this.focusCell(rowId, this.#data.columns[nextColumn]!.id, 'start');
      } else {
        const nextRow = event.shiftKey ? rowIndex - 1 : rowIndex + 1;
        if (nextRow >= 0 && nextRow < this.#data.rows.length) {
          const targetColumn = event.shiftKey
            ? this.#data.columns[this.#data.columns.length - 1]
            : this.#data.columns[0];
          if (targetColumn) this.focusCell(this.#data.rows[nextRow]!.id, targetColumn.id, 'start');
        }
      }
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const rowIndex = this.#data.rows.findIndex(row => row.id === rowId);
      const nextRow = this.#data.rows[rowIndex + 1];
      if (nextRow) this.focusCell(nextRow.id, columnId, 'start');
      else this.#addRow(rowId);
    }
  }

  #openMenu(anchor: HTMLElement, rowId: string, columnId: string | null): void {
    if (this.#readonly) return;
    this.#closePopover();
    const menu = document.createElement('div');
    menu.className = 'nb-table-menu';
    menu.contentEditable = 'false';
    const add = (label: string, action: () => void, disabled = false): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = disabled;
      button.addEventListener('click', () => {
        this.#closePopover();
        action();
      });
      menu.append(button);
    };
    add('Insert row above', () => {
      const result = insertTableRow(this.#data, rowId, 'before');
      this.#host.commit(result.data);
      requestAnimationFrame(() => this.focusCell(result.rowId, columnId ?? this.#data.columns[0]?.id ?? '', 'start'));
    });
    add('Insert row below', () => {
      const result = insertTableRow(this.#data, rowId, 'after');
      this.#host.commit(result.data);
      requestAnimationFrame(() => this.focusCell(result.rowId, columnId ?? this.#data.columns[0]?.id ?? '', 'start'));
    });
    if (columnId) {
      add('Insert column left', () => {
        const result = insertTableColumn(this.#data, columnId, 'before');
        this.#host.commit(result.data);
        requestAnimationFrame(() => this.focusCell(rowId, result.columnId, 'start'));
      });
      add('Insert column right', () => {
        const result = insertTableColumn(this.#data, columnId, 'after');
        this.#host.commit(result.data);
        requestAnimationFrame(() => this.focusCell(rowId, result.columnId, 'start'));
      });
    }
    add('Delete row', () => this.#deleteRow(rowId), this.#data.rows.length <= 1);
    if (columnId) add('Delete column', () => this.#deleteColumn(columnId), this.#data.columns.length <= 1);
    this.element.getRootNode().appendChild(menu);
    const root = this.element.getRootNode() as ShadowRoot;
    const overlay = root.querySelector<HTMLElement>('.nb-overlay');
    if (overlay) overlay.append(menu);
    placeFloating(menu, anchor.getBoundingClientRect(), { side: 'below', gap: 6, margin: 10, fallback: 'flip' });
    const cleanup = dismissFloating({
      element: menu,
      pointerTarget: root,
      onDismiss: () => this.#closePopover(),
    });
    this.#popover = { element: menu, cleanup };
  }

  #closePopover(): void {
    if (!this.#popover) return;
    this.#popover.cleanup();
    this.#popover.element.remove();
    this.#popover = null;
  }
}

export function tableColumnWidth(data: TableData, columnId: string): number {
  return data.columns.find(column => column.id === columnId)?.width ?? DEFAULT_COLUMN_WIDTH;
}

export function updateTableColumnWidth(
  data: TableData,
  columnId: string,
  width: number
): TableData {
  return setTableColumnWidth(data, columnId, width);
}
