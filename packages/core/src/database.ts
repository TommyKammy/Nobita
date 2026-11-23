import { createId } from './id.js';
import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseData,
  DatabaseRow,
  DatabaseSort,
  DatabaseVariant,
} from './types.js';

export const DATABASE_COLUMN_TYPES: readonly DatabaseColumnType[] = [
  'text',
  'number',
  'select',
  'date',
  'checkbox',
  'url',
];

export const isDatabaseColumnType = (value: unknown): value is DatabaseColumnType =>
  typeof value === 'string' && (DATABASE_COLUMN_TYPES as readonly string[]).includes(value);

export function createDatabaseColumn(
  name: string,
  type: DatabaseColumnType = 'text',
  options: string[] = []
): DatabaseColumn {
  return {
    id: createId('c'),
    name,
    type,
    ...(type === 'select' ? { options: options.length > 0 ? options : ['Todo', 'In progress', 'Done'] } : {}),
  };
}

export function createDatabaseRow(cells: Record<string, DatabaseCell> = {}): DatabaseRow {
  return { id: createId('r'), cells };
}

export interface CreateDatabaseOptions {
  variant?: DatabaseVariant;
  columns?: DatabaseColumn[];
  rows?: DatabaseRow[];
}

/** A ready-to-edit data view. Tables use plain text columns; databases use properties. */
export function createDatabaseData(options: CreateDatabaseOptions = {}): DatabaseData {
  const variant = options.variant ?? 'database';
  if (options.columns && options.columns.length > 0) {
    return {
      variant,
      columns: options.columns,
      rows: options.rows ?? [createDatabaseRow(), createDatabaseRow()],
    };
  }
  if (variant === 'table') {
    return {
      variant,
      columns: [
        createDatabaseColumn('Column 1'),
        createDatabaseColumn('Column 2'),
        createDatabaseColumn('Column 3'),
      ],
      rows: [createDatabaseRow(), createDatabaseRow(), createDatabaseRow()],
    };
  }
  return {
    variant,
    columns: [
      createDatabaseColumn('Name'),
      createDatabaseColumn('Status', 'select', ['Todo', 'In progress', 'Done']),
      createDatabaseColumn('Due', 'date'),
      createDatabaseColumn('Done', 'checkbox'),
    ],
    rows: [createDatabaseRow(), createDatabaseRow()],
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseCell(value: unknown): DatabaseCell {
  if (!isRecord(value)) return {};
  const text = typeof value.text === 'string' ? value.text.replace(/\r\n?/gu, '\n') : '';
  const checked = value.checked === true;
  return {
    ...(text ? { text } : {}),
    ...(checked ? { checked: true } : {}),
  };
}

function parseColumn(value: unknown, index: number, seen: Set<string>): DatabaseColumn | null {
  if (!isRecord(value)) return null;
  let id = typeof value.id === 'string' && value.id.length > 0 ? value.id : '';
  if (!id || seen.has(id)) id = createId('c');
  seen.add(id);
  const name =
    typeof value.name === 'string' && value.name.trim().length > 0
      ? value.name.slice(0, 120)
      : `Column ${index + 1}`;
  const type = isDatabaseColumnType(value.type) ? value.type : 'text';
  const options =
    type === 'select' && Array.isArray(value.options)
      ? Array.from(
          new Set(
            value.options
              .filter((option): option is string => typeof option === 'string')
              .map(option => option.trim())
              .filter(Boolean)
          )
        ).slice(0, 100)
      : undefined;
  return { id, name, type, ...(options && options.length > 0 ? { options } : {}) };
}

function parseRow(
  value: unknown,
  columns: readonly DatabaseColumn[],
  seen: Set<string>
): DatabaseRow | null {
  if (!isRecord(value)) return null;
  let id = typeof value.id === 'string' && value.id.length > 0 ? value.id : '';
  if (!id || seen.has(id)) id = createId('r');
  seen.add(id);
  const cells: Record<string, DatabaseCell> = {};
  const rawCells = isRecord(value.cells) ? value.cells : {};
  for (const column of columns) {
    const cell = parseCell(rawCells[column.id]);
    if (Object.keys(cell).length > 0) cells[column.id] = cell;
  }
  return { id, cells };
}

function parseSort(value: unknown, columns: readonly DatabaseColumn[]): DatabaseSort | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.columnId !== 'string' || !columns.some(column => column.id === value.columnId)) {
    return undefined;
  }
  return {
    columnId: value.columnId,
    direction: value.direction === 'desc' ? 'desc' : 'asc',
  };
}

/** Validate untrusted database props, filling ids and defaults. */
export function normalizeDatabaseData(value: unknown, fallbackVariant: DatabaseVariant = 'database'): DatabaseData {
  if (!isRecord(value)) return createDatabaseData({ variant: fallbackVariant });
  const variant: DatabaseVariant = value.variant === 'table' ? 'table' : value.variant === 'database' ? 'database' : fallbackVariant;
  const columnIds = new Set<string>();
  const columns: DatabaseColumn[] = [];
  if (Array.isArray(value.columns)) {
    value.columns.forEach((column, index) => {
      const parsed = parseColumn(column, index, columnIds);
      if (parsed) columns.push(parsed);
    });
  }
  if (columns.length === 0) {
    columns.push(createDatabaseColumn('Column 1'));
  }
  const rowIds = new Set<string>();
  const rows: DatabaseRow[] = [];
  if (Array.isArray(value.rows)) {
    for (const row of value.rows) {
      const parsed = parseRow(row, columns, rowIds);
      if (parsed) rows.push(parsed);
    }
  }
  const sort = parseSort(value.sort, columns);
  return {
    variant,
    columns,
    rows,
    ...(sort ? { sort } : {}),
  };
}

/** Deep clone preserving ids (used by cloneDoc and snapshots). */
export function cloneDatabaseData(data: DatabaseData): DatabaseData {
  return {
    variant: data.variant,
    columns: data.columns.map(column => ({
      ...column,
      ...(column.options ? { options: [...column.options] } : {}),
    })),
    rows: data.rows.map(row => ({
      id: row.id,
      cells: Object.fromEntries(
        Object.entries(row.cells).map(([key, cell]) => [key, { ...cell }])
      ),
    })),
    ...(data.sort ? { sort: { ...data.sort } } : {}),
  };
}

/** Deep clone with fresh row and column ids (copy, duplicate, paste). */
export function duplicateDatabaseData(data: DatabaseData): DatabaseData {
  const columnMap = new Map<string, string>();
  const columns = data.columns.map(column => {
    const id = createId('c');
    columnMap.set(column.id, id);
    return {
      ...column,
      id,
      ...(column.options ? { options: [...column.options] } : {}),
    };
  });
  const rows = data.rows.map(row => {
    const cells: Record<string, DatabaseCell> = {};
    for (const [oldId, cell] of Object.entries(row.cells)) {
      const nextId = columnMap.get(oldId);
      if (nextId) cells[nextId] = { ...cell };
    }
    return { id: createId('r'), cells };
  });
  return {
    variant: data.variant,
    columns,
    rows,
    ...(data.sort && columnMap.has(data.sort.columnId)
      ? { sort: { columnId: columnMap.get(data.sort.columnId) as string, direction: data.sort.direction } }
      : {}),
  };
}

export function databaseCellText(cell: DatabaseCell | undefined, type: DatabaseColumnType): string {
  if (!cell) return '';
  if (type === 'checkbox') return cell.checked ? 'true' : '';
  return cell.text ?? '';
}

export function databaseCellDisplay(cell: DatabaseCell | undefined, type: DatabaseColumnType): string {
  if (!cell) return '';
  if (type === 'checkbox') return cell.checked ? '✓' : '';
  return cell.text ?? '';
}

function comparable(value: string, type: DatabaseColumnType): string | number {
  if (type === 'number') {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : Number.NaN;
  }
  if (type === 'date') {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : Number.NaN;
  }
  return value.toLocaleLowerCase();
}

/** Rows in display order, applying the saved sort if any. */
export function sortedDatabaseRows(data: DatabaseData): DatabaseRow[] {
  const sort = data.sort;
  if (!sort) return data.rows;
  const column = data.columns.find(item => item.id === sort.columnId);
  if (!column) return data.rows;
  const direction = sort.direction === 'desc' ? -1 : 1;
  return data.rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = databaseCellText(a.row.cells[column.id], column.type);
      const right = databaseCellText(b.row.cells[column.id], column.type);
      if (!left && !right) return a.index - b.index;
      if (!left) return 1;
      if (!right) return -1;
      let result = 0;
      if (column.type === 'checkbox') {
        const l = a.row.cells[column.id]?.checked ? 1 : 0;
        const r = b.row.cells[column.id]?.checked ? 1 : 0;
        result = l - r;
      } else {
        const l = comparable(left, column.type);
        const r = comparable(right, column.type);
        if (typeof l === 'number' && typeof r === 'number') {
          if (Number.isNaN(l) && Number.isNaN(r)) result = 0;
          else if (Number.isNaN(l)) result = 1;
          else if (Number.isNaN(r)) result = -1;
          else result = l - r;
        } else {
          result = String(l).localeCompare(String(r), undefined, { numeric: true, sensitivity: 'base' });
        }
      }
      return result === 0 ? a.index - b.index : result * direction;
    })
    .map(entry => entry.row);
}

export function databaseRowNumber(data: DatabaseData, rowId: string): number {
  return sortedDatabaseRows(data).findIndex(row => row.id === rowId) + 1;
}
