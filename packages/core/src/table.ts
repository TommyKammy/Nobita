import { createId } from './id.js';
import {
  cloneRuns,
  marksEqual,
  normalizeRuns,
  parseInlineRuns,
  plainText,
  runsLength,
  sliceRuns,
} from './text.js';
import type { InlineRun, TableCell, TableColumn, TableData, TableRow } from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MAX_CELL_TEXT_LENGTH = 10000;
const MAX_TABLE_COLUMNS = 100;
const MAX_TABLE_ROWS = 1000;

const asString = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\r\n?/gu, '\n').slice(0, MAX_CELL_TEXT_LENGTH) : '';

/** Return true if any run carries an inline formatting mark, mention, or page link. */
export function hasRichMarks(runs: readonly InlineRun[]): boolean {
  return runs.some(run =>
    Boolean(
      run.marks &&
        (run.marks.bold ||
          run.marks.italic ||
          run.marks.underline ||
          run.marks.strike ||
          run.marks.code ||
          run.marks.link ||
          run.marks.highlight ||
          run.marks.color ||
          run.marks.mention ||
          run.marks.page)
    )
  );
}

function clampRuns(runs: readonly InlineRun[]): InlineRun[] {
  const cleaned = runs.some(run => run.text.includes('\r'))
    ? runs.map(run =>
        run.text.includes('\r') ? { ...run, text: run.text.replace(/\r\n?/gu, '\n') } : run
      )
    : runs;
  const normalized = normalizeRuns(cleaned);
  return runsLength(normalized) > MAX_CELL_TEXT_LENGTH
    ? sliceRuns(normalized, 0, MAX_CELL_TEXT_LENGTH)
    : normalized;
}

function runsEqual(a: readonly InlineRun[], b: readonly InlineRun[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.text !== right.text || !marksEqual(left.marks, right.marks)) return false;
  }
  return true;
}

export function createTableColumn(init?: { id?: string; width?: number; backgroundColor?: string }): TableColumn {
  return {
    id: init?.id ?? createId('tc'),
    ...(init?.width !== undefined ? { width: init.width } : {}),
    ...(init?.backgroundColor ? { backgroundColor: init.backgroundColor } : {}),
  };
}

export function createTableRow(init?: { id?: string; backgroundColor?: string }): TableRow {
  return {
    id: init?.id ?? createId('tr'),
    ...(init?.backgroundColor ? { backgroundColor: init.backgroundColor } : {}),
    cells: {},
  };
}

export function createTableData(options: { rows?: number; columns?: number } = {}): TableData {
  const columnCount = Math.max(1, Math.min(MAX_TABLE_COLUMNS, Math.floor(options.columns ?? 3)));
  const rowCount = Math.max(1, Math.min(MAX_TABLE_ROWS, Math.floor(options.rows ?? 3)));
  return {
    columns: Array.from({ length: columnCount }, () => createTableColumn()),
    rows: Array.from({ length: rowCount }, () => createTableRow()),
  };
}

function parseCell(value: unknown): TableCell | undefined {
  if (!isRecord(value)) return undefined;
  if (value.runs !== undefined) {
    const parsed = parseInlineRuns(value.runs);
    const runs =
      runsLength(parsed) > MAX_CELL_TEXT_LENGTH
        ? sliceRuns(parsed, 0, MAX_CELL_TEXT_LENGTH)
        : parsed;
    if (runs.length > 0) {
      const text = plainText(runs);
      return hasRichMarks(runs) ? { text, runs } : { text };
    }
  }
  const text = asString(value.text);
  return text ? { text } : undefined;
}

/** Validate untrusted table props, filling ids and defaults. */
export function normalizeTableData(value: unknown): TableData {
  if (!isRecord(value)) return createTableData();
  const columnIds = new Set<string>();
  const columns: TableColumn[] = [];
  if (Array.isArray(value.columns)) {
    for (const item of value.columns.slice(0, MAX_TABLE_COLUMNS)) {
      if (!isRecord(item)) continue;
      const rawId = typeof item.id === 'string' && item.id.length > 0 ? item.id : '';
      const id = rawId && !columnIds.has(rawId) ? rawId : createId('tc');
      columnIds.add(id);
      const width =
        typeof item.width === 'number' && Number.isFinite(item.width)
          ? Math.max(60, Math.min(240, item.width))
          : undefined;
      const backgroundColor =
        typeof item.backgroundColor === 'string' && item.backgroundColor
          ? item.backgroundColor.slice(0, 40)
          : undefined;
      columns.push({
        id,
        ...(width !== undefined ? { width } : {}),
        ...(backgroundColor ? { backgroundColor } : {}),
      });
    }
  }
  if (columns.length === 0) {
    columns.push(createTableColumn(), createTableColumn(), createTableColumn());
  }

  const rowIds = new Set<string>();
  const rows: TableRow[] = [];
  if (Array.isArray(value.rows)) {
    for (const item of value.rows.slice(0, MAX_TABLE_ROWS)) {
      if (!isRecord(item)) continue;
      const rawId = typeof item.id === 'string' && item.id.length > 0 ? item.id : '';
      const id = rawId && !rowIds.has(rawId) ? rawId : createId('tr');
      rowIds.add(id);
      const cells: Record<string, TableCell> = {};
      if (isRecord(item.cells)) {
        for (const [columnId, cell] of Object.entries(item.cells)) {
          if (!columnIds.has(columnId)) continue;
          const parsed = parseCell(cell);
          if (parsed) cells[columnId] = parsed;
        }
      }
      const backgroundColor =
        typeof item.backgroundColor === 'string' && item.backgroundColor
          ? item.backgroundColor.slice(0, 40)
          : undefined;
      rows.push({
        id,
        ...(backgroundColor ? { backgroundColor } : {}),
        cells,
      });
    }
  }
  if (rows.length === 0) {
    rows.push(createTableRow(), createTableRow(), createTableRow());
  }
  return { columns, rows };
}

export function tableCellText(row: TableRow | undefined, columnId: string): string {
  const cell = row?.cells[columnId];
  if (!cell) return '';
  return cell.text ?? (cell.runs ? plainText(cell.runs) : '');
}

function cloneTableCell(cell: TableCell): TableCell {
  const text = cell.text ?? (cell.runs ? plainText(cell.runs) : '');
  return cell.runs && cell.runs.length > 0
    ? { text, runs: cloneRuns(cell.runs) }
    : { text };
}

function cloneCells(cells: Record<string, TableCell>, columns: readonly TableColumn[]): Record<string, TableCell> {
  const out: Record<string, TableCell> = {};
  for (const column of columns) {
    const cell = cells[column.id];
    if (cell && (cell.text || (cell.runs && cell.runs.length > 0))) {
      out[column.id] = cloneTableCell(cell);
    }
  }
  return out;
}

/** Deep clone preserving ids (snapshots, history). */
export function cloneTableData(data: TableData): TableData {
  return {
    columns: data.columns.map(column => ({ ...column })),
    rows: data.rows.map(row => ({
      id: row.id,
      ...(row.backgroundColor ? { backgroundColor: row.backgroundColor } : {}),
      cells: cloneCells(row.cells, data.columns),
    })),
  };
}

/** Deep clone with fresh row and column ids (copy, duplicate, paste). */
export function duplicateTableData(data: TableData): TableData {
  const columnMap = new Map<string, string>();
  const columns = data.columns.map(column => {
    const id = createId('tc');
    columnMap.set(column.id, id);
    return {
      ...column,
      id,
    };
  });
  const rows = data.rows.map(row => {
    const cells: Record<string, TableCell> = {};
    for (const [oldId, cell] of Object.entries(row.cells)) {
      const nextId = columnMap.get(oldId);
      if (nextId && (cell.text || (cell.runs && cell.runs.length > 0))) {
        cells[nextId] = cloneTableCell(cell);
      }
    }
    return {
      id: createId('tr'),
      ...(row.backgroundColor ? { backgroundColor: row.backgroundColor } : {}),
      cells,
    };
  });
  return { columns, rows };
}

export function setTableCellText(
  data: TableData,
  rowId: string,
  columnId: string,
  text: string
): TableData {
  const value = text.replace(/\r\n?/gu, '\n').slice(0, MAX_CELL_TEXT_LENGTH);
  const row = data.rows.find(item => item.id === rowId);
  if (!row) return data;
  const current = row.cells[columnId];
  const currentText = current?.text ?? '';
  if (currentText === value && !current?.runs) return data;
  return {
    ...data,
    rows: data.rows.map(item => {
      if (item.id !== rowId) return item;
      const cells = { ...item.cells };
      if (value) cells[columnId] = { text: value };
      else delete cells[columnId];
      return { ...item, cells };
    }),
  };
}

/** Set rich-text runs on a cell, maintaining `text` projection and omitting `runs` when plain. */
export function setTableCellRuns(
  data: TableData,
  rowId: string,
  columnId: string,
  runs: readonly InlineRun[]
): TableData {
  const row = data.rows.find(item => item.id === rowId);
  if (!row) return data;
  const normalized = clampRuns(runs);
  const text = plainText(normalized);
  const current = row.cells[columnId];
  if (!text) {
    if (!current) return data;
    return {
      ...data,
      rows: data.rows.map(item => {
        if (item.id !== rowId) return item;
        const cells = { ...item.cells };
        delete cells[columnId];
        return { ...item, cells };
      }),
    };
  }
  const rich = hasRichMarks(normalized);
  if (
    current &&
    current.text === text &&
    (rich ? Boolean(current.runs && runsEqual(current.runs, normalized)) : !current.runs)
  ) {
    return data;
  }
  const nextCell: TableCell = rich ? { text, runs: normalized } : { text };
  return {
    ...data,
    rows: data.rows.map(item => {
      if (item.id !== rowId) return item;
      return {
        ...item,
        cells: { ...item.cells, [columnId]: nextCell },
      };
    }),
  };
}

export function insertTableRow(
  data: TableData,
  afterRowId: string | null = null,
  position: 'before' | 'after' = 'after'
): { data: TableData; rowId: string } {
  if (data.rows.length >= MAX_TABLE_ROWS) return { data, rowId: '' };
  const row = createTableRow();
  const index = afterRowId ? data.rows.findIndex(item => item.id === afterRowId) : data.rows.length - 1;
  const at = index < 0 ? data.rows.length : position === 'before' ? index : index + 1;
  const rows = data.rows.slice();
  rows.splice(at, 0, row);
  return { data: { ...data, rows }, rowId: row.id };
}

export function deleteTableRow(data: TableData, rowId: string): TableData {
  if (data.rows.length <= 1) return data;
  return { ...data, rows: data.rows.filter(row => row.id !== rowId) };
}

export function insertTableColumn(
  data: TableData,
  afterColumnId: string | null = null,
  position: 'before' | 'after' = 'after'
): { data: TableData; columnId: string } {
  if (data.columns.length >= MAX_TABLE_COLUMNS) return { data, columnId: '' };
  const column = createTableColumn();
  const index = afterColumnId
    ? data.columns.findIndex(item => item.id === afterColumnId)
    : data.columns.length - 1;
  const at = index < 0 ? data.columns.length : position === 'before' ? index : index + 1;
  const columns = data.columns.slice();
  columns.splice(at, 0, column);
  return { data: { ...data, columns }, columnId: column.id };
}

export function deleteTableColumn(data: TableData, columnId: string): TableData {
  if (data.columns.length <= 1) return data;
  return {
    columns: data.columns.filter(column => column.id !== columnId),
    rows: data.rows.map(row => {
      const cells = { ...row.cells };
      delete cells[columnId];
      return { ...row, cells };
    }),
  };
}

export function setTableColumnWidth(data: TableData, columnId: string, width: number): TableData {
  const value = Math.max(60, Math.min(240, Math.round(width)));
  return {
    ...data,
    columns: data.columns.map(column =>
      column.id === columnId ? { ...column, width: value } : column
    ),
  };
}

export function tableToTsv(data: TableData): string {
  const rows = data.rows.map(row =>
    data.columns
      .map(column => tableCellText(row, column.id))
      .map(value => (/[\t\n\r"]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value))
      .join('\t')
  );
  return rows.join('\n');
}

export function duplicateTableRow(
  data: TableData,
  rowId: string
): { data: TableData; rowId: string } {
  if (data.rows.length >= MAX_TABLE_ROWS) return { data, rowId };
  const index = data.rows.findIndex(row => row.id === rowId);
  const source = data.rows[index];
  if (!source) return { data, rowId };
  const row: TableRow = {
    id: createId('tr'),
    ...(source.backgroundColor ? { backgroundColor: source.backgroundColor } : {}),
    cells: Object.fromEntries(
      Object.entries(source.cells).map(([columnId, cell]) => [columnId, cloneTableCell(cell)])
    ),
  };
  const rows = data.rows.slice();
  rows.splice(index + 1, 0, row);
  return { data: { ...data, rows }, rowId: row.id };
}

export function duplicateTableColumn(
  data: TableData,
  columnId: string
): { data: TableData; columnId: string } {
  if (data.columns.length >= MAX_TABLE_COLUMNS) return { data, columnId };
  const index = data.columns.findIndex(column => column.id === columnId);
  const source = data.columns[index];
  if (!source) return { data, columnId };
  const column: TableColumn = {
    ...(source.width !== undefined ? { width: source.width } : {}),
    ...(source.backgroundColor ? { backgroundColor: source.backgroundColor } : {}),
    id: createId('tc'),
  };
  const columns = data.columns.slice();
  columns.splice(index + 1, 0, column);
  return {
    data: {
      columns,
      rows: data.rows.map(row => {
        const cell = row.cells[source.id];
        if (!cell) return row;
        return {
          ...row,
          cells: { ...row.cells, [column.id]: cloneTableCell(cell) },
        };
      }),
    },
    columnId: column.id,
  };
}

export function moveTableRow(
  data: TableData,
  rowId: string,
  direction: 1 | -1
): TableData {
  const index = data.rows.findIndex(row => row.id === rowId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= data.rows.length) return data;
  const rows = data.rows.slice();
  const [row] = rows.splice(index, 1);
  if (!row) return data;
  rows.splice(target, 0, row);
  return { ...data, rows };
}

export function moveTableColumn(
  data: TableData,
  columnId: string,
  direction: 1 | -1
): TableData {
  const index = data.columns.findIndex(column => column.id === columnId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= data.columns.length) return data;
  const columns = data.columns.slice();
  const [column] = columns.splice(index, 1);
  if (!column) return data;
  columns.splice(target, 0, column);
  return { ...data, columns };
}

function moveItemTo<T extends { id: string }>(
  items: readonly T[],
  sourceId: string,
  targetId: string,
  position: 'before' | 'after'
): T[] | null {
  if (sourceId === targetId) return null;
  const sourceIndex = items.findIndex(item => item.id === sourceId);
  const targetIndex = items.findIndex(item => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return null;
  const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const insertIndex = position === 'before' ? adjustedTarget : adjustedTarget + 1;
  if (insertIndex === sourceIndex) return null;
  const next = items.slice();
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) return null;
  next.splice(insertIndex, 0, moved);
  return next;
}

/** Move a row immediately before or after `targetRowId` for drag reordering. */
export function moveTableRowTo(
  data: TableData,
  rowId: string,
  targetRowId: string,
  position: 'before' | 'after' = 'before'
): TableData {
  const rows = moveItemTo(data.rows, rowId, targetRowId, position);
  return rows ? { ...data, rows } : data;
}

/** Move a column immediately before or after `targetColumnId` for drag reordering. */
export function moveTableColumnTo(
  data: TableData,
  columnId: string,
  targetColumnId: string,
  position: 'before' | 'after' = 'before'
): TableData {
  const columns = moveItemTo(data.columns, columnId, targetColumnId, position);
  return columns ? { ...data, columns } : data;
}

export function clearTableRow(data: TableData, rowId: string): TableData {
  const row = data.rows.find(item => item.id === rowId);
  if (!row || Object.keys(row.cells).length === 0) return data;
  return {
    ...data,
    rows: data.rows.map(item => (item.id === rowId ? { ...item, cells: {} } : item)),
  };
}

export function clearTableColumn(data: TableData, columnId: string): TableData {
  let changed = false;
  const rows = data.rows.map(row => {
    if (!row.cells[columnId]) return row;
    changed = true;
    const cells = { ...row.cells };
    delete cells[columnId];
    return { ...row, cells };
  });
  return changed ? { ...data, rows } : data;
}

export function setTableRowColor(
  data: TableData,
  rowId: string,
  color: string | undefined
): TableData {
  return {
    ...data,
    rows: data.rows.map(row => {
      if (row.id !== rowId) return row;
      const next = { ...row };
      if (color) next.backgroundColor = color;
      else delete next.backgroundColor;
      return next;
    }),
  };
}

export function setTableColumnColor(
  data: TableData,
  columnId: string,
  color: string | undefined
): TableData {
  return {
    ...data,
    columns: data.columns.map(column => {
      if (column.id !== columnId) return column;
      const next = { ...column };
      if (color) next.backgroundColor = color;
      else delete next.backgroundColor;
      return next;
    }),
  };
}
