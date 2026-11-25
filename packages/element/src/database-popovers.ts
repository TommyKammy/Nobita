import {
  DATABASE_STAT_LABELS,
  DATABASE_STAT_TYPES,
  createId,
  databaseFilterGroup,
  databaseSorts,
  databaseStatValue,
  databaseViewColumnStates,
  groupedDatabaseRows,
  safeHref,
} from '@nobita/core';
import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseData,
  DatabaseFile,
  DatabaseFilter,
  DatabaseFilterGroup,
  DatabaseFilterOperator,
  DatabaseRow,
  DatabaseStatType,
  DatabaseView as DatabaseViewConfig,
  DatabaseViewColumn,
} from '@nobita/core';
import { dismissFloating, placeFloating } from './floating.js';
import { icon } from './icons.js';
import {
  COLUMN_TYPES,
  FILTER_LABELS,
  btn,
  defaultFilterForColumn,
  defaultFilterOperator,
  el,
  filterOperators,
  iconBtn,
  popTitle,
  selectEl,
} from './database-dom.js';

export interface DatabasePopoversContext {
  rootElement: HTMLElement;
  getEventsSignal(): AbortSignal;
  getReadonly(): boolean;
  getData(): DatabaseData;
  activeView(): DatabaseViewConfig & { id: string; name: string };
  views(): (DatabaseViewConfig & { id: string; name: string })[];
  columnStates(view?: DatabaseViewConfig): ReturnType<typeof databaseViewColumnStates>;
  viewColumns(view?: DatabaseViewConfig): DatabaseViewColumn[];
  titleColumn(view?: DatabaseViewConfig): DatabaseColumn | undefined;
  groupsFor(view: DatabaseViewConfig): ReturnType<typeof groupedDatabaseRows>;
  commit(data: DatabaseData, options?: { mergeKey?: string }): void;
  updateActiveView(patch: Partial<DatabaseViewConfig>): void;
  patchViewColumn(
    columnId: string,
    patch: Partial<DatabaseViewColumn>,
    options?: { move?: -1 | 1 }
  ): void;
  setFilterTree(filter: DatabaseFilterGroup): void;
  setGroupProperty(key: string, patch: { hide?: boolean; collapsed?: boolean }): void;
  commitCell(rowId: string, columnId: string, cell: DatabaseCell, mergeKey?: string): void;
  addView(type: 'table' | 'board'): void;
  moveView(direction: 1 | -1): void;
  moveGroup(key: string, direction: 1 | -1): void;
  moveColumn(columnId: string, direction: 1 | -1): void;
  duplicateColumn(columnId: string): void;
  deleteColumn(columnId: string): void;
  insertColumn(anchorId: string, after: boolean): void;
  commitColumnFields(
    columnId: string,
    name: string,
    type: DatabaseColumnType,
    optionsText: string,
    extra?: (columns: DatabaseColumn[]) => DatabaseColumn[]
  ): void;
  addColumnOfType(type: DatabaseColumnType, openSettings?: boolean): void;
  addFilterForColumn(columnId: string): void;
  defaultGroupColumn(): string | undefined;
  insertRow(anchorId: string | null, after: boolean): void;
  duplicateRow(rowId: string): void;
  deleteRow(rowId: string): void;
}

/** Manages floating popovers for views, queries, columns, rows, and cell pickers. */
export class DatabasePopoversController {
  #ctx: DatabasePopoversContext;
  #popoverCleanup: (() => void) | null = null;

  constructor(ctx: DatabasePopoversContext) {
    this.#ctx = ctx;
  }

  showPopover(anchor: HTMLElement, content: HTMLElement): void {
    this.closePopover();
    const popover = el('div', 'nb-db-popover');
    popover.append(content);
    this.#ctx.rootElement.append(popover);
    placeFloating(popover, anchor.getBoundingClientRect(), {
      align: 'start',
      side: 'below',
      gap: 6,
      margin: 10,
    });

    const dismiss = dismissFloating({
      element: popover,
      pointerTarget: document,
      scroll: true,
      dismissOnInsideScroll: true,
      onDismiss: () => this.closePopover(),
    });
    this.#popoverCleanup = () => {
      dismiss();
      popover.remove();
    };
  }

  closePopover(): void {
    const cleanup = this.#popoverCleanup;
    this.#popoverCleanup = null;
    cleanup?.();
  }

  destroy(): void {
    this.closePopover();
  }

  openAddViewMenu(anchor: HTMLElement): void {
    const content = document.createElement('div');
    content.append(popTitle('Add view'));
    const actions = el('div', 'nb-db-pop-actions');
    for (const type of ['table', 'board'] as const) {
      const button = btn(undefined, {
        text: type === 'board' ? 'Board view' : 'Table view',
      });
      button.addEventListener('click', () => {
        this.closePopover();
        this.#ctx.addView(type);
      });
      actions.append(button);
    }
    content.append(actions);
    this.showPopover(anchor, content);
  }

  openViewMenu(anchor: HTMLElement): void {
    if (this.#ctx.getReadonly()) return;
    const data = this.#ctx.getData();
    const signal = this.#ctx.getEventsSignal();
    const view = this.#ctx.activeView();
    const content = el('div', 'nb-db-view-menu');
    content.append(popTitle('View settings'));
    const name = el('input', 'nb-db-view-name');
    name.value = view.name;
    name.placeholder = 'View name';
    name.setAttribute('aria-label', 'View name');
    name.addEventListener('change', () => {
      const value = name.value.trim();
      if (value && value !== view.name) this.#ctx.updateActiveView({ name: value });
    }, { signal });
    content.append(name);

    const layout = el('div', 'nb-db-view-layout');
    const label = el('span', undefined, 'Layout');
    const buttons = document.createElement('div');
    for (const type of ['table', 'board'] as const) {
      const button = btn('nb-db-view-layout-btn', {
        html: `${type === 'table' ? icon.table : icon.database}<span>${type === 'table' ? 'Table' : 'Board'}</span>`,
        dataset: { active: String(view.type === type) },
      });
      button.addEventListener('click', () => {
        if (view.type === type) return;
        this.closePopover();
        const groupBy =
          type === 'board' && !view.groupBy
            ? this.#ctx.defaultGroupColumn()
            : undefined;
        this.#ctx.updateActiveView({
          type,
          ...(groupBy ? { groupBy } : {}),
        });
      }, { signal });
      buttons.append(button);
    }
    layout.append(label, buttons);
    content.append(layout);

    const actions = el('div', 'nb-db-pop-actions');
    const add = (text: string, action: () => void, danger = false): void => {
      const button = btn(danger ? 'danger' : undefined, { text });
      button.addEventListener('click', action);
      actions.append(button);
    };
    const propertyCount = this.#ctx.columnStates(view).filter(item => !item.hide).length;
    add(`Properties (${propertyCount} shown)`, () => {
      this.closePopover();
      this.openViewProperties(anchor);
    });
    add('Filter', () => {
      this.closePopover();
      this.openFilterPopover(anchor);
    });
    add(
      `Sort${databaseSorts(view).length > 0 ? ` (${databaseSorts(view).length})` : ''}`,
      () => {
        this.closePopover();
        this.openSortPopover(anchor);
      }
    );
    add(
      `Group${view.groupBy ? `: ${data.columns.find(column => column.id === view.groupBy)?.name ?? ''}` : ''}`,
      () => {
        this.closePopover();
        this.openGroupPopover(anchor);
      }
    );
    add('Rename view', () => {
      this.closePopover();
      this.openRenameView(anchor);
    });
    add('Duplicate view', () => {
      this.closePopover();
      const views = this.#ctx.views();
      if (views.length >= 100) return;
      const active = this.#ctx.activeView();
      const index = views.findIndex(item => item.id === active.id);
      const copy = {
        ...active,
        id: createId('v'),
        name: `${active.name} copy`,
        filters: active.filters.map(filter => ({ ...filter })),
        ...(active.filter
          ? { filter: JSON.parse(JSON.stringify(active.filter)) as DatabaseFilterGroup }
          : {}),
        ...(active.groupProperties
          ? {
              groupProperties: active.groupProperties.map(group => ({
                ...group,
                ...(group.manuallyCardSort
                  ? { manuallyCardSort: [...group.manuallyCardSort] }
                  : {}),
              })),
            }
          : {}),
        ...(active.sorts ? { sorts: active.sorts.map(sort => ({ ...sort })) } : {}),
        ...(active.columns ? { columns: active.columns.map(column => ({ ...column })) } : {}),
        ...(active.hiddenColumns ? { hiddenColumns: [...active.hiddenColumns] } : {}),
        ...(active.stats ? { stats: { ...active.stats } } : {}),
        ...(active.header ? { header: { ...active.header } } : {}),
      } satisfies DatabaseViewConfig;
      const next = [...views];
      next.splice(index + 1, 0, copy);
      const { view: _legacyView, sort: _legacySort, ...rest } = data;
      this.#ctx.commit({ ...rest, views: next, activeViewId: copy.id });
    });
    const views = this.#ctx.views();
    const index = views.findIndex(item => item.id === view.id);
    if (index > 0) {
      add('Move view left', () => {
        this.closePopover();
        this.#ctx.moveView(-1);
      });
    }
    if (index >= 0 && index < views.length - 1) {
      add('Move view right', () => {
        this.closePopover();
        this.#ctx.moveView(1);
      });
    }
    if (views.length > 1) {
      add('Delete view', () => {
        this.closePopover();
        const active = this.#ctx.activeView();
        const remaining = this.#ctx.views().filter(item => item.id !== active.id);
        const { view: _legacyView, sort: _legacySort, ...rest } = this.#ctx.getData();
        const nextActive = remaining[0]?.id;
        this.#ctx.commit({
          ...rest,
          views: remaining,
          ...(nextActive ? { activeViewId: nextActive } : {}),
        });
      }, true);
    }
    content.append(actions);
    this.showPopover(anchor, content);
    name.focus();
    name.select();
  }

  openViewProperties(anchor: HTMLElement): void {
    const signal = this.#ctx.getEventsSignal();
    const view = this.#ctx.activeView();
    const content = el('div', 'nb-db-view-properties');
    content.append(popTitle('Properties'));
    const states = this.#ctx.columnStates(view);
    const bulk = el('div', 'nb-db-properties-bulk');
    const showAll = btn(undefined, { text: 'Show all' });
    showAll.addEventListener('click', () => {
      this.closePopover();
      this.#ctx.updateActiveView({
        columns: this.#ctx.viewColumns(view).map(column => ({ ...column, hide: false })),
        hiddenColumns: [],
      });
    }, { signal });
    const hideAll = btn(undefined, { text: 'Hide all' });
    hideAll.addEventListener('click', () => {
      this.closePopover();
      const titleId = this.#ctx.titleColumn(view)?.id;
      const columns = this.#ctx.viewColumns(view).map(column => ({
        ...column,
        hide: column.id !== titleId,
      }));
      this.#ctx.updateActiveView({
        columns,
        hiddenColumns: columns.filter(column => column.hide).map(column => column.id),
      });
    }, { signal });
    bulk.append(showAll, hideAll);
    content.append(bulk);
    const list = el('div', 'nb-db-column-list');
    states.forEach((state, index) => {
      const row = el('div', 'nb-db-property-row');
      const label = el('span', 'nb-db-property-name', state.column.name);
      const up = iconBtn(
        'nb-db-property-move',
        icon.arrowUp,
        `Move ${state.column.name} up`,
        { title: 'Move up', disabled: index === 0 }
      );
      up.addEventListener('click', () => {
        this.closePopover();
        this.#ctx.patchViewColumn(state.column.id, {}, { move: -1 });
      }, { signal });
      const down = iconBtn(
        'nb-db-property-move',
        icon.arrowDown,
        `Move ${state.column.name} down`,
        { title: 'Move down', disabled: index === states.length - 1 }
      );
      down.addEventListener('click', () => {
        this.closePopover();
        this.#ctx.patchViewColumn(state.column.id, {}, { move: 1 });
      }, { signal });
      const toggle = iconBtn(
        'nb-db-property-eye',
        state.hide ? icon.expand : icon.checkboxSquare,
        state.hide ? 'Show property' : 'Hide property',
        { dataset: { hidden: String(state.hide) } }
      );
      toggle.addEventListener('click', () => {
        this.closePopover();
        this.#ctx.patchViewColumn(state.column.id, { hide: !state.hide });
      }, { signal });
      row.append(label, up, down, toggle);
      list.append(row);
    });
    content.append(list);
    this.showPopover(anchor, content);
  }

  openRenameView(anchor: HTMLElement): void {
    const view = this.#ctx.activeView();
    const content = document.createElement('div');
    const field = el('label', 'nb-db-field');
    const input = document.createElement('input');
    input.value = view.name;
    field.append(el('span', undefined, 'Name'), input);
    const actions = el('div', 'nb-db-pop-actions');
    const apply = btn(undefined, { text: 'Done' });
    apply.addEventListener('click', () => {
      const name = input.value.trim();
      if (name) this.#ctx.updateActiveView({ name });
      this.closePopover();
    });
    actions.append(apply);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      apply.click();
    });
    content.append(popTitle('Rename view'), field, actions);
    this.showPopover(anchor, content);
    input.focus();
    input.select();
  }

  openSortPopover(anchor: HTMLElement): void {
    const data = this.#ctx.getData();
    const view = this.#ctx.activeView();
    const draft = (view.sorts ?? (view.sort ? [view.sort] : [])).map(sort => ({ ...sort }));
    const content = el('div', 'nb-db-sort-popover');
    const list = el('div', 'nb-db-filter-list');
    const render = (): void => {
      list.replaceChildren();
      if (draft.length === 0) {
        list.append(el('div', 'nb-db-filter-empty', 'No sort keys.'));
      }
      draft.forEach((sort, index) => {
        const row = el('div', 'nb-db-filter-row');
        const column = selectEl(
          'Sort column',
          data.columns.map(item => ({
            value: item.id,
            label: item.name,
            selected: item.id === sort.columnId,
          }))
        );
        column.addEventListener('change', () => {
          sort.columnId = column.value;
        });
        const direction = selectEl('Sort direction', [
          { value: 'asc', label: 'Ascending', selected: sort.direction === 'asc' },
          { value: 'desc', label: 'Descending', selected: sort.direction === 'desc' },
        ]);
        direction.addEventListener('change', () => {
          sort.direction = direction.value === 'desc' ? 'desc' : 'asc';
        });
        const remove = iconBtn('nb-db-filter-remove', icon.x, 'Remove sort');
        remove.addEventListener('click', () => {
          draft.splice(index, 1);
          render();
        });
        row.append(column, direction, remove);
        list.append(row);
      });
    };
    const footer = el('div', 'nb-db-pop-actions');
    const add = btn(undefined, { text: '+ Add sort' });
    add.addEventListener('click', () => {
      const first = data.columns[0];
      if (!first) return;
      draft.push({ columnId: first.id, direction: 'asc' });
      render();
    });
    const clear = btn(undefined, { text: 'Clear' });
    clear.addEventListener('click', () => {
      draft.length = 0;
      render();
    });
    const apply = btn(undefined, { text: 'Apply' });
    apply.addEventListener('click', () => {
      this.#ctx.updateActiveView({
        sorts: draft.filter(sort => data.columns.some(column => column.id === sort.columnId)),
        sort: null,
      });
      this.closePopover();
    });
    footer.append(add, clear, apply);
    content.append(popTitle('Sort'), list, footer);
    render();
    this.showPopover(anchor, content);
  }

  openStatPopover(
    columnId: string,
    anchor: HTMLElement,
    rows: readonly DatabaseRow[]
  ): void {
    const column = this.#ctx.getData().columns.find(item => item.id === columnId);
    if (!column) return;
    const content = document.createElement('div');
    content.append(popTitle(`Calculate ${column.name}`));
    const list = el('div', 'nb-db-stat-list');
    const current = this.#ctx.columnStates().find(item => item.column.id === columnId)?.stat;
    const add = (label: string, type: DatabaseStatType | null): void => {
      const button = btn('nb-db-stat-option', {
        text: type ? `${label} (${databaseStatValue(rows, column, type)})` : 'None',
        dataset: { active: String((current ?? null) === type) },
      });
      button.addEventListener('click', () => {
        const view = this.#ctx.activeView();
        const stats = { ...(view.stats ?? {}) };
        if (type) stats[columnId] = type;
        else delete stats[columnId];
        const columns = this.#ctx.viewColumns(view).map(item => {
          if (item.id !== columnId) return item;
          const next = { ...item };
          if (type) next.stat = type;
          else delete next.stat;
          return next;
        });
        this.#ctx.updateActiveView({ stats, columns });
        this.closePopover();
      });
      list.append(button);
    };
    add('None', null);
    const available =
      column.type === 'number'
        ? DATABASE_STAT_TYPES
        : DATABASE_STAT_TYPES.filter(
            type =>
              type === 'count' ||
              type === 'countValues' ||
              type === 'countUnique' ||
              type === 'countEmpty' ||
              type === 'countNotEmpty'
          );
    for (const type of available) {
      add(DATABASE_STAT_LABELS[type], type);
    }
    content.append(list);
    this.showPopover(anchor, content);
  }

  openFilterPopover(anchor: HTMLElement): void {
    const data = this.#ctx.getData();
    const view = this.#ctx.activeView();
    const root = JSON.parse(
      JSON.stringify(databaseFilterGroup(view))
    ) as DatabaseFilterGroup;
    const content = el('div', 'nb-db-filter-popover');
    content.append(popTitle('Filters'));
    const modeRow = el('label', 'nb-db-field');
    const modeSelect = selectEl('Filter mode', [
      { value: 'and', label: 'All filters', selected: root.op === 'and' },
      { value: 'or', label: 'Any filter', selected: root.op === 'or' },
    ]);
    modeSelect.addEventListener('change', () => {
      root.op = modeSelect.value === 'or' ? 'or' : 'and';
    });
    modeRow.append(el('span', undefined, 'Match'), modeSelect);
    content.append(modeRow);

    const list = el('div', 'nb-db-filter-list');
    content.append(list);

    const render = (): void => {
      list.replaceChildren();
      this.#renderFilterGroup(root, list, 0, undefined, render);
      if (root.conditions.length === 0) {
        list.append(el('div', 'nb-db-filter-empty', 'No filters. Showing all rows.'));
      }
    };
    const footer = el('div', 'nb-db-pop-actions');
    const add = btn(undefined, { text: '+ Add filter' });
    add.addEventListener('click', () => {
      const first = data.columns[0];
      if (!first) return;
      root.conditions.push(defaultFilterForColumn(first));
      render();
    });
    const addGroup = btn(undefined, { text: '+ Add group' });
    addGroup.addEventListener('click', () => {
      root.conditions.push({ type: 'group', op: 'and', conditions: [] });
      render();
    });
    const clear = btn(undefined, { text: 'Clear all' });
    clear.addEventListener('click', () => {
      root.conditions = [];
      render();
    });
    const apply = btn(undefined, { text: 'Apply' });
    apply.addEventListener('click', () => {
      root.op = modeSelect.value === 'or' ? 'or' : 'and';
      this.#ctx.setFilterTree(root);
      this.closePopover();
    });
    footer.append(add, addGroup, clear, apply);
    content.append(footer);
    render();
    this.showPopover(anchor, content);
  }

  #renderFilterCondition(
    filter: DatabaseFilter,
    parent: DatabaseFilterGroup,
    render: () => void
  ): HTMLElement {
    const columns = this.#ctx.getData().columns;
    const column = columns.find(item => item.id === filter.columnId);
    const row = el('div', 'nb-db-filter-row');
    if (!column) {
      row.textContent = 'This filter references a deleted column.';
      const remove = iconBtn('nb-db-filter-remove', icon.x, 'Remove filter');
      remove.addEventListener('click', () => {
        parent.conditions = parent.conditions.filter(item => item !== filter);
        render();
      });
      row.append(remove);
      return row;
    }
    const columnSelect = selectEl(
      'Filter column',
      columns.map(item => ({
        value: item.id,
        label: item.name,
        selected: item.id === filter.columnId,
      }))
    );
    columnSelect.addEventListener('change', () => {
      const next = columns.find(item => item.id === columnSelect.value);
      if (!next) return;
      filter.columnId = next.id;
      filter.operator = defaultFilterOperator(next.type);
      filter.value = next.type === 'checkbox' ? 'true' : '';
      render();
    });

    const operators = filterOperators(column.type);
    if (!operators.includes(filter.operator)) operators.unshift(filter.operator);
    const operatorSelect = selectEl(
      'Filter operator',
      operators.map(value => ({
        value,
        label: FILTER_LABELS[value],
        selected: filter.operator === value,
      }))
    );
    operatorSelect.addEventListener('change', () => {
      filter.operator = operatorSelect.value as DatabaseFilterOperator;
      render();
    });
    row.append(columnSelect, operatorSelect);

    const needsValue =
      filter.operator !== 'isEmpty' &&
      filter.operator !== 'isNotEmpty' &&
      filter.operator !== 'isChecked' &&
      filter.operator !== 'isUnchecked';
    if (needsValue) {
      if (column.type === 'select') {
        const select = selectEl('Filter value', [
          { value: '', label: 'Choose…' },
          ...(column.options ?? []).map(optionValue => ({
            value: optionValue,
            label: optionValue,
            selected: filter.value === optionValue,
          })),
        ]);
        select.addEventListener('change', () => {
          filter.value = select.value;
        });
        row.append(select);
      } else if (column.type === 'checkbox') {
        const select = selectEl('Filter value', [
          {
            value: 'true',
            label: 'Checked',
            selected: (filter.value ?? 'true') === 'true',
          },
          {
            value: 'false',
            label: 'Unchecked',
            selected: (filter.value ?? 'true') === 'false',
          },
        ]);
        select.addEventListener('change', () => {
          filter.value = select.value;
        });
        row.append(select);
      } else {
        const input = document.createElement('input');
        if (column.type === 'number') input.type = 'number';
        else if (column.type === 'date') input.type = 'date';
        else input.placeholder = column.type === 'multi-select' ? 'Option, Option' : 'Value';
        input.value = filter.value ?? '';
        input.setAttribute('aria-label', 'Filter value');
        input.addEventListener('input', () => {
          filter.value = input.value;
        });
        row.append(input);
      }
    }
    const remove = iconBtn('nb-db-filter-remove', icon.x, 'Remove filter');
    remove.addEventListener('click', () => {
      parent.conditions = parent.conditions.filter(item => item !== filter);
      render();
    });
    row.append(remove);
    return row;
  }

  #renderFilterGroup(
    group: DatabaseFilterGroup,
    parent: HTMLElement,
    depth: number,
    parentGroup: DatabaseFilterGroup | undefined,
    render: () => void
  ): void {
    const columns = this.#ctx.getData().columns;
    const box = el('div', depth === 0 ? 'nb-db-filter-root-group' : 'nb-db-filter-group');
    if (depth > 0) {
      const head = el('div', 'nb-db-filter-group-head');
      const op = selectEl('Filter group mode', [
        { value: 'and', label: 'All', selected: group.op === 'and' },
        { value: 'or', label: 'Any', selected: group.op === 'or' },
      ]);
      op.addEventListener('change', () => {
        group.op = op.value === 'or' ? 'or' : 'and';
      });
      const remove = iconBtn('nb-db-filter-remove', icon.x, 'Remove group');
      remove.addEventListener('click', () => {
        if (!parentGroup) return;
        parentGroup.conditions = parentGroup.conditions.filter(item => item !== group);
        render();
      });
      head.append(op, remove);
      box.append(head);
    }
    for (const item of group.conditions) {
      if (item.type === 'group') {
        this.#renderFilterGroup(item, box, depth + 1, group, render);
      } else {
        box.append(this.#renderFilterCondition(item, group, render));
      }
    }
    if (depth > 0) {
      const footer = el('div', 'nb-db-filter-group-actions');
      const addCondition = btn('nb-db-filter-add', { text: '+ Add condition' });
      addCondition.addEventListener('click', () => {
        const first = columns[0];
        if (!first) return;
        group.conditions.push(defaultFilterForColumn(first));
        render();
      });
      footer.append(addCondition);
      if (depth < 4) {
        const addGroup = btn('nb-db-filter-add', { text: '+ Add group' });
        addGroup.addEventListener('click', () => {
          group.conditions.push({ type: 'group', op: 'and', conditions: [] });
          render();
        });
        footer.append(addGroup);
      }
      box.append(footer);
    }
    parent.append(box);
  }

  openGroupPopover(anchor: HTMLElement): void {
    const data = this.#ctx.getData();
    const signal = this.#ctx.getEventsSignal();
    const view = this.#ctx.activeView();
    const content = el('div', 'nb-db-group-popover');
    content.append(popTitle('Group'));
    const groupable =
      view.type === 'board'
        ? ['select', 'multi-select', 'checkbox']
        : ['text', 'number', 'date', 'select', 'multi-select', 'checkbox'];
    const select = selectEl('Group by column', [
      { value: '', label: 'None', selected: !view.groupBy },
      ...data.columns
        .filter(column => groupable.includes(column.type))
        .map(column => ({
          value: column.id,
          label: column.name,
          selected: view.groupBy === column.id,
        })),
    ]);
    select.addEventListener('change', () => {
      const groupBy = select.value || null;
      if (!groupBy) {
        this.#ctx.updateActiveView({ groupBy: null });
        this.closePopover();
        return;
      }
      const groups = groupedDatabaseRows(data, { ...view, groupBy });
      this.#ctx.updateActiveView({
        groupBy,
        groupProperties: groups.map(group => {
          const existing = view.groupProperties?.find(item => item.key === group.key);
          return existing ? { ...existing } : { key: group.key };
        }),
      });
      this.closePopover();
    });
    content.append(select);

    const hideEmpty = el('label', 'nb-db-check-row');
    const hideEmptyInput = document.createElement('input');
    hideEmptyInput.type = 'checkbox';
    hideEmptyInput.checked = Boolean(view.hideEmptyGroups);
    hideEmptyInput.addEventListener('change', () => {
      this.#ctx.updateActiveView({ hideEmptyGroups: hideEmptyInput.checked });
    }, { signal });
    hideEmpty.append(hideEmptyInput, el('span', undefined, 'Hide empty groups'));
    content.append(hideEmpty);

    if (view.groupBy) {
      const groups = this.#ctx.groupsFor(view);
      const list = el('div', 'nb-db-group-setting-list');
      groups.forEach((group, index) => {
        const row = el('div', 'nb-db-group-setting');
        const label = el('span', 'nb-db-group-setting-name', group.label || 'No value');
        const count = el('span', 'nb-db-group-count', String(group.rows.length));
        const up = iconBtn(
          'nb-db-property-move',
          icon.arrowUp,
          `Move ${group.label || 'group'} up`,
          { title: 'Move group up', disabled: index === 0 }
        );
        up.addEventListener('click', () => this.#ctx.moveGroup(group.key, -1), { signal });
        const down = iconBtn(
          'nb-db-property-move',
          icon.arrowDown,
          `Move ${group.label || 'group'} down`,
          { title: 'Move group down', disabled: index === groups.length - 1 }
        );
        down.addEventListener('click', () => this.#ctx.moveGroup(group.key, 1), { signal });
        const toggle = iconBtn(
          'nb-db-property-eye',
          group.hidden ? icon.expand : icon.checkboxSquare,
          group.hidden ? `Show ${group.label || 'group'}` : `Hide ${group.label || 'group'}`,
          {
            title: group.hidden ? 'Show group' : 'Hide group',
            dataset: { hidden: String(Boolean(group.hidden)) },
          }
        );
        toggle.addEventListener('click', () => {
          this.closePopover();
          this.#ctx.setGroupProperty(group.key, { hide: !group.hidden });
        }, { signal });
        row.append(label, count, up, down, toggle);
        list.append(row);
      });
      content.append(list);
    }
    this.showPopover(anchor, content);
    select.focus();
  }

  openAddPropertyMenu(anchor: HTMLElement): void {
    const content = document.createElement('div');
    content.append(popTitle('Add property'));
    const list = el('div', 'nb-db-pop-actions');
    for (const type of COLUMN_TYPES) {
      const button = btn(undefined, { text: type.label });
      button.addEventListener('click', () => {
        this.closePopover();
        this.#ctx.addColumnOfType(type.type, false);
      });
      list.append(button);
    }
    content.append(list);
    this.showPopover(anchor, content);
  }

  openMultiSelectPopover(
    columnId: string,
    rowId: string,
    anchor: HTMLElement
  ): void {
    if (this.#ctx.getReadonly()) return;
    const data = this.#ctx.getData();
    const column = data.columns.find(item => item.id === columnId);
    const row = data.rows.find(item => item.id === rowId);
    if (!column || !row) return;
    const draft = [...(row.cells[columnId]?.values ?? [])];
    const content = document.createElement('div');
    content.append(popTitle(column.name));
    const options = [...new Set([...(column.options ?? []), ...draft])];
    if (options.length === 0) {
      content.append(
        el('div', 'nb-db-filter-empty', 'Add options in the column settings first.')
      );
    }
    for (const option of options) {
      const label = el('label', 'nb-db-check-row');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = draft.includes(option);
      input.addEventListener('change', () => {
        if (input.checked) {
          if (!draft.includes(option)) draft.push(option);
        } else {
          const index = draft.indexOf(option);
          if (index >= 0) draft.splice(index, 1);
        }
      });
      label.append(input, el('span', undefined, option));
      content.append(label);
    }
    const actions = el('div', 'nb-db-pop-actions');
    const done = btn(undefined, { text: 'Done' });
    done.addEventListener('click', () => {
      this.#ctx.commitCell(
        rowId,
        columnId,
        { ...(row.cells[columnId] ?? {}), values: draft },
        `db:${rowId}:${columnId}`
      );
      this.closePopover();
    });
    actions.append(done);
    content.append(actions);
    this.showPopover(anchor, content);
    content.querySelector<HTMLInputElement>('input')?.focus();
  }

  openFilesPopover(
    columnId: string,
    rowId: string,
    anchor: HTMLElement
  ): void {
    if (this.#ctx.getReadonly()) return;
    const data = this.#ctx.getData();
    const column = data.columns.find(item => item.id === columnId);
    const row = data.rows.find(item => item.id === rowId);
    if (!column || !row) return;
    const files: DatabaseFile[] = (row.cells[columnId]?.files ?? []).map(file => ({
      ...file,
    }));
    const content = document.createElement('div');
    content.append(popTitle(column.name));
    const nameInput = document.createElement('input');
    nameInput.placeholder = 'File name';
    nameInput.setAttribute('aria-label', 'File name');
    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.placeholder = 'https://…';
    urlInput.setAttribute('aria-label', 'File URL');
    const error = el('div', 'nb-db-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const list = el('div', 'nb-db-file-list');
    const render = (): void => {
      list.replaceChildren();
      files.forEach((file, index) => {
        const fileRow = el('div', 'nb-db-filter-row');
        const link = el('a', undefined, file.name);
        link.href = file.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const remove = iconBtn('nb-db-filter-remove', icon.x, `Remove ${file.name}`);
        remove.addEventListener('click', () => {
          files.splice(index, 1);
          render();
        });
        fileRow.append(link, remove);
        list.append(fileRow);
      });
    };
    const add = btn(undefined, { text: 'Add file' });
    add.addEventListener('click', () => {
      const name = nameInput.value.trim();
      const url = safeHref(urlInput.value);
      if (!name || !url) {
        error.textContent = 'Name and a valid URL are required.';
        error.hidden = false;
        return;
      }
      files.push({ id: createId('f'), name, url });
      nameInput.value = '';
      urlInput.value = '';
      error.hidden = true;
      render();
    });
    const done = btn(undefined, { text: 'Done' });
    done.addEventListener('click', () => {
      this.#ctx.commitCell(
        rowId,
        columnId,
        { ...(row.cells[columnId] ?? {}), files },
        `db:${rowId}:${columnId}`
      );
      this.closePopover();
    });
    const actions = el('div', 'nb-db-pop-actions');
    actions.append(add, done);
    content.append(nameInput, urlInput, error, list, actions);
    render();
    this.showPopover(anchor, content);
    nameInput.focus();
  }

  openPeoplePopover(
    columnId: string,
    rowId: string,
    anchor: HTMLElement
  ): void {
    if (this.#ctx.getReadonly()) return;
    const data = this.#ctx.getData();
    const column = data.columns.find(item => item.id === columnId);
    const row = data.rows.find(item => item.id === rowId);
    if (!column || !row) return;
    const existing = row.cells[columnId]?.people ?? [];
    const content = document.createElement('div');
    content.append(popTitle(column.name));
    const input = document.createElement('input');
    input.value = existing.map(person => person.label).join(', ');
    input.placeholder = 'Ada, Lin';
    input.setAttribute('aria-label', 'People');
    const hint = el('div', 'nb-db-filter-empty', 'Separate names with commas.');
    const done = btn(undefined, { text: 'Done' });
    const actions = el('div', 'nb-db-pop-actions');
    actions.append(done);
    done.addEventListener('click', () => {
      const labels = input.value
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
      const unchanged =
        labels.length === existing.length &&
        labels.every((label, index) => label === existing[index]?.label);
      const used = new Set<string>();
      const people = unchanged
        ? existing
        : labels.map(label => {
            const match = existing.find(
              person => person.label === label && !used.has(person.id)
            );
            if (match) {
              used.add(match.id);
              return match;
            }
            return { id: createId('p'), label };
          });
      this.#ctx.commitCell(
        rowId,
        columnId,
        { ...(row.cells[columnId] ?? {}), people },
        `db:${rowId}:${columnId}`
      );
      this.closePopover();
    });
    content.append(input, hint, actions);
    this.showPopover(anchor, content);
    input.focus();
    input.select();
  }

  #buildNumberFormatField(column: DatabaseColumn): {
    field: HTMLElement;
    formatSelect: HTMLSelectElement;
    decimals: HTMLInputElement;
    decimalPatch: () => { decimal?: number };
  } {
    const field = el('div', 'nb-db-field nb-db-number-format');
    const formatSelect = selectEl('Number format', [
      { value: 'number', label: 'Number', selected: (column.data?.format ?? 'number') === 'number' },
      { value: 'currency', label: 'Currency', selected: (column.data?.format ?? 'number') === 'currency' },
      { value: 'percent', label: 'Percent', selected: (column.data?.format ?? 'number') === 'percent' },
      { value: 'decimal', label: 'Decimal', selected: (column.data?.format ?? 'number') === 'decimal' },
    ]);
    const decimals = document.createElement('input');
    decimals.type = 'number';
    decimals.min = '0';
    decimals.max = '6';
    decimals.step = '1';
    const defaultDecimals =
      typeof column.data?.decimal === 'number'
        ? column.data.decimal
        : column.data?.format === 'currency'
          ? 2
          : 0;
    decimals.value = String(defaultDecimals);
    let decimalTouched = false;
    decimals.addEventListener('input', () => {
      decimalTouched = true;
    });
    decimals.setAttribute('aria-label', 'Decimal places');
    const decimalPatch = (): { decimal?: number } =>
      decimalTouched || typeof column.data?.decimal === 'number'
        ? {
            decimal: Math.max(
              0,
              Math.min(6, Math.round(Number(decimals.value) || 0))
            ),
          }
        : {};
    field.append(el('span', undefined, 'Format'), formatSelect, decimals);
    field.style.display = column.type === 'number' ? '' : 'none';
    return { field, formatSelect, decimals, decimalPatch };
  }

  openColumnPopover(columnId: string, anchor: HTMLElement): void {
    if (this.#ctx.getReadonly()) return;
    const data = this.#ctx.getData();
    const column = data.columns.find(item => item.id === columnId);
    if (!column) return;
    const view = this.#ctx.activeView();
    const state = this.#ctx.columnStates(view).find(item => item.column.id === columnId);
    const isTitle = this.#ctx.titleColumn(view)?.id === columnId;
    const content = el('div', 'nb-db-column-popover');
    content.append(popTitle('Column'));

    const nameField = el('label', 'nb-db-field');
    const nameInput = document.createElement('input');
    nameInput.value = column.name;
    nameInput.disabled = isTitle;
    nameField.append(el('span', undefined, 'Name'), nameInput);

    const typeField = el('label', 'nb-db-field');
    const typeSelect = document.createElement('select');
    typeSelect.disabled = isTitle;
    for (const type of COLUMN_TYPES) {
      const option = document.createElement('option');
      option.value = type.type;
      option.textContent = type.label;
      option.selected = type.type === column.type;
      typeSelect.append(option);
    }
    typeField.append(el('span', undefined, 'Type'), typeSelect);

    const optionsField = el('label', 'nb-db-field');
    const optionsInput = document.createElement('input');
    optionsInput.value = column.options?.join(', ') ?? 'Todo, In progress, Done';
    optionsField.append(el('span', undefined, 'Options (comma separated)'), optionsInput);
    const { field: numberField, formatSelect, decimals, decimalPatch } =
      this.#buildNumberFormatField(column);
    const syncOptionsVisibility = (): void => {
      optionsField.style.display =
        typeSelect.value === 'select' || typeSelect.value === 'multi-select'
          ? ''
          : 'none';
      numberField.style.display = typeSelect.value === 'number' ? '' : 'none';
    };
    typeSelect.addEventListener('change', syncOptionsVisibility);
    syncOptionsVisibility();

    const actions = el('div', 'nb-db-pop-actions');
    const action = (
      label: string,
      iconMarkup: string,
      handler: () => void,
      danger = false
    ): void => {
      const button = btn(danger ? 'danger' : undefined, {
        html: `${iconMarkup}<span>${label}</span>`,
      });
      button.addEventListener('click', handler);
      actions.append(button);
    };
    const apply = (): void => {
      this.#ctx.commitColumnFields(
        columnId,
        nameInput.value,
        typeSelect.value as DatabaseColumnType,
        optionsInput.value,
        columns => {
          if (typeSelect.value !== 'number') return columns;
          return columns.map(item =>
            item.id === columnId
              ? {
                  ...item,
                  data: {
                    ...(item.data ?? {}),
                    format: formatSelect.value,
                    ...decimalPatch(),
                  },
                }
              : item
          );
        }
      );
    };
    action('Done', icon.check, () => {
      apply();
      this.closePopover();
    });
    const hidden = state?.hide ?? false;
    action(hidden ? 'Show In View' : 'Hide In View', icon.checkboxSquare, () => {
      this.closePopover();
      this.#ctx.patchViewColumn(columnId, { hide: !hidden });
    });
    action('Filter', icon.filter, () => {
      apply();
      this.#ctx.addFilterForColumn(columnId);
      this.closePopover();
      queueMicrotask(() => {
        const current =
          this.#ctx.rootElement.querySelector<HTMLElement>(
            `th[data-column-id="${CSS.escape(columnId)}"] .nb-db-col-head`
          ) ?? anchor;
        this.openFilterPopover(current);
      });
    });
    action('Sort Ascending', icon.sortAsc, () => {
      apply();
      this.#ctx.updateActiveView({ sorts: [{ columnId, direction: 'asc' }], sort: null });
      this.closePopover();
    });
    action('Sort Descending', icon.sortDesc, () => {
      apply();
      this.#ctx.updateActiveView({ sorts: [{ columnId, direction: 'desc' }], sort: null });
      this.closePopover();
    });
    action('Insert Left Column', icon.arrowLeft, () => {
      apply();
      this.#ctx.insertColumn(columnId, false);
      this.closePopover();
    });
    action('Insert Right Column', icon.arrowRight, () => {
      apply();
      this.#ctx.insertColumn(columnId, true);
      this.closePopover();
    });
    if (!isTitle) {
      action('Move Left', icon.arrowLeft, () => {
        this.closePopover();
        this.#ctx.moveColumn(columnId, -1);
      });
      action('Move Right', icon.arrowRight, () => {
        this.closePopover();
        this.#ctx.moveColumn(columnId, 1);
      });
    }
    action('Duplicate', icon.duplicate, () => {
      this.closePopover();
      this.#ctx.duplicateColumn(columnId);
    });
    if (data.columns.length > 1) {
      action('Delete', icon.trashSmall, () => {
        this.closePopover();
        this.#ctx.deleteColumn(columnId);
      }, true);
    }

    if (column.type === 'number') {
      const commitFormat = (): void => {
        const currentData = this.#ctx.getData();
        const colData = {
          ...(column.data ?? {}),
          format: formatSelect.value,
          ...decimalPatch(),
        };
        this.#ctx.commit({
          ...currentData,
          columns: currentData.columns.map(item =>
            item.id === columnId ? { ...item, data: colData } : item
          ),
        });
      };
      formatSelect.addEventListener('change', commitFormat);
      decimals.addEventListener('change', commitFormat);
    }

    nameInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        apply();
        this.closePopover();
      }
    });

    content.append(nameField, typeField, optionsField, numberField, actions);
    this.showPopover(anchor, content);
    if (!isTitle) {
      nameInput.focus();
      nameInput.select();
    }
  }

  openRowPopover(rowId: string, anchor: HTMLElement): void {
    if (this.#ctx.getReadonly()) return;
    const content = document.createElement('div');
    content.append(popTitle('Row'));
    const actions = el('div', 'nb-db-pop-actions');
    const add = (label: string, handler: () => void, danger = false): void => {
      const button = btn(danger ? 'danger' : undefined, { text: label });
      button.addEventListener('click', () => {
        handler();
        this.closePopover();
      });
      actions.append(button);
    };
    add('Insert above', () => this.#ctx.insertRow(rowId, false));
    add('Insert below', () => this.#ctx.insertRow(rowId, true));
    add('Duplicate', () => this.#ctx.duplicateRow(rowId));
    add('Delete', () => this.#ctx.deleteRow(rowId), true);
    content.append(actions);
    this.showPopover(anchor, content);
    actions.querySelector<HTMLButtonElement>('button')?.focus();
  }

  openSelectPopover(columnId: string, rowId: string, anchor: HTMLElement): void {
    if (this.#ctx.getReadonly()) return;
    const data = this.#ctx.getData();
    const column = data.columns.find(item => item.id === columnId);
    if (!column) return;
    const content = document.createElement('div');
    content.append(popTitle(column.name));
    const current = data.rows.find(row => row.id === rowId)?.cells[columnId]?.text ?? '';
    const options = column.options ?? [];
    for (const option of options) {
      const button = btn('nb-db-opt');
      button.append(el('span', 'nb-db-dot'), el('span', undefined, option));
      if (option === current) button.style.fontWeight = '600';
      button.addEventListener('click', () => {
        this.#ctx.commitCell(rowId, columnId, { text: option }, `db:${rowId}:${columnId}`);
        this.closePopover();
      });
      content.append(button);
    }
    if (options.length === 0) {
      const empty = el('div', 'nb-db-empty', 'No options yet.');
      empty.style.height = 'auto';
      content.append(empty);
    }
    if (current) {
      const clear = btn('nb-db-opt');
      clear.append(el('span', 'nb-db-opt-clear', 'Clear'));
      clear.addEventListener('click', () => {
        this.#ctx.commitCell(rowId, columnId, {}, `db:${rowId}:${columnId}`);
        this.closePopover();
      });
      content.append(clear);
    }
    const edit = btn('nb-db-opt');
    edit.append(el('span', 'nb-db-opt-clear', 'Edit options…'));
    edit.addEventListener('click', () => {
      this.closePopover();
      this.openColumnPopover(columnId, anchor);
    });
    content.append(edit);
    this.showPopover(anchor, content);
    content.querySelector<HTMLButtonElement>('.nb-db-opt')?.focus();
  }
}
