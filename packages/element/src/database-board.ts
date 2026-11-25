import {
  createDatabaseRow,
  databaseCellDisplay,
  databaseSorts,
  groupedDatabaseRows,
  safeImageSrc,
} from '@nobita/core';
import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseData,
  DatabaseRow,
  DatabaseView as DatabaseViewConfig,
} from '@nobita/core';
import { placeCaret } from './dom.js';
import { icon } from './icons.js';
import {
  TYPE_ICON,
  btn,
  cellForGroupValue,
  el,
  formatDatabaseNumber,
  iconBtn,
  mergeOrder,
  parseProgressValue,
  seedGroupSettings,
  withText,
} from './database-dom.js';
import type { DatabaseRichTextController } from './database-rich-text.js';

export interface DatabaseBoardContext {
  rootElement: HTMLElement;
  instanceId: string;
  getReadonly(): boolean;
  getData(): DatabaseData;
  getSyncedData(): DatabaseData | null;
  getScrollElement(): HTMLElement | null;
  getContentSignal(): AbortSignal;
  activeView(): DatabaseViewConfig & { id: string; name: string };
  views(): (DatabaseViewConfig & { id: string; name: string })[];
  visibleColumns(view?: DatabaseViewConfig): DatabaseColumn[];
  titleColumn(view?: DatabaseViewConfig): DatabaseColumn | undefined;
  groupsFor(view: DatabaseViewConfig): ReturnType<typeof groupedDatabaseRows>;
  currentCell(rowId: string, columnId: string): DatabaseCell | undefined;
  commit(data: DatabaseData, options?: { mergeKey?: string }): void;
  commitCell(rowId: string, columnId: string, cell: DatabaseCell, mergeKey?: string): void;
  commitDeletedRows(deletedIds: ReadonlySet<string>): void;
  clearSelectedRow(rowId: string): void;
  setPendingBoardFocus(rowId: string): void;
  history(redo: boolean): void;
  render(): void;
  openDetailPanel(rowId: string): void;
  openRowPopover(rowId: string, anchor: HTMLElement): void;
  showPopover(anchor: HTMLElement, content: HTMLElement): void;
  closePopover(): void;
  richText: DatabaseRichTextController;
}

/** Manages Kanban board rendering, card drag-reorder, group actions, and value sync. */
export class DatabaseBoardController {
  #ctx: DatabaseBoardContext;
  #boardTitleEditing: { rowId: string; columnId: string } | null = null;
  #boardBlurTimer: number | null = null;

  constructor(ctx: DatabaseBoardContext) {
    this.#ctx = ctx;
  }

  isEditingGroupTitle(view: DatabaseViewConfig): boolean {
    return Boolean(
      this.#boardTitleEditing &&
      view.type === 'board' &&
      view.groupBy === this.#boardTitleEditing.columnId
    );
  }

  destroy(): void {
    if (this.#boardBlurTimer !== null) {
      window.clearTimeout(this.#boardBlurTimer);
      this.#boardBlurTimer = null;
    }
    this.#boardTitleEditing = null;
  }

  render(view: DatabaseViewConfig): HTMLElement {
    const readonly = this.#ctx.getReadonly();
    const data = this.#ctx.getData();
    const signal = this.#ctx.getContentSignal();
    const board = el('div', 'nb-db-board');
    const groups = this.#ctx.groupsFor(view).filter(group => !group.hidden);
    const columns = this.#ctx.visibleColumns(view);
    const titleColumn = this.#ctx.titleColumn(view) ?? columns[0];
    for (const group of groups) {
      const column = el('section', 'nb-db-board-column');
      column.dataset.group = group.key;
      if (!readonly && view.groupBy) {
        column.addEventListener(
          'dragover',
          event => {
            event.preventDefault();
            column.classList.add('is-drop-target');
          },
          { signal }
        );
        column.addEventListener(
          'dragleave',
          event => {
            if (column.contains(event.relatedTarget as Node | null)) return;
            column.classList.remove('is-drop-target');
          },
          { signal }
        );
        column.addEventListener(
          'drop',
          event => {
            event.preventDefault();
            this.clearDropIndicators();
            if (event.dataTransfer?.getData('text/nobita-db') !== this.#ctx.instanceId) {
              return;
            }
            const rowId = event.dataTransfer?.getData('text/nobita-row');
            if (rowId) {
              this.moveCard(
                rowId,
                group.key,
                undefined,
                false,
                event.dataTransfer?.getData('text/nobita-group')
              );
            }
          },
          { signal }
        );
      }
      const heading = el('div', 'nb-db-board-heading');
      const titleWrap = el('div', 'nb-db-board-group-title');
      const groupColumn = view.groupBy
        ? data.columns.find(item => item.id === view.groupBy)
        : undefined;
      const groupIcon = el('span', 'nb-db-board-group-icon');
      groupIcon.innerHTML = groupColumn
        ? TYPE_ICON[groupColumn.type] ?? icon.text
        : icon.database;
      const label = el('span', 'nb-db-board-group-label', group.label);
      const count = el('span', 'nb-db-board-count', String(group.rows.length));
      titleWrap.append(groupIcon, label, count);
      heading.append(titleWrap);
      if (!readonly) {
        const ops = el('div', 'nb-db-board-group-ops');
        const add = iconBtn('nb-db-board-group-op', icon.plus, 'Add card');
        add.addEventListener('click', event => {
          event.stopPropagation();
          this.addCard(view, view.groupBy ? group.key : undefined, 'start');
        }, { signal });
        const more = iconBtn('nb-db-board-group-op', icon.more, 'Group actions');
        more.addEventListener('click', event => {
          event.stopPropagation();
          this.openGroupMenu(more, view, group.key, group.rows);
        }, { signal });
        ops.append(add, more);
        heading.append(ops);
      }
      column.append(heading);

      const cards = el('div', 'nb-db-board-cards');
      for (const row of group.rows) {
        cards.append(this.#renderCard(row, titleColumn, view, columns));
      }
      if (group.rows.length === 0) {
        cards.append(el('div', 'nb-db-board-empty', 'No cards'));
      }
      if (!readonly) {
        const add = btn('nb-db-board-add', { html: `${icon.plus}<span>Add</span>` });
        add.addEventListener('click', () => {
          this.addCard(view, view.groupBy ? group.key : undefined, 'end');
        }, { signal });
        cards.append(add);
      }
      column.append(cards);
      board.append(column);
    }
    return board;
  }

  clearDropIndicators(): void {
    const scope = this.#ctx.getScrollElement() ?? this.#ctx.rootElement;
    for (const node of scope.querySelectorAll<HTMLElement>(
      '.is-drop-target, .is-drop-before, .is-drop-after'
    )) {
      node.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after');
    }
  }

  #coverSrc(row: DatabaseRow, view: DatabaseViewConfig): string | null {
    const coverId = view.coverColumnId;
    if (!coverId) return null;
    if (
      !this.#ctx
        .getData()
        .columns.some(column => column.id === coverId && column.type === 'image')
    ) {
      return null;
    }
    return safeImageSrc(row.cells[coverId]?.text);
  }

  #renderCover(src: string): HTMLElement {
    const cover = el('div', 'nb-db-card-cover');
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    img.draggable = false;
    cover.append(img);
    return cover;
  }

  #renderCard(
    row: DatabaseRow,
    titleColumn: DatabaseColumn | undefined,
    view: DatabaseViewConfig,
    columns: readonly DatabaseColumn[]
  ): HTMLElement {
    const readonly = this.#ctx.getReadonly();
    const signal = this.#ctx.getContentSignal();
    const card = el('article', 'nb-db-card');
    card.dataset.rowId = row.id;
    if (!readonly && view.groupBy) {
      card.draggable = true;
      card.addEventListener(
        'dragstart',
        event => {
          event.dataTransfer?.setData('text/nobita-db', this.#ctx.instanceId);
          event.dataTransfer?.setData('text/nobita-row', row.id);
          event.dataTransfer?.setData(
            'text/nobita-group',
            card.closest<HTMLElement>('.nb-db-board-column')?.dataset.group ?? ''
          );
          event.dataTransfer?.setData('text/plain', row.id);
          card.classList.add('is-dragging');
        },
        { signal }
      );
      card.addEventListener(
        'dragend',
        () => {
          card.classList.remove('is-dragging');
          this.clearDropIndicators();
        },
        { signal }
      );
      card.addEventListener(
        'dragover',
        event => {
          event.preventDefault();
          event.stopPropagation();
          const rect = card.getBoundingClientRect();
          const before = event.clientY < rect.top + rect.height / 2;
          card.classList.toggle('is-drop-before', before);
          card.classList.toggle('is-drop-after', !before);
        },
        { signal }
      );
      card.addEventListener(
        'dragleave',
        event => {
          if (card.contains(event.relatedTarget as Node | null)) return;
          card.classList.remove('is-drop-before', 'is-drop-after');
        },
        { signal }
      );
      card.addEventListener(
        'drop',
        event => {
          event.preventDefault();
          event.stopPropagation();
          this.clearDropIndicators();
          if (event.dataTransfer?.getData('text/nobita-db') !== this.#ctx.instanceId) {
            return;
          }
          const sourceId = event.dataTransfer?.getData('text/nobita-row');
          if (!sourceId || sourceId === row.id) return;
          const rect = card.getBoundingClientRect();
          const before = event.clientY < rect.top + rect.height / 2;
          const targetGroup = card.closest<HTMLElement>('.nb-db-board-column')?.dataset.group;
          if (targetGroup !== undefined) {
            this.moveCard(
              sourceId,
              targetGroup,
              row.id,
              before,
              event.dataTransfer?.getData('text/nobita-group')
            );
          }
        },
        { signal }
      );
    }
    card.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (target.closest('.nb-db-card-title, .nb-db-card-ops')) return;
      this.#ctx.openDetailPanel(row.id);
    }, { signal });
    const coverSrc = this.#coverSrc(row, view);
    if (coverSrc) {
      card.classList.add('has-cover');
      card.append(this.#renderCover(coverSrc));
    }
    const title = el('div', 'nb-db-card-title');
    const cell = titleColumn ? row.cells[titleColumn.id] : undefined;
    const value = titleColumn
      ? titleColumn.type === 'number'
        ? formatDatabaseNumber(cell?.text ?? '', titleColumn)
        : databaseCellDisplay(cell, titleColumn.type)
      : '';
    const editable =
      titleColumn !== undefined &&
      !readonly &&
      (titleColumn.type === 'text' ||
        titleColumn.type === 'number' ||
        titleColumn.type === 'date' ||
        titleColumn.type === 'url');
    title.textContent = value || (editable ? '' : 'Untitled');
    if (titleColumn && editable) {
      title.contentEditable = 'true';
      title.spellcheck = false;
      title.setAttribute('role', 'textbox');
      title.setAttribute('aria-label', titleColumn.name);
      title.addEventListener(
        'focus',
        () => {
          if (this.#boardBlurTimer !== null) {
            window.clearTimeout(this.#boardBlurTimer);
            this.#boardBlurTimer = null;
          }
          if (titleColumn.type === 'number') {
            title.textContent =
              this.#ctx.currentCell(row.id, titleColumn.id)?.text ?? '';
            placeCaret(title, 'end');
          }
          if (view.groupBy === titleColumn.id) {
            this.#boardTitleEditing = { rowId: row.id, columnId: titleColumn.id };
          }
        },
        { signal }
      );
      title.addEventListener(
        'blur',
        () => {
          const editing = this.#boardTitleEditing;
          if (editing?.rowId === row.id && editing.columnId === titleColumn.id) {
            this.#boardTitleEditing = null;
            if (this.#boardBlurTimer !== null) {
              window.clearTimeout(this.#boardBlurTimer);
            }
            this.#boardBlurTimer = window.setTimeout(() => {
              this.#boardBlurTimer = null;
              this.#ctx.render();
            }, 0);
          } else if (titleColumn.type === 'number') {
            title.textContent = formatDatabaseNumber(
              this.#ctx.currentCell(row.id, titleColumn.id)?.text ?? '',
              titleColumn
            );
          }
        },
        { signal }
      );
      const commitTitle = (): void => {
        const raw = (title.textContent ?? '').replace(/\r?\n/gu, ' ');
        const nextVal =
          titleColumn.type === 'number'
            ? raw.replace(/[^0-9eE+.-]/gu, '')
            : raw;
        const current = this.#ctx.currentCell(row.id, titleColumn.id);
        if ((current?.text ?? '') === nextVal) return;
        this.#ctx.commitCell(
          row.id,
          titleColumn.id,
          withText(current, nextVal),
          `db:${row.id}:${titleColumn.id}`
        );
      };
      this.#ctx.richText.attachCompositionHandlers(title, commitTitle, signal);
      title.addEventListener(
        'input',
        event => {
          if (this.#ctx.richText.isComposing(title) || (event as InputEvent).isComposing) {
            return;
          }
          commitTitle();
        },
        { signal }
      );
      title.addEventListener(
        'keydown',
        event => {
          if (this.#ctx.richText.isComposingKey(event, title)) return;
          const mod = event.metaKey || event.ctrlKey;
          if (mod && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            this.#ctx.history(event.shiftKey);
            return;
          }
          if (mod && event.key.toLowerCase() === 'y') {
            event.preventDefault();
            this.#ctx.history(true);
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            title.blur();
          }
        },
        { signal }
      );
      title.addEventListener(
        'paste',
        event => {
          event.preventDefault();
          const raw = (event.clipboardData?.getData('text/plain') ?? '').replace(
            /\r?\n/gu,
            ' '
          );
          const nextVal =
            titleColumn.type === 'number'
              ? raw.replace(/[^0-9eE+.-]/gu, '')
              : raw;
          if (!nextVal) return;
          this.#ctx.richText.pastePlainText(title, nextVal);
        },
        { signal }
      );
    }
    card.append(title);
    const fields = this.#boardFields(row, titleColumn, view, columns);
    if (fields) card.append(fields);
    if (!readonly) {
      const ops = el('div', 'nb-db-card-ops');
      const expand = iconBtn('nb-db-card-op', icon.expand, 'Open record');
      expand.addEventListener('click', event => {
        event.stopPropagation();
        this.#ctx.openDetailPanel(row.id);
      }, { signal });
      const more = iconBtn('nb-db-card-op', icon.more, 'Card actions');
      more.addEventListener('click', event => {
        event.stopPropagation();
        this.#ctx.openRowPopover(row.id, more);
      }, { signal });
      ops.append(expand, more);
      card.append(ops);
    }
    return card;
  }

  #boardFields(
    row: DatabaseRow,
    titleColumn: DatabaseColumn | undefined,
    view: DatabaseViewConfig,
    columns: readonly DatabaseColumn[]
  ): HTMLElement | null {
    const fields = el('div', 'nb-db-card-fields');
    for (const column of columns) {
      if (column.id === titleColumn?.id || column.id === view.groupBy) continue;
      if (column.id === view.coverColumnId && column.type === 'image') continue;
      if (column.type === 'progress') {
        const pct = parseProgressValue(row.cells[column.id]?.text);
        if (pct === null) continue;
        const field = el('span', 'nb-db-card-field nb-db-card-progress');
        field.title = `${column.name}: ${pct}%`;
        const bar = el('span', 'nb-db-mini-bar');
        const fill = document.createElement('span');
        fill.style.width = `${pct}%`;
        bar.append(fill);
        field.append(bar, el('span', undefined, `${pct}%`));
        fields.append(field);
        continue;
      }
      if (column.type === 'image') {
        const src = safeImageSrc(row.cells[column.id]?.text);
        if (!src) continue;
        const field = el('span', 'nb-db-card-field nb-db-card-image');
        field.title = column.name;
        const thumb = el('img', 'nb-db-card-thumb');
        thumb.src = src;
        thumb.alt = '';
        thumb.loading = 'lazy';
        thumb.draggable = false;
        field.append(thumb, el('span', undefined, column.name));
        fields.append(field);
        continue;
      }
      const display =
        column.type === 'number'
          ? formatDatabaseNumber(row.cells[column.id]?.text ?? '', column)
          : databaseCellDisplay(row.cells[column.id], column.type);
      if (!display) continue;
      const field = el('span', 'nb-db-card-field');
      field.title = `${column.name}: ${display}`;
      const fieldIcon = el('span', 'nb-db-card-field-icon');
      fieldIcon.innerHTML = TYPE_ICON[column.type] ?? icon.text;
      field.append(fieldIcon, el('span', undefined, display));
      fields.append(field);
    }
    return fields.childElementCount > 0 ? fields : null;
  }

  syncValues(force = false): void {
    const view = this.#ctx.activeView();
    if (view.type !== 'board') return;
    const data = this.#ctx.getData();
    const root = this.#ctx.rootElement.getRootNode() as ShadowRoot;
    const activeElement = root.activeElement;
    const columns = this.#ctx.visibleColumns(view);
    const titleColumn = this.#ctx.titleColumn(view) ?? columns[0];
    const rowById = new Map(data.rows.map(row => [row.id, row]));
    const prev = this.#ctx.getSyncedData();
    const prevColumnsSame = prev !== null && prev.columns === data.columns;
    const prevRowById =
      !force && prev ? new Map(prev.rows.map(row => [row.id, row])) : null;
    for (const card of this.#ctx.rootElement.querySelectorAll<HTMLElement>('.nb-db-card[data-row-id]')) {
      const rowId = card.dataset.rowId;
      if (!rowId) continue;
      const row = rowById.get(rowId);
      if (!row) continue;
      if (!force && prevColumnsSame && prevRowById?.get(rowId) === row) continue;
      const nextCover = this.#coverSrc(row, view);
      const existingCover = card.querySelector<HTMLElement>('.nb-db-card-cover');
      if (nextCover) {
        if (existingCover) {
          const img = existingCover.querySelector<HTMLImageElement>('img');
          if (img && img.getAttribute('src') !== nextCover) img.src = nextCover;
        } else {
          card.prepend(this.#renderCover(nextCover));
          card.classList.add('has-cover');
        }
      } else if (existingCover) {
        existingCover.remove();
        card.classList.remove('has-cover');
      }
      const title = card.querySelector<HTMLElement>('.nb-db-card-title');
      if (
        title &&
        !this.#ctx.richText.isComposing(title) &&
        (force || activeElement !== title)
      ) {
        const raw = titleColumn ? row.cells[titleColumn.id]?.text ?? '' : '';
        const editing = activeElement === title;
        const value = titleColumn
          ? titleColumn.type === 'number'
            ? editing
              ? raw
              : formatDatabaseNumber(raw, titleColumn)
            : databaseCellDisplay(row.cells[titleColumn.id], titleColumn.type)
          : '';
        const nextText =
          value || (title.contentEditable === 'true' ? '' : 'Untitled');
        if (title.textContent !== nextText) title.textContent = nextText;
      }
      const previous = card.querySelector('.nb-db-card-fields');
      const next = this.#boardFields(row, titleColumn, view, columns);
      if (previous && next) previous.replaceWith(next);
      else if (previous) previous.remove();
      else if (next) card.append(next);
    }
  }

  addCard(
    view: DatabaseViewConfig,
    groupKey: string | undefined,
    position: 'start' | 'end'
  ): void {
    if (this.#ctx.getReadonly()) return;
    const data = this.#ctx.getData();
    const viewId = this.#ctx.activeView().id;
    const row = createDatabaseRow();
    const groupColumn = view.groupBy
      ? data.columns.find(column => column.id === view.groupBy)
      : undefined;
    if (groupColumn && groupKey !== undefined) {
      row.cells[groupColumn.id] = cellForGroupValue(
        groupColumn,
        undefined,
        groupKey
      );
    }
    const rows = [...data.rows, row];
    let views = this.#ctx.views();
    if (
      groupColumn &&
      groupKey !== undefined &&
      databaseSorts(view).length === 0
    ) {
      const groups = this.#ctx.groupsFor(view);
      const group = groups.find(item => item.key === groupKey);
      const visible = group?.rows.map(item => item.id) ?? [];
      const order =
        position === 'start' ? [row.id, ...visible] : [...visible, row.id];
      const settings = seedGroupSettings(
        view.groupProperties ?? [],
        groups.map(item => item.key)
      );
      const groupProperties = settings.map(setting =>
        setting.key === groupKey
          ? {
              ...setting,
              manuallyCardSort: mergeOrder(
                setting.manuallyCardSort ?? [],
                order
              ),
            }
          : setting
      );
      views = views.map(item =>
        item.id === viewId ? { ...item, groupProperties } : item
      );
    }
    this.#ctx.setPendingBoardFocus(row.id);
    this.#ctx.commit({
      ...data,
      rows,
      views,
      activeViewId: viewId,
    });
  }

  openGroupMenu(
    anchor: HTMLElement,
    view: DatabaseViewConfig,
    groupKey: string,
    rows: readonly DatabaseRow[]
  ): void {
    const content = el('div', 'nb-db-pop-actions nb-db-board-group-menu');
    const add = btn(undefined, { text: 'Add card' });
    add.addEventListener('click', () => {
      this.#ctx.closePopover();
      this.addCard(view, view.groupBy ? groupKey : undefined, 'end');
    });
    const remove = btn('danger', { text: 'Delete cards' });
    remove.addEventListener('click', () => {
      this.#ctx.closePopover();
      const ids = new Set(rows.map(row => row.id));
      for (const id of ids) this.#ctx.clearSelectedRow(id);
      this.#ctx.commitDeletedRows(ids);
    });
    content.append(add, remove);
    this.#ctx.showPopover(anchor, content);
  }

  moveCard(
    rowId: string,
    targetGroupKey: string,
    targetRowId?: string,
    before = false,
    sourceGroupKey?: string
  ): void {
    const view = this.#ctx.activeView();
    const data = this.#ctx.getData();
    if (view.type !== 'board' || !view.groupBy) return;
    const groupColumn = data.columns.find(column => column.id === view.groupBy);
    const row = data.rows.find(item => item.id === rowId);
    if (!groupColumn || !row) return;
    const groups = this.#ctx.groupsFor(view);
    const sourceGroup =
      (sourceGroupKey !== undefined
        ? groups.find(group => group.key === sourceGroupKey)
        : undefined) ??
      groups.find(group => group.rows.some(item => item.id === rowId));
    if (!sourceGroup) return;
    const sorts = databaseSorts(view).length > 0;
    const sameGroup = sourceGroup.key === targetGroupKey;
    if (sameGroup && sorts) return;
    if (sameGroup && targetRowId === rowId) return;

    let targetOrder = (
      groups.find(group => group.key === targetGroupKey)?.rows ?? []
    ).map(item => item.id);
    targetOrder = targetOrder.filter(id => id !== rowId);
    if (targetRowId) {
      const index = targetOrder.indexOf(targetRowId);
      if (index >= 0) targetOrder.splice(before ? index : index + 1, 0, rowId);
      else targetOrder.push(rowId);
    } else {
      targetOrder.push(rowId);
    }

    const sourceOrder = sourceGroup.rows
      .map(item => item.id)
      .filter(id => id !== rowId);

    let rows = data.rows;
    if (!sameGroup) {
      const cells = { ...row.cells };
      let next: DatabaseCell;
      if (groupColumn.type === 'multi-select') {
        const current = row.cells[groupColumn.id] ?? {};
        next = { ...current };
        if (!targetGroupKey) {
          delete next.values;
        } else {
          const existing = current.values ?? [];
          const filtered = sourceGroup.key
            ? existing.filter(value => value !== sourceGroup.key)
            : [...existing];
          if (!filtered.includes(targetGroupKey)) {
            filtered.push(targetGroupKey);
          }
          next.values = filtered;
        }
      } else {
        next = cellForGroupValue(
          groupColumn,
          row.cells[groupColumn.id],
          targetGroupKey
        );
      }
      if (Object.keys(next).length > 0) cells[groupColumn.id] = next;
      else delete cells[groupColumn.id];
      rows = rows.map(item =>
        item.id === rowId ? { ...item, cells } : item
      );
    }

    let views = this.#ctx.views();
    if (!sorts) {
      const settings = seedGroupSettings(
        view.groupProperties ?? [],
        groups.map(group => group.key)
      );
      const groupProperties = settings.map(setting => {
        if (setting.key === targetGroupKey) {
          return {
            ...setting,
            manuallyCardSort: mergeOrder(
              (setting.manuallyCardSort ?? []).filter(id => id !== rowId),
              targetOrder
            ),
          };
        }
        if (!sameGroup && setting.key === sourceGroup.key) {
          return {
            ...setting,
            manuallyCardSort: mergeOrder(
              (setting.manuallyCardSort ?? []).filter(id => id !== rowId),
              sourceOrder
            ),
          };
        }
        return setting;
      });
      views = views.map(item =>
        item.id === view.id ? { ...item, groupProperties } : item
      );
    }

    const { view: _legacyView, sort: _legacySort, ...rest } = data;
    this.#ctx.commit({
      ...rest,
      rows,
      views,
      activeViewId: view.id,
    });
  }
}
