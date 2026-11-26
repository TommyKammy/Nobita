import type { InlineRun, TableCell, TableData, TableRow } from './types.js';
import { normalizeRuns, plainText } from './text.js';

export const MAX_CELL_TEXT_LENGTH = 10_000;

export interface TableRect {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
}

interface Occupancy {
  readonly spans: readonly Readonly<TableRect>[];
  readonly slots: ReadonlyMap<number, Readonly<TableRect>>;
}

const cache = new WeakMap<TableData, Occupancy>();
const rowCache = new WeakMap<TableRow, [string, TableCell][]>();

function spanCells(row: TableRow) {
  let entries = rowCache.get(row);
  if (!entries) {
    entries = Object.entries(row.cells).filter(([, cell]) => cell.colspan || cell.rowspan);
    rowCache.set(row, entries);
  }
  return entries;
}

export function buildTableOccupancyGrid(data: TableData): Occupancy {
  const previous = cache.get(data);
  if (previous) return previous;
  const grid = { spans: [] as TableRect[], slots: new Map<number, TableRect>() };
  const width = data.columns.length;
  let indices: Map<string, number> | undefined;
  for (const [r, row] of data.rows.entries()) {
    const entries = spanCells(row);
    if (!entries.length) continue;
    indices ??= new Map(data.columns.map((column, i) => [column.id, i]));
    for (const [id, cell] of entries) {
      const c = indices.get(id);
      if (c === undefined) continue;
      const rect = {
        rowStart: r,
        columnStart: c,
        rowEnd: Math.min(data.rows.length, r + (cell.rowspan ?? 1)) - 1,
        columnEnd: Math.min(width, c + (cell.colspan ?? 1)) - 1,
      };
      grid.spans.push(rect);
      for (let y = r; y <= rect.rowEnd; y++) {
        for (let x = c; x <= rect.columnEnd; x++) grid.slots.set(y * width + x, rect);
      }
    }
  }
  cache.set(data, grid);
  return grid;
}

export function tableSpanAt(data: TableData, row: number, column: number) {
  if (column < 0 || column >= data.columns.length) return undefined;
  return buildTableOccupancyGrid(data).slots.get(row * data.columns.length + column);
}

export function expandTableRange(data: TableData, rect: TableRect): TableRect {
  const range = { ...rect };
  let changed: boolean;
  do {
    changed = false;
    for (const span of buildTableOccupancyGrid(data).spans) {
      if (
        span.rowEnd < range.rowStart ||
        span.rowStart > range.rowEnd ||
        span.columnEnd < range.columnStart ||
        span.columnStart > range.columnEnd
      )
        continue;
      if (
        span.rowStart >= range.rowStart &&
        span.rowEnd <= range.rowEnd &&
        span.columnStart >= range.columnStart &&
        span.columnEnd <= range.columnEnd
      )
        continue;
      range.rowStart = Math.min(range.rowStart, span.rowStart);
      range.rowEnd = Math.max(range.rowEnd, span.rowEnd);
      range.columnStart = Math.min(range.columnStart, span.columnStart);
      range.columnEnd = Math.max(range.columnEnd, span.columnEnd);
      changed = true;
    }
  } while (changed);
  return range;
}

export function withSpan(cell: TableCell, height: number, width: number): TableCell {
  const result: TableCell = { text: cell.text };
  if (cell.runs) result.runs = cell.runs;
  if (width > 1) result.colspan = width;
  if (height > 1) result.rowspan = height;
  return result;
}

/** Only writes through fresh row/cell maps. Untouched rows retain their identity. */
function writer(data: TableData) {
  let rows = data.rows;
  return {
    set(r: number, c: number, cell?: TableCell) {
      const id = data.columns[c]!.id;
      let row = rows[r]!;
      if (!cell?.text && !cell?.colspan && !cell?.rowspan) cell = undefined;
      if (row.cells[id] === cell) return;
      if (rows === data.rows) rows = rows.slice();
      if (row === data.rows[r]) rows[r] = row = { ...row, cells: { ...row.cells } };
      if (cell) row.cells[id] = cell;
      else delete row.cells[id];
    },
    result: () => (rows === data.rows ? data : { ...data, rows }),
  };
}

/** Clear each intersecting anchor once, including spans anchored outside the range. */
export function clearTableRange(data: TableData, range: TableRect): TableData {
  if (
    !data.rows[range.rowStart] ||
    !data.rows[range.rowEnd] ||
    !data.columns[range.columnStart] ||
    !data.columns[range.columnEnd]
  )
    return data;
  const edit = writer(data);
  for (let r = range.rowStart; r <= range.rowEnd; r++) {
    for (let c = range.columnStart; c <= range.columnEnd; c++) {
      const span = tableSpanAt(data, r, c);
      if (!span) {
        edit.set(r, c);
      } else if (
        r === Math.max(range.rowStart, span.rowStart) &&
        c === Math.max(range.columnStart, span.columnStart)
      ) {
        const height = span.rowEnd - span.rowStart + 1;
        const width = span.columnEnd - span.columnStart + 1;
        if (data.rows[span.rowStart]!.cells[data.columns[span.columnStart]!.id]?.text) {
          edit.set(span.rowStart, span.columnStart, withSpan({ text: '' }, height, width));
        }
      }
    }
  }
  return edit.result();
}

export function mergeTableCells(data: TableData, rect: TableRect): TableData {
  const { rowStart, rowEnd, columnStart, columnEnd } = expandTableRange(data, rect);
  if (
    !data.rows[rowStart] ||
    !data.rows[rowEnd] ||
    !data.columns[columnStart] ||
    !data.columns[columnEnd] ||
    rowStart > rowEnd ||
    columnStart > columnEnd ||
    (rowStart === rowEnd && columnStart === columnEnd)
  )
    return data;
  const existing = tableSpanAt(data, rowStart, columnStart);
  if (
    existing &&
    existing.rowStart === rowStart &&
    existing.rowEnd === rowEnd &&
    existing.columnStart === columnStart &&
    existing.columnEnd === columnEnd
  )
    return data;
  const runs: InlineRun[] = [];
  let length = 0;
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = columnStart; c <= columnEnd; c++) {
      const cell = data.rows[r]!.cells[data.columns[c]!.id];
      if (!cell?.text) continue;
      length += cell.text.length + (runs.length ? 1 : 0);
      if (length > MAX_CELL_TEXT_LENGTH) return data;
      if (runs.length) runs.push({ text: '\n' });
      for (const run of cell.runs ?? [{ text: cell.text }]) runs.push(run);
    }
  }
  const normalized = normalizeRuns(runs);
  const anchor: TableCell = { text: plainText(normalized) };
  if (normalized.some(run => run.marks)) anchor.runs = normalized;
  const edit = writer(data);
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = columnStart; c <= columnEnd; c++) {
      edit.set(
        r,
        c,
        r === rowStart && c === columnStart
          ? withSpan(anchor, rowEnd - rowStart + 1, columnEnd - columnStart + 1)
          : undefined
      );
    }
  }
  return edit.result();
}

export function unmergeTableRange(data: TableData, rect: TableRect): TableData {
  const edit = writer(data);
  for (const span of buildTableOccupancyGrid(data).spans) {
    if (
      span.rowEnd < rect.rowStart ||
      span.rowStart > rect.rowEnd ||
      span.columnEnd < rect.columnStart ||
      span.columnStart > rect.columnEnd
    )
      continue;
    const cell = data.rows[span.rowStart]!.cells[data.columns[span.columnStart]!.id]!;
    edit.set(span.rowStart, span.columnStart, withSpan(cell, 1, 1));
  }
  return edit.result();
}

export function unmergeTableCell(data: TableData, rowId: string, columnId: string): TableData {
  const r = data.rows.findIndex(row => row.id === rowId);
  const c = data.columns.findIndex(col => col.id === columnId);
  return unmergeTableRange(data, { rowStart: r, rowEnd: r, columnStart: c, columnEnd: c });
}

/** Reconcile a single axis edit by tracking the original member IDs. */
export function reconcileTableAxis(
  data: TableData,
  next: TableData,
  axis: 'rows' | 'columns'
): TableData {
  const { spans } = buildTableOccupancyGrid(data);
  if (!spans.length) return next;
  const before = data[axis];
  const after = next[axis];
  const positions = new Map(after.map((item, i) => [item.id, i]));
  const rowAxis = axis === 'rows';
  const edit = writer(next);
  for (const span of spans) {
    const { rowStart: r, columnStart: c } = span;
    const cell = data.rows[r]!.cells[data.columns[c]!.id]!;
    const first = rowAxis ? r : c;
    const end = rowAxis ? span.rowEnd : span.columnEnd;
    const members = before.slice(first, end + 1).flatMap(item => {
      const index = positions.get(item.id);
      return index === undefined ? [] : [index];
    });
    if (!members.length) continue;
    const moved = before.length === after.length;
    const min = Math.min(...members);
    const last = Math.max(...members);
    const split = moved && last - min + 1 !== members.length;
    const start = split ? members[0]! : min;
    const count = last - start + 1;
    const height = rowAxis ? count : span.rowEnd - r + 1;
    const width = rowAxis ? span.columnEnd - c + 1 : count;
    if (moved && start !== members[0]) {
      edit.set(rowAxis ? members[0]! : r, rowAxis ? c : members[0]!);
    }
    const y = rowAxis ? start : r;
    const x = rowAxis ? c : start;
    const targetHeight = split ? 1 : height;
    const targetWidth = split ? 1 : width;
    if (
      next.rows[y]!.cells[next.columns[x]!.id] !== cell ||
      (cell.rowspan ?? 1) !== targetHeight ||
      (cell.colspan ?? 1) !== targetWidth
    ) {
      edit.set(y, x, withSpan(cell, targetHeight, targetWidth));
    }
    // A duplicate inserted inside the span may carry a copy of its anchor.
    if (after.length > before.length && last - start >= members.length) {
      for (let i = start + 1; i < last; i++) {
        if (!members.includes(i)) edit.set(rowAxis ? i : r, rowAxis ? c : i);
      }
    }
  }
  return edit.result();
}
