import { createId } from './id.js';
import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseData,
  DatabaseFile,
  DatabaseFilter,
  DatabaseFilterGroup,
  DatabaseFilterNode,
  DatabaseFilterOperator,
  DatabaseGroupProperty,
  DatabasePerson,
  DatabaseRow,
  DatabaseSort,
  DatabaseStatType,
  DatabaseVariant,
  DatabaseView,
  DatabaseViewColumn,
  DatabaseViewType,
  InlineRun,
} from './types.js';
import { cloneRuns, parseInlineRuns, plainText } from './text.js';
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
  'countUnique',
  'countEmpty',
  'countNotEmpty',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
];

export const DATABASE_STAT_LABELS: Record<DatabaseStatType, string> = {
  count: 'Count all',
  countValues: 'Count values',
  countUnique: 'Count unique',
  countEmpty: 'Count empty',
  countNotEmpty: 'Count not empty',
  sum: 'Sum',
  average: 'Average',
  median: 'Median',
  min: 'Min',
  max: 'Max',
  range: 'Range',
};

export const DEFAULT_DATABASE_COLUMN_WIDTH = 180;
export const MIN_DATABASE_COLUMN_WIDTH = 100;
export const MAX_DATABASE_COLUMN_WIDTH = 480;

export function createDatabaseView(
  type: DatabaseViewType = 'table',
  name?: string
): DatabaseView & { id: string; name: string } {
  return {
    id: createId('v'),
    name: name ?? (type === 'board' ? 'Board' : 'Table'),
    type,
    filters: [],
    filter: { type: 'group', op: 'and', conditions: [] },
  };
}

export function createDatabaseColumn(
  name: string,
  type: DatabaseColumnType = 'text',
  options: string[] = [],
  data?: Record<string, unknown>
): DatabaseColumn {
  return {
    id: createId('c'),
    name,
    type,
    ...(data ? { data: { ...data } } : {}),
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
  view.columns = data.columns.map(column => ({
    id: column.id,
    width: column.width ?? DEFAULT_DATABASE_COLUMN_WIDTH,
  }));
  const titleColumnId = data.titleColumnId ?? data.columns[0]?.id;
  return {
    ...data,
    ...(titleColumnId ? { titleColumnId } : {}),
    views: [view],
    activeViewId: view.id,
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
  const runs = parseInlineRuns(value.runs);
  const plain = runs.length > 0 ? plainText(runs) : '';
  const text =
    plain ||
    (typeof value.text === 'string' ? value.text.replace(/\r\n?/gu, '\n') : '');
  const checked = value.checked === true;
  const values = parseStringList(value.values);
  const files = parseFiles(value.files);
  const people = parsePeople(value.people);
  return {
    ...(text ? { text } : {}),
    ...(runs.length > 0 ? { runs } : {}),
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
      ? Math.min(MAX_DATABASE_COLUMN_WIDTH, Math.max(MIN_DATABASE_COLUMN_WIDTH, Math.round(value.width)))
      : undefined;
  const data = isRecord(value.data)
    ? Object.fromEntries(
        Object.entries(value.data)
          .filter(([, item]) =>
            typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
          )
          .slice(0, 20)
      )
    : undefined;
  return {
    id,
    name,
    type,
    ...(options ? { options } : {}),
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
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
  const pageContent = isRecord(value.page)
    ? parseInlineRuns(value.page.content)
    : [];
  return {
    id,
    cells,
    ...(pageContent.length > 0 ? { page: { content: pageContent } } : {}),
  };
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

function parseFilterGroup(
  value: unknown,
  columns: readonly DatabaseColumn[],
  depth = 0
): DatabaseFilterGroup | undefined {
  if (!isRecord(value) || depth > 4) return undefined;
  const op = value.op === 'or' ? 'or' : 'and';
  const raw = Array.isArray(value.conditions) ? value.conditions.slice(0, 30) : [];
  const conditions: DatabaseFilterNode[] = [];
  for (const item of raw) {
    if (isRecord(item) && item.type === 'group') {
      const group = parseFilterGroup(item, columns, depth + 1);
      if (group && group.conditions.length > 0) conditions.push(group);
      continue;
    }
    const filter = parseFilter(item, columns);
    if (filter) conditions.push(filter);
  }
  return { type: 'group', op, conditions };
}

function parseViewColumns(
  value: unknown,
  columns: readonly DatabaseColumn[],
  hiddenColumns: readonly string[],
  stats: Readonly<Record<string, DatabaseStatType>>,
  legacyWidths: ReadonlyMap<string, number>
): DatabaseViewColumn[] {
  const known = new Set(columns.map(column => column.id));
  const hidden = new Set(hiddenColumns);
  const seen = new Set<string>();
  const result: DatabaseViewColumn[] = [];
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 200)) {
      if (!isRecord(item) || typeof item.id !== 'string' || !known.has(item.id)) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const width =
        typeof item.width === 'number' && Number.isFinite(item.width)
          ? Math.min(MAX_DATABASE_COLUMN_WIDTH, Math.max(MIN_DATABASE_COLUMN_WIDTH, Math.round(item.width)))
          : legacyWidths.get(item.id);
      const stat =
        typeof item.stat === 'string' &&
        (DATABASE_STAT_TYPES as readonly string[]).includes(item.stat)
          ? (item.stat as DatabaseStatType)
          : stats[item.id];
      result.push({
        id: item.id,
        ...(width ? { width } : {}),
        ...(item.hide === true || hidden.has(item.id) ? { hide: true } : {}),
        ...(stat ? { stat } : {}),
      });
    }
  }
  for (const column of columns) {
    if (seen.has(column.id)) continue;
    const width = legacyWidths.get(column.id) ?? DEFAULT_DATABASE_COLUMN_WIDTH;
    const stat = stats[column.id];
    result.push({
      id: column.id,
      width,
      ...(hidden.has(column.id) ? { hide: true } : {}),
      ...(stat ? { stat } : {}),
    });
  }
  return result;
}

function parseGroupProperties(
  value: unknown,
  rowIds?: ReadonlySet<string>
): DatabaseGroupProperty[] {
  if (!Array.isArray(value)) return [];
  const result: DatabaseGroupProperty[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 100)) {
    if (!isRecord(item) || typeof item.key !== 'string' || item.key.length > 200) continue;
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    let manuallyCardSort: string[] | undefined;
    if (Array.isArray(item.manuallyCardSort)) {
      const seenIds = new Set<string>();
      const maxIds = rowIds ? rowIds.size : 50_000;
      for (const id of item.manuallyCardSort) {
        if (typeof id !== 'string') continue;
        if (rowIds && !rowIds.has(id)) continue;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        if (seenIds.size >= maxIds) break;
      }
      if (seenIds.size > 0) manuallyCardSort = [...seenIds];
    }
    result.push({
      key: item.key,
      ...(item.hide === true ? { hide: true } : {}),
      ...(item.collapsed === true ? { collapsed: true } : {}),
      ...(manuallyCardSort && manuallyCardSort.length > 0 ? { manuallyCardSort } : {}),
    });
  }
  return result;
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
  columns: readonly DatabaseColumn[],
  rowIds?: ReadonlySet<string>
): DatabaseView | undefined {
  if (!isRecord(value)) return undefined;
  const type = value.type === 'board' ? 'board' : 'table';
  const filters = Array.isArray(value.filters)
    ? value.filters
        .map(filter => parseFilter(filter, columns))
        .filter((filter): filter is DatabaseFilter => Boolean(filter))
        .slice(0, 30)
    : [];
  const filter =
    parseFilterGroup(value.filter, columns) ??
    (filters.length > 0
      ? {
          type: 'group' as const,
          op: value.filterMode === 'or' ? ('or' as const) : ('and' as const),
          conditions: filters,
        }
      : { type: 'group' as const, op: 'and' as const, conditions: [] });
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
  const legacyWidths = new Map(
    columns
      .filter(column => typeof column.width === 'number')
      .map(column => [column.id, column.width as number])
  );
  const viewColumns = parseViewColumns(
    value.columns,
    columns,
    hiddenColumns,
    stats,
    legacyWidths
  );
  const groupProperties = parseGroupProperties(value.groupProperties, rowIds);
  const headerValue = isRecord(value.header) ? value.header : {};
  const header = {
    ...(typeof headerValue.titleColumnId === 'string' &&
    columns.some(column => column.id === headerValue.titleColumnId)
      ? { titleColumnId: headerValue.titleColumnId }
      : {}),
    ...(typeof headerValue.iconColumnId === 'string' &&
    columns.some(column => column.id === headerValue.iconColumnId)
      ? { iconColumnId: headerValue.iconColumnId }
      : {}),
  };
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
    filter,
    ...(value.filterMode === 'or' ? { filterMode: 'or' as const } : {}),
    ...(groupBy ? { groupBy } : {}),
    ...(groupProperties.length > 0 ? { groupProperties } : {}),
    ...(value.hideEmptyGroups === true ? { hideEmptyGroups: true } : {}),
    ...(sorts.length > 0 ? { sorts } : {}),
    ...(sort ? { sort } : {}),
    columns: viewColumns,
    ...(hiddenColumns.length > 0 ? { hiddenColumns } : {}),
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
    ...(Object.keys(header).length > 0 ? { header } : {}),
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
  const view = parseView(value.view, columns, rowIds);
  const views: DatabaseView[] = [];
  if (Array.isArray(value.views)) {
    const seen = new Set<string>();
    for (const item of value.views.slice(0, 100)) {
      const parsed = parseView(item, columns, rowIds);
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
  const title =
    typeof value.title === 'string' && value.title.trim()
      ? value.title.trim().slice(0, 200)
      : undefined;
  const hasHeaderTitleColumn = [view, ...views].some(item => {
    const columnId = item?.header?.titleColumnId;
    return (
      typeof columnId === 'string' &&
      columns.some(column => column.id === columnId)
    );
  });
  const titleColumnId =
    typeof value.titleColumnId === 'string' &&
    columns.some(column => column.id === value.titleColumnId)
      ? value.titleColumnId
      : hasHeaderTitleColumn
        ? undefined
        : columns[0]?.id;
  return {
    variant,
    columns,
    rows,
    ...(title ? { title } : {}),
    ...(titleColumnId ? { titleColumnId } : {}),
    ...(sort ? { sort } : {}),
    ...(view ? { view } : {}),
    ...(views.length > 0 ? { views } : {}),
    ...(activeViewId ? { activeViewId } : {}),
  };
}

function cloneCell(cell: DatabaseCell): DatabaseCell {
  return {
    ...cell,
    ...(cell.runs ? { runs: cloneRuns(cell.runs) } : {}),
    ...(cell.values ? { values: [...cell.values] } : {}),
    ...(cell.files ? { files: cell.files.map(file => ({ ...file })) } : {}),
    ...(cell.people ? { people: cell.people.map(person => ({ ...person })) } : {}),
  };
}

function cloneRowPage(
  page: NonNullable<DatabaseRow['page']>
): NonNullable<DatabaseRow['page']> {
  return { content: cloneRuns(page.content) };
}

function cloneFilterNode(node: DatabaseFilterNode): DatabaseFilterNode {
  if (node.type === 'group') {
    return {
      type: 'group',
      op: node.op,
      conditions: node.conditions.map(cloneFilterNode),
    };
  }
  return { ...node };
}

function cloneView(view: DatabaseView): DatabaseView {
  return {
    ...(view.id ? { id: view.id } : {}),
    ...(view.name ? { name: view.name } : {}),
    type: view.type,
    filters: view.filters.map(filter => ({ ...filter })),
    ...(view.filterMode ? { filterMode: view.filterMode } : {}),
    ...(view.filter ? { filter: cloneFilterNode(view.filter) as DatabaseFilterGroup } : {}),
    ...(view.groupBy ? { groupBy: view.groupBy } : {}),
    ...(view.groupProperties
      ? {
          groupProperties: view.groupProperties.map(group => ({
            ...group,
            ...(group.manuallyCardSort
              ? { manuallyCardSort: [...group.manuallyCardSort] }
              : {}),
          })),
        }
      : {}),
    ...(view.hideEmptyGroups ? { hideEmptyGroups: true } : {}),
    ...(view.sorts ? { sorts: view.sorts.map(sort => ({ ...sort })) } : {}),
    ...(view.sort ? { sort: { ...view.sort } } : {}),
    ...(view.columns ? { columns: view.columns.map(column => ({ ...column })) } : {}),
    ...(view.hiddenColumns ? { hiddenColumns: [...view.hiddenColumns] } : {}),
    ...(view.stats ? { stats: { ...view.stats } } : {}),
    ...(view.header ? { header: { ...view.header } } : {}),
  };
}

function remapFilterNode(
  node: DatabaseFilterNode,
  columnMap: ReadonlyMap<string, string>
): DatabaseFilterNode | undefined {
  if (node.type === 'group') {
    const conditions = node.conditions.flatMap(item => {
      const next = remapFilterNode(item, columnMap);
      return next ? [next] : [];
    });
    return { type: 'group', op: node.op, conditions };
  }
  const columnId = columnMap.get(node.columnId);
  return columnId ? { ...node, columnId } : undefined;
}

function remapView(
  view: DatabaseView,
  columnMap: ReadonlyMap<string, string>,
  id?: string,
  rowMap?: ReadonlyMap<string, string>
): DatabaseView {
  const filters = view.filters.flatMap(filter => {
    const columnId = columnMap.get(filter.columnId);
    return columnId ? [{ ...filter, columnId }] : [];
  });
  const filter = view.filter
    ? (remapFilterNode(view.filter, columnMap) as DatabaseFilterGroup | undefined)
    : undefined;
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
  const columns = view.columns?.flatMap(column => {
    const nextId = columnMap.get(column.id);
    return nextId ? [{ ...column, id: nextId }] : [];
  });
  const groupProperties = view.groupProperties?.map(group => ({
    ...group,
    ...(group.manuallyCardSort
      ? {
          manuallyCardSort: group.manuallyCardSort.flatMap(rowId => {
            const nextRowId = rowMap?.get(rowId);
            return nextRowId ? [nextRowId] : [];
          }),
        }
      : {}),
  }));
  const titleHeaderId = view.header?.titleColumnId
    ? columnMap.get(view.header.titleColumnId)
    : undefined;
  const iconHeaderId = view.header?.iconColumnId
    ? columnMap.get(view.header.iconColumnId)
    : undefined;
  const header =
    titleHeaderId || iconHeaderId
      ? {
          ...(titleHeaderId ? { titleColumnId: titleHeaderId } : {}),
          ...(iconHeaderId ? { iconColumnId: iconHeaderId } : {}),
        }
      : undefined;
  return {
    ...(id ? { id } : view.id ? { id: view.id } : {}),
    ...(view.name ? { name: view.name } : {}),
    type: view.type,
    filters,
    ...(filter ? { filter } : {}),
    ...(view.filterMode ? { filterMode: view.filterMode } : {}),
    ...(groupBy ? { groupBy } : {}),
    ...(groupProperties ? { groupProperties } : {}),
    ...(view.hideEmptyGroups ? { hideEmptyGroups: true } : {}),
    ...(sorts.length > 0 ? { sorts } : {}),
    ...(columns ? { columns } : {}),
    ...(hiddenColumns.length > 0 ? { hiddenColumns } : {}),
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
    ...(header && Object.keys(header).length > 0 ? { header } : {}),
  };
}

/** Deep clone preserving ids (used by cloneDoc and snapshots). */
export function cloneDatabaseData(data: DatabaseData): DatabaseData {
  return {
    variant: data.variant,
    ...(data.title ? { title: data.title } : {}),
    ...(data.titleColumnId ? { titleColumnId: data.titleColumnId } : {}),
    columns: data.columns.map(column => ({
      ...column,
      ...(column.options ? { options: [...column.options] } : {}),
      ...(column.data ? { data: { ...column.data } } : {}),
    })),
    rows: data.rows.map(row => ({
      id: row.id,
      cells: Object.fromEntries(
        Object.entries(row.cells).map(([key, cell]) => [key, cloneCell(cell)])
      ),
      ...(row.page ? { page: cloneRowPage(row.page) } : {}),
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
      ...(column.data ? { data: { ...column.data } } : {}),
    };
  });
  const rowMap = new Map<string, string>();
  const rows = data.rows.map(row => {
    const cells: Record<string, DatabaseCell> = {};
    for (const [oldId, cell] of Object.entries(row.cells)) {
      const nextId = columnMap.get(oldId);
      if (nextId) cells[nextId] = cloneCell(cell);
    }
    const id = createId('r');
    rowMap.set(row.id, id);
    return { id, cells, ...(row.page ? { page: cloneRowPage(row.page) } : {}) };
  });
  const view = data.view ? remapView(data.view, columnMap, undefined, rowMap) : undefined;
  const viewIdMap = new Map<string, string>();
  const views = data.views?.map(item => {
    const id = createId('v');
    if (item.id) viewIdMap.set(item.id, id);
    return remapView(item, columnMap, id, rowMap);
  });
  const activeViewId = data.activeViewId
    ? viewIdMap.get(data.activeViewId)
    : views?.[0]?.id;
  const titleColumnId = data.titleColumnId
    ? columnMap.get(data.titleColumnId)
    : undefined;
  return {
    variant: data.variant,
    ...(data.title ? { title: data.title } : {}),
    ...(titleColumnId ? { titleColumnId } : {}),
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

function rawCellText(cell: DatabaseCell): string {
  return cell.text ?? (cell.runs ? plainText(cell.runs) : '');
}

export function databaseCellText(cell: DatabaseCell | undefined, type: DatabaseColumnType): string {
  if (!cell) return '';
  if (type === 'checkbox') return cell.checked ? 'true' : '';
  if (type === 'multi-select') return (cell.values ?? []).join(', ');
  if (type === 'files') return (cell.files ?? []).map(file => file.name).join(', ');
  if (type === 'people') return (cell.people ?? []).map(person => person.label).join(', ');
  return rawCellText(cell);
}

export function databaseCellDisplay(cell: DatabaseCell | undefined, type: DatabaseColumnType): string {
  if (!cell) return '';
  if (type === 'checkbox') return cell.checked ? '✓' : '';
  if (type === 'multi-select') return (cell.values ?? []).join(' · ');
  if (type === 'files') return (cell.files ?? []).map(file => file.name).join(' · ');
  if (type === 'people') return (cell.people ?? []).map(person => person.label).join(' · ');
  return rawCellText(cell);
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

const TEXT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortRows(
  rows: readonly DatabaseRow[],
  columns: readonly DatabaseColumn[],
  sorts: readonly DatabaseSort[]
): DatabaseRow[] {
  if (sorts.length === 0) return [...rows];
  const columnById = new Map(columns.map(column => [column.id, column]));
  const resolvedSorts: { column: DatabaseColumn; direction: 'asc' | 'desc' }[] = [];
  for (const sort of sorts) {
    const column = columnById.get(sort.columnId);
    if (column) resolvedSorts.push({ column, direction: sort.direction });
  }
  if (resolvedSorts.length === 0) return [...rows];

  const entries = rows.map((row, index) => ({
    row,
    index,
    keys: resolvedSorts.map(({ column }) => {
      const text = databaseCellText(row.cells[column.id], column.type);
      if (!text) return null;
      if (column.type === 'checkbox') return row.cells[column.id]?.checked ? 1 : 0;
      return comparable(text, column.type);
    }),
  }));

  entries.sort((a, b) => {
    for (let i = 0; i < resolvedSorts.length; i += 1) {
      const sort = resolvedSorts[i]!;
      const l = a.keys[i] ?? null;
      const r = b.keys[i] ?? null;
      if (l === null && r === null) continue;
      if (l === null) return 1;
      if (r === null) return -1;
      let result = 0;
      if (typeof l === 'number' && typeof r === 'number') {
        if (Number.isNaN(l) && Number.isNaN(r)) result = 0;
        else if (Number.isNaN(l)) result = 1;
        else if (Number.isNaN(r)) result = -1;
        else result = l - r;
      } else {
        result = TEXT_COLLATOR.compare(String(l), String(r));
      }
      if (result !== 0) return sort.direction === 'desc' ? -result : result;
    }
    return a.index - b.index;
  });

  return entries.map(entry => entry.row);
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
      filter: { type: 'group', op: 'and', conditions: [] },
      columns: data.columns.map(column => ({
        id: column.id,
        width: column.width ?? DEFAULT_DATABASE_COLUMN_WIDTH,
      })),
      ...(data.sort ? { sort: data.sort } : {}),
    },
  ];
}

export interface DatabaseViewColumnState {
  column: DatabaseColumn;
  width: number;
  hide: boolean;
  stat?: DatabaseStatType;
}

/** Ordered columns for a view, including hidden ones. */
export function databaseViewColumnStates(
  data: DatabaseData,
  view: DatabaseView = databaseView(data)
): DatabaseViewColumnState[] {
  const byId = new Map(data.columns.map(column => [column.id, column]));
  const hidden = new Set(view.hiddenColumns ?? []);
  const stats = view.stats ?? {};
  const result: DatabaseViewColumnState[] = [];
  const seen = new Set<string>();
  for (const item of view.columns ?? []) {
    const column = byId.get(item.id);
    if (!column || seen.has(item.id)) continue;
    seen.add(item.id);
    const stat = item.stat ?? stats[item.id];
    result.push({
      column,
      width:
        item.width ??
        column.width ??
        DEFAULT_DATABASE_COLUMN_WIDTH,
      hide: item.hide === true || hidden.has(item.id),
      ...(stat ? { stat } : {}),
    });
  }
  for (const column of data.columns) {
    if (seen.has(column.id)) continue;
    const stat = stats[column.id];
    result.push({
      column,
      width: column.width ?? DEFAULT_DATABASE_COLUMN_WIDTH,
      hide: hidden.has(column.id),
      ...(stat ? { stat } : {}),
    });
  }
  return result;
}

/** Visible columns in view order. */
export function databaseVisibleColumns(
  data: DatabaseData,
  view: DatabaseView = databaseView(data)
): DatabaseColumn[] {
  return databaseViewColumnStates(data, view)
    .filter(item => !item.hide)
    .map(item => item.column);
}

export function databaseTitleColumn(
  data: DatabaseData,
  view: DatabaseView = databaseView(data)
): DatabaseColumn | undefined {
  const id = data.titleColumnId ?? view.header?.titleColumnId;
  return (
    (id ? data.columns.find(column => column.id === id) : undefined) ??
    databaseVisibleColumns(data, view)[0] ??
    data.columns[0]
  );
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
  return !rawCellText(cell);
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

function hasFilterConditions(node: DatabaseFilterNode): boolean {
  if (node.type !== 'group') return true;
  return node.conditions.some(condition => hasFilterConditions(condition));
}

function matchesFilterNode(
  row: DatabaseRow,
  node: DatabaseFilterNode,
  data: DatabaseData
): boolean {
  if (node.type === 'group') {
    const matches: boolean[] = [];
    for (const item of node.conditions) {
      if (item.type === 'group' && !hasFilterConditions(item)) continue;
      if (
        item.type !== 'group' &&
        !data.columns.some(column => column.id === item.columnId)
      ) {
        continue;
      }
      matches.push(matchesFilterNode(row, item, data));
    }
    if (matches.length === 0) return true;
    return node.op === 'or' ? matches.some(Boolean) : matches.every(Boolean);
  }
  const column = data.columns.find(item => item.id === node.columnId);
  if (!column) return true;
  return matchesFilter(row, column, node);
}

/** Filter tree for a view, deriving it from legacy filters when needed. */
export function databaseFilterGroup(
  view: DatabaseView
): DatabaseFilterGroup {
  if (view.filter) return view.filter;
  return {
    type: 'group',
    op: view.filterMode === 'or' ? 'or' : 'and',
    conditions: view.filters ?? [],
  };
}

/** Rows after filters and sorting for a view. */
export function filteredDatabaseRows(
  data: DatabaseData,
  view: DatabaseView = databaseView(data)
): DatabaseRow[] {
  const filter = databaseFilterGroup(view);
  const rows =
    filter.conditions.length === 0
      ? [...data.rows]
      : data.rows.filter(row => matchesFilterNode(row, filter, data));
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
  if (type === 'countEmpty') {
    return String(rows.filter(row => isEmptyCell(row.cells[column.id], column)).length);
  }
  if (type === 'countNotEmpty') {
    return String(rows.filter(row => !isEmptyCell(row.cells[column.id], column)).length);
  }
  const values = rows
    .map(row => databaseCellText(row.cells[column.id], column.type).trim())
    .filter(Boolean);
  if (type === 'countValues') return String(values.length);
  if (type === 'countUnique') return String(new Set(values).size);
  const numbers = values
    .map(value => Number.parseFloat(value))
    .filter(value => Number.isFinite(value));
  if (
    type !== 'sum' &&
    type !== 'average' &&
    type !== 'median' &&
    type !== 'min' &&
    type !== 'max' &&
    type !== 'range'
  ) {
    return '';
  }
  if (numbers.length === 0) return '';
  if (type === 'sum') return formatStatNumber(numbers.reduce((sum, value) => sum + value, 0));
  if (type === 'min' || type === 'max' || type === 'range') {
    let min = numbers[0] ?? 0;
    let max = min;
    for (let i = 1; i < numbers.length; i += 1) {
      const n = numbers[i]!;
      if (n < min) min = n;
      if (n > max) max = n;
    }
    if (type === 'min') return formatStatNumber(min);
    if (type === 'max') return formatStatNumber(max);
    return formatStatNumber(max - min);
  }
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
  hidden?: boolean;
  collapsed?: boolean;
}

function applyGroupSettings(
  groups: DatabaseGroup[],
  view: DatabaseView
): DatabaseGroup[] {
  const groupProperties = view.groupProperties ?? [];
  const settings = new Map(groupProperties.map(group => [group.key, group]));
  const orderIndex = new Map(groupProperties.map((group, index) => [group.key, index]));
  const hasOrder = settings.size > 0;
  const ordered = hasOrder
    ? [...groups].sort((a, b) => {
        const ai = orderIndex.get(a.key) ?? -1;
        const bi = orderIndex.get(b.key) ?? -1;
        if (ai < 0 && bi < 0) return 0;
        if (ai < 0) return 1;
        if (bi < 0) return -1;
        return ai - bi;
      })
    : groups;
  const hasSort = databaseSorts(view).length > 0;
  return ordered
    .filter(group => !(view.hideEmptyGroups && group.rows.length === 0))
    .map(group => {
      const setting = settings.get(group.key);
      let rows = group.rows;
      if (!hasSort && setting?.manuallyCardSort?.length) {
        const order = new Map(setting.manuallyCardSort.map((id, index) => [id, index]));
        rows = [...rows].sort((a, b) => {
          const ai = order.get(a.id);
          const bi = order.get(b.id);
          if (ai === undefined && bi === undefined) return 0;
          if (ai === undefined) return 1;
          if (bi === undefined) return -1;
          return ai - bi;
        });
      }
      return {
        ...group,
        rows,
        ...(setting?.hide ? { hidden: true } : {}),
        ...(setting?.collapsed ? { collapsed: true } : {}),
      };
    });
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
    return applyGroupSettings(
      [
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
      ],
      view
    );
  }

  if (column.type === 'select' || column.type === 'multi-select') {
    const options = [...(column.options ?? [])];
    const optionSet = new Set(options);
    const buckets = new Map<string, DatabaseRow[]>();
    const empty: DatabaseRow[] = [];
    for (const row of rows) {
      const cell = row.cells[column.id];
      if (column.type === 'multi-select') {
        const rowValues = cell?.values;
        if (!rowValues || rowValues.length === 0) {
          empty.push(row);
          continue;
        }
        const seen = rowValues.length > 1 ? new Set<string>() : null;
        for (const value of rowValues) {
          if (seen) {
            if (seen.has(value)) continue;
            seen.add(value);
          }
          let bucket = buckets.get(value);
          if (!bucket) {
            bucket = [];
            buckets.set(value, bucket);
          }
          bucket.push(row);
        }
      } else {
        const value = cell?.text;
        if (!value) {
          empty.push(row);
          continue;
        }
        let bucket = buckets.get(value);
        if (!bucket) {
          bucket = [];
          buckets.set(value, bucket);
        }
        bucket.push(row);
      }
    }
    const extraKeys = [...buckets.keys()].filter(value => !optionSet.has(value)).sort();
    const ordered = [...options, ...extraKeys];
    const groups: DatabaseGroup[] = ordered.map(value => ({
      key: value,
      label: value,
      rows: buckets.get(value) ?? [],
    }));
    if (empty.length > 0) groups.push({ key: '', label: 'No value', rows: empty });
    return applyGroupSettings(groups, view);
  }

  const values = new Map<string, DatabaseRow[]>();
  for (const row of rows) {
    const value = databaseCellDisplay(row.cells[column.id], column.type);
    const group = values.get(value) ?? [];
    group.push(row);
    values.set(value, group);
  }
  return applyGroupSettings(
    [...values.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([key, groupRows]) => ({
        key,
        label: key || 'No value',
        rows: groupRows,
      })),
    view
  );
}

export function databaseRowNumber(data: DatabaseData, rowId: string): number {
  return sortedDatabaseRows(data).findIndex(row => row.id === rowId) + 1;
}
