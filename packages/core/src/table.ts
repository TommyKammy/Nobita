import { createId } from './id.js';
import type { TableCell, TableColumn, TableData, TableRow } from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\r\n?/gu, '\n').slice(0, 10000) : '';

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
  const columnCount = Math.max(1, Math.min(100, Math.floor(options.columns ?? 3)));
  const rowCount = Math.max(1, Math.min(1000, Math.floor(options.rows ?? 3)));
  return {
    columns: Array.from({ length: columnCount }, () => createTableColumn()),
    rows: Array.from({ length: rowCount }, () => createTableRow()),
  };
}

function parseCell(value: unknown): TableCell | undefined {
  if (!isRecord(value)) return undefined;
  const text = asString(value.text);
  return text ? { text } : undefined;
}

/** Validate untrusted table props, filling ids and defaults. */
export function normalizeTableData(value: unknown): TableData {
  if (!isRecord(value)) return createTableData();
  const columnIds = new Set<string>();
  const columns: TableColumn[] = [];
  if (Array.isArray(value.columns)) {
    for (const item of value.columns.slice(0, 100)) {
      if (!isRecord(item)) continue;
      const rawId = typeof item.id === 'string' && item.id.length > 0 ? item.id : '';
      const id = rawId && !columnIds.has(rawId) ? rawId : createId('tc');
      columnIds.add(id);
      const width =
        typeof item.width === 'number' && Number.isFinite(item.width)
          ? Math.max(40, Math.min(2000, item.width))
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
    for (const item of value.rows.slice(0, 1000)) {
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
  return row?.cells[columnId]?.text ?? '';
}

function cloneCells(cells: Record<string, TableCell>, columns: readonly TableColumn[]): Record<string, TableCell> {
  const out: Record<string, TableCell> = {};
  for (const column of columns) {
    const cell = cells[column.id];
    if (cell?.text) out[column.id] = { text: cell.text };
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
      if (nextId && cell.text) cells[nextId] = { text: cell.text };
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
  const value = text.replace(/\r\n?/gu, '\n').slice(0, 10000);
  const row = data.rows.find(item => item.id === rowId);
  if (!row) return data;
  const current = row.cells[columnId]?.text ?? '';
  if (current === value) return data;
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

export function insertTableRow(
  data: TableData,
  afterRowId: string | null = null,
  position: 'before' | 'after' = 'after'
): { data: TableData; rowId: string } {
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
  const value = Math.max(40, Math.min(2000, Math.round(width)));
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
      .map(column => row.cells[column.id]?.text ?? '')
      .map(value => (/[\t\n\r"]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value))
      .join('\t')
  );
  return rows.join('\n');
}
