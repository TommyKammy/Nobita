import {
  cloneRuns,
  createDatabaseColumn,
  createDatabaseRow,
  createDatabaseView,
  createId,
  DATABASE_STAT_LABELS,
  databaseCellText,
  databaseFilterGroup,
  databaseSorts,
  databaseStatValue,
  databaseTitleColumn,
  databaseView,
  databaseViewColumnStates,
  databaseViews,
  databaseVisibleColumns,
  filteredDatabaseRows,
  groupedDatabaseRows,
  MAX_DATABASE_COLUMN_WIDTH,
  MIN_DATABASE_COLUMN_WIDTH,
  parseInlineRuns,
  plainText,
  runsLength,
  safeImageSrc,
  searchDatabaseRows,
} from '@nobita/core';
import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseData,
  DatabaseFilter,
  DatabaseFilterGroup,
  DatabaseRow,
  DatabaseView as DatabaseViewConfig,
  DatabaseViewColumn,
  InlineRun,
  PageInfo,
} from '@nobita/core';
import { handleHistoryKey, nativeSelection, placeCaret } from './dom.js';
import { beginWindowDrag, pointAnchor } from './floating.js';
import { icon } from './icons.js';
import { parseTsv, tsvCell } from './tsv.js';
import {
  type CellKind,
  type CellNodes,
  DATABASE_ROWS_MIME,
  FILTER_LABELS,
  TYPE_ICON,
  applyFilesLabel,
  applyImageLabel,
  applyMultiLabel,
  applyPeopleLabel,
  applyProgressState,
  applySelectLabel,
  attachNumberInput,
  btn,
  caretAtBoundary,
  cellForGroupValue,
  cellKey,
  cloneCell,
  convertCell,
  defaultFilterForColumn,
  el,
  formatDatabaseNumber,
  iconBtn,
  mergeOrder,
  parseProgressValue,
  pruneRowIdsFromViews,
  readCellRuns,
  removeColumnFromView,
  renderTextCellContent,
  runsSignature,
  seedGroupSettings,
  selectionOffsets,
  setSelectionOffsets,
  shortcutTag,
  withText,
} from './database-dom.js';
import { DatabaseBoardController } from './database-board.js';
import { DatabaseDetailController } from './database-detail.js';
import { DatabasePopoversController } from './database-popovers.js';
import { DatabaseRichTextController } from './database-rich-text.js';

export type DatabaseImageUploader = (
  file: File
) => string | { src: string } | Promise<string | { src: string }>;

export interface DatabaseHost {
  readonly readonly: boolean;
  readonly uploadImage?: DatabaseImageUploader | undefined;
  resolvePage?: (pageId: string) => PageInfo | null;
  commit(data: DatabaseData, options?: { mergeKey?: string }): void;
  undo(): void;
  redo(): void;
  focusAfter(): void;
}

export class DatabaseView {
  readonly element: HTMLElement;
  #host: DatabaseHost;
  #data: DatabaseData;
  #readonly: boolean;
  #structureKey = '';
  #cells = new Map<string, CellNodes[]>();
  #active: { rowId: string; columnId: string; groupKey?: string } | null = null;
  #range: {
    startRowId: string;
    startColumnId: string;
    endRowId: string;
    endColumnId: string;
    groupKey?: string;
  } | null = null;
  #rangeCells = new Set<string>();
  #selectedRows = new Set<string>();
  #selectedTds = new Set<HTMLTableCellElement>();
  #activeTds = new Set<HTMLTableCellElement>();
  #syncedData: DatabaseData | null = null;
  #pendingFocus: { rowId: string; columnId: string; at: 'start' | 'end' } | null = null;
  #pendingBoardFocus: string | null = null;
  #colElements: HTMLTableColElement[] = [];
  #titleInput: HTMLInputElement | null = null;
  #countElement: HTMLElement | null = null;
  #scrollElement: HTMLElement | null = null;
  #events = new AbortController();
  #contentEvents = new AbortController();
  #globalEvents = new AbortController();
  #readonlyActiveViewId: string | null = null;
  #groupOverrides = new Map<string, { hide?: boolean; collapsed?: boolean }>();
  #groupOverrideVersion = 0;
  #queryCache: {
    data: DatabaseData;
    searchQuery: string;
    readonly: boolean;
    readonlyActiveViewId: string | null;
    overrideVersion: number;
    views: (DatabaseViewConfig & { id: string; name: string })[];
    activeView: DatabaseViewConfig & { id: string; name: string };
    rowsByViewId: Map<string, DatabaseRow[]>;
    groupsByViewId: Map<string, ReturnType<typeof groupedDatabaseRows>>;
    statesByViewId: Map<string, ReturnType<typeof databaseViewColumnStates>>;
  } | null = null;
  #filterBarOpen = new Set<string>();
  #dragSelect: {
    anchorRowId: string;
    anchorColumnId: string;
    groupKey?: string;
    moved: boolean;
  } | null = null;
  #fillHandle: HTMLElement | null = null;
  #fillHandleRaf: number | null = null;
  #visibleKey = '';
  #suppressClick = false;
  #instanceId = createId('db');
  #searchQuery = '';
  #searchOpen = false;
  #narrowSearchMedia: MediaQueryList | null = null;
  #headResizeObserver: ResizeObserver | null = null;
  #isNarrowSearch = false;

  #richText: DatabaseRichTextController;
  #board: DatabaseBoardController;
  #detail: DatabaseDetailController;
  #popovers: DatabasePopoversController;

  #clearNarrowSearch = (): void => {
    this.#searchOpen = false;
    const wrap = this.element.querySelector<HTMLElement>('.nb-db-search-wrap');
    if (wrap) {
      wrap.dataset.open = 'false';
      wrap
        .querySelector<HTMLElement>('.nb-db-search-toggle')
        ?.setAttribute('aria-expanded', 'false');
      const clear = wrap.querySelector<HTMLElement>('.nb-db-search-clear');
      if (clear) clear.tabIndex = -1;
    }
    const input = this.element.querySelector<HTMLInputElement>('.nb-db-search');
    if (input) input.value = '';
    if (!this.#searchQuery) return;
    this.#searchQuery = '';
    this.#renderContent();
  };

  #onNarrowSearchMedia = (event: MediaQueryListEvent): void => {
    if (!event.matches) return;
    this.#clearNarrowSearch();
  };

  constructor(host: DatabaseHost, data: DatabaseData) {
    this.#host = host;
    this.#data = data;
    this.#readonly = host.readonly;
    this.element = el('div', 'nb-db');
    this.element.contentEditable = 'false';
    this.element.tabIndex = -1;
    this.element.dataset.readonly = String(this.#readonly);

    const resolvePage = (pageId: string): PageInfo | null =>
      this.#host.resolvePage?.(pageId) ?? null;

    this.#richText = new DatabaseRichTextController({
      rootElement: this.element,
      getDetailElement: () => this.#detail.element,
      isReadonly: () => this.#readonly,
      getSignal: () => this.#events.signal,
      resolvePage,
    });
    const baseCtx = {
      rootElement: this.element,
      getReadonly: () => this.#readonly,
      getData: () => this.#data,
      activeView: () => this.#activeView(),
      visibleColumns: (view?: DatabaseViewConfig) => this.#visibleColumns(view),
      titleColumn: (view?: DatabaseViewConfig) => this.#titleColumn(view),
      currentCell: (rowId: string, columnId: string) => this.#currentCell(rowId, columnId),
      commitCell: (
        rowId: string,
        colId: string,
        cell: DatabaseCell,
        key?: string
      ) => this.#commitCell(rowId, colId, cell, key),
      history: (redo: boolean) => this.#history(redo),
      richText: this.#richText,
      resolvePage,
    };
    this.#board = new DatabaseBoardController({
      ...baseCtx,
      instanceId: this.#instanceId,
      getSyncedData: () => this.#syncedData,
      getScrollElement: () => this.#scrollElement,
      getContentSignal: () => this.#contentEvents.signal,
      views: () => this.#views(),
      groupsFor: view => this.#groupsFor(view),
      commit: (next, options) => this.#host.commit(next, options),
      commitDeletedRows: ids => this.#commitDeletedRows(ids),
      clearSelectedRow: id => this.#selectedRows.delete(id),
      setPendingBoardFocus: id => {
        this.#pendingBoardFocus = id;
      },
      render: () => this.render(),
      openDetailPanel: rowId => this.#detail.open(rowId),
      openRowPopover: (rowId, anchor) => this.#popovers.openRowPopover(rowId, anchor),
      showPopover: (anchor, content) => this.#popovers.showPopover(anchor, content),
      closePopover: () => this.#popovers.closePopover(),
    });
    this.#detail = new DatabaseDetailController({
      ...baseCtx,
      navigationRows: view => this.#navigationRows(view),
      commitTextRuns: (rowId, colId, runs, key) =>
        this.#commitTextRuns(rowId, colId, runs, key),
      commitRowPage: (rowId, runs, key) => this.#commitRowPage(rowId, runs, key),
      openAddPropertyMenu: anchor => this.#popovers.openAddPropertyMenu(anchor),
      openFilesPopover: (colId, rowId, anchor) =>
        this.#popovers.openFilesPopover(colId, rowId, anchor),
      openPeoplePopover: (colId, rowId, anchor) =>
        this.#popovers.openPeoplePopover(colId, rowId, anchor),
      openImagePopover: (colId, rowId, anchor) =>
        this.#popovers.openImagePopover(colId, rowId, anchor),
    });
    this.#popovers = new DatabasePopoversController({
      ...baseCtx,
      getEventsSignal: () => this.#events.signal,
      getUploadImage: () => this.#host.uploadImage,
      views: () => this.#views(),
      columnStates: view => this.#columnStates(view),
      viewColumns: view => this.#viewColumns(view),
      groupsFor: view => this.#groupsFor(view),
      commit: (next, options) => this.#host.commit(next, options),
      updateActiveView: patch => this.#updateActiveView(patch),
      patchViewColumn: (colId, patch, opts) => this.#patchViewColumn(colId, patch, opts),
      setFilterTree: filter => this.#setFilterTree(filter),
      setGroupProperty: (key, patch) => this.#setGroupProperty(key, patch),
      addView: type => this.#addView(type),
      moveView: dir => this.#moveView(dir),
      moveGroup: (key, dir) => this.#moveGroup(key, dir),
      moveColumn: (colId, dir) => this.#moveColumn(colId, dir),
      duplicateColumn: colId => this.#duplicateColumn(colId),
      deleteColumn: colId => this.#deleteColumn(colId),
      insertColumn: (anchorId, after) => this.#insertColumn(anchorId, after),
      commitColumnFields: (colId, name, type, optionsText, extra) =>
        this.#commitColumnFields(colId, name, type, optionsText, extra),
      addColumnOfType: (type, openSettings) => this.#addColumnOfType(type, openSettings),
      addFilterForColumn: colId => this.#addFilterForColumn(colId),
      defaultGroupColumn: () => this.#defaultGroupColumn(),
      insertRow: (anchorId, after) => this.#insertRow(anchorId, after),
      duplicateRow: rowId => this.#duplicateRow(rowId),
      deleteRow: rowId => this.#deleteRow(rowId),
      openDetailPanel: rowId => this.#detail.open(rowId),
    });

    this.element.addEventListener('copy', this.#onCopy, true);
    this.element.addEventListener('cut', this.#onCut, true);
    this.element.addEventListener('paste', this.#onPaste, true);
    this.element.addEventListener('click', this.#onClickCapture, true);
    this.element.addEventListener('keydown', this.#onDatabaseKeyDown, true);
    const view = this.element.ownerDocument.defaultView;
    if (typeof ResizeObserver !== 'undefined') {
      this.#headResizeObserver = new ResizeObserver(entries => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const width =
          entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        if (!(width > 0)) return;
        const narrow = width <= 560;
        const becameNarrow = narrow && !this.#isNarrowSearch;
        this.#isNarrowSearch = narrow;
        if (becameNarrow) this.#clearNarrowSearch();
      });
    } else {
      this.#narrowSearchMedia = view?.matchMedia('(max-width: 560px)') ?? null;
      this.#narrowSearchMedia?.addEventListener('change', this.#onNarrowSearchMedia);
    }
    const doc = this.element.ownerDocument;
    doc.addEventListener(
      'selectionchange',
      () => this.#richText.handleSelectionChange(),
      { signal: this.#globalEvents.signal }
    );
    view?.addEventListener('scroll', this.#richText.hideToolbar, {
      capture: true,
      passive: true,
      signal: this.#globalEvents.signal,
    });
    this.render();
  }

  update(data: DatabaseData): void {
    if (data === this.#data) return;
    const prev = this.#data;
    this.#data = data;
    const view = databaseView(data);
    if (this.#board.isEditingGroupTitle(view)) {
      this.#updateCount(view);
      return;
    }
    const sameStructure =
      this.#structureKey !== '' &&
      prev.variant === data.variant &&
      prev.columns === data.columns &&
      prev.views === data.views &&
      prev.view === data.view &&
      prev.activeViewId === data.activeViewId &&
      prev.titleColumnId === data.titleColumnId &&
      prev.sort === data.sort &&
      prev.rows.length === data.rows.length &&
      prev.rows.every((row, index) => row.id === data.rows[index]?.id);
    if (sameStructure) {
      const activeView = this.#activeView();
      const plainTableOrder =
        activeView.type === 'table' &&
        !activeView.groupBy &&
        !this.#searchQuery.trim() &&
        databaseFilterGroup(activeView).conditions.length === 0 &&
        databaseSorts(activeView).length === 0 &&
        !data.sort;
      if (plainTableOrder) {
        this.#syncValues();
        return;
      }
      const visibleKey = this.#visibleKeyFor(data);
      if (visibleKey !== this.#visibleKey) {
        this.render();
      } else {
        this.#syncValues();
      }
      return;
    }
    const nextKey = this.#keyFor(data);
    const visibleKey = this.#visibleKeyFor(data);
    if (nextKey !== this.#structureKey || visibleKey !== this.#visibleKey) {
      this.render();
    } else {
      this.#syncValues();
    }
  }

  setReadonly(readonly: boolean): void {
    if (readonly === this.#readonly) return;
    this.#readonly = readonly;
    if (!readonly) {
      this.#readonlyActiveViewId = null;
      if (this.#groupOverrides.size > 0) {
        this.#groupOverrides.clear();
        this.#groupOverrideVersion += 1;
      }
    }
    if (readonly) this.#detail.close({ restoreFocus: false });
    this.element.dataset.readonly = String(readonly);
    this.render();
  }

  focusFirstCell(): void {
    const rows = this.#rowsFor(this.#activeView());
    const row = rows[0];
    const column = this.#visibleColumns(this.#activeView())[0];
    if (!row || !column) {
      if (this.#data.columns.length === 0) this.#addColumn();
      else this.#addRow();
      return;
    }
    this.focusCell(row.id, column.id, 'start');
  }

  focusCell(rowId: string, columnId: string, at: 'start' | 'end' = 'end'): void {
    const nodes = this.#cells.get(cellKey(rowId, columnId))?.[0];
    if (!nodes) return;
    const target = nodes.text ?? nodes.input ?? nodes.button ?? nodes.progress;
    if (!target) return;
    target.focus();
    if (nodes.text) placeCaret(nodes.text, at);
    const groupKey = nodes.td.closest<HTMLElement>('.nb-db-group')?.dataset.group;
    this.#active = {
      rowId,
      columnId,
      ...(groupKey !== undefined ? { groupKey } : {}),
    };
    this.#syncSelectionVisuals();
  }

  destroy(): void {
    this.#cancelFillHandleFrame();
    this.#contentEvents.abort();
    this.#events.abort();
    this.#globalEvents.abort();
    this.#headResizeObserver?.disconnect();
    this.#headResizeObserver = null;
    this.#narrowSearchMedia?.removeEventListener('change', this.#onNarrowSearchMedia);
    this.#narrowSearchMedia = null;
    this.#filterBarOpen.clear();
    this.#selectedTds.clear();
    this.#activeTds.clear();
    this.#syncedData = null;
    this.#queryCache = null;
    this.#scrollElement = null;
    this.#board.destroy();
    this.#richText.destroy();
    this.#popovers.destroy();
    this.#detail.destroy();
    this.element.remove();
  }

  /** ---- query & view state ---- */

  #ensureQueryCache() {
    const readonlyActiveViewId = this.#readonly ? this.#readonlyActiveViewId : null;
    if (
      this.#queryCache &&
      this.#queryCache.data === this.#data &&
      this.#queryCache.searchQuery === this.#searchQuery &&
      this.#queryCache.readonly === this.#readonly &&
      this.#queryCache.readonlyActiveViewId === readonlyActiveViewId &&
      this.#queryCache.overrideVersion === this.#groupOverrideVersion
    ) {
      return this.#queryCache;
    }
    const views = databaseViews(this.#data).map((view, index) => ({
      ...view,
      id: view.id ?? (index === 0 ? 'view-default' : `view-${index}`),
      name: view.name ?? (view.type === 'board' ? 'Board' : 'Table'),
      filters: view.filters ?? [],
    }));
    const activeView =
      (readonlyActiveViewId !== null
        ? views.find(view => view.id === readonlyActiveViewId)
        : undefined) ??
      views.find(view => view.id === this.#data.activeViewId) ??
      views[0]!;
    this.#queryCache = {
      data: this.#data,
      searchQuery: this.#searchQuery,
      readonly: this.#readonly,
      readonlyActiveViewId,
      overrideVersion: this.#groupOverrideVersion,
      views,
      activeView,
      rowsByViewId: new Map(),
      groupsByViewId: new Map(),
      statesByViewId: new Map(),
    };
    return this.#queryCache;
  }

  #views(): (DatabaseViewConfig & { id: string; name: string })[] {
    return this.#ensureQueryCache().views;
  }

  #activeView(): DatabaseViewConfig & { id: string; name: string } {
    return this.#ensureQueryCache().activeView;
  }

  #updateActiveView(patch: Partial<DatabaseViewConfig>): void {
    const active = this.#activeView();
    const views = this.#views().map(view => {
      if (view.id !== active.id) return view;
      const next: DatabaseViewConfig & { id: string; name: string } = {
        ...view,
        ...patch,
        id: active.id,
        name: patch.name ?? view.name,
      };
      if ('coverColumnId' in patch && !patch.coverColumnId) {
        delete next.coverColumnId;
      }
      return next;
    });
    const { view: _legacyView, sort: _legacySort, ...rest } = this.#data;
    this.#host.commit({ ...rest, views, activeViewId: active.id });
  }

  #setActiveView(id: string): void {
    if (id === this.#activeView().id) return;
    if (this.#readonly) {
      this.#readonlyActiveViewId = id;
      this.render();
      return;
    }
    const { view: _legacyView, sort: _legacySort, ...rest } = this.#data;
    this.#host.commit({ ...rest, views: this.#views(), activeViewId: id });
  }

  #viewColumns(view: DatabaseViewConfig = this.#activeView()): DatabaseViewColumn[] {
    return this.#columnStates(view).map(item => {
      const column: DatabaseViewColumn = { id: item.column.id, width: item.width };
      if (item.hide) column.hide = true;
      if (item.stat) column.stat = item.stat;
      return column;
    });
  }

  #viewsWithColumn(
    columnId: string,
    anchorId: string | null,
    after: boolean,
    width = 180,
    copyFromId?: string
  ): DatabaseViewConfig[] {
    return this.#views().map(view => {
      const columns = this.#viewColumns(view);
      if (columns.some(column => column.id === columnId)) return view;
      let index = anchorId
        ? columns.findIndex(column => column.id === anchorId)
        : columns.length;
      if (index < 0) index = columns.length;
      else if (after) index += 1;
      const template = copyFromId
        ? columns.find(column => column.id === copyFromId)
        : undefined;
      columns.splice(index, 0, {
        ...(template ?? { id: columnId, width }),
        id: columnId,
      });
      return { ...view, columns };
    });
  }

  #patchViewColumn(
    columnId: string,
    patch: Partial<DatabaseViewColumn>,
    options: { move?: number } = {}
  ): void {
    const view = this.#activeView();
    const columns = this.#viewColumns(view);
    const index = columns.findIndex(column => column.id === columnId);
    if (index < 0) return;
    const current = columns[index];
    if (current) {
      columns[index] = {
        ...current,
        ...patch,
        id: current.id,
        ...(patch.width !== undefined ? { width: patch.width } : {}),
      };
    }
    if (options.move) {
      const target = index + options.move;
      if (target >= 0 && target < columns.length) {
        const [column] = columns.splice(index, 1);
        if (column) columns.splice(target, 0, column);
      }
    }
    const hiddenColumns = columns.filter(column => column.hide).map(column => column.id);
    this.#updateActiveView({
      columns,
      ...(hiddenColumns.length > 0 ? { hiddenColumns } : { hiddenColumns: [] }),
    });
  }

  #setFilterTree(filter: DatabaseFilterGroup): void {
    const flat: DatabaseFilter[] = filter.conditions.filter(
      (item): item is DatabaseFilter => item.type !== 'group'
    );
    const view = this.#activeView();
    if (filter.conditions.length > 0) this.#filterBarOpen.add(view.id);
    else this.#filterBarOpen.delete(view.id);
    this.#updateActiveView({
      filter,
      filters: flat,
      filterMode: filter.op,
    });
  }

  #setGroupProperty(key: string, patch: { hide?: boolean; collapsed?: boolean }): void {
    if (this.#readonly) {
      this.#groupOverrides.set(key, {
        ...(this.#groupOverrides.get(key) ?? {}),
        ...patch,
      });
      this.#groupOverrideVersion += 1;
      this.render();
      return;
    }
    const view = this.#activeView();
    const groups = seedGroupSettings(
      view.groupProperties ?? [],
      this.#groupsFor(view).map(group => group.key)
    );
    if (!groups.some(group => group.key === key)) groups.push({ key });
    const index = groups.findIndex(group => group.key === key);
    if (index >= 0) {
      const current = groups[index];
      if (current) groups[index] = { ...current, ...patch };
    }
    this.#updateActiveView({ groupProperties: groups });
  }

  #columnStates(
    view: DatabaseViewConfig = this.#activeView()
  ): ReturnType<typeof databaseViewColumnStates> {
    const cache = this.#ensureQueryCache();
    const key = view.id ?? '';
    const cached = cache.statesByViewId.get(key);
    if (cached) return cached;
    const result = databaseViewColumnStates(this.#data, view);
    cache.statesByViewId.set(key, result);
    return result;
  }

  #visibleColumns(view: DatabaseViewConfig = this.#activeView()): DatabaseColumn[] {
    return databaseVisibleColumns(this.#data, view);
  }

  #titleColumn(view: DatabaseViewConfig = this.#activeView()): DatabaseColumn | undefined {
    return databaseTitleColumn(this.#data, view);
  }

  #rowsFor(view: DatabaseViewConfig = this.#activeView()): DatabaseRow[] {
    const cache = this.#ensureQueryCache();
    const key = view.id ?? '';
    const cached = cache.rowsByViewId.get(key);
    if (cached) return cached;
    const filtered = filteredDatabaseRows(this.#data, view);
    const result =
      this.#searchQuery.trim().length > 0
        ? searchDatabaseRows(this.#data, filtered, this.#searchQuery)
        : filtered;
    cache.rowsByViewId.set(key, result);
    return result;
  }

  #groupsFor(
    view: DatabaseViewConfig = this.#activeView()
  ): ReturnType<typeof groupedDatabaseRows> {
    const cache = this.#ensureQueryCache();
    const key = view.id ?? '';
    const cached = cache.groupsByViewId.get(key);
    if (cached) return cached;
    const hasSearch = this.#searchQuery.trim().length > 0;
    const allowed = hasSearch
      ? new Set(this.#rowsFor(view).map(row => row.id))
      : null;
    const hasOverrides = this.#readonly && this.#groupOverrides.size > 0;
    const baseGroups = groupedDatabaseRows(this.#data, view);
    const groups =
      allowed || hasOverrides
        ? baseGroups.map(group => {
            const override = hasOverrides
              ? this.#groupOverrides.get(group.key)
              : undefined;
            return {
              ...group,
              ...(override?.hide !== undefined ? { hidden: override.hide } : {}),
              ...(override?.collapsed !== undefined
                ? { collapsed: override.collapsed }
                : {}),
              ...(allowed
                ? { rows: group.rows.filter(row => allowed.has(row.id)) }
                : {}),
            };
          })
        : baseGroups;
    const result = view.hideEmptyGroups
      ? groups.filter(group => group.rows.length > 0)
      : groups;
    cache.groupsByViewId.set(key, result);
    return result;
  }

  #keyFor(data: DatabaseData): string {
    const views = data.views ?? (data.view ? [data.view] : []);
    return JSON.stringify({
      readonly: this.#readonly,
      variant: data.variant,
      columns: data.columns.map(column => [
        column.id,
        column.name,
        column.type,
        column.options?.join('\u0001') ?? '',
        column.data ?? null,
      ]),
      rows: data.rows.map(row => row.id),
      activeViewId: data.activeViewId ?? null,
      titleColumnId: data.titleColumnId ?? null,
      views: views.map(view => ({
        id: view.id ?? null,
        name: view.name ?? null,
        type: view.type,
        filter: view.filter ?? null,
        filters: view.filters,
        filterMode: view.filterMode ?? 'and',
        groupBy: view.groupBy ?? null,
        groupProperties: view.groupProperties ?? [],
        hideEmptyGroups: view.hideEmptyGroups === true,
        sorts: view.sorts ?? (view.sort ? [view.sort] : []),
        columns: view.columns ?? [],
        hiddenColumns: view.hiddenColumns ?? [],
        stats: view.stats ?? {},
        header: view.header ?? null,
        coverColumnId: view.coverColumnId ?? null,
      })),
      sort: data.sort ?? null,
    });
  }

  #visibleKeyFor(
    data: DatabaseData,
    view: DatabaseViewConfig = data === this.#data ? this.#activeView() : databaseView(data)
  ): string {
    if (data === this.#data) {
      if (view.type === 'board' || view.groupBy) {
        return this.#groupsFor(view)
          .map(group => `${group.key}:${group.rows.map(row => row.id).join(',')}`)
          .join('\u0001');
      }
      return this.#rowsFor(view).map(row => row.id).join('\u0001');
    }
    const allowed = new Set(
      searchDatabaseRows(data, filteredDatabaseRows(data, view), this.#searchQuery).map(row => row.id)
    );
    if (view.type === 'board' || view.groupBy) {
      return groupedDatabaseRows(data, view)
        .map(group => `${group.key}:${group.rows.filter(row => allowed.has(row.id)).map(row => row.id).join(',')}`)
        .join('\u0001');
    }
    return [...allowed].join('\u0001');
  }

  /** ---- rendering ---- */

  render(): void {
    const detailRowId = this.#detail.rowId;
    if (detailRowId && !this.#data.rows.some(row => row.id === detailRowId)) {
      this.#detail.close();
    }
    this.#board.destroy();
    this.#cancelFillHandleFrame();
    this.#contentEvents.abort();
    this.#contentEvents = new AbortController();
    this.#events.abort();
    this.#events = new AbortController();
    this.#popovers.closePopover();
    this.#richText.clearPendingMarks();
    const hadFocus = this.element.contains((this.element.getRootNode() as ShadowRoot).activeElement);
    const view = this.#activeView();
    this.#structureKey = this.#keyFor(this.#data);
    this.#visibleKey = this.#visibleKeyFor(this.#data, view);
    this.element.dataset.readonly = String(this.#readonly);
    this.element.dataset.view = view.type;
    this.element.replaceChildren();
    this.#richText.resetToolbar();
    this.#scrollElement = null;

    const head = el('div', 'nb-db-head');
    const headTop = el('div', 'nb-db-head-top');
    const title = el('span', 'nb-db-title');
    const titleIcon = document.createElement('span');
    titleIcon.innerHTML = this.#data.variant === 'table' ? icon.table : icon.database;
    const titleInput = el('input', 'nb-db-title-input');
    titleInput.value = this.#data.title ?? '';
    titleInput.placeholder = this.#data.variant === 'table' ? 'Untitled table' : 'Untitled database';
    titleInput.disabled = this.#readonly;
    titleInput.setAttribute('aria-label', 'Database title');
    titleInput.addEventListener('input', () => {
      const value = titleInput.value.replace(/\r?\n/gu, ' ').slice(0, 200);
      if ((this.#data.title ?? '') === value) return;
      this.#host.commit({ ...this.#data, title: value }, { mergeKey: 'db:title' });
    }, { signal: this.#events.signal });
    this.#titleInput = titleInput;
    title.append(titleIcon, titleInput);
    const count = el('span', 'nb-db-count');
    this.#countElement = count;

    const tools = el('div', 'nb-db-tools');
    this.#renderToolButtons(view, tools);
    if (!this.#readonly) {
      const addRecord = btn('nb-db-btn nb-db-new-record-toolbar', {
        html: `${icon.plus}<span>New Record</span>`,
        title: 'Add record',
      });
      addRecord.addEventListener('click', () => {
        const rowId = this.#addRow();
        if (rowId) {
          requestAnimationFrame(() => this.#detail.open(rowId));
        }
      }, { signal: this.#events.signal });
      tools.append(addRecord);
    }
    headTop.append(title, count);
    const bar = el('div', 'nb-db-bar');
    bar.append(this.#renderViewBar(view), tools);
    head.append(headTop, bar);

    const scroll = el('div', 'nb-db-scroll');
    scroll.dataset.view = view.type;
    this.#scrollElement = scroll;
    const fillHandle = el('div', 'nb-db-fill-handle');
    fillHandle.dataset.visible = 'false';
    fillHandle.setAttribute('role', 'button');
    fillHandle.setAttribute('aria-label', 'Fill selected cells');
    fillHandle.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      this.#beginFillDrag();
    }, { signal: this.#events.signal });
    this.element.append(fillHandle);
    this.#fillHandle = fillHandle;
    scroll.addEventListener('scroll', () => this.#scheduleFillHandlePosition(), {
      signal: this.#events.signal,
      passive: true,
    });
    window.addEventListener('scroll', () => this.#scheduleFillHandlePosition(), {
      signal: this.#events.signal,
      passive: true,
    });

    const filterBar = this.#renderFilterBar(view);
    this.element.append(head);
    if (this.#headResizeObserver) {
      this.#headResizeObserver.disconnect();
      this.#headResizeObserver.observe(head);
    }
    if (filterBar) this.element.append(filterBar);
    this.element.append(scroll);
    this.#renderContent();

    if (view.type === 'table' && this.#pendingFocus) {
      const pending = this.#pendingFocus;
      this.#pendingFocus = null;
      this.focusCell(pending.rowId, pending.columnId, pending.at);
    } else if (view.type === 'table' && hadFocus && this.#active) {
      this.focusCell(this.#active.rowId, this.#active.columnId, 'end');
    } else if (view.type === 'board' && this.#pendingBoardFocus) {
      const rowId = this.#pendingBoardFocus;
      this.#pendingBoardFocus = null;
      requestAnimationFrame(() => {
        const cardTitle = this.element.querySelector<HTMLElement>(
          `.nb-db-card[data-row-id="${CSS.escape(rowId)}"] .nb-db-card-title`
        );
        if (!cardTitle || cardTitle.contentEditable !== 'true') return;
        cardTitle.focus();
        placeCaret(cardTitle, 'end');
      });
    }
    this.#syncedData = this.#data;
  }

  #renderContent(): void {
    const scroll = this.#scrollElement;
    if (!scroll) return;
    const view = this.#activeView();
    this.#board.destroy();
    this.#cancelFillHandleFrame();
    this.#contentEvents.abort();
    this.#contentEvents = new AbortController();
    this.#popovers.closePopover();
    this.#richText.clearPendingMarks(scroll);
    this.#cells.clear();
    this.#selectedTds.clear();
    this.#activeTds.clear();
    this.#clearRange();
    this.#colElements = [];
    this.#visibleKey = this.#visibleKeyFor(this.#data, view);
    scroll.dataset.view = view.type;
    scroll.replaceChildren(
      view.type === 'board' ? this.#board.render(view) : this.#renderTable(view)
    );
    this.#updateCount(view);
    this.#detail.sync();
    this.#syncRowSelection();
    this.#syncedData = this.#data;
  }

  #renderFilterBar(view: DatabaseViewConfig): HTMLElement | null {
    const group = databaseFilterGroup(view);
    if (group.conditions.length === 0) return null;
    const viewId = this.#activeView().id;
    if (!this.#readonly && !this.#filterBarOpen.has(viewId)) return null;
    const bar = el('div', 'nb-db-filter-bar');
    bar.id = `${this.#instanceId}-filters`;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Active filters');
    for (const condition of group.conditions) {
      let text: string;
      if (condition.type === 'group') {
        const count = condition.conditions.length;
        text = `${count} ${count === 1 ? 'rule' : 'rules'}`;
      } else {
        const column = this.#data.columns.find(item => item.id === condition.columnId);
        if (!column) continue;
        const operator = FILTER_LABELS[condition.operator] ?? condition.operator;
        text = `${column.name} ${operator}${condition.value ? ` ${condition.value}` : ''}`;
      }
      const chip = btn('nb-db-filter-chip', { text });
      chip.addEventListener('click', () => this.#popovers.openFilterPopover(chip), {
        signal: this.#events.signal,
      });
      bar.append(chip);
    }
    if (!this.#readonly) {
      const add = btn('nb-db-filter-add-chip', { text: '+ Add filter' });
      add.addEventListener('click', () => this.#popovers.openFilterPopover(add), {
        signal: this.#events.signal,
      });
      bar.append(add);
    }
    return bar;
  }

  #renderViewBar(view: DatabaseViewConfig): HTMLElement {
    const bar = el('div', 'nb-db-viewbar');
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Database views');
    for (const item of this.#views()) {
      const button = btn('nb-db-viewtab', {
        title: item.name,
        dataset: { active: String(item.id === view.id) },
      });
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(item.id === view.id));
      const typeIcon = el('span', 'nb-db-viewtab-icon');
      typeIcon.innerHTML = item.type === 'board' ? icon.database : icon.table;
      button.append(typeIcon, el('span', undefined, item.name));
      button.addEventListener(
        'click',
        () => {
          if (item.id === view.id) this.#popovers.openViewMenu(button);
          else this.#setActiveView(item.id);
        },
        { signal: this.#events.signal }
      );
      bar.append(button);
    }
    if (!this.#readonly) {
      const add = btn('nb-db-viewtab nb-db-viewadd', {
        text: '+',
        title: 'Add view',
        ariaLabel: 'Add view',
      });
      add.addEventListener('click', () => this.#popovers.openAddViewMenu(add), {
        signal: this.#events.signal,
      });
      bar.append(add);
    }
    return bar;
  }

  #renderToolButtons(view: DatabaseViewConfig, tools: HTMLElement): void {
    if (!this.#readonly) {
      const viewId = this.#activeView().id;
      const activeFilterCount = databaseFilterGroup(view).conditions.length;
      const filter = btn('nb-db-btn', {
        html: `${icon.filter}<span class="nb-db-btn-label">${activeFilterCount > 0 ? `Filter (${activeFilterCount})` : 'Filter'}</span>`,
        title: 'Filter rows',
        ariaLabel: activeFilterCount > 0 ? `Filter, ${activeFilterCount} active` : 'Filter rows',
        dataset: {
          active: String(activeFilterCount > 0),
          filterToggle: 'true',
        },
      });
      if (activeFilterCount > 0) {
        const open = this.#filterBarOpen.has(viewId);
        filter.setAttribute('aria-expanded', String(open));
        if (open) filter.setAttribute('aria-controls', `${this.#instanceId}-filters`);
        else filter.removeAttribute('aria-controls');
      }
      filter.addEventListener('click', () => {
        if (databaseFilterGroup(view).conditions.length === 0) {
          this.#popovers.openFilterPopover(filter);
          return;
        }
        if (this.#filterBarOpen.has(viewId)) this.#filterBarOpen.delete(viewId);
        else this.#filterBarOpen.add(viewId);
        this.render();
        requestAnimationFrame(() => {
          if (!this.element.isConnected) return;
          this.element
            .querySelector<HTMLButtonElement>('[data-filter-toggle="true"]')
            ?.focus();
        });
      }, { signal: this.#events.signal });
      tools.append(filter);
    }

    this.#renderSearch(tools);

    if (this.#readonly) return;
    const options = iconBtn('nb-db-btn nb-db-viewmore', icon.more, 'View settings');
    options.addEventListener('click', () => this.#popovers.openViewMenu(options), {
      signal: this.#events.signal,
    });
    tools.append(options);
  }

  #renderSearch(tools: HTMLElement): void {
    const wrap = el('div', 'nb-db-search-wrap');
    const toggle = iconBtn('nb-db-search-toggle', icon.search, 'Search', {
      title: 'Search rows',
    });
    const search = el('input', 'nb-db-search');
    search.type = 'search';
    search.placeholder = 'Search';
    search.value = this.#searchQuery;
    search.setAttribute('aria-label', 'Search rows');
    const clear = iconBtn('nb-db-search-clear', icon.x, 'Clear search');

    const setOpen = (open: boolean): void => {
      this.#searchOpen = open;
      wrap.dataset.open = String(open);
      toggle.setAttribute('aria-expanded', String(open));
      clear.tabIndex = open ? 0 : -1;
    };
    setOpen(this.#searchOpen || this.#searchQuery.length > 0);

    let composing = false;
    const applySearch = (): void => {
      setOpen(true);
      this.#searchQuery = search.value;
      this.#renderContent();
    };
    const clearSearch = (): void => {
      composing = false;
      search.value = '';
      this.#searchQuery = '';
      setOpen(true);
      search.focus();
      this.#renderContent();
    };

    toggle.addEventListener('click', () => {
      setOpen(true);
      search.focus();
    }, { signal: this.#events.signal });
    search.addEventListener('focus', () => setOpen(true), { signal: this.#events.signal });
    search.addEventListener('blur', () => {
      if (!wrap.isConnected || search.value) return;
      setOpen(false);
    }, { signal: this.#events.signal });
    search.addEventListener('compositionstart', () => {
      composing = true;
    }, { signal: this.#events.signal });
    search.addEventListener('compositionend', () => {
      composing = false;
      applySearch();
    }, { signal: this.#events.signal });
    search.addEventListener('input', event => {
      if (composing || (event as InputEvent).isComposing) return;
      applySearch();
    }, { signal: this.#events.signal });
    search.addEventListener('keydown', event => {
      if (composing || this.#richText.isComposingKey(event, search)) return;
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (search.value) {
        clearSearch();
        return;
      }
      setOpen(false);
      search.blur();
      toggle.focus();
    }, { signal: this.#events.signal });
    clear.addEventListener('mousedown', event => event.preventDefault(), {
      signal: this.#events.signal,
    });
    clear.addEventListener('click', () => {
      if (!search.value && !this.#searchQuery) {
        setOpen(false);
        search.blur();
        toggle.focus();
        return;
      }
      clearSearch();
    }, { signal: this.#events.signal });

    wrap.append(toggle, search, clear);
    tools.append(wrap);
  }

  #nextViewName(type: 'table' | 'board'): string {
    const base = type === 'board' ? 'Board' : 'Table';
    const names = new Set(this.#views().map(view => view.name));
    if (!names.has(base)) return base;
    let count = 2;
    while (names.has(`${base} ${count}`)) count += 1;
    return `${base} ${count}`;
  }

  #addView(type: 'table' | 'board'): void {
    if (this.#views().length >= 100) return;
    const view = createDatabaseView(type, this.#nextViewName(type));
    view.columns = this.#viewColumns().map(column => ({
      id: column.id,
      ...(column.width !== undefined ? { width: column.width } : {}),
    }));
    if (type === 'board') {
      const groupBy = this.#defaultGroupColumn();
      if (groupBy) view.groupBy = groupBy;
    }
    const views = [...this.#views(), view];
    const { view: _legacyView, sort: _legacySort, ...rest } = this.#data;
    this.#host.commit({ ...rest, views, activeViewId: view.id });
  }

  #moveView(direction: 1 | -1): void {
    const views = this.#views();
    const active = this.#activeView();
    const index = views.findIndex(view => view.id === active.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= views.length) return;
    const next = [...views];
    const [view] = next.splice(index, 1);
    if (!view) return;
    next.splice(target, 0, view);
    const { view: _legacyView, sort: _legacySort, ...rest } = this.#data;
    this.#host.commit({ ...rest, views: next, activeViewId: view.id });
  }

  /** ---- table rendering ---- */

  #renderTable(view: DatabaseViewConfig): HTMLElement {
    const wrapper = el('div', 'nb-db-table-area');
    const columns = this.#visibleColumns(view);
    if (view.groupBy) {
      const groups = this.#groupsFor(view);
      if (groups.length === 0) {
        wrapper.append(el('div', 'nb-db-empty', 'No groups'));
        return wrapper;
      }
      const visibleGroups = groups.filter(group => !group.hidden);
      if (visibleGroups.length === 0) {
        wrapper.append(el('div', 'nb-db-empty', 'All groups are hidden'));
        return wrapper;
      }
      for (const group of visibleGroups) {
        const section = el('section', 'nb-db-group');
        section.dataset.group = group.key;
        const heading = el('div', 'nb-db-group-head');
        const collapsed = Boolean(group.collapsed);
        const toggle = btn('nb-db-group-toggle', {
          ariaLabel: collapsed ? 'Expand group' : 'Collapse group',
        });
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.append(el('span', 'nb-db-group-chevron', collapsed ? '▸' : '▾'));
        toggle.addEventListener('click', event => {
          event.stopPropagation();
          this.#setGroupProperty(group.key, { collapsed: !collapsed });
        }, { signal: this.#contentEvents.signal });
        const addRow = iconBtn(
          'nb-db-group-add',
          icon.plus,
          `Add row to ${group.label || 'group'}`,
          { title: 'Add row to group', disabled: this.#readonly }
        );
        addRow.addEventListener('click', event => {
          event.stopPropagation();
          this.#addRow(undefined, group.key);
        }, { signal: this.#contentEvents.signal });
        heading.append(
          toggle,
          el('span', 'nb-db-group-label', group.label || 'No value'),
          el('span', 'nb-db-group-count', String(group.rows.length)),
          addRow
        );
        heading.addEventListener('click', () => {
          this.#setGroupProperty(group.key, { collapsed: !collapsed });
        }, { signal: this.#contentEvents.signal });
        section.append(heading);
        if (!collapsed) {
          section.append(this.#renderTableGrid(view, columns, group.rows, group.key));
        }
        wrapper.append(section);
      }
      return wrapper;
    }
    wrapper.append(this.#renderTableGrid(view, columns, this.#rowsFor(view)));
    return wrapper;
  }

  #renderTableGrid(
    view: DatabaseViewConfig,
    columns: readonly DatabaseColumn[],
    rows: readonly DatabaseRow[],
    groupKey?: string
  ): HTMLTableElement {
    const table = el('table', 'nb-db-table');
    table.setAttribute('aria-label', this.#data.title?.trim() || 'Database');
    const states = this.#columnStates(view).filter(state =>
      columns.some(column => column.id === state.column.id)
    );
    const titleColumn = this.#titleColumn(view);
    const opsColumnId =
      titleColumn && columns.some(column => column.id === titleColumn.id)
        ? titleColumn.id
        : columns[0]?.id;
    table.append(
      this.#renderTableColgroup(states),
      this.#renderTableHead(view, states),
      this.#renderTableBody(columns, rows, opsColumnId, groupKey),
      this.#renderTableFoot(columns, rows, states, groupKey)
    );
    return table;
  }

  #renderTableColgroup(
    states: ReturnType<typeof databaseViewColumnStates>
  ): HTMLTableColElement {
    const colgroup = document.createElement('colgroup');
    const handleCol = document.createElement('col');
    handleCol.style.width = '24px';
    colgroup.append(handleCol);
    for (const state of states) {
      const col = document.createElement('col');
      col.style.width = `${state.width}px`;
      this.#colElements.push(col);
      colgroup.append(col);
    }
    // Absorb leftover width so the 24px gutter and 40px add-column stay fixed.
    colgroup.append(document.createElement('col'));
    const addCol = document.createElement('col');
    addCol.style.width = '40px';
    colgroup.append(addCol);
    return colgroup;
  }

  #renderTableHead(
    view: DatabaseViewConfig,
    states: ReturnType<typeof databaseViewColumnStates>
  ): HTMLTableSectionElement {
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.append(el('th', 'nb-db-handle nb-db-corner'));
    const sorts = databaseSorts(view);
    const colById = new Map(states.map(state => [state.column.id, state.column]));
    for (const state of states) {
      const column = state.column;
      const th = el('th', 'nb-db-th');
      th.scope = 'col';
      th.dataset.columnId = column.id;
      const button = btn('nb-db-col-head', {
        ariaLabel: `Edit column ${column.name}`,
        disabled: this.#readonly,
      });
      const typeIcon = el('span', 'nb-db-typeicon');
      typeIcon.innerHTML = TYPE_ICON[column.type] ?? icon.text;
      button.append(typeIcon, el('span', 'nb-db-colname', column.name));
      const sortIndex = sorts.findIndex(sort => sort.columnId === column.id);
      if (sortIndex >= 0) {
        const direction = sorts[sortIndex]?.direction === 'desc' ? '↓' : '↑';
        button.append(
          el('span', 'nb-db-sort', sorts.length > 1 ? `${sortIndex + 1}${direction}` : direction)
        );
      }
      const chevron = el('span', 'nb-db-colhead-chevron');
      chevron.innerHTML = icon.chevron;
      button.append(chevron);
      const resizer = el('span', 'nb-db-resizer');
      resizer.setAttribute('role', 'separator');
      resizer.setAttribute('aria-orientation', 'vertical');
      resizer.setAttribute('aria-label', `Resize ${column.name}`);
      th.append(button, resizer);
      headRow.append(th);
    }
    const spacerHead = el('th', 'nb-db-spacer');
    spacerHead.setAttribute('aria-hidden', 'true');
    headRow.append(spacerHead);
    const addHead = el('th', 'nb-db-add-column-head');
    if (!this.#readonly) {
      addHead.append(iconBtn('nb-db-add-column', icon.plus, 'Add column'));
    }
    headRow.append(addHead);
    thead.append(headRow);

    const signal = this.#contentEvents.signal;
    thead.addEventListener('click', event => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest('.nb-db-add-column')) {
        this.#addColumn();
        return;
      }
      const colHead = target.closest<HTMLElement>('.nb-db-col-head');
      const columnId = colHead?.closest<HTMLElement>('th.nb-db-th')?.dataset.columnId;
      if (colHead && columnId) {
        this.#popovers.openColumnPopover(columnId, colHead);
      }
    }, { signal });
    thead.addEventListener('contextmenu', event => {
      if (this.#readonly || event.shiftKey) return;
      const th = (event.target as Element | null)?.closest<HTMLElement>(
        'th.nb-db-th[data-column-id]'
      );
      if (!th?.dataset.columnId) return;
      event.preventDefault();
      event.stopPropagation();
      this.#popovers.openColumnPopover(
        th.dataset.columnId,
        pointAnchor(event.clientX, event.clientY)
      );
    }, { signal });
    thead.addEventListener('pointerdown', event => {
      const target = event.target as Element | null;
      if (!target) return;
      const th = target.closest<HTMLElement>('th.nb-db-th[data-column-id]');
      const columnId = th?.dataset.columnId;
      if (!columnId) return;
      if (target.closest('.nb-db-resizer')) {
        const column = colById.get(columnId);
        if (column) this.#startColumnResize(event, column);
        return;
      }
      this.#beginColumnDrag(event, columnId);
    }, { signal });

    return thead;
  }

  #renderTableBody(
    columns: readonly DatabaseColumn[],
    rows: readonly DatabaseRow[],
    opsColumnId: string | undefined,
    groupKey?: string
  ): HTMLTableSectionElement {
    const tbody = document.createElement('tbody');
    for (const row of rows) {
      tbody.append(this.#renderTableRow(row, columns, opsColumnId));
    }
    if (rows.length === 0) {
      const empty = el('tr', 'nb-db-empty-row');
      const td = el(
        'td',
        'nb-db-empty',
        this.#readonly ? 'No rows' : 'No rows yet. Add one below.'
      );
      td.colSpan = Math.max(1, columns.length + 3);
      empty.append(td);
      tbody.append(empty);
    }

    const signal = this.#contentEvents.signal;
    tbody.addEventListener('pointerdown', event => {
      const target = event.target as Element | null;
      if (!target) return;
      const grip = target.closest('.nb-db-row-grip');
      if (grip) {
        const rowId = grip.closest<HTMLElement>('tr[data-row-id]')?.dataset.rowId;
        if (rowId) this.#beginRowDrag(event, rowId, groupKey);
        return;
      }
      if (target.closest('.nb-db-row-ops')) return;
      const cell = target.closest<HTMLElement>('td.nb-db-cell[data-row-id][data-column-id]');
      if (cell?.dataset.rowId && cell.dataset.columnId) {
        this.#onCellPointerDown(event, cell, cell.dataset.rowId, cell.dataset.columnId);
      }
    }, { signal });
    tbody.addEventListener('click', event => {
      const target = event.target as Element | null;
      if (!target) return;
      const expand = target.closest('.nb-db-row-expand');
      if (expand) {
        event.stopPropagation();
        const rowId = expand.closest<HTMLElement>('tr[data-row-id]')?.dataset.rowId;
        if (rowId) this.#detail.open(rowId);
        return;
      }
      const menu = target.closest<HTMLElement>('.nb-db-rowmenu');
      if (menu) {
        event.stopPropagation();
        const rowId = menu.closest<HTMLElement>('tr[data-row-id]')?.dataset.rowId;
        if (rowId) this.#popovers.openRowPopover(rowId, menu);
        return;
      }
      const check = target.closest('.nb-db-row-check');
      if (check) {
        event.preventDefault();
        const rowId = check.closest<HTMLElement>('tr[data-row-id]')?.dataset.rowId;
        if (rowId) this.#toggleRowSelection(rowId);
        return;
      }
      const grip = target.closest('.nb-db-row-grip');
      if (grip) {
        const rowId = grip.closest<HTMLElement>('tr[data-row-id]')?.dataset.rowId;
        if (rowId) this.#toggleRowSelection(rowId);
      }
    }, { signal });
    tbody.addEventListener('contextmenu', event => {
      if (this.#readonly || event.shiftKey) return;
      const tr = (event.target as Element | null)?.closest<HTMLElement>('tr[data-row-id]');
      if (!tr?.dataset.rowId) return;
      event.preventDefault();
      event.stopPropagation();
      this.#richText.hideToolbar();
      this.#popovers.openRowPopover(tr.dataset.rowId, pointAnchor(event.clientX, event.clientY));
    }, { signal });

    return tbody;
  }

  #renderTableRow(
    row: DatabaseRow,
    columns: readonly DatabaseColumn[],
    opsColumnId: string | undefined
  ): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.dataset.rowId = row.id;
    tr.classList.toggle('is-row-selected', this.#selectedRows.has(row.id));
    const handle = el('td', 'nb-db-handle');
    if (!this.#readonly) {
      const grip = iconBtn('nb-db-row-grip', icon.more, 'Select row');
      const check = iconBtn('nb-db-row-check', icon.checkboxSquare, 'Select row', {
        dataset: { rowId: row.id },
      });
      check.setAttribute('role', 'checkbox');
      check.setAttribute('aria-checked', String(this.#selectedRows.has(row.id)));
      handle.append(grip, check);
    }
    tr.append(handle);
    for (const column of columns) {
      const td = this.#createCell(row, column);
      if (column.id === opsColumnId) {
        td.classList.add('has-row-ops');
        td.append(this.#renderRowOperations());
      }
      tr.append(td);
    }
    tr.append(el('td', 'nb-db-spacer'), el('td', 'nb-db-add-cell'));
    return tr;
  }

  #renderRowOperations(): HTMLElement {
    const ops = el('div', 'nb-db-row-ops');
    ops.append(iconBtn('nb-db-row-expand', icon.expand, 'Expand row'));
    if (!this.#readonly) {
      ops.append(iconBtn('nb-db-rowmenu', icon.more, 'Row actions'));
    }
    return ops;
  }

  #renderTableFoot(
    columns: readonly DatabaseColumn[],
    rows: readonly DatabaseRow[],
    states: ReturnType<typeof databaseViewColumnStates>,
    groupKey?: string
  ): HTMLTableSectionElement {
    const tfoot = document.createElement('tfoot');
    if (states.length > 0) {
      const footRow = document.createElement('tr');
      footRow.append(el('td', 'nb-db-handle nb-db-foot-handle'));
      for (const state of states) {
        const td = el('td', 'nb-db-foot');
        const stat = state.stat;
        const button = btn('nb-db-stat', {
          text: stat
            ? `${DATABASE_STAT_LABELS[stat]}: ${databaseStatValue(rows, state.column, stat)}`
            : 'Calculate',
          disabled: this.#readonly,
          dataset: {
            statColumn: state.column.id,
            calculated: String(Boolean(stat)),
          },
        });
        button.addEventListener(
          'click',
          () => this.#popovers.openStatPopover(state.column.id, button, rows),
          { signal: this.#contentEvents.signal }
        );
        td.append(button);
        footRow.append(td);
      }
      footRow.append(el('td', 'nb-db-spacer'), el('td', 'nb-db-foot nb-db-add-cell'));
      tfoot.append(footRow);
    }
    if (!this.#readonly) {
      const addRowRow = el('tr', 'nb-db-new-record-row');
      const addRowCell = document.createElement('td');
      addRowCell.colSpan = Math.max(1, columns.length + 3);
      const addRow = btn('nb-db-new-record');
      const addRowLabel = el('span', 'nb-db-new-record-label');
      addRowLabel.innerHTML = `${icon.plus}<span>New Record</span>`;
      addRow.append(addRowLabel);
      addRow.addEventListener('click', () => this.#addRow(undefined, groupKey), {
        signal: this.#contentEvents.signal,
      });
      addRowCell.append(addRow);
      addRowRow.append(addRowCell);
      tfoot.append(addRowRow);
    }
    return tfoot;
  }

  /** ---- table drag, resize, selection & sync ---- */

  #history(redo: boolean): void {
    if (this.#readonly) return;
    if (redo) this.#host.redo();
    else this.#host.undo();
    this.#board.syncValues(true);
  }

  #defaultGroupColumn(): string | undefined {
    const columns = this.#visibleColumns();
    return (
      columns.find(column =>
        ['select', 'multi-select', 'checkbox'].includes(column.type)
      )?.id ?? columns[0]?.id
    );
  }

  #startColumnResize(event: PointerEvent, column: DatabaseColumn): void {
    if (this.#readonly) return;
    const index = this.#visibleColumns(this.#activeView()).findIndex(item => item.id === column.id);
    const col = this.#colElements[index];
    if (!col) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = col.getBoundingClientRect().width;
    beginWindowDrag(
      this.#contentEvents.signal,
      moveEvent => {
        const width = Math.max(
          MIN_DATABASE_COLUMN_WIDTH,
          Math.min(
            MAX_DATABASE_COLUMN_WIDTH,
            Math.round(startWidth + moveEvent.clientX - startX)
          )
        );
        col.style.width = `${width}px`;
      },
      () => {
        const width = Number.parseFloat(col.style.width);
        if (Number.isFinite(width)) this.#commitColumnWidth(column.id, width);
      }
    );
  }

  #moveGroup(key: string, direction: 1 | -1): void {
    const view = this.#activeView();
    if (!view.groupBy) return;
    const groups = this.#groupsFor(view);
    const index = groups.findIndex(group => group.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= groups.length) return;
    const keys = groups.map(group => group.key);
    const [keyValue] = keys.splice(index, 1);
    if (keyValue === undefined) return;
    keys.splice(target, 0, keyValue);
    const settings = view.groupProperties ?? [];
    const byKey = new Map(settings.map(group => [group.key, group]));
    const order = mergeOrder(settings.map(group => group.key), keys);
    this.#updateActiveView({
      groupProperties: order.map(groupKey => byKey.get(groupKey) ?? { key: groupKey }),
    });
  }

  #toggleRowSelection(rowId: string): void {
    if (this.#readonly) return;
    if (this.#selectedRows.has(rowId)) this.#selectedRows.delete(rowId);
    else this.#selectedRows.add(rowId);
    this.#syncRowSelection();
    this.element.focus({ preventScroll: true });
  }

  #syncRowSelection(): void {
    for (const tr of this.element.querySelectorAll<HTMLElement>(
      '.nb-db-table tbody tr[data-row-id]'
    )) {
      const selected = tr.dataset.rowId ? this.#selectedRows.has(tr.dataset.rowId) : false;
      tr.classList.toggle('is-row-selected', selected);
      tr.querySelector<HTMLElement>('.nb-db-row-check')?.setAttribute(
        'aria-checked',
        String(selected)
      );
    }
    this.#syncSelectionVisuals();
  }

  #deleteSelectedRows(): void {
    const selected = this.#selectedVisibleRows();
    if (selected.length === 0) return;
    const ids = new Set(selected.map(row => row.id));
    for (const id of ids) this.#selectedRows.delete(id);
    this.#commitDeletedRows(ids);
  }

  #selectedVisibleRows(): DatabaseRow[] {
    if (this.#selectedRows.size === 0) return [];
    const seen = new Set<string>();
    const rows: DatabaseRow[] = [];
    for (const row of this.#renderedRows(this.#activeView())) {
      if (!this.#selectedRows.has(row.id) || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    return rows;
  }

  #addFilterForColumn(columnId: string): void {
    const column = this.#data.columns.find(item => item.id === columnId);
    if (!column) return;
    const group = databaseFilterGroup(this.#activeView());
    this.#setFilterTree({
      ...group,
      conditions: [...group.conditions, defaultFilterForColumn(column)],
    });
  }

  #moveColumn(columnId: string, direction: 1 | -1): void {
    this.#patchViewColumn(columnId, {}, { move: direction });
  }

  #beginThresholdDrag(
    event: PointerEvent,
    onDrop: (endEvent: PointerEvent) => void
  ): void {
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    beginWindowDrag(
      this.#contentEvents.signal,
      moveEvent => {
        if (
          Math.abs(moveEvent.clientX - startX) < 6 &&
          Math.abs(moveEvent.clientY - startY) < 6
        ) {
          return;
        }
        moved = true;
      },
      endEvent => {
        if (!moved) return;
        this.#suppressClick = true;
        window.setTimeout(() => {
          this.#suppressClick = false;
        }, 0);
        onDrop(endEvent);
      }
    );
  }

  #beginColumnDrag(event: PointerEvent, columnId: string): void {
    if (this.#readonly || event.button !== 0) return;
    if ((event.target as Element | null)?.closest('.nb-db-resizer')) return;
    this.#beginThresholdDrag(event, endEvent => {
      const target = this.#headerColumnFromEvent(endEvent);
      if (target && target !== columnId) this.#moveColumnTo(columnId, target);
    });
  }

  #headerColumnFromEvent(event: Event): string | undefined {
    for (const node of event.composedPath()) {
      if (node instanceof HTMLElement && node.classList.contains('nb-db-th')) {
        return node.dataset.columnId;
      }
    }
    return undefined;
  }

  #moveColumnTo(columnId: string, targetId: string): void {
    const view = this.#activeView();
    const columns = this.#viewColumns(view);
    const from = columns.findIndex(column => column.id === columnId);
    const to = columns.findIndex(column => column.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const [column] = columns.splice(from, 1);
    if (!column) return;
    columns.splice(to, 0, column);
    this.#updateActiveView({ columns });
  }

  #beginRowDrag(event: PointerEvent, rowId: string, groupKey?: string): void {
    if (this.#readonly || event.button !== 0) return;
    this.#beginThresholdDrag(event, endEvent => {
      const target = this.#rowFromEvent(endEvent);
      if (target && target !== rowId) this.#moveRowTo(rowId, target, groupKey);
    });
  }

  #rowFromEvent(event: Event): string | undefined {
    for (const node of event.composedPath()) {
      if (node instanceof HTMLTableRowElement) return node.dataset.rowId;
    }
    return undefined;
  }

  #moveRowTo(rowId: string, targetId: string, groupKey?: string): void {
    const view = this.#activeView();
    if (view.type === 'table' && view.groupBy) {
      if (databaseSorts(view).length > 0) return;
      const groups = this.#groupsFor(view);
      const group =
        groupKey !== undefined
          ? groups.find(item => item.key === groupKey)
          : groups.find(item => item.rows.some(entry => entry.id === rowId));
      if (!group?.rows.some(entry => entry.id === targetId)) return;
      const ordered = [...group.rows];
      const groupFrom = ordered.findIndex(entry => entry.id === rowId);
      const groupTo = ordered.findIndex(entry => entry.id === targetId);
      if (groupFrom < 0 || groupTo < 0 || groupFrom === groupTo) return;
      const [moved] = ordered.splice(groupFrom, 1);
      if (!moved) return;
      ordered.splice(groupTo, 0, moved);
      const settings = seedGroupSettings(
        view.groupProperties ?? [],
        groups.map(item => item.key)
      );
      const savedOrder =
        settings.find(item => item.key === group.key)?.manuallyCardSort ?? [];
      const order = mergeOrder(savedOrder, ordered.map(entry => entry.id));
      const groupProperties = settings.map(setting =>
        setting.key === group.key
          ? { ...setting, manuallyCardSort: order }
          : setting
      );
      const views = this.#views().map(item =>
        item.id === view.id ? { ...item, groupProperties } : item
      );
      this.#host.commit({ ...this.#data, views });
      return;
    }
    const rows = [...this.#data.rows];
    const from = rows.findIndex(row => row.id === rowId);
    const to = rows.findIndex(row => row.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const [row] = rows.splice(from, 1);
    if (!row) return;
    rows.splice(to, 0, row);
    this.#host.commit({ ...this.#data, rows });
  }

  #commitColumnWidth(columnId: string, width: number): void {
    const value = Math.max(
      MIN_DATABASE_COLUMN_WIDTH,
      Math.min(MAX_DATABASE_COLUMN_WIDTH, Math.round(width))
    );
    const view = this.#activeView();
    const views = this.#views().map(item => {
      const columns = this.#viewColumns(item).map(column =>
        item.id === view.id && column.id === columnId
          ? { ...column, width: value }
          : column
      );
      return { ...item, columns };
    });
    this.#host.commit({
      ...this.#data,
      columns: this.#data.columns.map(item =>
        item.id === columnId ? { ...item, width: value } : item
      ),
      views,
      activeViewId: view.id,
    });
  }

  #duplicateColumn(columnId: string): void {
    if (this.#data.columns.length >= 200) return;
    const source = this.#data.columns.find(column => column.id === columnId);
    if (!source) return;
    const index = this.#data.columns.findIndex(column => column.id === columnId);
    const column = createDatabaseColumn(
      `${source.name} copy`,
      source.type,
      source.options ?? [],
      source.data
    );
    const columns = [...this.#data.columns];
    columns.splice(index + 1, 0, column);
    const rows = this.#data.rows.map(row => {
      const cell = row.cells[source.id];
      if (!cell) return row;
      return {
        ...row,
        cells: { ...row.cells, [column.id]: cloneCell(cell) },
      };
    });
    const view = this.#activeView();
    const views = this.#viewsWithColumn(column.id, columnId, true, 180, columnId);
    this.#host.commit({
      ...this.#data,
      columns,
      rows,
      views,
      activeViewId: view.id,
    });
  }

  #updateCount(view: DatabaseViewConfig = this.#activeView()): void {
    if (!this.#countElement) return;
    const total = this.#data.rows.length;
    const shown = this.#rowsFor(view).length;
    const rowText = shown === total ? `${total}` : `${shown} of ${total}`;
    const columnCount = this.#data.columns.length;
    this.#countElement.textContent = `${rowText} ${shown === 1 && total === 1 ? 'row' : 'rows'} · ${columnCount} ${
      columnCount === 1 ? 'column' : 'columns'
    }`;
  }

  #registerCell(key: string, nodes: CellNodes): void {
    const list = this.#cells.get(key);
    if (list) list.push(nodes);
    else this.#cells.set(key, [nodes]);
  }

  #currentCell(rowId: string, columnId: string): DatabaseCell | undefined {
    return this.#data.rows.find(row => row.id === rowId)?.cells[columnId];
  }

  #activateCellInput(element: HTMLElement, rowId: string, columnId: string): void {
    const groupKey = element.closest<HTMLElement>('.nb-db-group')?.dataset.group;
    this.#active = {
      rowId,
      columnId,
      ...(groupKey !== undefined ? { groupKey } : {}),
    };
  }

  #syncTitle(): void {
    const input = this.#titleInput;
    if (!input) return;
    const value = this.#data.title ?? '';
    if (input.value !== value) input.value = value;
  }

  #syncValues(): void {
    const root = this.element.getRootNode() as ShadowRoot;
    const prev = this.#syncedData;
    const prevColumnsSame = prev !== null && prev.columns === this.#data.columns;
    const prevRowById = prev
      ? new Map(prev.rows.map(row => [row.id, row]))
      : null;
    const prevColById =
      prev && !prevColumnsSame
        ? new Map(prev.columns.map(column => [column.id, column]))
        : null;

    for (const row of this.#data.rows) {
      const prevRow = prevRowById?.get(row.id);
      if (prevRow === row && prevColumnsSame) continue;
      for (const column of this.#data.columns) {
        const cell = row.cells[column.id];
        if (prevRow) {
          const prevCol = prevColumnsSame ? column : prevColById?.get(column.id);
          if (prevCol === column && prevRow.cells[column.id] === cell) continue;
        }
        const copies = this.#cells.get(cellKey(row.id, column.id));
        if (!copies) continue;
        const value = column.type === 'checkbox' ? '' : cell?.text ?? '';
        for (const nodes of copies) {
          if (nodes.text && !this.#richText.isComposing(nodes.text)) {
            const target = nodes.text;
            const updateText = (apply: () => void, nextLength: number): void => {
              const focused = root.activeElement === target;
              const saved = focused ? selectionOffsets(target) : null;
              apply();
              if (focused && saved) {
                setSelectionOffsets(
                  target,
                  Math.min(saved.start, nextLength),
                  Math.min(saved.end, nextLength)
                );
              }
            };
            const isRich = target.dataset.richText === 'true';
            const signature = isRich ? runsSignature(cell?.runs) : '';
            if (isRich && target.dataset.runs !== signature) {
              const nextLength = cell?.runs ? runsLength(cell.runs) : value.length;
              updateText(() => renderTextCellContent(target, cell, this.#host.resolvePage), nextLength);
            } else if ((!isRich || !cell?.runs) && target.textContent !== value) {
              updateText(() => {
                target.textContent = value;
              }, value.length);
            }
          }
          if (nodes.input) {
            const inputValue =
              column.type === 'number' && !nodes.input.matches(':focus')
                ? formatDatabaseNumber(value, column)
                : value;
            if (nodes.input.value !== inputValue) nodes.input.value = inputValue;
          }
          if (nodes.button) {
            this.#applyButtonLabel(nodes.button, column, cell);
          }
          if (nodes.progress && column.type === 'progress') {
            applyProgressState(nodes.progress, value, column.name);
          }
        }
      }
    }
    this.#syncTitle();
    this.#board.syncValues();
    this.#syncStats();
    this.#detail.sync();
    this.#updateCount(this.#activeView());
    this.#syncedData = this.#data;
  }

  #syncStats(): void {
    const view = this.#activeView();
    const states = this.#columnStates(view);
    const stateByColId = new Map<string, (typeof states)[number]>();
    let hasAnyStat = false;
    for (const state of states) {
      stateByColId.set(state.column.id, state);
      if (!state.hide && state.stat) hasAnyStat = true;
    }
    if (!hasAnyStat) {
      for (const button of this.element.querySelectorAll<HTMLButtonElement>(
        '.nb-db-table .nb-db-stat[data-stat-column]'
      )) {
        if (button.dataset.calculated !== 'false') {
          button.dataset.calculated = 'false';
          button.textContent = 'Calculate';
        }
      }
      return;
    }
    let groups: ReturnType<typeof groupedDatabaseRows> | null = null;
    for (const table of this.element.querySelectorAll<HTMLElement>('.nb-db-table')) {
      const groupKey = table.closest<HTMLElement>('.nb-db-group')?.dataset.group;
      let rows: DatabaseRow[] | null = null;
      for (const button of table.querySelectorAll<HTMLButtonElement>('.nb-db-stat[data-stat-column]')) {
        const columnId = button.dataset.statColumn;
        const state = columnId ? stateByColId.get(columnId) : undefined;
        if (!state) continue;
        const stat = state.stat;
        if (!stat) {
          if (button.dataset.calculated !== 'false') {
            button.dataset.calculated = 'false';
            button.textContent = 'Calculate';
          }
          continue;
        }
        if (!rows) {
          if (groupKey === undefined) {
            rows = this.#rowsFor(view);
          } else {
            groups ??= this.#groupsFor(view);
            rows = groups.find(group => group.key === groupKey)?.rows ?? [];
          }
        }
        button.dataset.calculated = 'true';
        button.textContent = `${DATABASE_STAT_LABELS[stat]}: ${databaseStatValue(rows, state.column, stat)}`;
      }
    }
  }

  /** ---- table cells ---- */

  #createCell(row: DatabaseRow, column: DatabaseColumn): HTMLTableCellElement {
    const td = el('td', `nb-db-cell nb-db-cell-${column.type}`);
    td.dataset.rowId = row.id;
    td.dataset.columnId = column.id;
    const cell = row.cells[column.id];
    const key = cellKey(row.id, column.id);
    const nodes: CellNodes = { td };

    if (column.type === 'checkbox') {
      this.#createCheckboxCell(td, nodes, row, column, cell);
    } else if (column.type === 'progress') {
      this.#createProgressCell(td, nodes, row, column, cell);
    } else if (
      column.type === 'select' ||
      column.type === 'multi-select' ||
      column.type === 'files' ||
      column.type === 'people' ||
      column.type === 'image'
    ) {
      this.#createPickerCell(td, nodes, row, column, cell);
    } else if (column.type === 'number' || column.type === 'date') {
      this.#createValueCell(td, nodes, row, column, cell);
    } else {
      this.#createTextCell(td, nodes, row, column, cell);
    }

    this.#registerCell(key, nodes);
    return td;
  }

  #createCheckboxCell(
    td: HTMLTableCellElement,
    nodes: CellNodes,
    row: DatabaseRow,
    column: DatabaseColumn,
    cell: DatabaseCell | undefined
  ): void {
    const signal = this.#contentEvents.signal;
    const button = iconBtn('nb-db-check', icon.check, column.name, {
      disabled: this.#readonly,
    });
    button.setAttribute('role', 'checkbox');
    button.setAttribute('aria-checked', String(Boolean(cell?.checked)));
    button.addEventListener(
      'click',
      event => {
        event.preventDefault();
        const checked = button.getAttribute('aria-checked') !== 'true';
        button.setAttribute('aria-checked', String(checked));
        this.#commitCell(
          row.id,
          column.id,
          { ...(cell?.text ? { text: cell.text } : {}), checked },
          `db:${row.id}:${column.id}`
        );
      },
      { signal }
    );
    button.addEventListener(
      'keydown',
      event => this.#onCellKeyDown(event, row.id, column.id, 'checkbox'),
      { signal }
    );
    td.append(button);
    nodes.button = button;
  }

  #applyButtonLabel(
    button: HTMLButtonElement,
    column: DatabaseColumn,
    cell: DatabaseCell | undefined
  ): void {
    const value = cell?.text ?? '';
    switch (column.type) {
      case 'checkbox':
        button.setAttribute('aria-checked', String(Boolean(cell?.checked)));
        break;
      case 'select':
        applySelectLabel(button, value, column.options, column.name);
        break;
      case 'multi-select':
        applyMultiLabel(button, cell?.values ?? [], column.name);
        break;
      case 'files':
        applyFilesLabel(button, cell?.files ?? [], column.name);
        break;
      case 'people':
        applyPeopleLabel(button, cell?.people ?? [], column.name);
        break;
      case 'image':
        applyImageLabel(button, value, column.name);
        break;
    }
  }

  #createPickerCell(
    td: HTMLTableCellElement,
    nodes: CellNodes,
    row: DatabaseRow,
    column: DatabaseColumn,
    cell: DatabaseCell | undefined
  ): void {
    const signal = this.#contentEvents.signal;
    const className =
      column.type === 'select'
        ? 'nb-db-select'
        : column.type === 'image'
          ? 'nb-db-select nb-db-image-cell'
          : 'nb-db-select nb-db-multi';
    const button = btn(className, { disabled: this.#readonly });
    this.#applyButtonLabel(button, column, cell);
    const open = (): void => {
      if (column.type === 'select') {
        this.#popovers.openSelectPopover(column.id, row.id, button);
      } else if (column.type === 'image') {
        this.#popovers.openImagePopover(column.id, row.id, button);
      } else if (column.type === 'multi-select') {
        this.#popovers.openMultiSelectPopover(column.id, row.id, button);
      } else if (column.type === 'files') {
        this.#popovers.openFilesPopover(column.id, row.id, button);
      } else {
        this.#popovers.openPeoplePopover(column.id, row.id, button);
      }
    };
    button.addEventListener('click', open, { signal });
    button.addEventListener(
      'keydown',
      event => {
        if (!(event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          open();
          return;
        }
        this.#onCellKeyDown(event, row.id, column.id, column.type as CellKind);
      },
      { signal }
    );
    td.append(button);
    nodes.button = button;
  }

  #createProgressCell(
    td: HTMLTableCellElement,
    nodes: CellNodes,
    row: DatabaseRow,
    column: DatabaseColumn,
    cell: DatabaseCell | undefined
  ): void {
    const signal = this.#contentEvents.signal;
    const control = el('div', 'nb-db-progress');
    control.setAttribute('role', 'slider');
    control.setAttribute('aria-valuemin', '0');
    control.setAttribute('aria-valuemax', '100');
    control.tabIndex = this.#readonly ? -1 : 0;
    if (this.#readonly) control.setAttribute('aria-disabled', 'true');
    const track = el('div', 'nb-db-progress-track');
    track.append(el('div', 'nb-db-progress-fill'));
    const label = el('span', 'nb-db-progress-label');
    control.append(track, label);
    applyProgressState(control, cell?.text, column.name);

    control.addEventListener(
      'focus',
      () => {
        this.#activateCellInput(control, row.id, column.id);
        this.#syncSelectionVisuals();
      },
      { signal }
    );

    if (!this.#readonly) {
      const mergeKey = `db:${row.id}:${column.id}`;
      control.addEventListener(
        'pointerdown',
        event => {
          if (event.button !== 0 || event.shiftKey) return;
          event.preventDefault();
          event.stopPropagation();
          if (this.#selectedRows.size > 0) {
            this.#selectedRows.clear();
            this.#syncRowSelection();
          }
          this.#suppressClick = false;
          if (this.#range) {
            this.#clearRange();
            this.#renderRange();
          }
          control.focus();
          this.#activateCellInput(control, row.id, column.id);
          this.#syncSelectionVisuals();
          const initialRect = track.getBoundingClientRect();
          const percentAt = (clientX: number): number | null => {
            const rect = track.isConnected ? track.getBoundingClientRect() : initialRect;
            if (rect.width <= 0) return null;
            return Math.max(
              0,
              Math.min(100, Math.round(((clientX - rect.left) / rect.width) * 100))
            );
          };
          const initial = percentAt(event.clientX);
          let lastPct = initial;
          if (initial !== null) {
            applyProgressState(control, String(initial), column.name);
          }
          beginWindowDrag(
      this.#contentEvents.signal,
            moveEvent => {
              const nextPct = percentAt(moveEvent.clientX);
              if (nextPct === null || nextPct === lastPct) return;
              lastPct = nextPct;
              applyProgressState(control, String(nextPct), column.name);
            },
            finishEvent => {
              if (finishEvent.type === 'pointercancel') {
                applyProgressState(
                  control,
                  this.#currentCell(row.id, column.id)?.text,
                  column.name
                );
                return;
              }
              if (lastPct === null) return;
              const nextValue = String(lastPct);
              if ((this.#currentCell(row.id, column.id)?.text ?? '') === nextValue) {
                return;
              }
              this.#commitCell(row.id, column.id, { text: nextValue }, mergeKey);
            }
          );
        },
        { signal }
      );
      control.addEventListener(
        'keydown',
        event => {
          if (!event.metaKey && !event.ctrlKey && !event.altKey) {
            if (event.key === 'Backspace' || event.key === 'Delete') {
              event.preventDefault();
              event.stopPropagation();
              this.#commitCell(row.id, column.id, {}, mergeKey);
              return;
            }
            if (event.key === 'Home') {
              event.preventDefault();
              event.stopPropagation();
              this.#commitCell(row.id, column.id, { text: '0' }, mergeKey);
              return;
            }
            if (event.key === 'End') {
              event.preventDefault();
              event.stopPropagation();
              this.#commitCell(row.id, column.id, { text: '100' }, mergeKey);
              return;
            }
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
              event.preventDefault();
              event.stopPropagation();
              const current =
                parseProgressValue(this.#currentCell(row.id, column.id)?.text) ?? 0;
              const step = event.shiftKey ? 1 : 5;
              const next = Math.max(
                0,
                Math.min(100, current + (event.key === 'ArrowRight' ? step : -step))
              );
              this.#commitCell(row.id, column.id, { text: String(next) }, mergeKey);
              return;
            }
          }
          this.#onCellKeyDown(event, row.id, column.id, 'progress');
        },
        { signal }
      );
    } else {
      control.addEventListener(
        'keydown',
        event => this.#onCellKeyDown(event, row.id, column.id, 'progress'),
        { signal }
      );
    }

    td.append(control);
    nodes.progress = control;
  }

  #createValueCell(
    td: HTMLTableCellElement,
    nodes: CellNodes,
    row: DatabaseRow,
    column: DatabaseColumn,
    cell: DatabaseCell | undefined
  ): void {
    const signal = this.#contentEvents.signal;
    const input = el('input', 'nb-db-input');
    input.disabled = this.#readonly;
    input.setAttribute('aria-label', column.name);
    if (column.type === 'number') {
      attachNumberInput(
        input,
        row,
        column,
        signal,
        (rId, cId) => this.#currentCell(rId, cId),
        (rId, cId, cellData, key) => this.#commitCell(rId, cId, cellData, key),
        () => this.#activateCellInput(input, row.id, column.id)
      );
    } else {
      input.type = 'text';
      input.placeholder = 'YYYY-MM-DD';
      input.value = cell?.text ?? '';
      input.addEventListener(
        'input',
        () => {
          this.#commitCell(
            row.id,
            column.id,
            withText(this.#currentCell(row.id, column.id), input.value),
            `db:${row.id}:${column.id}`
          );
        },
        { signal }
      );
      input.addEventListener(
        'focus',
        () => this.#activateCellInput(input, row.id, column.id),
        { signal }
      );
    }
    input.addEventListener(
      'keydown',
      event => this.#onCellKeyDown(event, row.id, column.id, column.type as CellKind),
      { signal }
    );
    td.append(input);
    nodes.input = input;
  }

  #createTextCell(
    td: HTMLTableCellElement,
    nodes: CellNodes,
    row: DatabaseRow,
    column: DatabaseColumn,
    cell: DatabaseCell | undefined
  ): void {
    const signal = this.#contentEvents.signal;
    const text = el('div', 'nb-db-text');
    text.contentEditable = this.#readonly ? 'false' : 'true';
    text.spellcheck = false;
    text.dataset.placeholder = column.type === 'url' ? 'https://…' : 'Empty';
    text.dataset.richText = String(column.type === 'text');
    text.setAttribute('role', 'textbox');
    text.setAttribute('aria-label', column.name);
    if (column.type === 'text') {
      text.classList.add('nb-db-rich-text');
      renderTextCellContent(text, cell, this.#host.resolvePage);
    } else {
      text.textContent = cell?.text ?? '';
    }
    if (!this.#readonly) {
      const commitCellText = (): void => {
        if (column.type !== 'text') {
          const value = (text.textContent ?? '').replace(/\r?\n/gu, ' ');
          this.#commitCell(
            row.id,
            column.id,
            withText(this.#currentCell(row.id, column.id), value),
            `db:${row.id}:${column.id}`
          );
          return;
        }
        const runs = readCellRuns(text);
        text.dataset.runs = runsSignature(runs.some(run => run.marks) ? runs : undefined);
        this.#commitTextRuns(row.id, column.id, runs, `db:${row.id}:${column.id}`);
      };
      this.#richText.attachCompositionHandlers(
        text,
        commitCellText,
        signal,
        column.type === 'text'
      );
      text.addEventListener(
        'input',
        event => {
          if (this.#richText.isComposing(text) || (event as InputEvent).isComposing) {
            return;
          }
          commitCellText();
        },
        { signal }
      );
      if (column.type === 'text') {
        this.#richText.attachRichTextHandlers(text, signal);
      }
      text.addEventListener(
        'focus',
        () => this.#activateCellInput(text, row.id, column.id),
        { signal }
      );
      text.addEventListener(
        'keydown',
        event => this.#onCellKeyDown(event, row.id, column.id, 'text'),
        { signal }
      );
      text.addEventListener(
        'paste',
        event => {
          event.preventDefault();
          const value = (event.clipboardData?.getData('text/plain') ?? '').replace(
            /\r?\n/gu,
            ' '
          );
          if (!value) return;
          if (column.type === 'text') this.#richText.pasteIntoRichText(text, value);
          else this.#richText.pastePlainText(text, value);
        },
        { signal }
      );
    }
    td.append(text);
    nodes.text = text;
  }

  /** ---- data mutations ---- */

  #commitTextRuns(
    rowId: string,
    columnId: string,
    runs: readonly InlineRun[],
    mergeKey?: string
  ): void {
    const current = this.#currentCell(rowId, columnId);
    const cell: DatabaseCell = { ...(current ?? {}) };
    const text = plainText(runs);
    if (text) cell.text = text;
    else delete cell.text;
    if (runs.some(run => run.marks)) cell.runs = cloneRuns(runs);
    else delete cell.runs;
    this.#commitCell(rowId, columnId, cell, mergeKey);
  }

  #commitRowPage(rowId: string, runs: readonly InlineRun[], mergeKey?: string): void {
    const rows = this.#data.rows.map(row => {
      if (row.id !== rowId) return row;
      if (runs.length === 0) {
        const { page: _page, ...rest } = row;
        return rest;
      }
      return { ...row, page: { content: cloneRuns(runs) } };
    });
    this.#host.commit({ ...this.#data, rows }, mergeKey ? { mergeKey } : undefined);
  }

  #commitCell(rowId: string, columnId: string, cell: DatabaseCell, mergeKey?: string): void {
    const rows = this.#data.rows.map(row => {
      if (row.id !== rowId) return row;
      const cells = { ...row.cells };
      const empty =
        !cell.text &&
        !cell.checked &&
        !(cell.values?.length) &&
        !(cell.files?.length) &&
        !(cell.people?.length);
      if (!empty) cells[columnId] = cell;
      else delete cells[columnId];
      return { ...row, cells };
    });
    this.#host.commit({ ...this.#data, rows }, mergeKey ? { mergeKey } : undefined);
  }

  #addRow(columnId = this.#data.columns[0]?.id ?? '', groupKey?: string): string | null {
    if (this.#readonly) return null;
    const row = createDatabaseRow();
    const view = this.#activeView();
    const groupColumn =
      groupKey !== undefined && view.groupBy
        ? this.#data.columns.find(column => column.id === view.groupBy)
        : undefined;
    if (groupColumn) {
      row.cells[groupColumn.id] = cellForGroupValue(groupColumn, undefined, groupKey!);
    }
    this.#pendingFocus = {
      rowId: row.id,
      columnId: columnId || this.#titleColumn()?.id || '',
      at: 'start',
    };
    this.#host.commit({ ...this.#data, rows: [...this.#data.rows, row] });
    return row.id;
  }

  #addColumn(): void {
    this.#addColumnOfType('text');
  }

  #addColumnOfType(type: DatabaseColumnType, openSettings = true): void {
    if (this.#readonly) return;
    const column = createDatabaseColumn(`Column ${this.#data.columns.length + 1}`, type);
    const view = this.#activeView();
    const views = this.#viewsWithColumn(column.id, null, false);
    this.#host.commit({
      ...this.#data,
      columns: [...this.#data.columns, column],
      views,
      activeViewId: view.id,
    });
    queueMicrotask(() => {
      if (!openSettings) return;
      const button = this.element.querySelector<HTMLElement>(
        `th[data-column-id="${CSS.escape(column.id)}"] .nb-db-col-head`
      );
      if (button) this.#popovers.openColumnPopover(column.id, button);
    });
  }

  #commitDeletedRows(deletedIds: ReadonlySet<string>): void {
    const views = this.#data.views
      ? pruneRowIdsFromViews(this.#data.views, deletedIds)
      : undefined;
    const view = this.#data.view
      ? pruneRowIdsFromViews([this.#data.view], deletedIds)[0]
      : undefined;
    this.#host.commit({
      ...this.#data,
      rows: this.#data.rows.filter(row => !deletedIds.has(row.id)),
      ...(views ? { views } : {}),
      ...(view ? { view } : {}),
    });
  }

  #deleteRow(rowId: string): void {
    this.#commitDeletedRows(new Set([rowId]));
    if (this.#active?.rowId === rowId) this.#active = null;
  }

  #insertRow(anchorId: string | null, after: boolean): void {
    const row = createDatabaseRow();
    const index = anchorId ? this.#data.rows.findIndex(item => item.id === anchorId) : -1;
    const rows = [...this.#data.rows];
    if (index < 0) rows.push(row);
    else rows.splice(after ? index + 1 : index, 0, row);
    this.#pendingFocus = {
      rowId: row.id,
      columnId: this.#data.columns[0]?.id ?? '',
      at: 'start',
    };
    this.#host.commit({ ...this.#data, rows });
  }

  #duplicateRow(rowId: string): void {
    const row = this.#data.rows.find(item => item.id === rowId);
    if (!row) return;
    const copy: DatabaseRow = {
      id: createDatabaseRow().id,
      cells: Object.fromEntries(
        Object.entries(row.cells).map(([key, cell]) => [key, cloneCell(cell)])
      ),
      ...(row.page ? { page: { content: cloneRuns(row.page.content) } } : {}),
    };
    const index = this.#data.rows.findIndex(item => item.id === rowId);
    const rows = [...this.#data.rows];
    rows.splice(index + 1, 0, copy);
    this.#pendingFocus = {
      rowId: copy.id,
      columnId: this.#data.columns[0]?.id ?? '',
      at: 'start',
    };
    this.#host.commit({ ...this.#data, rows });
  }

  #patchColumn(columnId: string, patch: Partial<DatabaseColumn>): DatabaseColumn[] {
    return this.#data.columns.map(column => {
      if (column.id !== columnId) return column;
      const type = patch.type ?? column.type;
      const next: DatabaseColumn = {
        id: column.id,
        name: patch.name ?? column.name,
        type,
        ...(column.width ? { width: column.width } : {}),
        ...((patch.data ?? column.data)
          ? { data: { ...(patch.data ?? column.data) } }
          : {}),
      };
      if (type === 'select' || type === 'multi-select') {
        const options = patch.options ?? column.options;
        if (options && options.length > 0) next.options = options;
      }
      return next;
    });
  }

  #deleteColumn(columnId: string): void {
    if (this.#data.columns.length <= 1) return;
    const columns = this.#data.columns.filter(column => column.id !== columnId);
    const rows = this.#data.rows.map(row => {
      const cells = { ...row.cells };
      delete cells[columnId];
      return { ...row, cells };
    });
    const next: DatabaseData = {
      ...this.#data,
      columns,
      rows,
      ...(this.#data.titleColumnId === columnId && columns[0]
        ? { titleColumnId: columns[0].id }
        : {}),
    };
    if (this.#data.sort?.columnId === columnId) delete next.sort;
    if (this.#data.views) {
      next.views = this.#data.views.map(view => removeColumnFromView(view, columnId));
    }
    if (this.#data.view) {
      next.view = removeColumnFromView(this.#data.view, columnId);
    }
    if (this.#detail.element?.querySelector(`[data-column-id="${CSS.escape(columnId)}"]`)) {
      this.#detail.close();
    }
    this.#host.commit(next);
  }

  #insertColumn(anchorId: string, after: boolean): void {
    const column = createDatabaseColumn(`Column ${this.#data.columns.length + 1}`);
    const columns = [...this.#data.columns];
    const index = columns.findIndex(item => item.id === anchorId);
    columns.splice(index < 0 ? columns.length : after ? index + 1 : index, 0, column);
    const view = this.#activeView();
    const views = this.#viewsWithColumn(column.id, anchorId, after);
    this.#host.commit({
      ...this.#data,
      columns,
      views,
      activeViewId: view.id,
    });
    queueMicrotask(() => {
      const button = this.element.querySelector<HTMLElement>(
        `th[data-column-id="${CSS.escape(column.id)}"] .nb-db-col-head`
      );
      if (button) this.#popovers.openColumnPopover(column.id, button);
    });
  }

  #commitColumnFields(
    columnId: string,
    name: string,
    type: DatabaseColumnType,
    optionsText: string,
    extra?: (columns: DatabaseColumn[]) => DatabaseColumn[]
  ): void {
    const previous = this.#data.columns.find(item => item.id === columnId);
    const options = optionsText
      .split(',')
      .map(option => option.trim())
      .filter(Boolean);
    const columns = this.#patchColumn(columnId, {
      name: name.trim() || 'Column',
      type,
      ...((type === 'select' || type === 'multi-select') && options.length > 0
        ? { options }
        : {}),
    });
    const nextData: DatabaseData = {
      ...this.#data,
      columns: extra ? extra(columns) : columns,
    };
    if (previous?.type === 'image' && type !== 'image') {
      const stripCover = (view: DatabaseViewConfig): DatabaseViewConfig => {
        if (view.coverColumnId !== columnId) return view;
        const { coverColumnId: _removed, ...rest } = view;
        return rest;
      };
      if (this.#data.views) nextData.views = this.#data.views.map(stripCover);
      if (this.#data.view) nextData.view = stripCover(this.#data.view);
    }
    this.#host.commit(nextData);
  }

  /** ---- navigation ---- */

  #rows(): DatabaseRow[] {
    return this.#navigationRows(this.#activeView());
  }

  #renderedRows(view: DatabaseViewConfig = this.#activeView()): DatabaseRow[] {
    if (view.type === 'table' && view.groupBy) {
      return this.#groupsFor(view).flatMap(group =>
        group.collapsed || group.hidden ? [] : group.rows
      );
    }
    return this.#rowsFor(view);
  }

  #navigationRows(view: DatabaseViewConfig = this.#activeView()): DatabaseRow[] {
    const seen = new Set<string>();
    const rows: DatabaseRow[] = [];
    for (const row of this.#renderedRows(view)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    return rows;
  }

  #moveTab(rowId: string, columnId: string, backwards: boolean): void {
    this.#moveHorizontal(rowId, columnId, backwards ? -1 : 1, true);
  }

  #moveVertical(rowId: string, columnId: string, direction: 1 | -1): void {
    const rows = this.#rows();
    const index = rows.findIndex(row => row.id === rowId);
    if (index < 0) return;
    const next = rows[index + direction];
    if (!next) {
      if (direction > 0 && !this.#readonly) this.#addRow(columnId);
      return;
    }
    this.focusCell(next.id, columnId, direction > 0 ? 'start' : 'end');
  }

  #moveHorizontal(
    rowId: string,
    columnId: string,
    direction: 1 | -1,
    addOnEnd = false
  ): void {
    const rows = this.#rows();
    const columns = this.#visibleColumns(this.#activeView());
    const rowIndex = rows.findIndex(row => row.id === rowId);
    const columnIndex = columns.findIndex(column => column.id === columnId);
    if (rowIndex < 0 || columnIndex < 0) return;
    let nextColumn = columnIndex + direction;
    let nextRow = rowIndex;
    if (nextColumn >= columns.length) {
      nextColumn = 0;
      nextRow += 1;
    } else if (nextColumn < 0) {
      nextColumn = columns.length - 1;
      nextRow -= 1;
    }
    if (addOnEnd && nextRow >= rows.length) {
      if (!this.#readonly) this.#addRow();
      return;
    }
    const targetRow = rows[nextRow];
    const targetColumn = columns[nextColumn];
    if (targetRow && targetColumn) {
      this.focusCell(
        targetRow.id,
        targetColumn.id,
        addOnEnd || direction < 0 ? 'end' : 'start'
      );
    }
  }

  #onCellKeyDown(
    event: KeyboardEvent,
    rowId: string,
    columnId: string,
    kind: CellKind
  ): void {
    if (
      this.#richText.isComposingKey(
        event,
        event.target instanceof HTMLElement ? event.target : null
      )
    ) {
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (
      handleHistoryKey(event, redo => (redo ? this.#host.redo() : this.#host.undo()))
    ) {
      return;
    }
    if (mod && kind === 'text') {
      const tag = shortcutTag(event);
      if (tag) {
        event.preventDefault();
        this.#richText.toggleInlineTag(tag);
        return;
      }
    }
    if (mod && ['b', 'i', 'u', 'e', 'k'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      return;
    }
    const copies = this.#cells.get(cellKey(rowId, columnId)) ?? [];
    const activeNode =
      copies.find(copy => copy.td.contains(event.target as Node)) ?? copies[0];
    if (event.key === 'Tab') {
      event.preventDefault();
      this.#moveTab(rowId, columnId, event.shiftKey);
      return;
    }
    if (mod && event.key === 'Enter') {
      event.preventDefault();
      this.#detail.open(rowId);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (kind === 'select') {
        if (activeNode?.button) {
          this.#popovers.openSelectPopover(columnId, rowId, activeNode.button);
        }
        return;
      }
      if (
        kind === 'multi-select' ||
        kind === 'files' ||
        kind === 'people' ||
        kind === 'image'
      ) {
        activeNode?.button?.click();
        return;
      }
      this.#moveVertical(rowId, columnId, 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.#popovers.closePopover();
      this.#host.focusAfter();
      return;
    }
    if (
      kind === 'text' ||
      kind === 'select' ||
      kind === 'checkbox' ||
      kind === 'progress' ||
      kind === 'image'
    ) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const dir = event.key === 'ArrowDown' ? 1 : -1;
        if (
          kind === 'text' &&
          activeNode?.text &&
          !caretAtBoundary(activeNode.text, dir > 0 ? 'end' : 'start')
        ) {
          return;
        }
        event.preventDefault();
        this.#moveVertical(rowId, columnId, dir);
      } else if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        kind === 'text' &&
        activeNode?.text
      ) {
        const dir = event.key === 'ArrowRight' ? 1 : -1;
        if (!caretAtBoundary(activeNode.text, dir > 0 ? 'end' : 'start')) return;
        event.preventDefault();
        this.#moveHorizontal(rowId, columnId, dir);
      }
    }
  }

  /** ---- range selection, fill handle & clipboard ---- */

  #onCellPointerDown(
    event: PointerEvent,
    cellEl: HTMLElement,
    rowId: string,
    columnId: string
  ): void {
    if (this.#readonly || event.button !== 0) return;
    const previous = this.#active;
    const groupKey = cellEl.closest<HTMLElement>('.nb-db-group')?.dataset.group;
    this.#active = {
      rowId,
      columnId,
      ...(groupKey !== undefined ? { groupKey } : {}),
    };
    this.#selectedRows.clear();
    this.#syncRowSelection();
    if (!event.shiftKey) {
      this.#suppressClick = false;
      if (this.#range) {
        this.#clearRange();
        this.#renderRange();
      }
    } else {
      const startRowId = previous?.rowId ?? rowId;
      const startColumnId = previous?.columnId ?? columnId;
      const rangeGroupKey = previous?.groupKey ?? groupKey;
      this.#range = {
        startRowId,
        startColumnId,
        endRowId: rowId,
        endColumnId: columnId,
        ...(rangeGroupKey !== undefined ? { groupKey: rangeGroupKey } : {}),
      };
      this.#suppressClick = true;
      this.#renderRange();
      event.preventDefault();
      return;
    }

    const drag = {
      anchorRowId: rowId,
      anchorColumnId: columnId,
      moved: false,
    };
    this.#dragSelect = drag;
    const root = this.element.getRootNode() as ShadowRoot;
    beginWindowDrag(
      this.#contentEvents.signal,
      moveEvent => {
        if (this.#dragSelect !== drag) return;
        const cell = this.#cellFromEvent(moveEvent);
        const targetRowId = cell?.dataset.rowId;
        const targetColumnId = cell?.dataset.columnId;
        if (!cell || !targetRowId || !targetColumnId) return;
        if (
          !drag.moved &&
          targetRowId === drag.anchorRowId &&
          targetColumnId === drag.anchorColumnId
        ) {
          return;
        }
        drag.moved = true;
        this.#range = {
          startRowId: drag.anchorRowId,
          startColumnId: drag.anchorColumnId,
          endRowId: targetRowId,
          endColumnId: targetColumnId,
          ...(groupKey !== undefined ? { groupKey } : {}),
        };
        nativeSelection(root)?.removeAllRanges();
        moveEvent.preventDefault();
        this.#renderRange();
      },
      () => {
        if (this.#dragSelect !== drag) return;
        this.#dragSelect = null;
        if (drag.moved) {
          this.#suppressClick = true;
          window.setTimeout(() => {
            this.#suppressClick = false;
          }, 0);
          this.#renderRange();
        }
      },
      () => {
        if (this.#dragSelect === drag) this.#dragSelect = null;
      }
    );
  }

  #cellFromEvent(event: Event): HTMLElement | null {
    for (const node of event.composedPath()) {
      if (node instanceof HTMLElement && node.classList.contains('nb-db-cell')) {
        return node;
      }
    }
    return null;
  }

  #rangeBounds(): {
    rows: DatabaseRow[];
    columns: DatabaseColumn[];
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
  } | null {
    if (!this.#range) return null;
    const view = this.#activeView();
    const groupKey = this.#range.groupKey;
    const rows =
      groupKey !== undefined
        ? this.#groupsFor(view).find(group => group.key === groupKey)?.rows ?? []
        : this.#renderedRows(view);
    const columns = this.#visibleColumns(view);
    const startRow = rows.findIndex(row => row.id === this.#range?.startRowId);
    const endRow = rows.findIndex(row => row.id === this.#range?.endRowId);
    const startColumn = columns.findIndex(column => column.id === this.#range?.startColumnId);
    const endColumn = columns.findIndex(column => column.id === this.#range?.endColumnId);
    if (startRow < 0 || endRow < 0 || startColumn < 0 || endColumn < 0) return null;
    return {
      rows,
      columns,
      startRow: Math.min(startRow, endRow),
      endRow: Math.max(startRow, endRow),
      startColumn: Math.min(startColumn, endColumn),
      endColumn: Math.max(startColumn, endColumn),
    };
  }

  #renderRange(): void {
    this.#rangeCells.clear();
    const bounds = this.#rangeBounds();
    if (bounds) {
      for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
        const dataRow = bounds.rows[row];
        if (!dataRow) continue;
        for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
          const dataColumn = bounds.columns[column];
          if (dataColumn) this.#rangeCells.add(cellKey(dataRow.id, dataColumn.id));
        }
      }
    }
    this.#syncSelectionVisuals();
  }

  #clearRange(): void {
    this.#range = null;
    this.#rangeCells.clear();
    this.#syncSelectionVisuals();
  }

  #syncSelectionVisuals(): void {
    const nextSelected = new Set<HTMLTableCellElement>();
    for (const key of this.#rangeCells) {
      const copies = this.#cells.get(key);
      if (!copies) continue;
      for (const nodes of copies) nextSelected.add(nodes.td);
    }

    const nextActive = new Set<HTMLTableCellElement>();
    const activeState = this.#active;
    if (activeState) {
      const copies = this.#cells.get(cellKey(activeState.rowId, activeState.columnId));
      if (copies) {
        for (const nodes of copies) {
          if (
            activeState.groupKey === undefined ||
            nodes.td.closest<HTMLElement>('.nb-db-group')?.dataset.group ===
              activeState.groupKey
          ) {
            nextActive.add(nodes.td);
          }
        }
      }
    }

    for (const td of this.#selectedTds) {
      if (!nextSelected.has(td)) {
        td.classList.remove('is-selected');
        td.setAttribute('aria-selected', 'false');
      }
    }
    for (const td of nextSelected) {
      if (!this.#selectedTds.has(td)) {
        td.classList.add('is-selected');
        td.setAttribute('aria-selected', 'true');
      }
    }
    for (const td of this.#activeTds) {
      if (!nextActive.has(td)) td.classList.remove('is-active');
    }
    for (const td of nextActive) {
      if (!this.#activeTds.has(td)) td.classList.add('is-active');
    }

    this.#selectedTds = nextSelected;
    this.#activeTds = nextActive;
    this.#positionFillHandle();
  }

  #cancelFillHandleFrame(): void {
    if (this.#fillHandleRaf !== null) {
      cancelAnimationFrame(this.#fillHandleRaf);
      this.#fillHandleRaf = null;
    }
  }

  #scheduleFillHandlePosition(): void {
    if (this.#fillHandleRaf !== null) return;
    this.#fillHandleRaf = requestAnimationFrame(() => {
      this.#fillHandleRaf = null;
      this.#positionFillHandle();
    });
  }

  #positionFillHandle(): void {
    const handle = this.#fillHandle;
    if (!handle) return;
    const active = this.#active;
    if (
      !active ||
      (this.#range && this.#range.startColumnId !== this.#range.endColumnId)
    ) {
      handle.dataset.visible = 'false';
      return;
    }
    const copies = this.#cells.get(cellKey(active.rowId, active.columnId)) ?? [];
    const cell =
      copies.find(copy => {
        if (active.groupKey === undefined) return true;
        return (
          copy.td.closest<HTMLElement>('.nb-db-group')?.dataset.group ===
          active.groupKey
        );
      }) ?? copies[0];
    const td = cell?.td;
    if (!td || !td.isConnected) {
      handle.dataset.visible = 'false';
      return;
    }
    const rect = td.getBoundingClientRect();
    handle.style.left = `${Math.round(rect.right - 1)}px`;
    handle.style.top = `${Math.round(rect.bottom - 1)}px`;
    handle.dataset.visible = 'true';
  }

  #beginFillDrag(): void {
    if (this.#readonly) return;
    const active = this.#active;
    if (!active) return;
    const view = this.#activeView();
    const visibleRows = this.#renderedRows(view);
    const sourceRowIndex = visibleRows.findIndex(row => row.id === active.rowId);
    const column = this.#data.columns.find(item => item.id === active.columnId);
    if (sourceRowIndex < 0 || !column) return;
    const source = visibleRows[sourceRowIndex];
    if (!source) return;
    const groupKey = active.groupKey;
    let moved = false;
    beginWindowDrag(
      this.#contentEvents.signal,
      moveEvent => {
        const target = this.#cellFromEvent(moveEvent);
        if (!target || target.dataset.columnId !== active.columnId) return;
        const targetRowId = target.dataset.rowId;
        const targetIndex = visibleRows.findIndex(row => row.id === targetRowId);
        if (targetIndex < 0) return;
        moved = true;
        const start = Math.min(sourceRowIndex, targetIndex);
        const end = Math.max(sourceRowIndex, targetIndex);
        const firstRow = visibleRows[start];
        const lastRow = visibleRows[end];
        if (!firstRow || !lastRow) return;
        this.#range = {
          startRowId: firstRow.id,
          startColumnId: active.columnId,
          endRowId: lastRow.id,
          endColumnId: active.columnId,
          ...(groupKey !== undefined ? { groupKey } : {}),
        };
        this.#renderRange();
      },
      () => {
        if (!moved) return;
        const current = this.#rangeBounds();
        if (!current) return;
        const sourceCell = source.cells[column.id];
        const updated = new Map<string, DatabaseRow>();
        for (let index = current.startRow; index <= current.endRow; index += 1) {
          const row = current.rows[index];
          if (!row || row.id === active.rowId) continue;
          const cells = { ...row.cells };
          if (sourceCell) cells[column.id] = cloneCell(sourceCell);
          else delete cells[column.id];
          updated.set(row.id, { ...row, cells });
        }
        if (updated.size > 0) {
          this.#host.commit({
            ...this.#data,
            rows: this.#data.rows.map(item => updated.get(item.id) ?? item),
          });
        }
      }
    );
  }

  #rangeText(): string {
    const bounds = this.#rangeBounds();
    if (!bounds) return '';
    const lines: string[] = [];
    for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
      const dataRow = bounds.rows[row];
      if (!dataRow) continue;
      const cells: string[] = [];
      for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
        const dataColumn = bounds.columns[column];
        if (!dataColumn) continue;
        cells.push(
          tsvCell(databaseCellText(dataRow.cells[dataColumn.id], dataColumn.type))
        );
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  }

  #applyGrid(
    startRowId: string,
    startColumnId: string,
    grid: string[][],
    clearReferences = false,
    groupKey?: string
  ): void {
    const view = this.#activeView();
    const group =
      groupKey !== undefined
        ? this.#groupsFor(view).find(item => item.key === groupKey)
        : undefined;
    const rows = group ? group.rows : this.#renderedRows(view);
    const groupColumn =
      group && view.groupBy
        ? this.#data.columns.find(column => column.id === view.groupBy)
        : undefined;
    const visibleColumns = this.#visibleColumns(view);
    const startRow = rows.findIndex(row => row.id === startRowId);
    const startColumn = visibleColumns.findIndex(column => column.id === startColumnId);
    if (startRow < 0 || startColumn < 0) return;

    const columns = [...visibleColumns];
    const width = Math.max(0, ...grid.map(line => line.length));
    while (columns.length < startColumn + width) {
      columns.push(createDatabaseColumn(`Column ${columns.length + 1}`));
    }
    const newColumns = columns.slice(visibleColumns.length);

    const byId = new Map(this.#data.rows.map(row => [row.id, row]));
    const added: DatabaseRow[] = [];
    let firstRowId: string | null = null;
    let firstColumnId: string | null = null;
    grid.forEach((values, rowOffset) => {
      let target = rows[startRow + rowOffset];
      if (!target) {
        target = createDatabaseRow();
        if (group && groupColumn) {
          const cells = { ...target.cells };
          const groupCell = cellForGroupValue(groupColumn, undefined, group.key);
          if (Object.keys(groupCell).length > 0) cells[groupColumn.id] = groupCell;
          target = { ...target, cells };
        }
        added.push(target);
      }
      const current = byId.get(target.id) ?? target;
      const cells = { ...current.cells };
      values.forEach((value, columnOffset) => {
        const column = columns[startColumn + columnOffset];
        if (!column) return;
        const cell = cells[column.id];
        if (column.type === 'checkbox') {
          const checked = /^(true|1|yes|✓)$/iu.test(value.trim());
          cells[column.id] = { ...(cell ?? {}), checked };
        } else if (column.type === 'multi-select') {
          const next = value
            .split(/[,;]/u)
            .map(item => item.trim())
            .filter(Boolean);
          if (next.length > 0) cells[column.id] = { ...(cell ?? {}), values: next };
          else delete cells[column.id];
        } else if (column.type === 'progress') {
          const n = parseProgressValue(value);
          if (n !== null) cells[column.id] = withText(cell, String(n));
          else delete cells[column.id];
        } else if (column.type === 'image') {
          const src = safeImageSrc(value);
          if (src) cells[column.id] = withText(cell, src);
          else delete cells[column.id];
        } else if (column.type === 'files' || column.type === 'people') {
          if (clearReferences) delete cells[column.id];
        } else if (value) {
          cells[column.id] = withText(cell, value);
        } else {
          delete cells[column.id];
        }
        if (!firstRowId) {
          firstRowId = target.id;
          firstColumnId = column.id;
        }
      });
      byId.set(target.id, { ...current, cells });
    });
    this.#host.commit({
      ...this.#data,
      columns: [...this.#data.columns, ...newColumns],
      rows: [
        ...this.#data.rows.map(row => byId.get(row.id) ?? row),
        ...added.map(row => byId.get(row.id) ?? row),
      ],
    });
    if (firstRowId && firstColumnId) {
      this.#pendingFocus = {
        rowId: firstRowId,
        columnId: firstColumnId,
        at: 'start',
      };
    }
    this.#clearRange();
  }

  #onClickCapture = (event: MouseEvent): void => {
    if (!this.#suppressClick) return;
    this.#suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  #onDatabaseKeyDown = (event: KeyboardEvent): void => {
    if (this.#readonly) return;
    const target = event.target;
    if (
      target === this.element &&
      handleHistoryKey(event, redo => this.#history(redo), true)
    ) {
      return;
    }
    const editing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement &&
        (target.matches('[contenteditable="true"]') ||
          target.matches('.nb-db-progress[role="slider"]') ||
          Boolean(target.closest('.nb-db-text[contenteditable="true"]'))));
    const editingCell =
      target instanceof HTMLElement && Boolean(target.closest('.nb-db-cell'));
    const rangeDelete =
      (event.key === 'Delete' || event.key === 'Backspace') &&
      !event.metaKey &&
      !event.ctrlKey &&
      this.#selectedRows.size === 0 &&
      this.#range !== null &&
      this.#rangeCells.size > 1 &&
      (!editing || editingCell);
    if (editing && !rangeDelete) return;
    if (!editing && this.#selectedRows.size > 0) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.#selectedRows.clear();
        this.#syncRowSelection();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        this.#deleteSelectedRows();
        return;
      }
    }
    if (rangeDelete) {
      event.preventDefault();
      const bounds = this.#rangeBounds();
      if (!bounds) return;
      const firstRow = bounds.rows[bounds.startRow];
      const firstColumn = bounds.columns[bounds.startColumn];
      if (!firstRow || !firstColumn) return;
      this.#applyGrid(
        firstRow.id,
        firstColumn.id,
        Array.from({ length: bounds.endRow - bounds.startRow + 1 }, () =>
          Array.from({ length: bounds.endColumn - bounds.startColumn + 1 }, () => '')
        ),
        true,
        this.#range?.groupKey
      );
    }
  };

  #selectedRowsText(): string {
    if (this.#selectedRows.size === 0) return '';
    const view = this.#activeView();
    const columns = this.#visibleColumns(view);
    return this.#selectedVisibleRows()
      .map(row =>
        columns
          .map(column =>
            tsvCell(databaseCellText(row.cells[column.id], column.type))
          )
          .join('\t')
      )
      .join('\n');
  }

  #selectedRowsPayload(): string {
    return JSON.stringify({
      columns: this.#data.columns.map(column => ({
        id: column.id,
        name: column.name,
        type: column.type,
      })),
      rows: this.#selectedVisibleRows().map(row => ({
        cells: row.cells,
        ...(row.page ? { page: row.page } : {}),
      })),
    });
  }

  #isNonCellTarget(target: Element | null, skipSelector: string): boolean {
    if (target?.closest(skipSelector)) return true;
    return (
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
      !target.closest('.nb-db-cell')
    );
  }

  #writeRowsClipboard(event: ClipboardEvent, rowText: string): void {
    event.clipboardData?.setData('text/plain', rowText);
    event.clipboardData?.setData(DATABASE_ROWS_MIME, this.#selectedRowsPayload());
    event.preventDefault();
  }

  #onCopy = (event: ClipboardEvent): void => {
    const target = event.target as Element | null;
    if (this.#isNonCellTarget(target, '.nb-db-popover, .nb-db-detail')) return;
    const rowText = this.#selectedRowsText();
    if (rowText) {
      this.#writeRowsClipboard(event, rowText);
      return;
    }
    const text = this.#rangeCells.size > 1 ? this.#rangeText() : '';
    if (!text) return;
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
  };

  #onCut = (event: ClipboardEvent): void => {
    if (this.#readonly) return;
    const target = event.target as Element | null;
    if (this.#isNonCellTarget(target, '.nb-db-popover, .nb-db-detail')) return;
    const rowText = this.#selectedRowsText();
    if (rowText) {
      this.#writeRowsClipboard(event, rowText);
      this.#deleteSelectedRows();
      return;
    }
    if (this.#rangeCells.size <= 1) return;
    const text = this.#rangeText();
    if (!text) return;
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
    const bounds = this.#rangeBounds();
    if (!bounds) return;
    const firstRow = bounds.rows[bounds.startRow];
    const firstColumn = bounds.columns[bounds.startColumn];
    if (!firstRow || !firstColumn) return;
    this.#applyGrid(
      firstRow.id,
      firstColumn.id,
      Array.from({ length: bounds.endRow - bounds.startRow + 1 }, () =>
        Array.from({ length: bounds.endColumn - bounds.startColumn + 1 }, () => '')
      ),
      true,
      this.#range?.groupKey
    );
  };

  #onPaste = (event: ClipboardEvent): void => {
    if (this.#readonly) return;
    const target = event.target as Element | null;
    if (this.#isNonCellTarget(target, '.nb-db-popover, .nb-db-card-title')) return;
    const typed = event.clipboardData?.getData(DATABASE_ROWS_MIME) ?? '';
    if (typed) {
      try {
        const parsed = JSON.parse(typed) as {
          columns?: Array<{ id?: unknown; name?: unknown; type?: unknown }>;
          rows?: Array<{
            cells?: Record<string, DatabaseCell>;
            page?: { content?: unknown };
          }>;
        };
        const sourceColumns = Array.isArray(parsed.columns) ? parsed.columns : [];
        const columnMap = new Map<
          string,
          { id: string; sourceType: DatabaseColumnType; targetType: DatabaseColumnType }
        >();
        if (sourceColumns.length > 0) {
          const used = new Set<string>();
          for (const source of sourceColumns) {
            if (!source || typeof source.id !== 'string') continue;
            const name = typeof source.name === 'string' ? source.name : '';
            const type = typeof source.type === 'string' ? source.type : '';
            const targetColumn =
              this.#data.columns.find(
                column => column.id === source.id && !used.has(column.id)
              ) ??
              this.#data.columns.find(
                column =>
                  column.name === name &&
                  (!type || column.type === type) &&
                  !used.has(column.id)
              ) ??
              this.#data.columns.find(
                column => column.name === name && !used.has(column.id)
              );
            if (targetColumn) {
              used.add(targetColumn.id);
              columnMap.set(source.id, {
                id: targetColumn.id,
                sourceType: (type || targetColumn.type) as DatabaseColumnType,
                targetType: targetColumn.type,
              });
            }
          }
        } else {
          for (const column of this.#data.columns) {
            columnMap.set(column.id, {
              id: column.id,
              sourceType: column.type,
              targetType: column.type,
            });
          }
        }
        const sourceRows = Array.isArray(parsed.rows) ? parsed.rows : [];
        const rows = sourceRows.map(item => {
          const cells: Record<string, DatabaseCell> = {};
          for (const [sourceId, cell] of Object.entries(item.cells ?? {})) {
            const mapping = columnMap.get(sourceId);
            if (!mapping) continue;
            if (!cell || typeof cell !== 'object' || Array.isArray(cell)) continue;
            const next =
              mapping.sourceType === mapping.targetType
                ? cloneCell(cell)
                : convertCell(cell, mapping.sourceType, mapping.targetType);
            if (next) cells[mapping.id] = next;
          }
          const pageContent = Array.isArray(item.page?.content)
            ? parseInlineRuns(item.page.content)
            : [];
          return {
            id: createId('r'),
            cells,
            ...(pageContent.length > 0 ? { page: { content: pageContent } } : {}),
          };
        });
        if (rows.length > 0 && columnMap.size > 0) {
          event.preventDefault();
          event.stopPropagation();
          const targetCell = target?.closest<HTMLElement>('.nb-db-cell[data-row-id]');
          const targetRowId = targetCell?.dataset.rowId ?? this.#active?.rowId;
          const index = targetRowId
            ? this.#data.rows.findIndex(row => row.id === targetRowId)
            : -1;
          const next = [...this.#data.rows];
          next.splice(index < 0 ? next.length : index + 1, 0, ...rows);
          this.#host.commit({ ...this.#data, rows: next });
          return;
        }
      } catch {
        // Fall back to TSV paste.
      }
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    const hasGrid = text.includes('\t') || text.includes('\n');
    if (!hasGrid && this.#rangeCells.size <= 1) return;
    const grid = parseTsv(text);
    if (grid.length === 0) return;
    const cell = target?.closest<HTMLElement>('.nb-db-cell[data-row-id][data-column-id]');
    const bounds = this.#rangeBounds();
    const startRowId =
      bounds?.rows[bounds.startRow]?.id ??
      cell?.dataset.rowId ??
      this.#active?.rowId;
    const startColumnId =
      bounds?.columns[bounds.startColumn]?.id ??
      cell?.dataset.columnId ??
      this.#active?.columnId;
    if (!startRowId || !startColumnId) return;
    const groupKey = cell?.closest<HTMLElement>('.nb-db-group')?.dataset.group;
    event.preventDefault();
    event.stopPropagation();
    this.#applyGrid(startRowId, startColumnId, grid, false, groupKey);
  };
}
