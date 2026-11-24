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
  DatabaseStatType,
  DatabaseVariant,
  DatabaseView,
  DatabaseViewType,
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
  'doesNotContain',
  'startsWith',
  'endsWith',
  'is',
  'isNot',
  'isEmpty',
  'isNotEmpty',
  'equal',
  'notEqual',
  'greaterThan',
  'lessThan',
  'greaterThanOrEqual',
  'lessThanOrEqual',
  'before',
  'after',
  'isChecked',
  'isUnchecked',
  'isAnyOf',
  'isNoneOf',
  'containsAny',
  'containsAll',
  'doesNotContainAny',
  'doesNotContainAll',
];

export const DATABASE_STAT_TYPES: readonly DatabaseStatType[] = [
  'count',
  'countValues',
  'sum',
  'average',
  'median',
  'min',
  'max',
];

export const DATABASE_STAT_LABELS: Record<DatabaseStatType, string> = {
  count: 'Count all',
  countValues: 'Count values',
  sum: 'Sum',
  average: 'Average',
  median: 'Median',
  min: 'Min',
  max: 'Max',
};

export function createDatabaseView(
  type: DatabaseViewType = 'table',
  name?: string
): DatabaseView & { id: string; name: string } {
  return {
    id: createId('v'),
    name: name ?? (type === 'board' ? 'Board' : 'Table'),
    type,
    filters: [],
  };
}

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

/** A ready-to-edit typed database. The `table` variant is kept for legacy documents. */
export function createDatabaseData(options: CreateDatabaseOptions = {}): DatabaseData {
  const variant = options.variant ?? 'database';
  if (options.columns && options.columns.length > 0) {
    const columns = options.columns;
    const rows = options.rows ?? [createDatabaseRow(), createDatabaseRow()];
    return withDefaultView({ variant, columns, rows });
  }
  if (variant === 'table') {
    return withDefaultView({
      variant,
      columns: [
        createDatabaseColumn('Column 1'),
        createDatabaseColumn('Column 2'),
        createDatabaseColumn('Column 3'),
      ],
      rows: [createDatabaseRow(), createDatabaseRow(), createDatabaseRow()],
    });
  }
  return withDefaultView({
    variant,
    columns: [
      createDatabaseColumn('Name'),
      createDatabaseColumn('Status', 'select', ['Todo', 'In progress', 'Done']),
      createDatabaseColumn('Due', 'date'),
      createDatabaseColumn('Done', 'checkbox'),
    ],
    rows: [createDatabaseRow(), createDatabaseRow()],
  });
}

function withDefaultView(data: Omit<DatabaseData, 'views' | 'activeViewId'>): DatabaseData {
  const view = createDatabaseView('table');
  return { ...data, views: [view], activeViewId: view.id };
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

function parseSorts(value: unknown, columns: readonly DatabaseColumn[]): DatabaseSort[] {
  if (!Array.isArray(value)) return [];
  const sorts: DatabaseSort[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 8)) {
    const sort = parseSort(item, columns);
    if (!sort || seen.has(sort.columnId)) continue;
    seen.add(sort.columnId);
    sorts.push(sort);
  }
  return sorts;
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
  const sorts = parseSorts(value.sorts, columns);
  const hiddenColumns = Array.isArray(value.hiddenColumns)
    ? [...new Set(value.hiddenColumns.filter((id): id is string => typeof id === 'string'))]
        .filter(id => columns.some(column => column.id === id))
        .slice(0, columns.length)
    : [];
  const stats: Record<string, DatabaseStatType> = {};
  if (isRecord(value.stats)) {
    for (const [columnId, stat] of Object.entries(value.stats)) {
      if (
        columns.some(column => column.id === columnId) &&
        typeof stat === 'string' &&
        (DATABASE_STAT_TYPES as readonly string[]).includes(stat)
      ) {
        stats[columnId] = stat as DatabaseStatType;
      }
    }
  }
  return {
    id:
      typeof value.id === 'string' && value.id.length > 0 ? value.id : createId('v'),
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim().slice(0, 120)
        : type === 'board'
          ? 'Board'
          : 'Table',
    type,
    filters,
    ...(value.filterMode === 'or' ? { filterMode: 'or' as const } : {}),
    ...(groupBy ? { groupBy } : {}),
    ...(sorts.length > 0 ? { sorts } : {}),
    ...(sort ? { sort } : {}),
    ...(hiddenColumns.length > 0 ? { hiddenColumns } : {}),
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
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
  const views: DatabaseView[] = [];
  if (Array.isArray(value.views)) {
    const seen = new Set<string>();
    for (const item of value.views.slice(0, 20)) {
      const parsed = parseView(item, columns);
      if (!parsed?.id || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      views.push(parsed);
    }
  }
  const activeViewId =
    typeof value.activeViewId === 'string' &&
    views.some(item => item.id === value.activeViewId)
      ? value.activeViewId
      : views[0]?.id;
  return {
    variant,
    columns,
    rows,
    ...(sort ? { sort } : {}),
    ...(view ? { view } : {}),
    ...(views.length > 0 ? { views } : {}),
    ...(activeViewId ? { activeViewId } : {}),
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
    ...(view.id ? { id: view.id } : {}),
    ...(view.name ? { name: view.name } : {}),
    type: view.type,
    filters: view.filters.map(filter => ({ ...filter })),
    ...(view.filterMode ? { filterMode: view.filterMode } : {}),
    ...(view.groupBy ? { groupBy: view.groupBy } : {}),
    ...(view.sorts ? { sorts: view.sorts.map(sort => ({ ...sort })) } : {}),
    ...(view.sort ? { sort: { ...view.sort } } : {}),
    ...(view.hiddenColumns ? { hiddenColumns: [...view.hiddenColumns] } : {}),
    ...(view.stats ? { stats: { ...view.stats } } : {}),
  };
}

function remapView(
  view: DatabaseView,
  columnMap: ReadonlyMap<string, string>,
  id?: string
): DatabaseView {
  const filters = view.filters.flatMap(filter => {
    const columnId = columnMap.get(filter.columnId);
    return columnId ? [{ ...filter, columnId }] : [];
  });
  const groupBy = view.groupBy ? columnMap.get(view.groupBy) : undefined;
  const sorts = (view.sorts ?? (view.sort ? [view.sort] : [])).flatMap(sort => {
    const columnId = columnMap.get(sort.columnId);
    return columnId ? [{ ...sort, columnId }] : [];
  });
  const hiddenColumns = (view.hiddenColumns ?? []).flatMap(columnId => {
    const nextId = columnMap.get(columnId);
    return nextId ? [nextId] : [];
  });
  const stats: Record<string, DatabaseStatType> = {};
  for (const [columnId, stat] of Object.entries(view.stats ?? {})) {
    const nextId = columnMap.get(columnId);
    if (nextId) stats[nextId] = stat;
  }
  return {
    ...(id ? { id } : view.id ? { id: view.id } : {}),
    ...(view.name ? { name: view.name } : {}),
    type: view.type,
    filters,
    ...(view.filterMode ? { filterMode: view.filterMode } : {}),
    ...(groupBy ? { groupBy } : {}),
    ...(sorts.length > 0 ? { sorts } : {}),
    ...(hiddenColumns.length > 0 ? { hiddenColumns } : {}),
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
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
    ...(data.views ? { views: data.views.map(cloneView) } : {}),
    ...(data.activeViewId ? { activeViewId: data.activeViewId } : {}),
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
  const view = data.view ? remapView(data.view, columnMap) : undefined;
  const viewIdMap = new Map<string, string>();
  const views = data.views?.map(item => {
    const id = createId('v');
    if (item.id) viewIdMap.set(item.id, id);
    return remapView(item, columnMap, id);
  });
  const activeViewId = data.activeViewId
    ? viewIdMap.get(data.activeViewId)
    : views?.[0]?.id;
  return {
    variant: data.variant,
    columns,
    rows,
    ...(data.sort && columnMap.has(data.sort.columnId)
      ? { sort: { columnId: columnMap.get(data.sort.columnId) as string, direction: data.sort.direction } }
      : {}),
    ...(view ? { view } : {}),
    ...(views && views.length > 0 ? { views } : {}),
    ...(activeViewId ? { activeViewId } : {}),
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
  sorts: readonly DatabaseSort[]
): DatabaseRow[] {
  if (sorts.length === 0) return [...rows];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const sort of sorts) {
        const column = columns.find(item => item.id === sort.columnId);
        if (!column) continue;
        const left = databaseCellText(a.row.cells[column.id], column.type);
        const right = databaseCellText(b.row.cells[column.id], column.type);
        if (!left && !right) continue;
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
        if (result !== 0) return sort.direction === 'desc' ? -result : result;
      }
      return a.index - b.index;
    })
    .map(entry => entry.row);
}

export function databaseSorts(view: DatabaseView): DatabaseSort[] {
  if (view.sorts && view.sorts.length > 0) return view.sorts;
  return view.sort ? [view.sort] : [];
}

export function databaseViews(data: DatabaseData): DatabaseView[] {
  if (data.views && data.views.length > 0) return data.views;
  if (data.view) return [data.view];
  return [
    {
      id: 'view-default',
      name: 'Table',
      type: 'table',
      filters: [],
      ...(data.sort ? { sort: data.sort } : {}),
    },
  ];
}

/** Saved active view, or a table view derived from the legacy fields. */
export function databaseView(data: DatabaseData): DatabaseView {
  const views = databaseViews(data);
  return views.find(view => view.id === data.activeViewId) ?? views[0]!;
}

function effectiveSorts(data: DatabaseData, view: DatabaseView): DatabaseSort[] {
  const sorts = databaseSorts(view);
  return sorts.length > 0 ? sorts : data.sort ? [data.sort] : [];
}

/** Rows in display order, applying the saved view sort or legacy sort. */
export function sortedDatabaseRows(data: DatabaseData): DatabaseRow[] {
  return sortRows(data.rows, data.columns, effectiveSorts(data, databaseView(data)));
}

function isEmptyCell(cell: DatabaseCell | undefined, column: DatabaseColumn): boolean {
  if (!cell) return true;
  if (column.type === 'checkbox') return cell.checked !== true;
  if (column.type === 'multi-select') return !cell.values?.length;
  if (column.type === 'files') return !cell.files?.length;
  if (column.type === 'people') return !cell.people?.length;
  return !cell.text;
}

function filterValues(filter: DatabaseFilter): string[] {
  return (filter.value ?? '')
    .split(/[\n,]/u)
    .map(value => value.trim())
    .filter(Boolean);
}

function matchesFilter(
  row: DatabaseRow,
  column: DatabaseColumn,
  filter: DatabaseFilter
): boolean {
  if (filter.operator === 'isEmpty') return isEmptyCell(row.cells[column.id], column);
  if (filter.operator === 'isNotEmpty') return !isEmptyCell(row.cells[column.id], column);

  const cell = row.cells[column.id];
  const current = databaseCellText(cell, column.type).trim();
  const expected = (filter.value ?? '').trim();
  const currentLower = current.toLocaleLowerCase();
  const expectedLower = expected.toLocaleLowerCase();
  const expectedValues = filterValues(filter).map(value => value.toLocaleLowerCase());

  switch (column.type) {
    case 'checkbox': {
      const checked = cell?.checked === true;
      if (filter.operator === 'isChecked') return checked;
      if (filter.operator === 'isUnchecked') return !checked;
      if (filter.operator === 'is') {
        return checked === (expected === '' || expectedLower === 'true');
      }
      if (filter.operator === 'isNot') {
        return checked !== (expected === '' || expectedLower === 'true');
      }
      return true;
    }
    case 'number': {
      const left = Number.parseFloat(current);
      const right = Number.parseFloat(expected);
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return filter.operator === 'notEqual' ? true : false;
      }
      switch (filter.operator) {
        case 'equal':
          return left === right;
        case 'notEqual':
          return left !== right;
        case 'greaterThan':
          return left > right;
        case 'lessThan':
          return left < right;
        case 'greaterThanOrEqual':
          return left >= right;
        case 'lessThanOrEqual':
          return left <= right;
        default:
          break;
      }
      break;
    }
    case 'date': {
      const left = Date.parse(current);
      const right = Date.parse(expected);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      if (filter.operator === 'before') return left < right;
      if (filter.operator === 'after') return left > right;
      break;
    }
    case 'select': {
      if (filter.operator === 'isAnyOf') return expectedValues.includes(currentLower);
      if (filter.operator === 'isNoneOf') return !expectedValues.includes(currentLower);
      break;
    }
    case 'multi-select': {
      const values = (cell?.values ?? []).map(value => value.toLocaleLowerCase());
      if (filter.operator === 'containsAny') {
        return expectedValues.length === 0 || expectedValues.some(value => values.includes(value));
      }
      if (filter.operator === 'containsAll') {
        return expectedValues.length === 0 || expectedValues.every(value => values.includes(value));
      }
      if (filter.operator === 'doesNotContainAny') {
        return expectedValues.length === 0 || expectedValues.every(value => !values.includes(value));
      }
      if (filter.operator === 'doesNotContainAll') {
        return expectedValues.length === 0 || !expectedValues.every(value => values.includes(value));
      }
      break;
    }
    default:
      break;
  }

  switch (filter.operator) {
    case 'contains':
      return expectedLower === '' || currentLower.includes(expectedLower);
    case 'doesNotContain':
      return expectedLower !== '' && !currentLower.includes(expectedLower);
    case 'startsWith':
      return currentLower.startsWith(expectedLower);
    case 'endsWith':
      return currentLower.endsWith(expectedLower);
    case 'is':
      return currentLower === expectedLower;
    case 'isNot':
      return currentLower !== expectedLower;
    default:
      return true;
  }
}

/** Rows after filters and sorting for a view. */
export function filteredDatabaseRows(
  data: DatabaseData,
  view: DatabaseView = databaseView(data)
): DatabaseRow[] {
  const filters = view.filters ?? [];
  const rows =
    filters.length === 0
      ? [...data.rows]
      : data.rows.filter(row => {
          const matches = filters.map(filter => {
            const column = data.columns.find(item => item.id === filter.columnId);
            return !column || matchesFilter(row, column, filter);
          });
          return view.filterMode === 'or' ? matches.some(Boolean) : matches.every(Boolean);
        });
  return sortRows(rows, data.columns, effectiveSorts(data, view));
}

/** Transient search across every cell in the given rows. */
export function searchDatabaseRows(
  data: DatabaseData,
  rows: readonly DatabaseRow[],
  query: string
): DatabaseRow[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...rows];
  return rows.filter(row =>
    data.columns.some(column =>
      databaseCellDisplay(row.cells[column.id], column.type)
        .toLocaleLowerCase()
        .includes(needle)
    )
  );
}

function formatStatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Display value for a table footer statistic. */
export function databaseStatValue(
  rows: readonly DatabaseRow[],
  column: DatabaseColumn,
  type: DatabaseStatType | undefined
): string {
  if (!type) return '';
  if (type === 'count') return String(rows.length);
  const values = rows
    .map(row => databaseCellText(row.cells[column.id], column.type).trim())
    .filter(Boolean);
  if (type === 'countValues') return String(values.length);
  const numbers = values
    .map(value => Number.parseFloat(value))
    .filter(value => Number.isFinite(value));
  if (type !== 'sum' && type !== 'average' && type !== 'median' && type !== 'min' && type !== 'max') {
    return '';
  }
  if (numbers.length === 0) return '';
  if (type === 'sum') return formatStatNumber(numbers.reduce((sum, value) => sum + value, 0));
  if (type === 'min') return formatStatNumber(Math.min(...numbers));
  if (type === 'max') return formatStatNumber(Math.max(...numbers));
  if (type === 'average') {
    return formatStatNumber(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
  }
  const sorted = numbers.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  return formatStatNumber(median);
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
