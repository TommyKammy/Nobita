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
  setTableRangeText,
  setTableColumnColor,
  setTableColumnWidth,
  setTableRowColor,
  tableCellText,
} from '@nobita/core';
import type { PageInfo, TableCell, TableData } from '@nobita/core';
import {
  btn,
  cellKey,
  el,
  readRichTextRuns,
  runsSignature,
  selectionOffsets,
  setSelectionOffsets,
  shortcutTag,
} from './database-dom.js';
import { DatabaseRichTextController } from './database-rich-text.js';
import { handleHistoryKey, nativeSelection, placeCaret } from './dom.js';
import {
  beginWindowDrag,
  openAnchoredPopover,
  pointAnchor,
  type FloatingAnchor,
} from './floating.js';
import { icon } from './icons.js';
import { renderInlineRuns } from './inline-dom.js';
import { parseTsv, tsvCell } from './tsv.js';

export interface TableHost {
  readonly readonly: boolean;
  resolvePage?: (pageId: string) => PageInfo | null;
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

interface TableAreaBounds {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
}

function writeCellText(element: HTMLElement, value: string): void {
  element.replaceChildren();
  if (!value) return;
  const lines = value.split('\n');
  lines.forEach((line, index) => {
    if (index > 0) element.append(document.createElement('br'));
    if (line) element.append(document.createTextNode(line));
  });
  // `readRunsFromDom` ignores a trailing root `<br>` as a browser placeholder,
  // so an explicit trailing newline needs a sentinel `<br>` after it.
  if (value.endsWith('\n')) {
    element.append(document.createElement('br'));
  }
}

function dots(vertical = false): HTMLElement {
  const wrap = el('span', vertical ? 'nb-table-dots nb-table-dots-vertical' : 'nb-table-dots');
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
  #cellTds = new Map<string, HTMLTableCellElement>();
  #selectedTds = new Map<HTMLTableCellElement, number>();
  #rowHandles = new Map<string, HTMLElement>();
  #colHandles = new Map<string, HTMLElement>();
  #shownRowHandles = new Set<HTMLElement>();
  #shownColHandles = new Set<HTMLElement>();
  #addColBtn: HTMLElement | null = null;
  #addRowBtn: HTMLElement | null = null;
  #addCornerBtn: HTMLElement | null = null;
  #syncedData: TableData | null = null;
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
    this.element = el('div', 'nb-table');
    this.element.contentEditable = 'false';
    this.element.dataset.readonly = String(this.#readonly);
    this.#richText = new DatabaseRichTextController({
      rootElement: this.element,
      isReadonly: () => this.#readonly,
      getSignal: () => this.#events.signal,
      richTextSelector: '.nb-table-cell',
      resolvePage: pageId => this.#host.resolvePage?.(pageId) ?? null,
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
    this.element.addEventListener('contextmenu', this.#onContextMenu, {
      signal: this.#globalEvents.signal,
    });
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

  #resetRefs(): void {
    this.#cells.clear();
    this.#cellTds.clear();
    this.#selectedTds.clear();
    this.#rowHandles.clear();
    this.#colHandles.clear();
    this.#shownRowHandles.clear();
    this.#shownColHandles.clear();
    this.#addColBtn = null;
    this.#addRowBtn = null;
    this.#addCornerBtn = null;
  }

  destroy(): void {
    this.#globalEvents.abort();
    this.#events.abort();
    this.#richText.destroy();
    this.#closePopover();
    this.#removeAddTip();
    this.#resetRefs();
    this.#syncedData = null;
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
      renderInlineRuns(cell, tableCell.runs, this.#host.resolvePage);
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
    const active = (this.element.getRootNode() as ShadowRoot).activeElement;
    const focusedHandle = active instanceof HTMLButtonElement && this.element.contains(active)
      ? active.dataset : undefined;
    this.#resetRefs();
    this.#colElements = [];
    this.#selectionOverlay = null;
    this.#dropLine = null;
    this.#structureKey = this.#structuralKey();
    this.element.dataset.readonly = String(this.#readonly);
    this.element.replaceChildren();

    const scroll = el('div', 'nb-table-scroll');
    const canvas = el('div', 'nb-table-canvas');
    const table = el('table', 'nb-table-grid');
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
        const td = el('td', 'nb-table-cell-wrap');
        td.dataset.rowId = row.id;
        td.dataset.columnId = column.id;
        td.setAttribute('aria-selected', 'false');
        const color = column.backgroundColor ?? row.backgroundColor;
        if (color) {
          td.dataset.background = 'true';
          td.style.setProperty('--nb-cell-bg', color);
        }
        const cell = el('div', 'nb-table-cell');
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
        td.append(cell);

        const makeHandle = (
          axis: 'row' | 'column',
          id: string,
          label: string,
          vertical: boolean,
          map: Map<string, HTMLElement>
        ): HTMLElement => {
          const handle = btn(`nb-table-${axis}-handle`, { ariaLabel: label });
          handle.dataset[`${axis}Id`] = id;
          handle.dataset.visible = 'false';
          handle.dataset.active = 'false';
          handle.append(dots(vertical));
          handle.addEventListener(
            'pointerdown',
            event => this.#beginAxisDrag(event, axis, id),
            { signal: this.#events.signal }
          );
          handle.addEventListener(
            'click',
            event => {
              event.preventDefault();
              event.stopPropagation();
              if (this.#suppressHandleClick) {
                this.#suppressHandleClick = false;
                return;
              }
              this.#openAxisMenu(axis, id, handle);
            },
            { signal: this.#events.signal }
          );
          map.set(id, handle);
          return handle;
        };
        if (rowIndex === 0 && !this.#readonly) {
          td.append(
            makeHandle('column', column.id, `Column ${columnIndex + 1} actions`, false, this.#colHandles)
          );
        }
        if (columnIndex === 0 && !this.#readonly) {
          td.append(
            makeHandle('row', row.id, `Row ${rowIndex + 1} actions`, true, this.#rowHandles)
          );
        }
        this.#createCellResizer(td, column.id);
        tr.append(td);
        const key = cellKey(row.id, column.id);
        this.#cells.set(key, cell);
        this.#cellTds.set(key, td);
      }
      body.append(tr);
    });

    const cellFromTarget = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element ? target.closest<HTMLElement>('.nb-table-cell') : null;
    body.addEventListener(
      'input',
      event => {
        const cell = cellFromTarget(event.target);
        const rowId = cell?.dataset.rowId;
        const columnId = cell?.dataset.columnId;
        if (!cell || !rowId || !columnId) return;
        if (this.#richText.isComposing(cell) || (event as InputEvent).isComposing) return;
        this.#clearAreaSelection();
        this.#commitCell(rowId, columnId, cell);
      },
      { signal: this.#events.signal }
    );
    body.addEventListener(
      'focusin',
      event => {
        const cell = cellFromTarget(event.target);
        const rowId = cell?.dataset.rowId;
        const columnId = cell?.dataset.columnId;
        if (!rowId || !columnId) return;
        this.#activeCell = { rowId, columnId };
      },
      { signal: this.#events.signal }
    );
    body.addEventListener(
      'pointerdown',
      event => {
        const cell = cellFromTarget(event.target);
        const rowId = cell?.dataset.rowId;
        const columnId = cell?.dataset.columnId;
        if (!rowId || !columnId) return;
        this.#beginCellRange(event, rowId, columnId);
      },
      { signal: this.#events.signal }
    );
    body.addEventListener(
      'keydown',
      event => {
        const cell = cellFromTarget(event.target);
        const rowId = cell?.dataset.rowId;
        const columnId = cell?.dataset.columnId;
        if (!rowId || !columnId) return;
        this.#onCellKeyDown(event, rowId, columnId);
      },
      { signal: this.#events.signal }
    );
    body.addEventListener(
      'mouseover',
      event => {
        const cell = cellFromTarget(event.target);
        const rowId = cell?.dataset.rowId;
        const columnId = cell?.dataset.columnId;
        if (!rowId || !columnId) return;
        if (this.#hoverRowId === rowId && this.#hoverColumnId === columnId) return;
        this.#hoverRowId = rowId;
        this.#hoverColumnId = columnId;
        this.#syncHover();
      },
      { signal: this.#events.signal }
    );

    table.append(body);
    canvas.append(table);

    const selection = el('div', 'nb-table-selection');
    selection.dataset.visible = 'false';
    canvas.append(selection);
    this.#selectionOverlay = selection;

    const dropLine = el('div', 'nb-table-drop-line');
    dropLine.dataset.visible = 'false';
    canvas.append(dropLine);
    this.#dropLine = dropLine;

    window.addEventListener('resize', () => this.#syncSelection(), {
      signal: this.#events.signal,
    });

    if (!this.#readonly) {
      const makeAddBtn = (
        className: string,
        ariaLabel: string,
        axis: 'row' | 'column' | 'corner',
        onClick: () => void
      ): HTMLButtonElement => {
        const button = btn(className, { html: icon.plus, ariaLabel });
        button.addEventListener(
          'pointerdown',
          event => this.#beginAddDrag(event, axis),
          { signal: this.#events.signal }
        );
        button.addEventListener(
          'click',
          event => {
            event.preventDefault();
            event.stopPropagation();
            if (this.#suppressAddClick) {
              this.#suppressAddClick = false;
              return;
            }
            onClick();
          },
          { signal: this.#events.signal }
        );
        return button;
      };
      const addColumn = makeAddBtn('nb-table-add-column', 'Add column', 'column', () =>
        this.#addColumn()
      );
      const addRow = makeAddBtn('nb-table-add-row', 'Add row', 'row', () =>
        this.#addRow()
      );
      const addCorner = makeAddBtn(
        'nb-table-add-corner',
        'Add row and column',
        'corner',
        () => this.#addCorner()
      );
      this.#addColBtn = addColumn;
      this.#addRowBtn = addRow;
      this.#addCornerBtn = addCorner;
      canvas.append(addColumn, addRow, addCorner);
    }

    scroll.append(canvas);
    this.element.append(scroll);
    this.#syncedData = this.#data;
    this.#syncHover();
    this.#syncSelection();
    if (focusedHandle?.rowId) {
      (this.#rowHandles.get(focusedHandle.rowId) ?? this.#rowHandles.values().next().value)?.focus();
    } else if (focusedHandle?.columnId) {
      (this.#colHandles.get(focusedHandle.columnId) ?? this.#colHandles.values().next().value)?.focus();
    }
  }

  #syncValues(): void {
    const root = this.element.getRootNode() as ShadowRoot;
    const prev = this.#syncedData;
    const prevRowById = prev
      ? new Map(prev.rows.map(row => [row.id, row]))
      : null;

    for (const row of this.#data.rows) {
      const prevRow = prevRowById?.get(row.id);
      if (prevRow === row) continue;
      for (const column of this.#data.columns) {
        const tableCell = row.cells[column.id];
        if (prevRow && prevRow.cells[column.id] === tableCell) continue;
        const cell = this.#cells.get(cellKey(row.id, column.id));
        if (!cell || this.#richText.isComposing(cell)) continue;
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
    this.#syncedData = this.#data;
  }

  #syncHover(): void {
    const syncHandles = (
      shown: Set<HTMLElement>,
      handles: Map<string, HTMLElement>,
      hoverId: string | null,
      selectedId: string | null,
      attr: 'rowId' | 'columnId'
    ): Set<HTMLElement> => {
      const next = new Set<HTMLElement>();
      if (hoverId) {
        const handle = handles.get(hoverId);
        if (handle) next.add(handle);
      }
      if (selectedId) {
        const handle = handles.get(selectedId);
        if (handle) next.add(handle);
      }
      for (const handle of shown) {
        if (next.has(handle)) continue;
        handle.dataset.visible = 'false';
        handle.dataset.active = 'false';
      }
      for (const handle of next) {
        handle.dataset.visible = 'true';
        handle.dataset.active = String(selectedId !== null && handle.dataset[attr] === selectedId);
      }
      return next;
    };

    this.#shownRowHandles = syncHandles(
      this.#shownRowHandles,
      this.#rowHandles,
      this.#hoverRowId,
      this.#selected?.type === 'row' ? this.#selected.id : null,
      'rowId'
    );
    this.#shownColHandles = syncHandles(
      this.#shownColHandles,
      this.#colHandles,
      this.#hoverColumnId,
      this.#selected?.type === 'column' ? this.#selected.id : null,
      'columnId'
    );

    const lastRow = this.#data.rows[this.#data.rows.length - 1];
    const lastColumn = this.#data.columns[this.#data.columns.length - 1];
    const atLastRow = Boolean(lastRow && this.#hoverRowId === lastRow.id);
    const atLastColumn = Boolean(lastColumn && this.#hoverColumnId === lastColumn.id);
    if (this.#addColBtn) this.#addColBtn.dataset.visible = String(atLastColumn);
    if (this.#addRowBtn) this.#addRowBtn.dataset.visible = String(atLastRow);
    if (this.#addCornerBtn) this.#addCornerBtn.dataset.visible = String(atLastRow && atLastColumn);
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
    const next = new Map<HTMLTableCellElement, number>();
    const setFlag = (td: HTMLTableCellElement | undefined, flag: number): void => {
      if (td) next.set(td, (next.get(td) ?? 0) | flag);
    };

    if (this.#selected?.type === 'row') {
      for (const column of this.#data.columns) {
        setFlag(this.#cellTds.get(cellKey(this.#selected.id, column.id)), 1);
      }
    } else if (this.#selected?.type === 'column') {
      for (const row of this.#data.rows) {
        setFlag(this.#cellTds.get(cellKey(row.id, this.#selected.id)), 2);
      }
    }

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
          if (column) setFlag(this.#cellTds.get(cellKey(row.id, column.id)), 4);
        }
      }
    }

    for (const [td] of this.#selectedTds) {
      if (next.has(td)) continue;
      td.classList.remove('is-row-selected', 'is-column-selected', 'is-area-selected');
      td.setAttribute('aria-selected', 'false');
    }

    for (const [td, mask] of next) {
      if (this.#selectedTds.get(td) === mask) continue;
      td.classList.toggle('is-row-selected', (mask & 1) !== 0);
      td.classList.toggle('is-column-selected', (mask & 2) !== 0);
      td.classList.toggle('is-area-selected', (mask & 4) !== 0);
      td.setAttribute('aria-selected', 'true');
    }

    this.#selectedTds = next;
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
    const firstCell = this.#cellTds.get(cellKey(firstRow.id, firstColumn.id));
    const lastCell = this.#cellTds.get(cellKey(lastRow.id, lastColumn.id));
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
    beginWindowDrag(
      this.#events.signal,
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
    const emptyRow = Array<string>(bounds.columnEnd - bounds.columnStart + 1).fill('');
    const grid = Array.from({ length: bounds.rowEnd - bounds.rowStart + 1 }, () => emptyRow);
    const next = setTableRangeText(this.#data, bounds.rowStart, bounds.columnStart, grid);
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
    const width = grid.reduce((max, line) => Math.max(max, line.length), 0);
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

    data = setTableRangeText(data, bounds.rowStart, bounds.columnStart, grid);
    const lastRow = data.rows[Math.min(neededRows, data.rows.length) - 1];
    const lastColumn = data.columns[Math.min(neededColumns, data.columns.length) - 1];
    const anchorRow = data.rows[bounds.rowStart];
    const anchorColumn = data.columns[bounds.columnStart];
    if (!anchorRow || !anchorColumn) return;
    this.#area = {
      anchorRowId: anchorRow.id,
      anchorColumnId: anchorColumn.id,
      focusRowId: lastRow?.id ?? anchorRow.id,
      focusColumnId: lastColumn?.id ?? anchorColumn.id,
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
    beginWindowDrag(
      this.#events.signal,
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
      tip = el('div', 'nb-table-add-tip');
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
    const originalWidth = col.style.width;
    const restore = (): void => {
      col.style.width = originalWidth;
      this.#syncSelection();
    };
    beginWindowDrag(
      this.#events.signal,
      moveEvent => {
        const width = Math.max(
          MIN_COLUMN_WIDTH,
          Math.min(MAX_COLUMN_WIDTH, Math.round(startWidth + moveEvent.clientX - startX))
        );
        col.style.width = `${width}px`;
        this.#syncSelection();
      },
      endEvent => {
        if (endEvent.type === 'pointercancel') {
          restore();
          return;
        }
        const width = Number.parseFloat(col.style.width);
        if (Number.isFinite(width)) {
          this.#host.commit(setTableColumnWidth(this.#data, columnId, width));
        }
      },
      restore
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
    beginWindowDrag(
      this.#events.signal,
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

  #beginAxisDrag(event: PointerEvent, axis: 'row' | 'column', id: string): void {
    let target: { id: string; position: 'before' | 'after' } | null = null;
    const isRow = axis === 'row';
    const escaped = CSS.escape(id);
    this.#startReorderDrag(
      event,
      () => {
        const selector = isRow
          ? `.nb-table-grid tbody tr[data-row-id="${escaped}"]`
          : `.nb-table-grid td[data-column-id="${escaped}"]`;
        for (const node of this.element.querySelectorAll<HTMLElement>(selector)) {
          node.classList.add('is-drag-source');
        }
      },
      moveEvent => {
        const dropLine = this.#dropLine;
        const canvas = dropLine?.parentElement;
        const table = this.element.querySelector<HTMLElement>('.nb-table-grid');
        const nodes = this.element.querySelectorAll<HTMLElement>(
          isRow
            ? '.nb-table-grid tbody tr[data-row-id]'
            : '.nb-table-grid tbody tr:first-child td[data-column-id]'
        );
        if (!dropLine || !canvas || !table || nodes.length === 0) return false;
        const canvasRect = canvas.getBoundingClientRect();
        const tableRect = table.getBoundingClientRect();
        let chosen: { id: string; position: 'before' | 'after'; coord: number } | null = null;
        for (const node of nodes) {
          const itemId = isRow ? node.dataset.rowId : node.dataset.columnId;
          if (!itemId) continue;
          const rect = node.getBoundingClientRect();
          const before = isRow
            ? moveEvent.clientY < rect.top + rect.height / 2
            : moveEvent.clientX < rect.left + rect.width / 2;
          if (before) {
            chosen = {
              id: itemId,
              position: 'before',
              coord: (isRow ? rect.top - canvasRect.top : rect.left - canvasRect.left),
            };
            break;
          }
          chosen = {
            id: itemId,
            position: 'after',
            coord: (isRow ? rect.bottom - canvasRect.top : rect.right - canvasRect.left),
          };
        }
        if (!chosen) return false;
        target = { id: chosen.id, position: chosen.position };
        dropLine.dataset.axis = axis;
        dropLine.style.left = `${isRow ? tableRect.left - canvasRect.left : chosen.coord}px`;
        dropLine.style.top = `${isRow ? chosen.coord : tableRect.top - canvasRect.top}px`;
        dropLine.style.width = isRow ? `${tableRect.width}px` : '';
        dropLine.style.height = isRow ? '' : `${tableRect.height}px`;
        dropLine.dataset.visible = 'true';
        return true;
      },
      () => {
        if (!target) return;
        const next = isRow
          ? moveTableRowTo(this.#data, id, target.id, target.position)
          : moveTableColumnTo(this.#data, id, target.id, target.position);
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
    if (handleHistoryKey(event, redo => this.#history(redo))) return;
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
      const rowIndex = this.#data.rows.findIndex(row => row.id === rowId);
      const columnIndex = this.#data.columns.findIndex(column => column.id === columnId);
      if (rowIndex < 0 || columnIndex < 0) return;
      if (event.shiftKey && rowIndex === 0 && columnIndex === 0) return;
      event.preventDefault();
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
        } else {
          this.#colHandles.get(this.#data.columns[0]!.id)?.focus();
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
    return el('div', 'nb-table-menu-content');
  }

  #addColors(content: HTMLElement, current: string | undefined, select: (color: string | undefined) => void): void {
    const section = el('div', 'nb-table-menu-colors');
    section.append(el('span', 'nb-table-menu-label', 'Background color'));
    const colors = el('div', 'nb-table-color-list');
    const defaultButton = btn('nb-table-color nb-table-color-default', {
      title: 'Default',
      ariaLabel: 'Default background',
    });
    defaultButton.addEventListener('click', () => {
      select(undefined);
      this.#closePopover();
    });
    colors.append(defaultButton);
    for (const item of TABLE_COLORS) {
      const button = btn('nb-table-color', {
        title: item.name,
        ariaLabel: `${item.name} background`,
        dataset: { active: String(item.color === current) },
      });
      button.style.background = item.color;
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
    const button = btn(danger ? 'danger' : undefined, { disabled });
    if (iconMarkup) {
      const glyph = el('span');
      glyph.innerHTML = iconMarkup;
      button.append(glyph, el('span', undefined, label));
    } else {
      button.textContent = label;
    }
    button.addEventListener('click', () => {
      this.#closePopover();
      action();
    });
    content.append(button);
  }

  #onContextMenu = (event: MouseEvent): void => {
    if (this.#readonly || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    this.#richText.hideToolbar();
    const anchor = pointAnchor(event.clientX, event.clientY);
    const rowHandle = target.closest<HTMLElement>('.nb-table-row-handle[data-row-id]');
    if (rowHandle?.dataset.rowId) {
      event.preventDefault();
      event.stopPropagation();
      this.#openAxisMenu('row', rowHandle.dataset.rowId, anchor);
      return;
    }
    const colHandle = target.closest<HTMLElement>('.nb-table-column-handle[data-column-id]');
    if (colHandle?.dataset.columnId) {
      event.preventDefault();
      event.stopPropagation();
      this.#openAxisMenu('column', colHandle.dataset.columnId, anchor);
      return;
    }
    const td = target.closest<HTMLElement>('td.nb-table-cell-wrap[data-row-id][data-column-id]');
    if (td?.dataset.rowId && td.dataset.columnId) {
      event.preventDefault();
      event.stopPropagation();
      this.#openCellContextMenu(td.dataset.rowId, td.dataset.columnId, anchor);
    }
  };

  #openCellContextMenu(rowId: string, columnId: string, anchor: FloatingAnchor): void {
    if (this.#readonly) return;
    const row = this.#data.rows.find(item => item.id === rowId);
    const column = this.#data.columns.find(item => item.id === columnId);
    if (!row || !column) return;
    const content = this.#menuContent();
    this.#addColors(content, row.backgroundColor, color => {
      this.#host.commit(setTableRowColor(this.#data, rowId, color));
    });
    const actions = el('div', 'nb-table-menu-actions');
    if (this.#area) {
      this.#addMenuItem(
        actions,
        'Clear selected cells',
        () => this.#clearSelectedCells(),
        false,
        false,
        icon.x
      );
    }
    this.#addMenuItem(
      actions,
      'Insert row above',
      () => {
        const result = insertTableRow(this.#data, rowId, 'before');
        this.#host.commit(result.data);
      },
      false,
      false,
      icon.arrowUp
    );
    this.#addMenuItem(
      actions,
      'Insert row below',
      () => {
        const result = insertTableRow(this.#data, rowId, 'after');
        this.#host.commit(result.data);
      },
      false,
      false,
      icon.arrowDown
    );
    this.#addMenuItem(
      actions,
      'Duplicate row',
      () => {
        const result = duplicateTableRow(this.#data, rowId);
        if (result.rowId) this.#host.commit(result.data);
      },
      false,
      false,
      icon.duplicate
    );
    this.#addMenuItem(
      actions,
      'Clear row contents',
      () => this.#host.commit(clearTableRow(this.#data, rowId)),
      false,
      false,
      icon.x
    );
    this.#addMenuItem(
      actions,
      'Delete row',
      () => {
        const next = deleteTableRow(this.#data, rowId);
        if (next !== this.#data) this.#host.commit(next);
      },
      this.#data.rows.length <= 1,
      true,
      icon.trash
    );
    this.#addMenuItem(
      actions,
      'Insert column left',
      () => {
        const result = insertTableColumn(this.#data, columnId, 'before');
        this.#host.commit(result.data);
      },
      false,
      false,
      icon.arrowLeft
    );
    this.#addMenuItem(
      actions,
      'Insert column right',
      () => {
        const result = insertTableColumn(this.#data, columnId, 'after');
        this.#host.commit(result.data);
      },
      false,
      false,
      icon.arrowRight
    );
    this.#addMenuItem(
      actions,
      'Duplicate column',
      () => {
        const result = duplicateTableColumn(this.#data, columnId);
        if (result.columnId) this.#host.commit(result.data);
      },
      false,
      false,
      icon.duplicate
    );
    this.#addMenuItem(
      actions,
      'Delete column',
      () => {
        const next = deleteTableColumn(this.#data, columnId);
        if (next !== this.#data) this.#host.commit(next);
      },
      this.#data.columns.length <= 1,
      true,
      icon.trash
    );
    content.append(actions);
    this.#showMenu(anchor, content);
  }

  #openAxisMenu(axis: 'row' | 'column', id: string, anchor: HTMLElement | FloatingAnchor): void {
    if (this.#readonly) return;
    const isRow = axis === 'row';
    const items = isRow ? this.#data.rows : this.#data.columns;
    const index = items.findIndex(item => item.id === id);
    const item = items[index];
    if (!item) return;
    this.#clearAreaSelection();
    this.#selected = { type: axis, id };
    this.#syncSelection();
    this.#syncHover();
    const content = this.#menuContent();
    this.#addColors(content, item.backgroundColor, color => {
      this.#host.commit(
        isRow
          ? setTableRowColor(this.#data, id, color)
          : setTableColumnColor(this.#data, id, color)
      );
    });
    const actions = el('div', 'nb-table-menu-actions');
    const focusInserted = (position: 'before' | 'after'): void => {
      if (isRow) {
        const result = insertTableRow(this.#data, id, position);
        this.#host.commit(result.data);
        requestAnimationFrame(() =>
          this.focusCell(result.rowId, this.#data.columns[0]?.id ?? '', 'start')
        );
      } else {
        const result = insertTableColumn(this.#data, id, position);
        this.#host.commit(result.data);
        requestAnimationFrame(() =>
          this.focusCell(this.#data.rows[0]?.id ?? '', result.columnId, 'start')
        );
      }
    };
    const prevIcon = isRow ? icon.arrowUp : icon.arrowLeft;
    const nextIcon = isRow ? icon.arrowDown : icon.arrowRight;
    this.#addMenuItem(
      actions,
      isRow ? 'Insert Above' : 'Insert Left',
      () => focusInserted('before'),
      false,
      false,
      prevIcon
    );
    this.#addMenuItem(
      actions,
      isRow ? 'Insert Below' : 'Insert Right',
      () => focusInserted('after'),
      false,
      false,
      nextIcon
    );
    this.#addMenuItem(
      actions,
      isRow ? 'Move Up' : 'Move Left',
      () =>
        this.#host.commit(
          isRow ? moveTableRow(this.#data, id, -1) : moveTableColumn(this.#data, id, -1)
        ),
      index === 0,
      false,
      prevIcon
    );
    this.#addMenuItem(
      actions,
      isRow ? 'Move Down' : 'Move Right',
      () =>
        this.#host.commit(
          isRow ? moveTableRow(this.#data, id, 1) : moveTableColumn(this.#data, id, 1)
        ),
      index === items.length - 1,
      false,
      nextIcon
    );
    this.#addMenuItem(
      actions,
      'Duplicate',
      () => {
        if (isRow) {
          const result = duplicateTableRow(this.#data, id);
          if (result.rowId) this.#host.commit(result.data);
        } else {
          const result = duplicateTableColumn(this.#data, id);
          if (result.columnId) this.#host.commit(result.data);
        }
      },
      false,
      false,
      icon.duplicate
    );
    this.#addMenuItem(
      actions,
      isRow ? 'Clear row contents' : 'Clear column contents',
      () =>
        this.#host.commit(
          isRow ? clearTableRow(this.#data, id) : clearTableColumn(this.#data, id)
        ),
      false,
      false,
      icon.x
    );
    this.#addMenuItem(
      actions,
      'Delete',
      () => {
        const next = isRow ? deleteTableRow(this.#data, id) : deleteTableColumn(this.#data, id);
        if (next !== this.#data) this.#host.commit(next);
      },
      items.length <= 1,
      true,
      icon.trash
    );
    content.append(actions);
    this.#showMenu(anchor, content);
  }

  #showMenu(anchor: HTMLElement | FloatingAnchor, content: HTMLElement): void {
    this.#closePopover();
    const root = this.element.getRootNode() as ShadowRoot;
    const overlay = root.querySelector<HTMLElement>('.nb-overlay');
    const popover = openAnchoredPopover({
      host: overlay ?? root,
      anchor,
      content,
      className: 'nb-table-menu',
      onDismiss: () => this.#closePopover(),
      place: { side: 'below', gap: 6, margin: 10, fallback: 'flip' },
      dismiss: { pointerTarget: root },
    });
    if (anchor instanceof HTMLElement) {
      content.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
    popover.element.contentEditable = 'false';
    this.#popover = popover;
  }

  #closePopover(): void {
    const popover = this.#popover;
    if (!popover) return;
    this.#popover = null;
    const restoreFocus = popover.element.matches(':focus-within');
    const selected = this.#selected;
    popover.cleanup();
    popover.element.remove();
    if (this.#selected) {
      this.#selected = null;
      this.#syncSelection();
      this.#syncHover();
    }
    if (restoreFocus && selected) {
      const handles = selected.type === 'row' ? this.#rowHandles : this.#colHandles;
      handles.get(selected.id)?.focus();
    }
  }

  #createCellResizer(td: HTMLTableCellElement, columnId: string): void {
    if (this.#readonly) return;
    const resizer = el('span', 'nb-table-resizer');
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
