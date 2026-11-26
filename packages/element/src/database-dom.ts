import {
  cloneRuns,
  databaseCellText,
  normalizeMark,
  normalizeRuns,
  plainText,
  safeImageSrc,
} from '@nobita/core';
import type {
  BooleanMarkKey,
  DatabaseCell,
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseFile,
  DatabaseFilter,
  DatabaseFilterGroup,
  DatabaseFilterOperator,
  DatabaseGroupProperty,
  DatabasePerson,
  DatabaseRow,
  DatabaseView as DatabaseViewConfig,
  InlineMark,
  InlineRun,
  PageInfo,
} from '@nobita/core';
import { nativeSelection } from './dom.js';
import { icon } from './icons.js';
import {
  domPointToRunsOffset,
  readRunsFromDom,
  renderInlineRuns,
  runsOffsetToDomPoint,
} from './inline-dom.js';

export type CellKind =
  | 'text'
  | 'number'
  | 'progress'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'multi-select'
  | 'image'
  | 'files'
  | 'people';

export interface CellNodes {
  td: HTMLTableCellElement;
  text?: HTMLElement;
  input?: HTMLInputElement;
  button?: HTMLButtonElement;
  progress?: HTMLElement;
}

export const COLUMN_TYPES: readonly { type: DatabaseColumnType; label: string }[] = [
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'progress', label: 'Progress' },
  { type: 'select', label: 'Select' },
  { type: 'multi-select', label: 'Multi-select' },
  { type: 'date', label: 'Date' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'url', label: 'URL' },
  { type: 'image', label: 'Image' },
  { type: 'files', label: 'Files' },
  { type: 'people', label: 'People' },
];

export const TYPE_ICON: Record<DatabaseColumnType, string> = {
  text: icon.text,
  number: icon.hash,
  progress: icon.progress,
  select: icon.tag,
  'multi-select': icon.tag,
  date: icon.calendar,
  checkbox: icon.checkboxSquare,
  url: icon.link,
  image: icon.image,
  files: icon.file,
  people: icon.user,
};

export const FILTER_LABELS: Record<DatabaseFilterOperator, string> = {
  contains: 'contains',
  doesNotContain: 'does not contain',
  startsWith: 'starts with',
  endsWith: 'ends with',
  is: 'is',
  isNot: 'is not',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  equal: 'equals',
  notEqual: 'does not equal',
  greaterThan: 'greater than',
  lessThan: 'less than',
  greaterThanOrEqual: 'greater than or equal',
  lessThanOrEqual: 'less than or equal',
  before: 'before',
  after: 'after',
  isChecked: 'is checked',
  isUnchecked: 'is not checked',
  isAnyOf: 'is any of',
  isNoneOf: 'is none of',
  containsAny: 'contains any of',
  containsAll: 'contains all of',
  doesNotContainAny: 'does not contain any of',
  doesNotContainAll: 'does not contain all of',
};

export const TAG_TO_MARK: Record<string, BooleanMarkKey> = {
  strong: 'bold',
  em: 'italic',
  u: 'underline',
  s: 'strike',
  code: 'code',
};

export const DATABASE_ROWS_MIME = 'application/x-nobita-database-rows';

/** Create an element with optional class name and text content. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface ButtonOptions {
  text?: string;
  html?: string;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
  dataset?: Record<string, string>;
}

/** Create a type="button" element with common attributes. */
export function btn(
  className?: string,
  options: ButtonOptions = {}
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  if (className) button.className = className;
  if (options.html !== undefined) button.innerHTML = options.html;
  else if (options.text !== undefined) button.textContent = options.text;
  if (options.title) button.title = options.title;
  if (options.ariaLabel) button.setAttribute('aria-label', options.ariaLabel);
  if (options.disabled !== undefined) button.disabled = options.disabled;
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      button.dataset[key] = value;
    }
  }
  return button;
}

/** Create an icon-only button with matching title and aria-label. */
export function iconBtn(
  className: string,
  iconMarkup: string,
  label: string,
  options: { title?: string; disabled?: boolean; dataset?: Record<string, string> } = {}
): HTMLButtonElement {
  return btn(className, {
    html: iconMarkup,
    title: options.title ?? label,
    ariaLabel: label,
    ...(options.disabled !== undefined ? { disabled: options.disabled } : {}),
    ...(options.dataset ? { dataset: options.dataset } : {}),
  });
}

/** Create a popover section title element. */
export function popTitle(text: string): HTMLElement {
  return el('div', 'nb-db-pop-title', text);
}

/** Populate a select element with option entries. */
export function selectEl(
  ariaLabel: string,
  options: ReadonlyArray<{ value: string; label: string; selected?: boolean }>
): HTMLSelectElement {
  const select = document.createElement('select');
  select.setAttribute('aria-label', ariaLabel);
  for (const item of options) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    if (item.selected) option.selected = true;
    select.append(option);
  }
  return select;
}

export function filterOperators(type: DatabaseColumnType): DatabaseFilterOperator[] {
  const empty: DatabaseFilterOperator[] = ['isEmpty', 'isNotEmpty'];
  if (type === 'checkbox') return ['isChecked', 'isUnchecked', 'is', 'isNot'];
  if (type === 'number' || type === 'progress') {
    return [
      'equal',
      'notEqual',
      'greaterThan',
      'lessThan',
      'greaterThanOrEqual',
      'lessThanOrEqual',
      ...empty,
    ];
  }
  if (type === 'date') return ['before', 'after', 'is', 'isNot', ...empty];
  if (type === 'select') return ['is', 'isNot', 'isAnyOf', 'isNoneOf', ...empty];
  if (type === 'multi-select') {
    return ['containsAny', 'containsAll', 'doesNotContainAny', 'doesNotContainAll', ...empty];
  }
  if (type === 'image') return ['contains', 'doesNotContain', 'is', 'isNot', ...empty];
  if (type === 'files' || type === 'people') return empty;
  return ['contains', 'doesNotContain', 'startsWith', 'endsWith', 'is', 'isNot', ...empty];
}

export function defaultFilterOperator(type: DatabaseColumnType): DatabaseFilterOperator {
  return filterOperators(type)[0] ?? 'is';
}

const NUMBER_FORMATTERS = new Map<string, Intl.NumberFormat>();

function getNumberFormatter(
  format: string,
  decimals: number | undefined,
  currency: string
): Intl.NumberFormat {
  const normalizedFormat =
    format === 'percent' || format === 'currency' ? format : 'decimal';
  const key = `${normalizedFormat}|${decimals ?? ''}|${
    normalizedFormat === 'currency' ? currency : ''
  }`;
  let formatter = NUMBER_FORMATTERS.get(key);
  if (formatter) return formatter;
  const fraction =
    decimals === undefined
      ? {}
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  if (normalizedFormat === 'percent') {
    formatter = new Intl.NumberFormat(undefined, {
      style: 'percent',
      useGrouping: false,
      ...fraction,
    });
  } else if (normalizedFormat === 'currency') {
    formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      ...fraction,
    });
  } else {
    formatter = new Intl.NumberFormat(undefined, {
      style: 'decimal',
      useGrouping: false,
      ...(decimals === undefined ? { maximumFractionDigits: 0 } : fraction),
    });
  }
  NUMBER_FORMATTERS.set(key, formatter);
  return formatter;
}

export function formatDatabaseNumber(value: string, column: DatabaseColumn): string {
  if (!value) return '';
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return value;
  const decimalValue =
    typeof column.data?.decimal === 'number' ? column.data.decimal : undefined;
  const decimals =
    decimalValue === undefined
      ? undefined
      : Math.max(0, Math.min(6, Math.round(decimalValue)));
  const format = typeof column.data?.format === 'string' ? column.data.format : 'number';
  const currency =
    format === 'currency'
      ? typeof column.data?.currency === 'string'
        ? column.data.currency
        : 'USD'
      : '';
  try {
    return getNumberFormatter(format, decimals, currency).format(number);
  } catch {
    return number.toFixed(decimals ?? 0);
  }
}

export const cellKey = (rowId: string, columnId: string): string =>
  `${rowId}\u0000${columnId}`;

export function detailFieldSchema(column: DatabaseColumn): string {
  return `${column.type}\u0000${(column.options ?? []).join('\u0001')}`;
}

export function titleTextEditable(column: DatabaseColumn | undefined): boolean {
  return Boolean(
    column && ['text', 'number', 'date', 'url'].includes(column.type)
  );
}

/** Merge a reordered visible sequence into a saved order without dropping hidden entries. */
export function mergeOrder(
  saved: readonly string[],
  visible: readonly string[]
): string[] {
  const visibleSet = new Set(visible);
  const order: string[] = [];
  let visibleIndex = 0;
  for (const id of saved) {
    if (visibleSet.has(id)) {
      const next = visible[visibleIndex];
      if (next !== undefined) {
        order.push(next);
        visibleIndex += 1;
      }
    } else if (!order.includes(id)) {
      order.push(id);
    }
  }
  while (visibleIndex < visible.length) {
    const next = visible[visibleIndex];
    if (next !== undefined) order.push(next);
    visibleIndex += 1;
  }
  return order;
}

/** Materialize saved group settings in visible order, keeping omitted groups. */
export function seedGroupSettings(
  saved: readonly DatabaseGroupProperty[],
  visibleKeys: readonly string[]
): DatabaseGroupProperty[] {
  const keys = [...visibleKeys];
  for (const setting of saved) {
    if (!keys.includes(setting.key)) keys.push(setting.key);
  }
  const byKey = new Map(saved.map(setting => [setting.key, setting]));
  return keys.map(key => {
    const setting = byKey.get(key);
    return setting
      ? {
          ...setting,
          ...(setting.manuallyCardSort
            ? { manuallyCardSort: [...setting.manuallyCardSort] }
            : {}),
        }
      : { key };
  });
}

export function selectionOffsets(
  element: HTMLElement
): { start: number; end: number } | null {
  const selection = nativeSelection(element.getRootNode() as ShadowRoot);
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (
    !element.contains(range.startContainer) ||
    !element.contains(range.endContainer)
  ) {
    return null;
  }
  const start = domPointToRunsOffset(element, range.startContainer, range.startOffset);
  const end = domPointToRunsOffset(element, range.endContainer, range.endOffset);
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

export function setSelectionOffsets(
  element: HTMLElement,
  start: number,
  end: number
): void {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const startPoint = runsOffsetToDomPoint(element, from);
  const endPoint = runsOffsetToDomPoint(element, to);
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  const selection = nativeSelection(element.getRootNode() as ShadowRoot);
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

export function caretAtBoundary(element: HTMLElement, side: 'start' | 'end'): boolean {
  const root = element.getRootNode() as ShadowRoot;
  const selection = nativeSelection(root);
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return false;
  const offset = domPointToRunsOffset(element, range.startContainer, range.startOffset);
  if (side === 'start') return offset === 0;
  return offset >= domPointToRunsOffset(element, element, element.childNodes.length);
}

export function isComposingKey(
  event: KeyboardEvent,
  composingTargets: WeakSet<HTMLElement>,
  target?: HTMLElement | null
): boolean {
  return (
    event.isComposing ||
    event.keyCode === 229 ||
    Boolean(target && composingTargets.has(target))
  );
}

export function shortcutTag(event: KeyboardEvent): string | null {
  if (!(event.metaKey || event.ctrlKey)) return null;
  const key = event.key.toLowerCase();
  if (key === 'b') return 'strong';
  if (key === 'i') return 'em';
  if (key === 'u') return 'u';
  if (key === 'e') return 'code';
  if (key === 's' && event.shiftKey) return 's';
  return null;
}

export function hasMeaningfulMark(mark: InlineMark | undefined): boolean {
  return Boolean(normalizeMark(mark));
}

export function runsSignature(runs: readonly InlineRun[] | undefined): string {
  return JSON.stringify(runs ?? []);
}

export function renderTextCellContent(
  element: HTMLElement,
  cell: DatabaseCell | undefined,
  resolvePage?: (pageId: string) => PageInfo | null
): void {
  const runs = cell?.runs;
  element.dataset.runs = runsSignature(runs);
  if (runs && runs.length > 0) {
    renderInlineRuns(element, runs, resolvePage);
  } else {
    element.textContent = cell?.text ?? '';
  }
}

export function readCellRuns(element: HTMLElement): InlineRun[] {
  return normalizeRuns(
    readRunsFromDom(element).map(run => ({
      ...run,
      text: run.text.replace(/\r?\n/gu, ' '),
      ...(run.marks ? { marks: { ...run.marks } } : {}),
    }))
  );
}

export function isMultilineRichText(target: HTMLElement): boolean {
  return target.classList.contains('nb-db-page-text') || target.dataset.multiline === 'true';
}

export function readRichTextRuns(target: HTMLElement): InlineRun[] {
  return isMultilineRichText(target)
    ? normalizeRuns(readRunsFromDom(target))
    : readCellRuns(target);
}

export function renderRichTextRuns(
  target: HTMLElement,
  runs: readonly InlineRun[],
  resolvePage?: (pageId: string) => PageInfo | null
): void {
  if (isMultilineRichText(target)) {
    if (runs.length > 0) renderInlineRuns(target, runs, resolvePage);
    else target.replaceChildren();
    return;
  }
  if (runs.some(run => run.marks)) renderInlineRuns(target, runs, resolvePage);
  else target.textContent = plainText(runs);
}

export function withText(cell: DatabaseCell | undefined, value: string): DatabaseCell {
  const next: DatabaseCell = { ...(cell ?? {}) };
  if (value) next.text = value;
  else delete next.text;
  delete next.runs;
  return next;
}

export function applySelectLabel(
  button: HTMLButtonElement,
  value: string,
  options: string[] = [],
  columnName?: string
): void {
  button.replaceChildren();
  if (columnName) {
    button.setAttribute('aria-label', value ? `${columnName}: ${value}` : columnName);
  }
  if (!value) {
    button.classList.add('is-empty');
    button.append(el('span', undefined, 'Select…'));
    return;
  }
  button.classList.remove('is-empty');
  const dot = el('span', 'nb-db-dot');
  const palette = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4'];
  const optionIndex = options.indexOf(value);
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const index = optionIndex >= 0 ? optionIndex : Math.abs(hash);
  dot.style.background = palette[index % palette.length] ?? '#3b82f6';
  button.append(dot, el('span', undefined, value));
}

export function applyMultiLabel(
  button: HTMLButtonElement,
  values: string[],
  columnName?: string
): void {
  button.replaceChildren();
  if (columnName) {
    button.setAttribute(
      'aria-label',
      values.length > 0 ? `${columnName}: ${values.join(', ')}` : columnName
    );
  }
  button.classList.toggle('is-empty', values.length === 0);
  if (values.length === 0) {
    button.append(el('span', undefined, 'Select…'));
    return;
  }
  for (const value of values.slice(0, 3)) {
    button.append(el('span', 'nb-db-chip', value));
  }
  if (values.length > 3) {
    button.append(el('span', 'nb-db-chip', `+${values.length - 3}`));
  }
}

export function parseProgressValue(value: string | undefined): number | null {
  if (!value) return null;
  let trimmed = value.trim();
  if (trimmed.endsWith('%')) trimmed = trimmed.slice(0, -1).trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function applyProgressState(
  control: HTMLElement,
  rawValue: string | undefined,
  columnName: string
): void {
  const val = parseProgressValue(rawValue);
  control.setAttribute('aria-label', columnName);
  control.setAttribute('aria-valuemin', '0');
  control.setAttribute('aria-valuemax', '100');
  const fill = control.querySelector<HTMLElement>('.nb-db-progress-fill');
  const label = control.querySelector<HTMLElement>('.nb-db-progress-label');
  if (val === null) {
    control.removeAttribute('aria-valuenow');
    control.setAttribute('aria-valuetext', 'Empty');
    control.dataset.value = '';
    control.classList.add('is-empty');
    if (fill) fill.style.width = '0%';
    if (label) label.textContent = '';
    return;
  }
  control.setAttribute('aria-valuenow', String(val));
  control.setAttribute('aria-valuetext', `${val}%`);
  control.dataset.value = String(val);
  control.classList.remove('is-empty');
  if (fill) fill.style.width = `${val}%`;
  if (label) label.textContent = `${val}%`;
}

export function applyImageLabel(
  button: HTMLButtonElement,
  rawSrc: string | undefined,
  columnName?: string
): void {
  const src = safeImageSrc(rawSrc);
  button.replaceChildren();
  button.classList.toggle('is-empty', !src);
  if (columnName) {
    button.setAttribute('aria-label', src ? `${columnName}: image` : columnName);
  }
  if (src) {
    const img = el('img', 'nb-db-thumb');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    img.draggable = false;
    button.append(img);
    return;
  }
  button.append(el('span', 'nb-db-image-empty', 'Add image…'));
}

export function applyFilesLabel(
  button: HTMLButtonElement,
  files: DatabaseFile[],
  columnName?: string
): void {
  button.replaceChildren();
  button.classList.toggle('is-empty', files.length === 0);
  const summary =
    files.length === 0
      ? ''
      : files.length === 1
        ? files[0]!.name
        : `${files.length} files`;
  if (columnName) {
    button.setAttribute('aria-label', summary ? `${columnName}: ${summary}` : columnName);
  }
  button.append(el('span', undefined, summary || 'Add file…'));
}

export function applyPeopleLabel(
  button: HTMLButtonElement,
  people: DatabasePerson[],
  columnName?: string
): void {
  button.replaceChildren();
  button.classList.toggle('is-empty', people.length === 0);
  const summary = people.map(person => person.label).join(', ');
  if (columnName) {
    button.setAttribute('aria-label', summary ? `${columnName}: ${summary}` : columnName);
  }
  button.append(el('span', undefined, summary || 'Add people…'));
}

export function cloneCell(cell: DatabaseCell): DatabaseCell {
  return {
    ...cell,
    ...(cell.runs ? { runs: cloneRuns(cell.runs) } : {}),
    ...(cell.values ? { values: [...cell.values] } : {}),
    ...(cell.files ? { files: cell.files.map(file => ({ ...file })) } : {}),
    ...(cell.people ? { people: cell.people.map(person => ({ ...person })) } : {}),
  };
}

export function convertCell(
  cell: DatabaseCell,
  sourceType: DatabaseColumnType,
  targetType: DatabaseColumnType
): DatabaseCell | null {
  if (targetType === 'files' || targetType === 'people') return null;
  const value = databaseCellText(cell, sourceType);
  if (targetType === 'checkbox') {
    return { checked: /^(true|1|yes|✓)$/iu.test(value.trim()) };
  }
  if (targetType === 'multi-select') {
    const values = value
      .split(/[,;]/u)
      .map(item => item.trim())
      .filter(Boolean);
    return values.length > 0 ? { values } : {};
  }
  if (targetType === 'progress') {
    const n = parseProgressValue(value);
    return n === null ? {} : { text: String(n) };
  }
  if (targetType === 'image') {
    const src = safeImageSrc(value);
    return src ? { text: src } : {};
  }
  return value ? { text: value } : {};
}

export function cellForGroupValue(
  column: DatabaseColumn,
  cell: DatabaseCell | undefined,
  groupKey: string
): DatabaseCell {
  const next: DatabaseCell = { ...(cell ?? {}) };
  if (column.type === 'checkbox') {
    if (groupKey === 'true') next.checked = true;
    else delete next.checked;
    return next;
  }
  if (column.type === 'multi-select') {
    if (groupKey) next.values = [groupKey];
    else delete next.values;
    return next;
  }
  delete next.runs;
  if (column.type === 'progress') {
    const n = parseProgressValue(groupKey);
    if (n !== null) next.text = String(n);
    else delete next.text;
    return next;
  }
  if (groupKey) next.text = groupKey;
  else delete next.text;
  return next;
}

export function defaultFilterForColumn(column: DatabaseColumn): DatabaseFilter {
  if (column.type === 'checkbox') return { columnId: column.id, operator: 'isChecked' };
  if (column.type === 'select') {
    return { columnId: column.id, operator: 'is', value: column.options?.[0] ?? '' };
  }
  if (column.type === 'multi-select') {
    return {
      columnId: column.id,
      operator: 'containsAny',
      value: column.options?.[0] ?? '',
    };
  }
  if (column.type === 'number' || column.type === 'progress') {
    return { columnId: column.id, operator: 'equal', value: '' };
  }
  if (column.type === 'image') return { columnId: column.id, operator: 'isNotEmpty' };
  if (column.type === 'date') return { columnId: column.id, operator: 'is', value: '' };
  return { columnId: column.id, operator: 'contains', value: '' };
}

export function removeFilterColumn(
  group: DatabaseFilterGroup,
  columnId: string
): DatabaseFilterGroup {
  const conditions: DatabaseFilterGroup['conditions'] = [];
  for (const item of group.conditions) {
    if (item.type === 'group') {
      const next = removeFilterColumn(item, columnId);
      if (next.conditions.length > 0) conditions.push(next);
    } else if (item.columnId !== columnId) {
      conditions.push(item);
    }
  }
  return { ...group, conditions };
}

export function removeColumnFromView(
  view: DatabaseViewConfig,
  columnId: string
): DatabaseViewConfig {
  const filters = view.filters.filter(filter => filter.columnId !== columnId);
  const filter = view.filter ? removeFilterColumn(view.filter, columnId) : undefined;
  const groupBy = view.groupBy && view.groupBy !== columnId ? view.groupBy : undefined;
  const groupRemoved = view.groupBy === columnId;
  const sorts = (view.sorts ?? (view.sort ? [view.sort] : [])).filter(
    sort => sort.columnId !== columnId
  );
  const sort = view.sort && view.sort.columnId !== columnId ? view.sort : undefined;
  const hiddenColumns = (view.hiddenColumns ?? []).filter(id => id !== columnId);
  const stats = { ...(view.stats ?? {}) };
  delete stats[columnId];
  const columns = view.columns?.filter(column => column.id !== columnId);
  const header = view.header
    ? {
        ...(view.header.titleColumnId === columnId
          ? {}
          : { titleColumnId: view.header.titleColumnId }),
        ...(view.header.iconColumnId === columnId
          ? {}
          : { iconColumnId: view.header.iconColumnId }),
      }
    : undefined;
  const { coverColumnId: existingCover, ...baseView } = view;
  return {
    ...baseView,
    filters,
    ...(filter ? { filter } : {}),
    ...(groupBy ? { groupBy } : groupRemoved ? { groupProperties: [] } : {}),
    ...(groupRemoved ? { hideEmptyGroups: false } : {}),
    ...(sorts.length > 0 ? { sorts } : {}),
    ...(sort ? { sort } : {}),
    ...(columns ? { columns } : {}),
    ...(hiddenColumns.length > 0 ? { hiddenColumns } : {}),
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
    ...(header && Object.keys(header).length > 0 ? { header } : {}),
    ...(existingCover && existingCover !== columnId ? { coverColumnId: existingCover } : {}),
  };
}

export function pruneRowIdsFromViews(
  views: readonly DatabaseViewConfig[],
  deletedIds: ReadonlySet<string>
): DatabaseViewConfig[] {
  if (deletedIds.size === 0) return [...views];
  let anyChanged = false;
  const nextViews = views.map(view => {
    if (!view.groupProperties?.length) return view;
    let viewChanged = false;
    const groupProperties = view.groupProperties.map(group => {
      if (!group.manuallyCardSort?.length) return group;
      const nextSort = group.manuallyCardSort.filter(id => !deletedIds.has(id));
      if (nextSort.length === group.manuallyCardSort.length) return group;
      viewChanged = true;
      const { manuallyCardSort: _removed, ...rest } = group;
      return nextSort.length > 0 ? { ...rest, manuallyCardSort: nextSort } : rest;
    });
    if (!viewChanged) return view;
    anyChanged = true;
    return { ...view, groupProperties };
  });
  return anyChanged ? nextViews : [...views];
}

export function attachNumberInput(
  input: HTMLInputElement,
  row: DatabaseRow,
  column: DatabaseColumn,
  signal: AbortSignal,
  currentCell: (rowId: string, columnId: string) => DatabaseCell | undefined,
  commitCell: (rowId: string, columnId: string, cell: DatabaseCell, mergeKey?: string) => void,
  onFocus?: () => void
): void {
  input.type = 'text';
  input.inputMode = 'decimal';
  input.value = formatDatabaseNumber(currentCell(row.id, column.id)?.text ?? '', column);
  input.addEventListener(
    'input',
    () => {
      const value = input.value.replace(/[^0-9eE+.-]/gu, '');
      commitCell(
        row.id,
        column.id,
        withText(currentCell(row.id, column.id), value),
        `db:${row.id}:${column.id}`
      );
    },
    { signal }
  );
  input.addEventListener(
    'focus',
    () => {
      onFocus?.();
      input.value = currentCell(row.id, column.id)?.text ?? '';
      input.select();
    },
    { signal }
  );
  input.addEventListener(
    'blur',
    () => {
      input.value = formatDatabaseNumber(currentCell(row.id, column.id)?.text ?? '', column);
    },
    { signal }
  );
}
