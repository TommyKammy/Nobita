import { createId } from './id.js';
import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseData,
  DatabaseFile,
  DatabaseFilter,
  DatabaseFilterOperator,
  DatabasePerson,
  DatabaseRow,
  DatabaseSort,
  DatabaseVariant,
  DatabaseView,
} from './types.js';
import { safeHref, safeImageSrc } from './url.js';

export const DATABASE_COLUMN_TYPES: readonly DatabaseColumnType[] = [
  'text',
  'number',
  'select',
  'multi-select',
  'date',
  'checkbox',
  'url',
  'files',
  'people',
];

export const isDatabaseColumnType = (value: unknown): value is DatabaseColumnType =>
  typeof value === 'string' && (DATABASE_COLUMN_TYPES as readonly string[]).includes(value);

export const DATABASE_FILTER_OPERATORS: readonly DatabaseFilterOperator[] = [
  'contains',
  'is',
  'isNot',
  'isEmpty',
  'isNotEmpty',
];

export function createDatabaseColumn(
  name: string,
  type: DatabaseColumnType = 'text',
  options: string[] = []
): DatabaseColumn {
  return {
    id: createId('c'),
    name,
    type,
    ...((type === 'select' || type === 'multi-select')
      ? { options: options.length > 0 ? options : ['Todo', 'In progress', 'Done'] }
      : {}),
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

function parseStringList(value: unknown, limit = 100): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean)
    )
  ).slice(0, limit);
  return values.length > 0 ? values : undefined;
}

function parseFiles(value: unknown): DatabaseFile[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const files: DatabaseFile[] = [];
  for (const item of value.slice(0, 50)) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 200) : '';
    const url = typeof item.url === 'string' ? safeHref(item.url) : null;
    if (!name || !url) continue;
    const file: DatabaseFile = { name, url };
    if (typeof item.id === 'string' && item.id) file.id = item.id.slice(0, 120);
    if (typeof item.mime === 'string' && item.mime) file.mime = item.mime.slice(0, 120);
    if (typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0) {
      file.size = item.size;
    }
    files.push(file);
  }
  return files.length > 0 ? files : undefined;
}

function parsePeople(value: unknown): DatabasePerson[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const people: DatabasePerson[] = [];
  for (const item of value.slice(0, 100)) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id.trim().slice(0, 200) : '';
    const label = typeof item.label === 'string' ? item.label.trim().slice(0, 120) : '';
    if (!id || !label) continue;
    const person: DatabasePerson = { id, label };
    if (typeof item.avatarUrl === 'string') {
      const avatarUrl = safeImageSrc(item.avatarUrl);
      if (avatarUrl) person.avatarUrl = avatarUrl;
    }
    people.push(person);
  }
  return people.length > 0 ? people : undefined;
}

function parseCell(value: unknown): DatabaseCell {
  if (!isRecord(value)) return {};
  const text = typeof value.text === 'string' ? value.text.replace(/\r\n?/gu, '\n') : '';
  const checked = value.checked === true;
  const values = parseStringList(value.values);
  const files = parseFiles(value.files);
  const people = parsePeople(value.people);
  return {
    ...(text ? { text } : {}),
    ...(checked ? { checked: true } : {}),
    ...(values ? { values } : {}),
    ...(files ? { files } : {}),
    ...(people ? { people } : {}),
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
    (type === 'select' || type === 'multi-select') && Array.isArray(value.options)
      ? parseStringList(value.options)
      : undefined;
  const width =
    typeof value.width === 'number' && Number.isFinite(value.width)
      ? Math.min(800, Math.max(80, Math.round(value.width)))
      : undefined;
  return {
    id,
    name,
    type,
    ...(options ? { options } : {}),
    ...(width ? { width } : {}),
  };
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

function parseFilter(
  value: unknown,
  columns: readonly DatabaseColumn[]
): DatabaseFilter | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.columnId !== 'string' || !columns.some(column => column.id === value.columnId)) {
    return undefined;
  }
  if (
    typeof value.operator !== 'string' ||
    !(DATABASE_FILTER_OPERATORS as readonly string[]).includes(value.operator)
  ) {
    return undefined;
  }
  const filter: DatabaseFilter = {
    columnId: value.columnId,
    operator: value.operator as DatabaseFilterOperator,
  };
  if (typeof value.value === 'string') filter.value = value.value.slice(0, 300);
  return filter;
}

function parseView(
  value: unknown,
  columns: readonly DatabaseColumn[]
): DatabaseView | undefined {
  if (!isRecord(value)) return undefined;
  const type = value.type === 'board' ? 'board' : 'table';
  const filters = Array.isArray(value.filters)
    ? value.filters
        .map(filter => parseFilter(filter, columns))
        .filter((filter): filter is DatabaseFilter => Boolean(filter))
        .slice(0, 30)
    : [];
  const groupBy =
    typeof value.groupBy === 'string' && columns.some(column => column.id === value.groupBy)
      ? value.groupBy
      : undefined;
  const sort = parseSort(value.sort, columns);
  return {
    type,
    filters,
    ...(groupBy ? { groupBy } : {}),
    ...(sort ? { sort } : {}),
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
  const view = parseView(value.view, columns);
  return {
    variant,
    columns,
    rows,
    ...(sort ? { sort } : {}),
    ...(view ? { view } : {}),
  };
}

function cloneCell(cell: DatabaseCell): DatabaseCell {
  return {
    ...cell,
    ...(cell.values ? { values: [...cell.values] } : {}),
    ...(cell.files ? { files: cell.files.map(file => ({ ...file })) } : {}),
    ...(cell.people ? { people: cell.people.map(person => ({ ...person })) } : {}),
  };
}

function cloneView(view: DatabaseView): DatabaseView {
  return {
    type: view.type,
    filters: view.filters.map(filter => ({ ...filter })),
    ...(view.groupBy ? { groupBy: view.groupBy } : {}),
    ...(view.sort ? { sort: { ...view.sort } } : {}),
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
        Object.entries(row.cells).map(([key, cell]) => [key, cloneCell(cell)])
      ),
    })),
    ...(data.sort ? { sort: { ...data.sort } } : {}),
    ...(data.view ? { view: cloneView(data.view) } : {}),
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
      if (nextId) cells[nextId] = cloneCell(cell);
    }
    return { id: createId('r'), cells };
  });
  const groupBy = data.view?.groupBy
    ? columnMap.get(data.view.groupBy)
    : undefined;
  const view = data.view
    ? {
        type: data.view.type,
        filters: data.view.filters.flatMap(filter => {
          const columnId = columnMap.get(filter.columnId);
          return columnId ? [{ ...filter, columnId }] : [];
        }),
        ...(groupBy ? { groupBy } : {}),
        ...(data.view.sort && columnMap.has(data.view.sort.columnId)
          ? {
              sort: {
                columnId: columnMap.get(data.view.sort.columnId) as string,
                direction: data.view.sort.direction,
              },
            }
          : {}),
      }
    : undefined;
  return {
    variant: data.variant,
    columns,
    rows,
    ...(data.sort && columnMap.has(data.sort.columnId)
      ? { sort: { columnId: columnMap.get(data.sort.columnId) as string, direction: data.sort.direction } }
      : {}),
    ...(view ? { view } : {}),
  };
}

export function databaseCellText(cell: DatabaseCell | undefined, type: DatabaseColumnType): string {
  if (!cell) return '';
  if (type === 'checkbox') return cell.checked ? 'true' : '';
  if (type === 'multi-select') return (cell.values ?? []).join(', ');
  if (type === 'files') return (cell.files ?? []).map(file => file.name).join(', ');
  if (type === 'people') return (cell.people ?? []).map(person => person.label).join(', ');
  return cell.text ?? '';
}

export function databaseCellDisplay(cell: DatabaseCell | undefined, type: DatabaseColumnType): string {
  if (!cell) return '';
  if (type === 'checkbox') return cell.checked ? '✓' : '';
  if (type === 'multi-select') return (cell.values ?? []).join(' · ');
  if (type === 'files') return (cell.files ?? []).map(file => file.name).join(' · ');
  if (type === 'people') return (cell.people ?? []).map(person => person.label).join(' · ');
  return cell.text ?? '';
}

function filterText(cell: DatabaseCell | undefined, column: DatabaseColumn): string {
  if (column.type === 'checkbox') return cell?.checked ? 'true' : 'false';
  return databaseCellText(cell, column.type);
}

function matchesFilter(
  row: DatabaseRow,
  column: DatabaseColumn,
  filter: DatabaseFilter
): boolean {
  const current = filterText(row.cells[column.id], column).trim().toLocaleLowerCase();
  const expected = (filter.value ?? '').trim().toLocaleLowerCase();
  switch (filter.operator) {
    case 'contains':
      return expected === '' || current.includes(expected);
    case 'is':
      return current === expected;
    case 'isNot':
      return current !== expected;
    case 'isEmpty':
      return current === '' || (column.type === 'checkbox' && current === 'false');
    case 'isNotEmpty':
      return !(current === '' || (column.type === 'checkbox' && current === 'false'));
    default:
      return true;
  }
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

function sortRows(
  rows: readonly DatabaseRow[],
  columns: readonly DatabaseColumn[],
  sort: DatabaseSort | null | undefined
): DatabaseRow[] {
  if (!sort) return [...rows];
  const column = columns.find(item => item.id === sort.columnId);
  if (!column) return [...rows];
  const direction = sort.direction === 'desc' ? -1 : 1;
  return rows
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
          result = String(l).localeCompare(String(r), undefined, {
            numeric: true,
            sensitivity: 'base',
          });
        }
      }
      return result === 0 ? a.index - b.index : result * direction;
    })
    .map(entry => entry.row);
}

/** Saved view, or a table view derived from the legacy fields. */
export function databaseView(data: DatabaseData): DatabaseView {
  return data.view ?? {
    type: 'table',
    filters: [],
    ...(data.sort ? { sort: data.sort } : {}),
  };
}

/** Rows in display order, applying the saved view sort or legacy sort. */
export function sortedDatabaseRows(data: DatabaseData): DatabaseRow[] {
  return sortRows(
    data.rows,
    data.columns,
    data.view ? data.view.sort : data.sort
  );
}

/** Rows after filters and sorting for a view. */
export function filteredDatabaseRows(
  data: DatabaseData,
  view: DatabaseView = databaseView(data)
): DatabaseRow[] {
  const filters = view.filters ?? [];
  const rows = data.rows.filter(row =>
    filters.every(filter => {
      const column = data.columns.find(item => item.id === filter.columnId);
      return !column || matchesFilter(row, column, filter);
    })
  );
  return sortRows(rows, data.columns, view.sort);
}

export interface DatabaseGroup {
  key: string;
  label: string;
  rows: DatabaseRow[];
}

/** Group filtered rows for a board or grouped view. */
export function groupedDatabaseRows(
  data: DatabaseData,
  view: DatabaseView = databaseView(data)
): DatabaseGroup[] {
  const rows = filteredDatabaseRows(data, view);
  const column = view.groupBy
    ? data.columns.find(item => item.id === view.groupBy)
    : undefined;
  if (!column) return [{ key: 'all', label: 'All rows', rows }];

  if (column.type === 'checkbox') {
    return [
      {
        key: 'true',
        label: 'Checked',
        rows: rows.filter(row => row.cells[column.id]?.checked === true),
      },
      {
        key: 'false',
        label: 'Unchecked',
        rows: rows.filter(row => row.cells[column.id]?.checked !== true),
      },
    ];
  }

  if (column.type === 'select' || column.type === 'multi-select') {
    const options = [...(column.options ?? [])];
    const values = new Set(options);
    for (const row of rows) {
      const cell = row.cells[column.id];
      const rowValues =
        column.type === 'multi-select'
          ? cell?.values ?? []
          : cell?.text
            ? [cell.text]
            : [];
      for (const value of rowValues) values.add(value);
    }
    const ordered = [...options, ...[...values].filter(value => !options.includes(value)).sort()];
    const groups: DatabaseGroup[] = ordered.map(value => ({
      key: value,
      label: value,
      rows: rows.filter(row => {
        const cell = row.cells[column.id];
        if (column.type === 'multi-select') return (cell?.values ?? []).includes(value);
        return cell?.text === value;
      }),
    }));
    const empty = rows.filter(row => {
      const cell = row.cells[column.id];
      return column.type === 'multi-select'
        ? !(cell?.values?.length)
        : !cell?.text;
    });
    if (empty.length > 0) groups.push({ key: '', label: 'No value', rows: empty });
    return groups;
  }

  const values = new Map<string, DatabaseRow[]>();
  for (const row of rows) {
    const value = databaseCellDisplay(row.cells[column.id], column.type);
    const group = values.get(value) ?? [];
    group.push(row);
    values.set(value, group);
  }
  return [...values.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([key, groupRows]) => ({
      key,
      label: key || 'No value',
      rows: groupRows,
    }));
}

export function databaseRowNumber(data: DatabaseData, rowId: string): number {
  return sortedDatabaseRows(data).findIndex(row => row.id === rowId) + 1;
}
