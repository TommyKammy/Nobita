import {
  HIGHLIGHT_HEX,
  PALETTE_COLORS,
  clearTableColumn,
  clearTableRow,
  deleteTableColumn,
  deleteTableRow,
  duplicateTableColumn,
  duplicateTableRow,
  insertTableColumn,
  insertTableRow,
  moveTableColumn,
  moveTableColumnTo,
  moveTableRow,
  moveTableRowTo,
  plainText,
  runsLength,
  setTableCellRuns,
  setTableCellText,
  setTableColumnColor,
  setTableColumnWidth,
  setTableRowColor,
  tableCellText,
} from '@nobita/core';
import type { TableCell, TableData } from '@nobita/core';
import {
  readRichTextRuns,
  runsSignature,
  selectionOffsets,
  setSelectionOffsets,
  shortcutTag,
} from './database-dom.js';
import { DatabaseRichTextController } from './database-rich-text.js';
import { nativeSelection, placeCaret } from './dom.js';
import { dismissFloating, placeFloating } from './floating.js';
import { icon } from './icons.js';
import { renderInlineRuns } from './inline-dom.js';
import { parseTsv, tsvCell } from './tsv.js';

export interface TableHost {
  readonly readonly: boolean;
  commit(data: TableData, options?: { mergeKey?: string }): void;
  undo(): void;
  redo(): void;
  focusAfterHistory(): void;
}

const DEFAULT_COLUMN_WIDTH = 120;
const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 240;

const TABLE_COLORS = PALETTE_COLORS.map(color => ({
  name: color.charAt(0).toUpperCase() + color.slice(1),
  color: HIGHLIGHT_HEX[color],
}));

function cellKey(rowId: string, columnId: string): string {
  return `${rowId}\u0000${columnId}`;
}

interface TableAreaBounds {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
}

function writeCellText(element: HTMLElement, value: string): void {
  element.replaceChildren();
  const lines = value.split('\n');
  lines.forEach((line, index) => {
    if (index > 0) element.append(document.createElement('br'));
    if (line) element.append(document.createTextNode(line));
  });
}

function dots(vertical = false): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = vertical ? 'nb-table-dots nb-table-dots-vertical' : 'nb-table-dots';
  wrap.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 3; index += 1) {
    wrap.append(document.createElement('i'));
  }
  return wrap;
}

export class SimpleTableView {
  readonly element: HTMLElement;

  #host: TableHost;
  #data: TableData;
  #readonly: boolean;
  #globalEvents = new AbortController();
  #events = new AbortController();
  #richText: DatabaseRichTextController;
  #cells = new Map<string, HTMLElement>();
  #colElements: HTMLTableColElement[] = [];
  #popover: { element: HTMLElement; cleanup: () => void } | null = null;
  #structureKey = '';
  #hoverRowId: string | null = null;
  #hoverColumnId: string | null = null;
  #selected: { type: 'row' | 'column'; id: string } | null = null;
  #area: {
    anchorRowId: string;
    anchorColumnId: string;
    focusRowId: string;
    focusColumnId: string;
  } | null = null;
  #drag: {
    anchorRowId: string;
    anchorColumnId: string;
    moved: boolean;
  } | null = null;
  #selectionOverlay: HTMLElement | null = null;
  #dropLine: HTMLElement | null = null;
  #activeCell: { rowId: string; columnId: string } | null = null;
  #suppressCellClick = false;
  #suppressAddClick = false;
  #suppressHandleClick = false;
  #addTip: HTMLElement | null = null;

  constructor(host: TableHost, data: TableData) {
    this.#host = host;
    this.#data = data;
    this.#readonly = host.readonly;
    this.element = document.createElement('div');
    this.element.className = 'nb-table';
    this.element.contentEditable = 'false';
    this.element.dataset.readonly = String(this.#readonly);
    this.#richText = new DatabaseRichTextController({
      rootElement: this.element,
      isReadonly: () => this.#readonly,
      getSignal: () => this.#events.signal,
      richTextSelector: '.nb-table-cell',
    });
    const doc = this.element.ownerDocument;
    doc.addEventListener(
      'selectionchange',
      () => this.#richText.handleSelectionChange(),
      { signal: this.#globalEvents.signal }
    );
    doc.defaultView?.addEventListener('scroll', this.#richText.hideToolbar, {
      capture: true,
      passive: true,
      signal: this.#globalEvents.signal,
    });
    this.element.addEventListener('mouseleave', () => {
      this.#hoverRowId = null;
      this.#hoverColumnId = null;
      this.#syncHover();
    });
    this.element.addEventListener('copy', this.#onCopy, true);
    this.element.addEventListener('cut', this.#onCut, true);
    this.element.addEventListener('paste', this.#onPaste, true);
    this.element.addEventListener('click', this.#onClickCapture, true);
    this.render();
  }

  update(data: TableData): void {
    if (data === this.#data) return;
    this.#data = data;
    if (this.#structuralKey() !== this.#structureKey) {
      this.render();
    } else {
      this.#syncValues();
      this.#syncSelection();
    }
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
    this.#clearAreaSelection();
    cell.focus();
    placeCaret(cell, at);
  }

  destroy(): void {
    this.#globalEvents.abort();
    this.#events.abort();
    this.#richText.destroy();
    this.#closePopover();
    this.#removeAddTip();
    this.element.remove();
  }

  #structuralKey(): string {
    return JSON.stringify({
      readonly: this.#readonly,
      columns: this.#data.columns.map(column => [
        column.id,
        column.width ?? null,
        column.backgroundColor ?? null,
      ]),
      rows: this.#data.rows.map(row => [row.id, row.backgroundColor ?? null]),
    });
  }

  #renderCellContent(cell: HTMLElement, tableCell: TableCell | undefined): void {
    if (tableCell?.runs && tableCell.runs.length > 0) {
      cell.dataset.runs = runsSignature(tableCell.runs);
      renderInlineRuns(cell, tableCell.runs);
    } else {
      cell.dataset.runs = '';
      writeCellText(cell, tableCell?.text ?? '');
    }
  }

  render(): void {
    this.#events.abort();
    this.#events = new AbortController();
    this.#richText.clearPendingMarks();
    this.#richText.resetToolbar();
    this.#closePopover();
    this.#cells.clear();
    this.#colElements = [];
    this.#selectionOverlay = null;
    this.#dropLine = null;
    this.#structureKey = this.#structuralKey();
    this.element.dataset.readonly = String(this.#readonly);
    this.element.replaceChildren();

    const scroll = document.createElement('div');
    scroll.className = 'nb-table-scroll';
    const canvas = document.createElement('div');
    canvas.className = 'nb-table-canvas';
    const table = document.createElement('table');
    table.className = 'nb-table-grid';
    const colgroup = document.createElement('colgroup');
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
      for (const [columnIndex, column] of this.#data.columns.entries()) {
        const td = document.createElement('td');
        td.className = 'nb-table-cell-wrap';
        td.dataset.rowId = row.id;
        td.dataset.columnId = column.id;
        const color = column.backgroundColor ?? row.backgroundColor;
        if (color) {
          td.dataset.background = 'true';
          td.style.setProperty('--nb-cell-bg', color);
        }
        const cell = document.createElement('div');
        cell.className = 'nb-table-cell';
        cell.contentEditable = this.#readonly ? 'false' : 'true';
        cell.spellcheck = false;
        cell.dataset.rowId = row.id;
        cell.dataset.columnId = column.id;
        cell.dataset.multiline = 'true';
        cell.dataset.richText = 'true';
        cell.setAttribute('role', 'textbox');
        cell.setAttribute('aria-label', `Row ${rowIndex + 1}, column ${columnIndex + 1}`);
        this.#renderCellContent(cell, row.cells[column.id]);
        if (!this.#readonly) {
          this.#richText.attachRichTextHandlers(cell, this.#events.signal);
          this.#richText.attachCompositionHandlers(
            cell,
            () => this.#commitCell(row.id, column.id, cell),
            this.#events.signal,
            true
          );
        }
        cell.addEventListener(
          'input',
          event => {
            if (this.#richText.isComposing(cell) || (event as InputEvent).isComposing) return;
            this.#clearAreaSelection();
            this.#commitCell(row.id, column.id, cell);
          },
          { signal: this.#events.signal }
        );
        cell.addEventListener(
          'focus',
          () => {
            this.#activeCell = { rowId: row.id, columnId: column.id };
          },
          { signal: this.#events.signal }
        );
        cell.addEventListener(
          'pointerdown',
          event => this.#beginCellRange(event, row.id, column.id),
          { signal: this.#events.signal }
        );
        cell.addEventListener(
          'keydown',
          event => this.#onCellKeyDown(event, row.id, column.id),
          { signal: this.#events.signal }
        );
        cell.addEventListener(
          'mouseenter',
          () => {
            this.#hoverRowId = row.id;
            this.#hoverColumnId = column.id;
            this.#syncHover();
          },
          { signal: this.#events.signal }
        );
        td.append(cell);

        if (rowIndex === 0 && !this.#readonly) {
          const columnHandle = document.createElement('div');
          columnHandle.className = 'nb-table-column-handle';
          columnHandle.dataset.columnId = column.id;
          columnHandle.setAttribute('role', 'button');
          columnHandle.setAttribute('aria-label', `Column ${columnIndex + 1} actions`);
          columnHandle.append(dots());
          columnHandle.addEventListener(
            'pointerdown',
            event => this.#beginColumnDrag(event, column.id),
            { signal: this.#events.signal }
          );
          columnHandle.addEventListener(
            'click',
            event => {
              event.preventDefault();
              event.stopPropagation();
              if (this.#suppressHandleClick) {
                this.#suppressHandleClick = false;
                return;
              }
              this.#openColumnMenu(column.id, columnHandle);
            },
            { signal: this.#events.signal }
          );
          td.append(columnHandle);
        }
        if (columnIndex === 0 && !this.#readonly) {
          const rowHandle = document.createElement('div');
          rowHandle.className = 'nb-table-row-handle';
          rowHandle.dataset.rowId = row.id;
          rowHandle.setAttribute('role', 'button');
          rowHandle.setAttribute('aria-label', `Row ${rowIndex + 1} actions`);
          rowHandle.append(dots(true));
          rowHandle.addEventListener(
            'pointerdown',
            event => this.#beginRowDrag(event, row.id),
            { signal: this.#events.signal }
          );
          rowHandle.addEventListener(
            'click',
            event => {
              event.preventDefault();
              event.stopPropagation();
              if (this.#suppressHandleClick) {
                this.#suppressHandleClick = false;
                return;
              }
              this.#openRowMenu(row.id, rowHandle);
            },
            { signal: this.#events.signal }
          );
          td.append(rowHandle);
        }
        this.#createCellResizer(td, column.id);
        tr.append(td);
        this.#cells.set(cellKey(row.id, column.id), cell);
      }
      body.append(tr);
    });
    table.append(body);
    canvas.append(table);

    const selection = document.createElement('div');
    selection.className = 'nb-table-selection';
    selection.dataset.visible = 'false';
    canvas.append(selection);
    this.#selectionOverlay = selection;

    const dropLine = document.createElement('div');
    dropLine.className = 'nb-table-drop-line';
    dropLine.dataset.visible = 'false';
    canvas.append(dropLine);
    this.#dropLine = dropLine;

    window.addEventListener('resize', () => this.#syncSelection(), {
      signal: this.#events.signal,
    });

    if (!this.#readonly) {
      const addColumn = document.createElement('button');
      addColumn.type = 'button';
      addColumn.className = 'nb-table-add-column';
      addColumn.setAttribute('aria-label', 'Add column');
      addColumn.innerHTML = icon.plus;
      addColumn.addEventListener('pointerdown', event => {
        this.#beginAddDrag(event, 'column');
      }, { signal: this.#events.signal });
      addColumn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (this.#suppressAddClick) {
          this.#suppressAddClick = false;
          return;
        }
        this.#addColumn();
      }, { signal: this.#events.signal });
      const addRow = document.createElement('button');
      addRow.type = 'button';
      addRow.className = 'nb-table-add-row';
      addRow.setAttribute('aria-label', 'Add row');
      addRow.innerHTML = icon.plus;
      addRow.addEventListener('pointerdown', event => {
        this.#beginAddDrag(event, 'row');
      }, { signal: this.#events.signal });
      addRow.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (this.#suppressAddClick) {
          this.#suppressAddClick = false;
          return;
        }
        this.#addRow();
      }, { signal: this.#events.signal });
      const addCorner = document.createElement('button');
      addCorner.type = 'button';
      addCorner.className = 'nb-table-add-corner';
      addCorner.setAttribute('aria-label', 'Add row and column');
      addCorner.innerHTML = icon.plus;
      addCorner.addEventListener('pointerdown', event => {
        this.#beginAddDrag(event, 'corner');
      }, { signal: this.#events.signal });
      addCorner.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (this.#suppressAddClick) {
          this.#suppressAddClick = false;
          return;
        }
        this.#addCorner();
      }, { signal: this.#events.signal });
      canvas.append(addColumn, addRow, addCorner);
    }

    scroll.append(canvas);
    this.element.append(scroll);
    this.#syncHover();
    this.#syncSelection();
  }

  #syncValues(): void {
    const root = this.element.getRootNode() as ShadowRoot;
    for (const row of this.#data.rows) {
      for (const column of this.#data.columns) {
        const cell = this.#cells.get(cellKey(row.id, column.id));
        if (!cell || this.#richText.isComposing(cell)) continue;
        const tableCell = row.cells[column.id];
        const expectedSig =
          tableCell?.runs && tableCell.runs.length > 0 ? runsSignature(tableCell.runs) : '';
        const expectedText =
          tableCell?.text ?? (tableCell?.runs ? plainText(tableCell.runs) : '');
        const currentSig = cell.dataset.runs ?? '';
        const currentText = plainText(readRichTextRuns(cell));
        if (currentSig === expectedSig && currentText === expectedText) continue;
        const focused = root.activeElement === cell;
        const saved = focused ? selectionOffsets(cell) : null;
        this.#renderCellContent(cell, tableCell);
        if (focused) {
          const maxLen = tableCell?.runs ? runsLength(tableCell.runs) : expectedText.length;
          if (saved) {
            setSelectionOffsets(
              cell,
              Math.min(saved.start, maxLen),
              Math.min(saved.end, maxLen)
            );
          } else {
            placeCaret(cell, 'end');
          }
        }
      }
    }
  }

  #syncHover(): void {
    for (const handle of this.element.querySelectorAll<HTMLElement>('.nb-table-row-handle')) {
      const selected = this.#selected?.type === 'row' && handle.dataset.rowId === this.#selected.id;
      const visible = handle.dataset.rowId === this.#hoverRowId || selected;
      handle.dataset.visible = String(visible);
      handle.dataset.active = String(selected);
    }
    for (const handle of this.element.querySelectorAll<HTMLElement>('.nb-table-column-handle')) {
      const selected =
        this.#selected?.type === 'column' && handle.dataset.columnId === this.#selected.id;
      const visible = handle.dataset.columnId === this.#hoverColumnId || selected;
      handle.dataset.visible = String(visible);
      handle.dataset.active = String(selected);
    }
    const lastRow = this.#data.rows[this.#data.rows.length - 1];
    const lastColumn = this.#data.columns[this.#data.columns.length - 1];
    const atLastRow = Boolean(lastRow && this.#hoverRowId === lastRow.id);
    const atLastColumn = Boolean(lastColumn && this.#hoverColumnId === lastColumn.id);
    for (const button of this.element.querySelectorAll<HTMLElement>('.nb-table-add-column')) {
      button.dataset.visible = String(atLastColumn);
    }
    for (const button of this.element.querySelectorAll<HTMLElement>('.nb-table-add-row')) {
      button.dataset.visible = String(atLastRow);
    }
    for (const button of this.element.querySelectorAll<HTMLElement>('.nb-table-add-corner')) {
      button.dataset.visible = String(atLastRow && atLastColumn);
    }
  }

  #areaBounds(): TableAreaBounds | null {
    const area = this.#area;
    if (!area) return null;
    const anchorRow = this.#data.rows.findIndex(row => row.id === area.anchorRowId);
    const anchorColumn = this.#data.columns.findIndex(
      column => column.id === area.anchorColumnId
    );
    const focusRow = this.#data.rows.findIndex(row => row.id === area.focusRowId);
    const focusColumn = this.#data.columns.findIndex(
      column => column.id === area.focusColumnId
    );
    if (anchorRow < 0 || anchorColumn < 0 || focusRow < 0 || focusColumn < 0) {
      this.#area = null;
      return null;
    }
    return {
      rowStart: Math.min(anchorRow, focusRow),
      rowEnd: Math.max(anchorRow, focusRow),
      columnStart: Math.min(anchorColumn, focusColumn),
      columnEnd: Math.max(anchorColumn, focusColumn),
    };
  }

  #syncSelection(): void {
    const bounds = this.#areaBounds();
    const areaCells = new Set<string>();
    if (bounds) {
      for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
        const row = this.#data.rows[rowIndex];
        if (!row) continue;
        for (
          let columnIndex = bounds.columnStart;
          columnIndex <= bounds.columnEnd;
          columnIndex += 1
        ) {
          const column = this.#data.columns[columnIndex];
          if (column) areaCells.add(cellKey(row.id, column.id));
        }
      }
    }
    for (const [key, cell] of this.#cells) {
      const td = cell.closest<HTMLElement>('td');
      if (!td) continue;
      const [rowId, columnId] = key.split('\u0000');
      const rowSelected = this.#selected?.type === 'row' && rowId === this.#selected.id;
      const columnSelected =
        this.#selected?.type === 'column' && columnId === this.#selected.id;
      const areaSelected = areaCells.has(key);
      td.classList.toggle('is-row-selected', Boolean(rowSelected));
      td.classList.toggle('is-column-selected', Boolean(columnSelected));
      td.classList.toggle('is-area-selected', areaSelected);
      td.setAttribute(
        'aria-selected',
        String(rowSelected || columnSelected || areaSelected)
      );
    }
    this.#positionSelectionOverlay(bounds);
  }

  #positionSelectionOverlay(bounds: TableAreaBounds | null): void {
    const overlay = this.#selectionOverlay;
    if (!overlay) return;
    if (!bounds) {
      overlay.dataset.visible = 'false';
      return;
    }
    const firstRow = this.#data.rows[bounds.rowStart];
    const lastRow = this.#data.rows[bounds.rowEnd];
    const firstColumn = this.#data.columns[bounds.columnStart];
    const lastColumn = this.#data.columns[bounds.columnEnd];
    if (!firstRow || !lastRow || !firstColumn || !lastColumn) {
      overlay.dataset.visible = 'false';
      return;
    }
    const firstCell = this.#cells
      .get(cellKey(firstRow.id, firstColumn.id))
      ?.closest<HTMLElement>('td');
    const lastCell = this.#cells
      .get(cellKey(lastRow.id, lastColumn.id))
      ?.closest<HTMLElement>('td');
    const canvas = overlay.parentElement;
    if (!firstCell || !lastCell || !canvas) {
      overlay.dataset.visible = 'false';
      return;
    }
    const canvasRect = canvas.getBoundingClientRect();
    const firstRect = firstCell.getBoundingClientRect();
    const lastRect = lastCell.getBoundingClientRect();
    const left = Math.min(firstRect.left, lastRect.left) - canvasRect.left;
    const top = Math.min(firstRect.top, lastRect.top) - canvasRect.top;
    const right = Math.max(firstRect.right, lastRect.right) - canvasRect.left;
    const bottom = Math.max(firstRect.bottom, lastRect.bottom) - canvasRect.top;
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${Math.max(0, right - left)}px`;
    overlay.style.height = `${Math.max(0, bottom - top)}px`;
    overlay.dataset.visible = 'true';
  }

  #clearAreaSelection(): void {
    if (!this.#area) return;
    this.#area = null;
    this.#syncSelection();
  }

  #beginWindowDrag(
    onMove: (event: PointerEvent) => void,
    onFinish: (event: PointerEvent) => void,
    onCancel?: () => void
  ): void {
    const eventsSignal = this.#events.signal;
    if (eventsSignal.aborted) return;
    const controller = new AbortController();
    const { signal } = controller;
    eventsSignal.addEventListener(
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

  #beginCellRange(event: PointerEvent, rowId: string, columnId: string): void {
    if (this.#readonly || event.button !== 0 || !event.isPrimary) return;
    this.#clearAreaSelection();
    const drag = {
      anchorRowId: rowId,
      anchorColumnId: columnId,
      moved: false,
    };
    this.#drag = drag;
    const root = this.element.getRootNode() as ShadowRoot;
    this.#beginWindowDrag(
      moveEvent => {
        if (this.#drag !== drag) return;
        const target = this.#cellFromEvent(moveEvent);
        if (!target) return;
        const targetRowId = target.dataset.rowId;
        const targetColumnId = target.dataset.columnId;
        if (!targetRowId || !targetColumnId) return;
        if (
          !drag.moved &&
          targetRowId === drag.anchorRowId &&
          targetColumnId === drag.anchorColumnId
        ) {
          return;
        }
        drag.moved = true;
        this.element.classList.add('is-selecting');
        this.#area = {
          anchorRowId: drag.anchorRowId,
          anchorColumnId: drag.anchorColumnId,
          focusRowId: targetRowId,
          focusColumnId: targetColumnId,
        };
        nativeSelection(root)?.removeAllRanges();
        moveEvent.preventDefault();
        this.#syncSelection();
      },
      () => {
        if (this.#drag !== drag) return;
        this.#drag = null;
        this.element.classList.remove('is-selecting');
        if (drag.moved) {
          this.#suppressCellClick = true;
          window.setTimeout(() => {
            this.#suppressCellClick = false;
          }, 0);
        } else {
          this.#area = null;
        }
        this.#syncSelection();
        if (drag.moved) this.#restoreActiveCaret();
      },
      () => {
        if (this.#drag === drag) this.#drag = null;
        this.element.classList.remove('is-selecting');
      }
    );
  }

  #cellFromEvent(event: Event): HTMLElement | null {
    for (const node of event.composedPath()) {
      if (node instanceof HTMLElement && node.classList.contains('nb-table-cell')) {
        return node;
      }
    }
    return null;
  }

  #restoreActiveCaret(): void {
    const active = this.#activeCell;
    if (!active) return;
    const cell = this.#cells.get(cellKey(active.rowId, active.columnId));
    if (!cell) return;
    cell.focus();
    placeCaret(cell, 'end');
  }

  #history(redo: boolean): void {
    const active = this.#activeCell;
    const rowIndex = active
      ? this.#data.rows.findIndex(row => row.id === active.rowId)
      : -1;
    const columnIndex = active
      ? this.#data.columns.findIndex(column => column.id === active.columnId)
      : -1;
    if (redo) this.#host.redo();
    else this.#host.undo();
    if (!this.element.isConnected) {
      this.#host.focusAfterHistory();
      return;
    }
    const root = this.element.getRootNode() as ShadowRoot;
    const activeEl = active
      ? this.#cells.get(cellKey(active.rowId, active.columnId))
      : undefined;
    if (activeEl && root.activeElement === activeEl) return;
    const focus = (): void =>
      this.#focusHistoryCell(active, rowIndex, columnIndex);
    focus();
    requestAnimationFrame(focus);
  }

  #focusHistoryCell(
    active: { rowId: string; columnId: string } | null,
    rowIndex: number,
    columnIndex: number
  ): void {
    if (this.#data.rows.length === 0 || this.#data.columns.length === 0) return;
    const row =
      (active && this.#data.rows.find(item => item.id === active.rowId)) ||
      this.#data.rows[Math.min(Math.max(rowIndex, 0), this.#data.rows.length - 1)];
    const column =
      (active &&
        this.#data.columns.find(item => item.id === active.columnId)) ||
      this.#data.columns[
        Math.min(Math.max(columnIndex, 0), this.#data.columns.length - 1)
      ];
    if (row && column) this.focusCell(row.id, column.id, 'end');
  }

  #onClickCapture = (event: MouseEvent): void => {
    if (!this.#suppressCellClick) return;
    this.#suppressCellClick = false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  #rangeText(): string | null {
    const bounds = this.#areaBounds();
    if (!bounds) return null;
    const lines: string[] = [];
    for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
      const row = this.#data.rows[rowIndex];
      if (!row) continue;
      const cells: string[] = [];
      for (
        let columnIndex = bounds.columnStart;
        columnIndex <= bounds.columnEnd;
        columnIndex += 1
      ) {
        const column = this.#data.columns[columnIndex];
        if (column) cells.push(tsvCell(tableCellText(row, column.id)));
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  }

  #clearSelectedCells(): void {
    const bounds = this.#areaBounds();
    if (!bounds) return;
    this.#area = null;
    let next = this.#data;
    for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
      const row = this.#data.rows[rowIndex];
      if (!row) continue;
      for (
        let columnIndex = bounds.columnStart;
        columnIndex <= bounds.columnEnd;
        columnIndex += 1
      ) {
        const column = this.#data.columns[columnIndex];
        if (column) next = setTableCellText(next, row.id, column.id, '');
      }
    }
    if (next !== this.#data) this.#host.commit(next);
    this.#syncSelection();
  }

  #onCopy = (event: ClipboardEvent): void => {
    if (this.#readonly) return;
    const text = this.#rangeText();
    if (text === null) return;
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
  };

  #onCut = (event: ClipboardEvent): void => {
    if (this.#readonly) return;
    const text = this.#rangeText();
    if (text === null) return;
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
    this.#clearSelectedCells();
  };

  #onPaste = (event: ClipboardEvent): void => {
    if (this.#readonly) return;
    const bounds = this.#areaBounds();
    if (!bounds) {
      const cell = this.#cellFromEvent(event);
      if (!cell) return;
      const plain = event.clipboardData?.getData('text/plain') ?? '';
      if (!plain) return;
      event.preventDefault();
      event.stopPropagation();
      this.#richText.pasteIntoRichText(cell, plain.replace(/\r\n?/gu, '\n'));
      return;
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    const grid = parseTsv(text);
    if (grid.length === 0) return;
    event.preventDefault();
    event.stopPropagation();

    let data = this.#data;
    const width = Math.max(0, ...grid.map(line => line.length));
    const neededColumns = bounds.columnStart + width;
    while (data.columns.length < neededColumns) {
      const last = data.columns[data.columns.length - 1];
      const result = insertTableColumn(data, last?.id ?? null);
      if (!result.columnId) break;
      data = result.data;
    }
    const neededRows = bounds.rowStart + grid.length;
    while (data.rows.length < neededRows) {
      const last = data.rows[data.rows.length - 1];
      const result = insertTableRow(data, last?.id ?? null);
      if (!result.rowId) break;
      data = result.data;
    }

    let lastRowId = '';
    let lastColumnId = '';
    let widestColumn = -1;
    grid.forEach((values, rowOffset) => {
      const row = data.rows[bounds.rowStart + rowOffset];
      if (!row) return;
      lastRowId = row.id;
      values.forEach((value, columnOffset) => {
        const column = data.columns[bounds.columnStart + columnOffset];
        if (!column) return;
        data = setTableCellText(data, row.id, column.id, value);
        if (columnOffset > widestColumn) {
          widestColumn = columnOffset;
          lastColumnId = column.id;
        }
      });
    });
    const anchorRow = data.rows[bounds.rowStart];
    const anchorColumn = data.columns[bounds.columnStart];
    if (!anchorRow || !anchorColumn) return;
    this.#area = {
      anchorRowId: anchorRow.id,
      anchorColumnId: anchorColumn.id,
      focusRowId: lastRowId || anchorRow.id,
      focusColumnId: lastColumnId || anchorColumn.id,
    };
    this.#host.commit(data);
    this.#syncSelection();
    requestAnimationFrame(() => {
      const cell = this.#cells.get(cellKey(anchorRow.id, anchorColumn.id));
      if (!cell) return;
      cell.focus();
      placeCaret(cell, 'end');
    });
  };

  #commitCell(rowId: string, columnId: string, cell: HTMLElement): void {
    const runs = readRichTextRuns(cell);
    const next = setTableCellRuns(this.#data, rowId, columnId, runs);
    const nextCell = next.rows.find(row => row.id === rowId)?.cells[columnId];
    cell.dataset.runs =
      nextCell?.runs && nextCell.runs.length > 0 ? runsSignature(nextCell.runs) : '';
    if (next === this.#data) return;
    this.#host.commit(next, { mergeKey: `tb:${rowId}:${columnId}` });
  }

  #beginAddDrag(event: PointerEvent, axis: 'row' | 'column' | 'corner'): void {
    if (this.#readonly || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    this.#beginWindowDrag(
      moveEvent => {
        this.#syncAddTip(moveEvent.clientX, moveEvent.clientY, axis, startX, startY);
      },
      upEvent => {
        this.#removeAddTip();
        if (upEvent.type === 'pointercancel') return;
        const dx = upEvent.clientX - startX;
        const dy = upEvent.clientY - startY;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        this.#suppressAddClick = true;
        window.setTimeout(() => {
          this.#suppressAddClick = false;
        }, 0);
        const rows = axis === 'row' || axis === 'corner'
          ? Math.max(1, Math.round(Math.abs(dy) / 39))
          : 0;
        const columns = axis === 'column' || axis === 'corner'
          ? Math.max(1, Math.round(Math.abs(dx) / DEFAULT_COLUMN_WIDTH))
          : 0;
        this.#addCounts(rows, columns);
      },
      () => this.#removeAddTip()
    );
  }

  #syncAddTip(x: number, y: number, axis: 'row' | 'column' | 'corner', startX: number, startY: number): void {
    let tip = this.#addTip;
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'nb-table-add-tip';
      (this.element.getRootNode() as ShadowRoot).append(tip);
      this.#addTip = tip;
    }
    const rows = axis === 'row' || axis === 'corner'
      ? Math.max(1, Math.round(Math.abs(y - startY) / 39))
      : 0;
    const columns = axis === 'column' || axis === 'corner'
      ? Math.max(1, Math.round(Math.abs(x - startX) / DEFAULT_COLUMN_WIDTH))
      : 0;
    tip.textContent = rows > 0 && columns > 0
      ? `+${rows} row${rows === 1 ? '' : 's'}, +${columns} column${columns === 1 ? '' : 's'}`
      : rows > 0
        ? `+${rows} row${rows === 1 ? '' : 's'}`
        : `+${columns} column${columns === 1 ? '' : 's'}`;
    tip.style.left = `${x + 14}px`;
    tip.style.top = `${y + 14}px`;
  }

  #removeAddTip(): void {
    this.#addTip?.remove();
    this.#addTip = null;
  }

  #addCounts(rows: number, columns: number): void {
    let data = this.#data;
    let lastRow = data.rows[data.rows.length - 1];
    let lastColumn = data.columns[data.columns.length - 1];
    let focusRow = '';
    let focusColumn = '';
    for (let index = 0; index < rows; index += 1) {
      if (!lastRow) break;
      const result = insertTableRow(data, lastRow.id);
      data = result.data;
      lastRow = data.rows.find(row => row.id === result.rowId);
      focusRow = result.rowId;
    }
    for (let index = 0; index < columns; index += 1) {
      if (!lastColumn) break;
      const result = insertTableColumn(data, lastColumn.id);
      data = result.data;
      lastColumn = data.columns.find(column => column.id === result.columnId);
      focusColumn = result.columnId;
    }
    this.#host.commit(data);
    if (data === this.#data) return;
    if (focusRow || focusColumn) {
      requestAnimationFrame(() =>
        this.focusCell(
          focusRow || data.rows[0]?.id || '',
          focusColumn || data.columns[0]?.id || '',
          'start'
        )
      );
    }
  }

  #addRow(afterRowId: string | null = null): void {
    const result = insertTableRow(this.#data, afterRowId);
    if (!result.rowId) return;
    this.#host.commit(result.data);
    requestAnimationFrame(() =>
      this.focusCell(result.rowId, this.#data.columns[0]?.id ?? '', 'start')
    );
  }

  #addColumn(afterColumnId: string | null = null): void {
    const result = insertTableColumn(this.#data, afterColumnId);
    if (!result.columnId) return;
    this.#host.commit(result.data);
    requestAnimationFrame(() =>
      this.focusCell(this.#data.rows[0]?.id ?? '', result.columnId, 'start')
    );
  }

  #addCorner(): void {
    const lastRow = this.#data.rows[this.#data.rows.length - 1];
    const lastColumn = this.#data.columns[this.#data.columns.length - 1];
    if (!lastRow || !lastColumn) return;
    const rowResult = insertTableRow(this.#data, lastRow.id);
    const columnResult = insertTableColumn(rowResult.data, lastColumn.id);
    if (columnResult.data === this.#data) return;
    this.#host.commit(columnResult.data);
    requestAnimationFrame(() =>
      this.focusCell(
        rowResult.rowId || this.#data.rows[0]?.id || '',
        columnResult.columnId || lastColumn.id,
        'start'
      )
    );
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
    this.#beginWindowDrag(
      moveEvent => {
        const width = Math.max(
          MIN_COLUMN_WIDTH,
          Math.min(MAX_COLUMN_WIDTH, Math.round(startWidth + moveEvent.clientX - startX))
        );
        col.style.width = `${width}px`;
        this.#syncSelection();
      },
      endEvent => {
        if (endEvent.type === 'pointercancel') return;
        const width = Number.parseFloat(col.style.width);
        if (Number.isFinite(width)) {
          this.#host.commit(setTableColumnWidth(this.#data, columnId, width));
        }
      }
    );
  }

  #startReorderDrag(
    event: PointerEvent,
    markSources: () => void,
    updateTarget: (moveEvent: PointerEvent) => boolean,
    commitTarget: () => void
  ): void {
    if (this.#readonly || event.button !== 0 || !event.isPrimary) return;
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let hasTarget = false;
    const cleanup = (): void => {
      this.element.classList.remove('is-reordering');
      for (const node of this.element.querySelectorAll('.is-drag-source')) {
        node.classList.remove('is-drag-source');
      }
      if (this.#dropLine) this.#dropLine.dataset.visible = 'false';
    };
    this.#beginWindowDrag(
      moveEvent => {
        if (!dragging) {
          if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) {
            return;
          }
          dragging = true;
          this.#closePopover();
          this.#clearAreaSelection();
          this.element.classList.add('is-reordering');
          markSources();
        }
        moveEvent.preventDefault();
        hasTarget = updateTarget(moveEvent);
      },
      upEvent => {
        cleanup();
        if (!dragging) return;
        this.#suppressHandleClick = true;
        window.setTimeout(() => {
          this.#suppressHandleClick = false;
        }, 0);
        if (upEvent.type !== 'pointercancel' && hasTarget) {
          commitTarget();
        }
      },
      cleanup
    );
  }

  #beginRowDrag(event: PointerEvent, rowId: string): void {
    let target: { rowId: string; position: 'before' | 'after' } | null = null;
    this.#startReorderDrag(
      event,
      () => {
        this.element
          .querySelector<HTMLElement>(`.nb-table-grid tbody tr[data-row-id="${CSS.escape(rowId)}"]`)
          ?.classList.add('is-drag-source');
      },
      moveEvent => {
        const dropLine = this.#dropLine;
        const canvas = dropLine?.parentElement;
        const table = this.element.querySelector<HTMLElement>('.nb-table-grid');
        const rows = Array.from(
          this.element.querySelectorAll<HTMLTableRowElement>('.nb-table-grid tbody tr[data-row-id]')
        );
        if (!dropLine || !canvas || !table || rows.length === 0) return false;
        const canvasRect = canvas.getBoundingClientRect();
        const tableRect = table.getBoundingClientRect();
        let chosen: { rowId: string; position: 'before' | 'after'; y: number } | null = null;
        for (const tr of rows) {
          const id = tr.dataset.rowId;
          if (!id) continue;
          const rect = tr.getBoundingClientRect();
          if (moveEvent.clientY < rect.top + rect.height / 2) {
            chosen = { rowId: id, position: 'before', y: rect.top - canvasRect.top };
            break;
          }
          chosen = { rowId: id, position: 'after', y: rect.bottom - canvasRect.top };
        }
        if (!chosen) return false;
        target = { rowId: chosen.rowId, position: chosen.position };
        dropLine.dataset.axis = 'row';
        dropLine.style.left = `${tableRect.left - canvasRect.left}px`;
        dropLine.style.top = `${chosen.y}px`;
        dropLine.style.width = `${tableRect.width}px`;
        dropLine.style.height = '';
        dropLine.dataset.visible = 'true';
        return true;
      },
      () => {
        if (!target) return;
        const next = moveTableRowTo(this.#data, rowId, target.rowId, target.position);
        if (next !== this.#data) this.#host.commit(next);
      }
    );
  }

  #beginColumnDrag(event: PointerEvent, columnId: string): void {
    let target: { columnId: string; position: 'before' | 'after' } | null = null;
    this.#startReorderDrag(
      event,
      () => {
        for (const td of this.element.querySelectorAll<HTMLElement>(
          `.nb-table-grid td[data-column-id="${CSS.escape(columnId)}"]`
        )) {
          td.classList.add('is-drag-source');
        }
      },
      moveEvent => {
        const dropLine = this.#dropLine;
        const canvas = dropLine?.parentElement;
        const table = this.element.querySelector<HTMLElement>('.nb-table-grid');
        const cells = Array.from(
          this.element.querySelectorAll<HTMLTableCellElement>(
            '.nb-table-grid tbody tr:first-child td[data-column-id]'
          )
        );
        if (!dropLine || !canvas || !table || cells.length === 0) return false;
        const canvasRect = canvas.getBoundingClientRect();
        const tableRect = table.getBoundingClientRect();
        let chosen: { columnId: string; position: 'before' | 'after'; x: number } | null = null;
        for (const td of cells) {
          const id = td.dataset.columnId;
          if (!id) continue;
          const rect = td.getBoundingClientRect();
          if (moveEvent.clientX < rect.left + rect.width / 2) {
            chosen = { columnId: id, position: 'before', x: rect.left - canvasRect.left };
            break;
          }
          chosen = { columnId: id, position: 'after', x: rect.right - canvasRect.left };
        }
        if (!chosen) return false;
        target = { columnId: chosen.columnId, position: chosen.position };
        dropLine.dataset.axis = 'column';
        dropLine.style.left = `${chosen.x}px`;
        dropLine.style.top = `${tableRect.top - canvasRect.top}px`;
        dropLine.style.width = '';
        dropLine.style.height = `${tableRect.height}px`;
        dropLine.dataset.visible = 'true';
        return true;
      },
      () => {
        if (!target) return;
        const next = moveTableColumnTo(this.#data, columnId, target.columnId, target.position);
        if (next !== this.#data) this.#host.commit(next);
      }
    );
  }

  #onCellKeyDown(event: KeyboardEvent, rowId: string, columnId: string): void {
    if (this.#richText.isComposingKey(event, event.target as HTMLElement | null)) return;
    const formatTag = shortcutTag(event);
    if (formatTag && !this.#readonly) {
      event.preventDefault();
      this.#clearAreaSelection();
      this.#richText.toggleInlineTag(formatTag);
      return;
    }
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
    if (this.#area) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.#clearAreaSelection();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        this.#clearSelectedCells();
        return;
      }
      if (
        !mod &&
        (event.key.startsWith('Arrow') ||
          event.key === 'Home' ||
          event.key === 'End' ||
          event.key === 'PageUp' ||
          event.key === 'PageDown')
      ) {
        this.#clearAreaSelection();
      }
    }
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

  #menuContent(): HTMLElement {
    const content = document.createElement('div');
    content.className = 'nb-table-menu-content';
    return content;
  }

  #addColors(content: HTMLElement, current: string | undefined, select: (color: string | undefined) => void): void {
    const section = document.createElement('div');
    section.className = 'nb-table-menu-colors';
    const label = document.createElement('span');
    label.className = 'nb-table-menu-label';
    label.textContent = 'Background color';
    section.append(label);
    const colors = document.createElement('div');
    colors.className = 'nb-table-color-list';
    const defaultButton = document.createElement('button');
    defaultButton.type = 'button';
    defaultButton.className = 'nb-table-color nb-table-color-default';
    defaultButton.title = 'Default';
    defaultButton.setAttribute('aria-label', 'Default background');
    defaultButton.addEventListener('click', () => {
      select(undefined);
      this.#closePopover();
    });
    colors.append(defaultButton);
    for (const item of TABLE_COLORS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-table-color';
      button.style.background = item.color;
      button.title = item.name;
      button.setAttribute('aria-label', `${item.name} background`);
      button.dataset.active = String(item.color === current);
      button.addEventListener('click', () => {
        select(item.color);
        this.#closePopover();
      });
      colors.append(button);
    }
    section.append(colors);
    content.append(section);
  }

  #addMenuItem(
    content: HTMLElement,
    label: string,
    action: () => void,
    disabled = false,
    danger = false,
    iconMarkup?: string
  ): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = disabled;
    if (danger) button.className = 'danger';
    if (iconMarkup) {
      const glyph = document.createElement('span');
      glyph.innerHTML = iconMarkup;
      const text = document.createElement('span');
      text.textContent = label;
      button.append(glyph, text);
    } else {
      button.textContent = label;
    }
    button.addEventListener('click', () => {
      this.#closePopover();
      action();
    });
    content.append(button);
  }

  #openRowMenu(rowId: string, anchor: HTMLElement): void {
    if (this.#readonly) return;
    const row = this.#data.rows.find(item => item.id === rowId);
    if (!row) return;
    const index = this.#data.rows.findIndex(item => item.id === rowId);
    this.#clearAreaSelection();
    this.#selected = { type: 'row', id: rowId };
    this.#syncSelection();
    this.#syncHover();
    const content = this.#menuContent();
    this.#addColors(content, row.backgroundColor, color => {
      this.#host.commit(setTableRowColor(this.#data, rowId, color));
    });
    const actions = document.createElement('div');
    actions.className = 'nb-table-menu-actions';
    this.#addMenuItem(actions, 'Insert Above', () => {
      const result = insertTableRow(this.#data, rowId, 'before');
      this.#host.commit(result.data);
      requestAnimationFrame(() =>
        this.focusCell(result.rowId, this.#data.columns[0]?.id ?? '', 'start')
      );
    }, false, false, icon.arrowUp);
    this.#addMenuItem(actions, 'Insert Below', () => {
      const result = insertTableRow(this.#data, rowId, 'after');
      this.#host.commit(result.data);
      requestAnimationFrame(() =>
        this.focusCell(result.rowId, this.#data.columns[0]?.id ?? '', 'start')
      );
    }, false, false, icon.arrowDown);
    this.#addMenuItem(actions, 'Move Up', () => {
      this.#host.commit(moveTableRow(this.#data, rowId, -1));
    }, index === 0, false, icon.arrowUp);
    this.#addMenuItem(actions, 'Move Down', () => {
      this.#host.commit(moveTableRow(this.#data, rowId, 1));
    }, index === this.#data.rows.length - 1, false, icon.arrowDown);
    this.#addMenuItem(actions, 'Duplicate', () => {
      const result = duplicateTableRow(this.#data, rowId);
      if (!result.rowId) return;
      this.#host.commit(result.data);
    }, false, false, icon.duplicate);
    this.#addMenuItem(actions, 'Clear row contents', () => {
      this.#host.commit(clearTableRow(this.#data, rowId));
    }, false, false, icon.x);
    this.#addMenuItem(actions, 'Delete', () => {
      const next = deleteTableRow(this.#data, rowId);
      if (next === this.#data) return;
      this.#host.commit(next);
    }, this.#data.rows.length <= 1, true, icon.trash);
    content.append(actions);
    this.#showMenu(anchor, content);
  }

  #openColumnMenu(columnId: string, anchor: HTMLElement): void {
    if (this.#readonly) return;
    const column = this.#data.columns.find(item => item.id === columnId);
    if (!column) return;
    const index = this.#data.columns.findIndex(item => item.id === columnId);
    this.#clearAreaSelection();
    this.#selected = { type: 'column', id: columnId };
    this.#syncSelection();
    this.#syncHover();
    const content = this.#menuContent();
    this.#addColors(content, column.backgroundColor, color => {
      this.#host.commit(setTableColumnColor(this.#data, columnId, color));
    });
    const actions = document.createElement('div');
    actions.className = 'nb-table-menu-actions';
    this.#addMenuItem(actions, 'Insert Left', () => {
      const result = insertTableColumn(this.#data, columnId, 'before');
      this.#host.commit(result.data);
      requestAnimationFrame(() =>
        this.focusCell(this.#data.rows[0]?.id ?? '', result.columnId, 'start')
      );
    }, false, false, icon.arrowLeft);
    this.#addMenuItem(actions, 'Insert Right', () => {
      const result = insertTableColumn(this.#data, columnId, 'after');
      this.#host.commit(result.data);
      requestAnimationFrame(() =>
        this.focusCell(this.#data.rows[0]?.id ?? '', result.columnId, 'start')
      );
    }, false, false, icon.arrowRight);
    this.#addMenuItem(actions, 'Move Left', () => {
      this.#host.commit(moveTableColumn(this.#data, columnId, -1));
    }, index === 0, false, icon.arrowLeft);
    this.#addMenuItem(actions, 'Move Right', () => {
      this.#host.commit(moveTableColumn(this.#data, columnId, 1));
    }, index === this.#data.columns.length - 1, false, icon.arrowRight);
    this.#addMenuItem(actions, 'Duplicate', () => {
      const result = duplicateTableColumn(this.#data, columnId);
      if (!result.columnId) return;
      this.#host.commit(result.data);
    }, false, false, icon.duplicate);
    this.#addMenuItem(actions, 'Clear column contents', () => {
      this.#host.commit(clearTableColumn(this.#data, columnId));
    }, false, false, icon.x);
    this.#addMenuItem(actions, 'Delete', () => {
      const next = deleteTableColumn(this.#data, columnId);
      if (next === this.#data) return;
      this.#host.commit(next);
    }, this.#data.columns.length <= 1, true, icon.trash);
    content.append(actions);
    this.#showMenu(anchor, content);
  }

  #showMenu(anchor: HTMLElement, content: HTMLElement): void {
    this.#closePopover();
    const menu = document.createElement('div');
    menu.className = 'nb-table-menu';
    menu.contentEditable = 'false';
    menu.append(content);
    const root = this.element.getRootNode() as ShadowRoot;
    const overlay = root.querySelector<HTMLElement>('.nb-overlay');
    (overlay ?? root).append(menu);
    placeFloating(menu, anchor.getBoundingClientRect(), {
      side: 'below',
      gap: 6,
      margin: 10,
      fallback: 'flip',
    });
    const cleanup = dismissFloating({
      element: menu,
      pointerTarget: root,
      onDismiss: () => this.#closePopover(),
    });
    this.#popover = { element: menu, cleanup };
  }

  #closePopover(): void {
    const popover = this.#popover;
    if (!popover) return;
    this.#popover = null;
    popover.cleanup();
    popover.element.remove();
    if (this.#selected) {
      this.#selected = null;
      this.#syncSelection();
      this.#syncHover();
    }
  }

  #createCellResizer(td: HTMLTableCellElement, columnId: string): void {
    if (this.#readonly) return;
    const resizer = document.createElement('span');
    resizer.className = 'nb-table-resizer';
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-orientation', 'vertical');
    resizer.setAttribute('aria-label', 'Resize column');
    resizer.addEventListener(
      'pointerdown',
      event => this.#startColumnResize(event, columnId),
      { signal: this.#events.signal }
    );
    td.append(resizer);
  }
}
