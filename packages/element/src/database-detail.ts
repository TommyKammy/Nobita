import {
  databaseCellText,
  databaseCellDisplay,
  normalizeRuns,
  safeHref,
} from '@nobita/core';
import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseData,
  DatabaseRow,
  DatabaseView as DatabaseViewConfig,
  InlineRun,
  PageInfo,
} from '@nobita/core';
import { handleHistoryKey, placeCaret } from './dom.js';
import { icon } from './icons.js';
import { readRunsFromDom, renderInlineRuns } from './inline-dom.js';
import {
  TYPE_ICON,
  applyFilesLabel,
  applyImageLabel,
  applyPeopleLabel,
  attachNumberInput,
  btn,
  detailFieldSchema,
  el,
  formatDatabaseNumber,
  iconBtn,
  parseProgressValue,
  readCellRuns,
  renderTextCellContent,
  runsSignature,
  selectionOffsets,
  setSelectionOffsets,
  shortcutTag,
  titleTextEditable,
  withText,
  isComputedColumn,
} from './database-dom.js';
import type { DatabaseRichTextController } from './database-rich-text.js';

export interface DatabaseDetailContext {
  databaseId: string;
  rootElement: HTMLElement;
  getReadonly(): boolean;
  getData(): DatabaseData;
  activeView(): DatabaseViewConfig & { id: string; name: string };
  visibleColumns(view?: DatabaseViewConfig): DatabaseColumn[];
  titleColumn(view?: DatabaseViewConfig): DatabaseColumn | undefined;
  navigationRows(view?: DatabaseViewConfig): DatabaseRow[];
  currentCell(rowId: string, columnId: string): DatabaseCell | undefined;
  commitCell(rowId: string, columnId: string, cell: DatabaseCell, mergeKey?: string): void;
  commitTextRuns(
    rowId: string,
    columnId: string,
    runs: readonly InlineRun[],
    mergeKey?: string
  ): void;
  commitRowPage(rowId: string, runs: readonly InlineRun[], mergeKey?: string): void;
  history(redo: boolean): void;
  openAddPropertyMenu(anchor: HTMLElement): void;
  openFilesPopover(columnId: string, rowId: string, anchor: HTMLElement): void;
  openPeoplePopover(columnId: string, rowId: string, anchor: HTMLElement): void;
  openComputed(columnId: string, anchor: HTMLElement, rowId?: string): void;
  openImagePopover(columnId: string, rowId: string, anchor: HTMLElement): void;
  richText: DatabaseRichTextController;
  resolvePage?: (pageId: string) => PageInfo | null;
}

/** Manages the record page modal dialog, focus trap, field editors, and page body. */
export class DatabaseDetailController {
  #ctx: DatabaseDetailContext;
  #detail: HTMLElement | null = null;
  #detailRowId: string | null = null;
  #detailTrigger: HTMLElement | null = null;
  #detailEvents = new AbortController();

  constructor(ctx: DatabaseDetailContext) {
    this.#ctx = ctx;
  }

  get element(): HTMLElement | null {
    return this.#detail;
  }

  get rowId(): string | null {
    return this.#detailRowId;
  }

  destroy(): void {
    this.close({ restoreFocus: false });
  }

  close(options: { restoreFocus?: boolean; keepTrigger?: boolean } = {}): void {
    const { restoreFocus = true, keepTrigger = false } = options;
    this.#ctx.richText.hideToolbar();
    this.#ctx.richText.clearPendingMarks();
    this.#detail?.remove();
    this.#detail = null;
    this.#detailRowId = null;
    this.#detailEvents.abort();
    this.#detailEvents = new AbortController();
    if (keepTrigger) return;
    const trigger = this.#detailTrigger;
    this.#detailTrigger = null;
    if (restoreFocus && trigger?.isConnected) {
      trigger.focus();
    }
  }

  #focusables(panel: HTMLElement): HTMLElement[] {
    const candidates = panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
    );
    const result: HTMLElement[] = [];
    for (const element of candidates) {
      if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
        continue;
      }
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (element.getClientRects().length === 0) continue;
      result.push(element);
    }
    return result;
  }

  open(rowId: string): void {
    const data = this.#ctx.getData();
    const readonly = this.#ctx.getReadonly();
    const row = data.rows.find(item => item.id === rowId);
    if (!row) return;
    const root = this.#ctx.rootElement.getRootNode() as ShadowRoot;
    const hadDetail = this.#detail !== null;
    if (!hadDetail) {
      const activeEl = root.activeElement ?? this.#ctx.rootElement.ownerDocument.activeElement;
      this.#detailTrigger = activeEl instanceof HTMLElement ? activeEl : null;
    }
    this.close({ restoreFocus: false, keepTrigger: true });
    this.#detailRowId = rowId;
    const view = this.#ctx.activeView();
    const titleColumn = this.#ctx.titleColumn(view);
    const backdrop = el('div', 'nb-db-detail-backdrop');
    backdrop.dataset.recordOwner = this.#ctx.databaseId;
    const panel = el('section', 'nb-db-detail');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Record page');
    const bar = el('div', 'nb-db-detail-bar');
    const nav = el('div', 'nb-db-detail-nav');
    const navigate = (direction: -1 | 1): void => {
      const rows = this.#ctx.navigationRows(this.#ctx.activeView());
      const index = rows.findIndex(item => item.id === this.#detailRowId);
      const nextRow = rows[index + direction];
      if (nextRow) this.open(nextRow.id);
    };
    const prev = iconBtn('nb-db-detail-navbtn', icon.arrowUp, 'Previous record', {
      dataset: { nav: 'prev' },
    });
    prev.addEventListener('click', () => navigate(-1));
    const next = iconBtn('nb-db-detail-navbtn', icon.arrowDown, 'Next record', {
      dataset: { nav: 'next' },
    });
    next.addEventListener('click', () => navigate(1));
    this.#syncNav(prev, next, rowId);
    nav.append(prev, next);
    const close = iconBtn('nb-db-detail-close', icon.x, 'Close record page');
    close.addEventListener('click', () => this.close());
    bar.append(nav, close);
    panel.append(bar);

    const title = this.#renderTitle(row, titleColumn);
    panel.append(title);

    const fields = el('div', 'nb-db-detail-fields');
    for (const column of this.#ctx.visibleColumns(view)) {
      if (column.id === titleColumn?.id && titleTextEditable(titleColumn)) continue;
      fields.append(this.#renderField(row, column));
    }
    panel.append(fields);

    const add = btn('nb-db-detail-add', {
      html: `${icon.plus}<span>Add Property</span>`,
      disabled: readonly,
    });
    add.addEventListener('click', () => this.#ctx.openAddPropertyMenu(add));
    panel.append(add);

    panel.append(this.#renderPage(row));

    panel.addEventListener(
      'keydown',
      event => {
        if (event.key !== 'Tab') return;
        const focusables = this.#focusables(panel);
        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }
        const active = root.activeElement as HTMLElement | null;
        const currentIndex = active ? focusables.indexOf(active) : -1;
        event.preventDefault();
        if (event.shiftKey) {
          const prevIndex =
            currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1;
          focusables[prevIndex]?.focus();
        } else {
          const nextIndex =
            currentIndex < 0 || currentIndex >= focusables.length - 1
              ? 0
              : currentIndex + 1;
          focusables[nextIndex]?.focus();
        }
      },
      { signal: this.#detailEvents.signal }
    );

    panel.addEventListener(
      'click',
      event => {
        const target = event.target as Element | null;
        const link = target?.closest<HTMLElement>('[data-link]');
        if (link && (event.metaKey || event.ctrlKey)) {
          const href = safeHref(link.dataset.link);
          if (href && !href.startsWith('#page-') && !href.startsWith('#block-')) {
            event.preventDefault();
            window.open(href, '_blank', 'noopener,noreferrer');
          }
        }
      },
      { signal: this.#detailEvents.signal }
    );

    backdrop.append(panel);
    backdrop.addEventListener('pointerdown', event => {
      if (event.target === backdrop) this.close();
    });
    backdrop.addEventListener('keydown', event => {
      if (handleHistoryKey(event, redo => this.#ctx.history(redo), true)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    });
    (root.querySelector('.nb-overlay') ?? root).append(backdrop);
    this.#detail = backdrop;
    if (readonly) {
      close.focus();
    } else {
      title.focus();
      title.select();
    }
  }

  #renderTitle(
    row: DatabaseRow,
    titleColumn: DatabaseColumn | undefined
  ): HTMLInputElement {
    const readonly = this.#ctx.getReadonly();
    const title = el('input', 'nb-db-detail-title');
    title.value = titleColumn
      ? titleColumn.type === 'number'
        ? formatDatabaseNumber(row.cells[titleColumn.id]?.text ?? '', titleColumn)
        : databaseCellText(row.cells[titleColumn.id], titleColumn.type)
      : '';
    title.placeholder = 'Untitled';
    title.setAttribute('aria-label', 'Record title');
    title.disabled = readonly;
    if (titleColumn) title.dataset.columnId = titleColumn.id;
    if (titleTextEditable(titleColumn)) {
      title.addEventListener('input', () => {
        if (!titleColumn) return;
        const value =
          titleColumn.type === 'number'
            ? title.value.replace(/[^0-9eE+.-]/gu, '')
            : title.value;
        const current = this.#ctx.currentCell(row.id, titleColumn.id);
        if ((current?.text ?? '') === value) return;
        this.#ctx.commitCell(
          row.id,
          titleColumn.id,
          withText(current, value),
          `db:${row.id}:${titleColumn.id}`
        );
      }, { signal: this.#detailEvents.signal });
      if (titleColumn?.type === 'number') {
        title.addEventListener('focus', () => {
          title.value = this.#ctx.currentCell(row.id, titleColumn.id)?.text ?? '';
          title.select();
        }, { signal: this.#detailEvents.signal });
        title.addEventListener('blur', () => {
          title.value = formatDatabaseNumber(
            this.#ctx.currentCell(row.id, titleColumn.id)?.text ?? '',
            titleColumn
          );
        }, { signal: this.#detailEvents.signal });
      }
    } else {
      title.readOnly = true;
      title.dataset.readonly = 'true';
    }
    return title;
  }

  #renderPage(row: DatabaseRow): HTMLElement {
    const readonly = this.#ctx.getReadonly();
    const section = el('section', 'nb-db-detail-page');
    const head = el('div', 'nb-db-detail-page-head');
    const pageIcon = document.createElement('span');
    pageIcon.innerHTML = icon.page;
    head.append(pageIcon, el('span', undefined, 'Page'));
    const body = el('div', 'nb-db-page-text nb-db-rich-text');
    body.contentEditable = readonly ? 'false' : 'true';
    body.spellcheck = false;
    body.dataset.placeholder = 'Write about this record…';
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-label', 'Record page body');
    this.#renderPageContent(body, row);
    if (!readonly) {
      const commitPage = (): void => {
        const runs = normalizeRuns(readRunsFromDom(body));
        body.dataset.runs = runsSignature(runs);
        this.#ctx.commitRowPage(row.id, runs, `db:${row.id}:page`);
      };
      this.#ctx.richText.attachCompositionHandlers(
        body,
        commitPage,
        this.#detailEvents.signal,
        true
      );
      body.addEventListener(
        'input',
        event => {
          if (this.#ctx.richText.isComposing(body) || (event as InputEvent).isComposing) {
            return;
          }
          commitPage();
        },
        { signal: this.#detailEvents.signal }
      );
      this.#ctx.richText.attachRichTextHandlers(body, this.#detailEvents.signal);
      body.addEventListener(
        'paste',
        event => {
          event.preventDefault();
          event.stopPropagation();
          const value = (event.clipboardData?.getData('text/plain') ?? '').replace(
            /\r\n?/gu,
            '\n'
          );
          if (!value) return;
          this.#ctx.richText.pasteIntoRichText(body, value);
        },
        { signal: this.#detailEvents.signal }
      );
      body.addEventListener(
        'keydown',
        event => {
          if (this.#ctx.richText.isComposingKey(event, body)) return;
          const tag = shortcutTag(event);
          if (!tag) return;
          event.preventDefault();
          this.#ctx.richText.toggleInlineTag(tag);
        },
        { signal: this.#detailEvents.signal }
      );
    }
    section.append(head, body);
    return section;
  }

  #renderPageContent(element: HTMLElement, row: DatabaseRow): void {
    const runs = row.page?.content ?? [];
    element.dataset.runs = runsSignature(runs);
    if (runs.length > 0) renderInlineRuns(element, runs, this.#ctx.resolvePage);
    else element.replaceChildren();
  }

  #applyPickerLabel(
    button: HTMLButtonElement,
    column: DatabaseColumn,
    cell: DatabaseCell | undefined
  ): void {
    if (column.type === 'files') applyFilesLabel(button, cell?.files ?? [], column.name);
    else if (column.type === 'people') applyPeopleLabel(button, cell?.people ?? [], column.name);
    else if (isComputedColumn(column)) button.textContent = databaseCellDisplay(cell,column.type);
    else if (column.type === 'image') applyImageLabel(button, cell?.text, column.name);
  }

  #restoreOffsets(text: HTMLElement, maxLength: number): void {
    const offsets = selectionOffsets(text);
    if (offsets) {
      setSelectionOffsets(
        text,
        Math.min(offsets.start, maxLength),
        Math.min(offsets.end, maxLength)
      );
    }
  }

  #syncSelectOptions(
    select: HTMLSelectElement,
    column: DatabaseColumn,
    cell: DatabaseCell | undefined
  ): void {
    const selected =
      column.type === 'multi-select'
        ? new Set(cell?.values ?? [])
        : new Set(cell?.text ? [cell.text] : []);
    const optionValues = new Set(Array.from(select.options).map(option => option.value));
    const appendOption = (value: string, label: string): void => {
      if (optionValues.has(value)) return;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
      optionValues.add(value);
    };
    if (select.options.length === 0) appendOption('', 'Empty');
    for (const value of column.options ?? []) appendOption(value, value);
    for (const value of selected) if (value) appendOption(value, value);
    for (const option of select.options) {
      if (option.value) option.selected = selected.has(option.value);
    }
  }

  #renderField(row: DatabaseRow, column: DatabaseColumn): HTMLElement {
    const readonly = this.#ctx.getReadonly();
    const field = el(column.type === 'text' ? 'div' : 'label', 'nb-db-detail-field');
    field.dataset.columnId = column.id;
    field.dataset.schema = detailFieldSchema(column);
    const name = el('span', 'nb-db-detail-field-name');
    const typeIcon = el('span', 'nb-db-detail-field-icon');
    typeIcon.innerHTML = TYPE_ICON[column.type] ?? icon.text;
    name.append(typeIcon, el('span', undefined, column.name));
    field.append(name);

    const cell = row.cells[column.id];
    if (column.type === 'checkbox') {
      const button = btn('nb-db-check nb-db-detail-check', {
        html: icon.check,
        disabled: readonly,
      });
      button.setAttribute('role', 'checkbox');
      button.setAttribute('aria-checked', String(Boolean(cell?.checked)));
      button.addEventListener('click', () => {
        const checked = button.getAttribute('aria-checked') !== 'true';
        button.setAttribute('aria-checked', String(checked));
        this.#ctx.commitCell(
          row.id,
          column.id,
          { ...(cell ?? {}), checked },
          `db:${row.id}:${column.id}`
        );
      }, { signal: this.#detailEvents.signal });
      field.append(button);
      return field;
    }

    if (column.type === 'select' || column.type === 'multi-select') {
      const select = el('select', 'nb-db-detail-input');
      select.disabled = readonly;
      select.multiple = column.type === 'multi-select';
      this.#syncSelectOptions(select, column, cell);
      select.addEventListener('change', () => {
        const values = Array.from(select.selectedOptions)
          .map(item => item.value)
          .filter(Boolean);
        const next: DatabaseCell =
          column.type === 'multi-select'
            ? { ...(values.length > 0 ? { values } : {}) }
            : { ...(values[0] ? { text: values[0] } : {}) };
        this.#ctx.commitCell(row.id, column.id, next, `db:${row.id}:${column.id}`);
      }, { signal: this.#detailEvents.signal });
      field.append(select);
      return field;
    }

    if (column.type === 'number' || column.type === 'date' || column.type === 'url') {
      const input = el('input', 'nb-db-detail-input');
      input.disabled = readonly;
      if (column.type === 'number') {
        attachNumberInput(
          input,
          row,
          column,
          this.#detailEvents.signal,
          (rId, cId) => this.#ctx.currentCell(rId, cId),
          (rId, cId, next, key) => this.#ctx.commitCell(rId, cId, next, key)
        );
      } else {
        input.type = 'text';
        input.value = cell?.text ?? '';
        input.addEventListener('input', () => {
          this.#ctx.commitCell(
            row.id,
            column.id,
            withText(this.#ctx.currentCell(row.id, column.id), input.value),
            `db:${row.id}:${column.id}`
          );
        }, { signal: this.#detailEvents.signal });
      }
      field.append(input);
      return field;
    }

    if (column.type === 'progress') {
      const val = parseProgressValue(cell?.text);
      const wrap = el('div', 'nb-db-detail-progress');
      const range = el('input', 'nb-db-detail-range');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.step = '1';
      range.disabled = readonly;
      range.setAttribute('aria-label', column.name);
      range.value = String(val ?? 0);
      const valEl = el(
        'span',
        'nb-db-detail-progress-val',
        val === null ? '—' : `${val}%`
      );
      range.addEventListener(
        'input',
        () => {
          valEl.textContent = `${range.value}%`;
          this.#ctx.commitCell(
            row.id,
            column.id,
            { text: range.value },
            `db:${row.id}:${column.id}`
          );
        },
        { signal: this.#detailEvents.signal }
      );
      wrap.append(range, valEl);
      field.append(wrap);
      return field;
    }

    if (column.type === 'image') {
      const button = btn('nb-db-detail-picker nb-db-detail-image', {
        disabled: readonly,
      });
      applyImageLabel(button, cell?.text, column.name);
      button.addEventListener(
        'click',
        () => this.#ctx.openImagePopover(column.id, row.id, button),
        { signal: this.#detailEvents.signal }
      );
      field.append(button);
      return field;
    }

    if (['formula','relation','files','people'].includes(column.type)) {
      const button = btn('nb-db-select nb-db-multi nb-db-detail-picker', {
        disabled: readonly,
      });
      this.#applyPickerLabel(button, column, cell);
      button.addEventListener('click', () => {
        if (isComputedColumn(column)) {
          this.#ctx.openComputed(column.id,button,column.relation ? row.id : undefined);
        } else if (column.type === 'files') {
          this.#ctx.openFilesPopover(column.id, row.id, button);
        } else {
          this.#ctx.openPeoplePopover(column.id, row.id, button);
        }
      }, { signal: this.#detailEvents.signal });
      field.append(button);
      return field;
    }

    const text = el('div', 'nb-db-detail-input nb-db-detail-text nb-db-rich-text');
    text.contentEditable = readonly ? 'false' : 'true';
    text.spellcheck = false;
    text.dataset.richText = 'true';
    text.setAttribute('role', 'textbox');
    text.setAttribute('aria-label', column.name);
    text.setAttribute('aria-multiline', 'false');
    renderTextCellContent(text, cell, this.#ctx.resolvePage);
    if (!readonly) {
      const commitField = (): void => {
        const runs = readCellRuns(text);
        text.dataset.runs = runsSignature(runs.some(run => run.marks) ? runs : undefined);
        this.#ctx.commitTextRuns(row.id, column.id, runs, `db:${row.id}:${column.id}`);
      };
      this.#ctx.richText.attachCompositionHandlers(
        text,
        commitField,
        this.#detailEvents.signal,
        true
      );
      text.addEventListener('input', event => {
        if (this.#ctx.richText.isComposing(text) || (event as InputEvent).isComposing) {
          return;
        }
        commitField();
      }, { signal: this.#detailEvents.signal });
      this.#ctx.richText.attachRichTextHandlers(text, this.#detailEvents.signal);
      text.addEventListener('paste', event => {
        event.preventDefault();
        event.stopPropagation();
        const value = (event.clipboardData?.getData('text/plain') ?? '').replace(
          /\r?\n/gu,
          ' '
        );
        if (!value) return;
        this.#ctx.richText.pasteIntoRichText(text, value);
      }, { signal: this.#detailEvents.signal });
      text.addEventListener('keydown', event => {
        if (this.#ctx.richText.isComposingKey(event, text)) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          text.blur();
          return;
        }
        const tag = shortcutTag(event);
        if (!tag) return;
        event.preventDefault();
        this.#ctx.richText.toggleInlineTag(tag);
      }, { signal: this.#detailEvents.signal });
    }
    field.append(text);
    return field;
  }

  sync(): void {
    const detail = this.#detail;
    const rowId = this.#detailRowId;
    if (!detail || !rowId) return;
    const data = this.#ctx.getData();
    const row = data.rows.find(item => item.id === rowId);
    if (!row) return;
    const prev = detail.querySelector<HTMLButtonElement>(
      '.nb-db-detail-navbtn[data-nav="prev"]'
    );
    const next = detail.querySelector<HTMLButtonElement>(
      '.nb-db-detail-navbtn[data-nav="next"]'
    );
    if (prev && next) this.#syncNav(prev, next, rowId);
    const pageBody = detail.querySelector<HTMLElement>('.nb-db-page-text');
    if (pageBody && !this.#ctx.richText.isComposing(pageBody)) {
      const root = this.#ctx.rootElement.getRootNode() as ShadowRoot;
      const signature = runsSignature(row.page?.content ?? []);
      if (pageBody.dataset.runs !== signature) {
        const focused = root.activeElement === pageBody;
        this.#renderPageContent(pageBody, row);
        if (focused) placeCaret(pageBody, 'end');
      }
    }
    const view = this.#ctx.activeView();
    const titleColumn = this.#ctx.titleColumn(view);
    const fields = detail.querySelector<HTMLElement>('.nb-db-detail-fields');
    if (fields) {
      const columns = this.#ctx.visibleColumns(view).filter(
        column => !(column.id === titleColumn?.id && titleTextEditable(titleColumn))
      );
      const current = [
        ...fields.querySelectorAll<HTMLElement>('.nb-db-detail-field'),
      ];
      const currentKeys = current.map(
        field => `${field.dataset.columnId ?? ''}\u0000${field.dataset.schema ?? ''}`
      );
      const desiredKeys = columns.map(
        column => `${column.id}\u0000${detailFieldSchema(column)}`
      );
      if (
        currentKeys.length !== desiredKeys.length ||
        currentKeys.some((key, index) => key !== desiredKeys[index])
      ) {
        const byId = new Map(
          current.map(field => [field.dataset.columnId ?? '', field])
        );
        const wanted = new Set(columns.map(column => column.id));
        for (const field of current) {
          if (!wanted.has(field.dataset.columnId ?? '')) field.remove();
        }
        for (const column of columns) {
          const schema = detailFieldSchema(column);
          let field = byId.get(column.id);
          if (field?.dataset.schema !== schema) {
            field?.remove();
            field = this.#renderField(row, column);
          }
          fields.append(field);
        }
      }
    }
    let title = detail.querySelector<HTMLInputElement>('.nb-db-detail-title');
    if (title) {
      if (title.dataset.columnId !== (titleColumn?.id ?? '')) {
        const focused = title.matches(':focus');
        const replacement = this.#renderTitle(row, titleColumn);
        title.replaceWith(replacement);
        if (focused) {
          replacement.focus();
          const end = replacement.value.length;
          replacement.setSelectionRange(end, end);
        }
        title = replacement;
      }
      const input = title;
      const column = input.dataset.columnId
        ? data.columns.find(item => item.id === input.dataset.columnId)
        : undefined;
      if (column) {
        const cell = row.cells[column.id];
        const value =
          column.type === 'number'
            ? cell?.text ?? ''
            : databaseCellText(cell, column.type);
        const formatted =
          column.type === 'number'
            ? formatDatabaseNumber(value, column)
            : value;
        this.#syncInput(input, value, formatted);
      }
    }
    for (const field of detail.querySelectorAll<HTMLElement>(
      '.nb-db-detail-field[data-column-id]'
    )) {
      const column = data.columns.find(
        item => item.id === field.dataset.columnId
      );
      if (!column) continue;
      const cell = row.cells[column.id];
      const check = field.querySelector<HTMLButtonElement>(
        'button[role="checkbox"]'
      );
      if (check) {
        check.setAttribute('aria-checked', String(Boolean(cell?.checked)));
        continue;
      }
      if (column.type === 'progress') {
        const range = field.querySelector<HTMLInputElement>('.nb-db-detail-range');
        const valEl = field.querySelector<HTMLElement>('.nb-db-detail-progress-val');
        const val = parseProgressValue(cell?.text);
        if (range) {
          const nextVal = String(val ?? 0);
          if (range.value !== nextVal) range.value = nextVal;
        }
        if (valEl) valEl.textContent = val === null ? '—' : `${val}%`;
        continue;
      }
      const picker = field.querySelector<HTMLButtonElement>(
        'button.nb-db-detail-picker'
      );
      if (picker) {
        this.#applyPickerLabel(picker, column, cell);
        continue;
      }
      const select = field.querySelector<HTMLSelectElement>('select');
      if (select) {
        this.#syncSelectOptions(select, column, cell);
        continue;
      }
      const input = field.querySelector<HTMLInputElement>('input');
      if (input) {
        const value = cell?.text ?? '';
        const formatted =
          column.type === 'number'
            ? formatDatabaseNumber(value, column)
            : value;
        this.#syncInput(input, value, formatted);
        continue;
      }
      const text = field.querySelector<HTMLElement>('.nb-db-detail-text');
      const textValue = cell?.text ?? '';
      if (text && this.#ctx.richText.isComposing(text)) continue;
      if (text && text.dataset.richText === 'true') {
        const signature = runsSignature(cell?.runs);
        if (
          text.dataset.runs !== signature ||
          text.textContent !== textValue
        ) {
          const focused = text.matches(':focus');
          const offsets = focused ? selectionOffsets(text) : null;
          renderTextCellContent(text, cell, this.#ctx.resolvePage);
          if (offsets) {
            setSelectionOffsets(
              text,
              Math.min(offsets.start, textValue.length),
              Math.min(offsets.end, textValue.length)
            );
          }
        }
      } else if (text && text.textContent !== textValue) {
        const focused = text.matches(':focus');
        text.textContent = textValue;
        if (focused) this.#restoreOffsets(text, textValue.length);
      }
    }
  }

  #syncNav(
    prev: HTMLButtonElement,
    next: HTMLButtonElement,
    rowId: string
  ): void {
    const rows = this.#ctx.navigationRows(this.#ctx.activeView());
    const index = rows.findIndex(item => item.id === rowId);
    prev.disabled = index <= 0;
    next.disabled = index < 0 || index >= rows.length - 1;
  }

  #syncInput(
    input: HTMLInputElement,
    value: string,
    formatted: string
  ): void {
    const focused = input.matches(':focus');
    const next = focused ? value : formatted;
    if (input.value === next) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = next;
    if (focused && start !== null && end !== null) {
      try {
        input.setSelectionRange(start, end);
      } catch {
        // Some input types do not support selection ranges.
      }
    }
  }
}
