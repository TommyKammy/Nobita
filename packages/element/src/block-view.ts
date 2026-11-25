import type { Block } from '@nobita/core';
import { createDatabaseData, createTableData, safeImageSrc } from '@nobita/core';
import type { BlockHost } from './bridge.js';
import { DatabaseView, type DatabaseHost } from './database-view.js';
import { SimpleTableView } from './table-view.js';
import { domPointToOffset, nativeSelection } from './dom.js';
import { icon } from './icons.js';
import { renderInlineRuns } from './inline-dom.js';

const CODE_LANGUAGES = [
  'text',
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'json',
  'html',
  'css',
  'python',
  'go',
  'rust',
  'sql',
  'bash',
  'markdown',
  'yaml',
] as const;

const CALLOUT_TONES = [
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'danger', label: 'Danger' },
] as const;

let plusIconNode: Node | null = null;
let dragIconNode: Node | null = null;

function cloneIcon(cache: 'plus' | 'drag'): Node {
  let template = cache === 'plus' ? plusIconNode : dragIconNode;
  if (!template) {
    const host = document.createElement('span');
    host.innerHTML = cache === 'plus' ? icon.plus : icon.drag;
    template = host.firstChild ?? document.createTextNode('');
    if (cache === 'plus') plusIconNode = template;
    else dragIconNode = template;
  }
  return template.cloneNode(true);
}

export interface BlockRenderContext {
  depth: number;
  index: number;
  /** 1-based ordinal for numbered lists, 0 otherwise. */
  number: number;
}

export class BlockView {
  readonly element: HTMLElement;
  readonly id: string;
  block: Block;

  #host: BlockHost;
  #row: HTMLElement;
  #marker: HTMLElement;
  #content: HTMLElement;
  #children: HTMLElement;
  #text: HTMLElement | null = null;
  #codeLang: HTMLSelectElement | null = null;
  #toneSelect: HTMLSelectElement | null = null;
  #pageLink: HTMLElement | null = null;
  #pageIcon: HTMLElement | null = null;
  #pageLabel: HTMLElement | null = null;
  #image: HTMLElement | null = null;
  #caption: HTMLElement | null = null;
  #database: DatabaseView | null = null;
  #table: SimpleTableView | null = null;
  #childViews = new Map<string, BlockView>();
  #context: BlockRenderContext | null = null;
  #markerKey = '';

  constructor(host: BlockHost, block: Block, context: BlockRenderContext) {
    this.#host = host;
    this.block = block;
    this.id = block.id;
    host.registerView(this);

    this.element = document.createElement('div');
    this.element.className = 'nb-block';
    this.element.dataset.blockId = block.id;

    this.#row = document.createElement('div');
    this.#row.className = 'nb-row';

    const gutter = document.createElement('div');
    gutter.className = 'nb-gutter';
    gutter.contentEditable = 'false';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'nb-gutter-btn nb-add';
    add.setAttribute('aria-label', 'Add block below');
    add.title = 'Add block below';
    add.append(cloneIcon('plus'));
    const drag = document.createElement('button');
    drag.type = 'button';
    drag.className = 'nb-gutter-btn nb-drag';
    drag.setAttribute('aria-label', 'Drag to move, click for actions');
    drag.title = 'Drag to move · click for actions';
    drag.append(cloneIcon('drag'));
    gutter.append(add, drag);

    this.#marker = document.createElement('div');
    this.#marker.className = 'nb-marker';
    this.#marker.contentEditable = 'false';
    this.#content = document.createElement('div');
    this.#content.className = 'nb-content';

    this.#row.append(gutter, this.#marker, this.#content);
    this.#children = document.createElement('div');
    this.#children.className = 'nb-children';
    this.element.append(this.#row, this.#children);

    this.update(block, context, true);
  }

  update(block: Block, context: BlockRenderContext, force = false): void {
    const previous = this.block;
    const contextChanged =
      !this.#context ||
      this.#context.depth !== context.depth ||
      this.#context.number !== context.number;
    if (!force && previous === block && !contextChanged) return;
    this.block = block;
    this.#context = context;

    const rebuild = force || previous.type !== block.type;
    if (rebuild) {
      this.#buildContent(block);
    }

    this.element.dataset.type = block.type;
    this.element.dataset.depth = String(context.depth);
    if (block.type === 'heading') this.element.dataset.level = String(block.props.level ?? 1);
    else delete this.element.dataset.level;
    if (block.type === 'todo') this.element.dataset.checked = String(Boolean(block.props.checked));
    else delete this.element.dataset.checked;
    if (block.type === 'callout') this.element.dataset.tone = block.props.tone ?? 'info';
    else delete this.element.dataset.tone;
    if (block.props.collapsed) this.element.dataset.collapsed = 'true';
    else delete this.element.dataset.collapsed;

    if (block.props.align) this.#content.style.textAlign = block.props.align;
    else this.#content.style.removeProperty('text-align');

    this.#renderMarker(context);

    if (block.type === 'database' && this.#database) {
      this.#database.update(block.props.database ?? createDatabaseData({ variant: 'database' }));
    }
    if (block.type === 'table' && this.#table) {
      this.#table.update(block.props.table ?? createTableData());
    }

    if (this.#text) {
      if (rebuild || previous.text !== block.text) {
        this.#renderRuns();
      }
    }

    if (this.#codeLang) {
      this.#syncCodeLanguage(block.props.language ?? 'text');
    }
    if (this.#toneSelect) {
      this.#toneSelect.value = block.props.tone ?? 'info';
    }
    if (block.type === 'page' && this.#pageLink) {
      this.#syncPageLink(block);
    }

    if (block.type === 'image') {
      if (force || previous.props.src !== block.props.src) this.#buildImage(block);
      if (this.#caption && document.activeElement !== this.#caption) {
        const caption = block.props.caption ?? '';
        if (this.#caption.textContent !== caption) this.#caption.textContent = caption;
      }
    }

    if (force || previous.children !== block.children) {
      this.#syncChildren(block.children, context.depth + 1);
    }
  }

  #buildContent(block: Block): void {
    this.#database?.destroy();
    this.#database = null;
    this.#table?.destroy();
    this.#table = null;
    this.#text = null;
    this.#codeLang = null;
    this.#toneSelect = null;
    this.#pageLink = null;
    this.#pageIcon = null;
    this.#pageLabel = null;
    this.#image = null;
    this.#caption = null;
    this.#content.replaceChildren();

    if (block.type === 'page') {
      const link = document.createElement('div');
      link.className = 'nb-page-link';
      link.contentEditable = 'false';
      link.tabIndex = 0;
      link.setAttribute('role', 'link');
      const pageIcon = document.createElement('span');
      pageIcon.className = 'nb-page-icon';
      const label = document.createElement('span');
      label.className = 'nb-page-label';
      const arrow = document.createElement('span');
      arrow.className = 'nb-page-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '↗';
      link.append(pageIcon, label, arrow);
      link.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this.#openPage();
      });
      link.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        this.#openPage();
      });
      this.#pageLink = link;
      this.#pageIcon = pageIcon;
      this.#pageLabel = label;
      this.#content.append(link);
      this.#syncPageLink(block);
      return;
    }

    if (block.type === 'table') {
      const host = this.#host;
      const blockId = this.id;
      const view = new SimpleTableView(
        {
          get readonly() {
            return host.readonly;
          },
          commit: (data, options) => host.updateTable(blockId, data, options),
          undo: () => host.undoTable(),
          redo: () => host.redoTable(),
          focusAfterHistory: () => host.focusAfterTableHistory(blockId),
        },
        block.props.table ?? createTableData()
      );
      this.#table = view;
      this.#content.append(view.element);
      return;
    }

    if (block.type === 'database') {
      const host = this.#host;
      const blockId = this.id;
      const view = new DatabaseView(
        {
          get readonly() {
            return host.readonly;
          },
          get uploadImage() {
            return host.uploadImage;
          },
          commit: (data, options) => host.updateDatabase(blockId, data, options),
          undo: () => host.undoDatabase(),
          redo: () => host.redoDatabase(),
          focusAfter: () => host.focusAfterBlock(blockId),
        } satisfies DatabaseHost,
        block.props.database ?? createDatabaseData({ variant: 'database' })
      );
      this.#database = view;
      this.#content.append(view.element);
      return;
    }

    if (block.type === 'divider') {
      const line = document.createElement('div');
      line.className = 'nb-divider';
      line.contentEditable = 'false';
      this.#content.append(line);
      return;
    }

    if (block.type === 'image') {
      this.#image = document.createElement('div');
      this.#content.append(this.#image);
      this.#buildImage(block);
      return;
    }

    const text = document.createElement('div');
    text.className = 'nb-text';
    this.#text = text;
    this.#content.append(text);

    if (block.type === 'code') {
      const lang = document.createElement('select');
      lang.className = 'nb-code-lang';
      lang.contentEditable = 'false';
      lang.disabled = this.#host.readonly;
      lang.setAttribute('aria-label', 'Code language');
      for (const language of CODE_LANGUAGES) {
        const option = document.createElement('option');
        option.value = language;
        option.textContent = language;
        lang.append(option);
      }
      lang.addEventListener('change', () => {
        this.#host.setCodeLanguage(this.id, lang.value);
      });
      this.#codeLang = lang;
      this.#content.append(lang);
      this.#syncCodeLanguage(block.props.language ?? 'text');
    }
    if (block.type === 'callout') {
      const tone = document.createElement('select');
      tone.className = 'nb-callout-tone';
      tone.contentEditable = 'false';
      tone.disabled = this.#host.readonly;
      tone.setAttribute('aria-label', 'Callout tone');
      for (const item of CALLOUT_TONES) {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        tone.append(option);
      }
      tone.value = block.props.tone ?? 'info';
      tone.addEventListener('change', () => {
        this.#host.setCalloutTone(this.id, tone.value as 'info' | 'success' | 'warning' | 'danger');
      });
      this.#toneSelect = tone;
      this.#content.append(tone);
    }
  }

  #renderRuns(): void {
    const text = this.#text;
    if (!text) return;
    renderInlineRuns(text, this.block.text, pageId => this.#host.pageInfo(pageId));
  }

  #openPage(): void {
    const pageId = this.block.props.pageId;
    if (!pageId) return;
    this.#host.setFocusedBlock(this.id);
    this.#host.openPage(pageId);
  }

  #syncPageLink(block: Block): void {
    if (!this.#pageLink || !this.#pageIcon || !this.#pageLabel) return;
    const pageId = block.props.pageId ?? '';
    const info = pageId ? this.#host.pageInfo(pageId) : null;
    const title =
      (info?.title ?? block.props.pageTitle ?? '').trim() ||
      (pageId ? 'Untitled page' : 'Missing page');
    const pageIcon = info?.icon ?? block.props.pageIcon;
    if (pageIcon) this.#pageIcon.textContent = pageIcon;
    else this.#pageIcon.innerHTML = icon.page;
    this.#pageLabel.textContent = title;
    this.#pageLink.dataset.pageId = pageId;
    this.#pageLink.dataset.missing = String(!pageId);
    this.#pageLink.title = pageId ? title : 'Missing page link';
    this.#pageLink.setAttribute(
      'aria-label',
      pageId ? `Open page: ${title}` : 'Missing page link'
    );
  }

  refreshPageLink(): void {
    if (this.block.type === 'page') {
      this.#syncPageLink(this.block);
      return;
    }
    if (!this.#text) return;
    const chips = this.#text.querySelectorAll<HTMLElement>('.nb-m-page');
    if (chips.length === 0) return;
    let chipIndex = 0;
    for (const run of this.block.text) {
      if (!run.marks?.page) continue;
      const chip = chips[chipIndex++];
      if (!chip) break;
      const info = this.#host.pageInfo(run.marks.page.id);
      const displayTitle =
        (info?.title ?? run.marks.page.title ?? run.text).trim() || 'Untitled page';
      const displayIcon = (info?.icon ?? run.marks.page.icon ?? '').trim();
      chip.textContent = displayTitle;
      chip.dataset.pageTitle = displayTitle;
      if (displayIcon) chip.dataset.pageIcon = displayIcon;
      else delete chip.dataset.pageIcon;
      chip.title = displayTitle;
      chip.setAttribute('aria-label', `Open page: ${displayTitle}`);
    }
  }

  focusPageLink(): void {
    this.#pageLink?.focus();
  }

  #syncCodeLanguage(language: string): void {
    const select = this.#codeLang;
    if (!select) return;
    if (
      !Array.from(select.options).some(option => option.value === language)
    ) {
      const option = document.createElement('option');
      option.value = language;
      option.textContent = language;
      select.append(option);
    }
    select.value = language;
  }

  #renderMarker(context: BlockRenderContext): void {
    const block = this.block;
    const number = context.number;
    const key = [
      block.type,
      block.props.checked ? '1' : '0',
      number,
      block.children.length,
      block.type === 'callout' ? (block.props.tone ?? 'info') : '',
    ].join('|');
    if (key === this.#markerKey) return;
    this.#markerKey = key;
    this.#marker.replaceChildren();
    this.#marker.style.display = '';

    switch (block.type) {
      case 'bulleted': {
        const bullet = document.createElement('span');
        bullet.className = block.children.length > 0 ? 'nb-bullet nb-bullet-open' : 'nb-bullet';
        this.#marker.append(bullet);
        break;
      }
      case 'numbered': {
        const number = document.createElement('span');
        number.className = 'nb-number';
        number.textContent = String(context.number);
        this.#marker.append(number);
        break;
      }      case 'todo': {
        const box = document.createElement('button');
        box.type = 'button';
        box.className = 'nb-checkbox';
        box.setAttribute('role', 'checkbox');
        box.setAttribute('aria-checked', String(Boolean(block.props.checked)));
        box.setAttribute('aria-label', block.props.checked ? 'Mark as not done' : 'Mark as done');
        box.innerHTML = icon.check;
        box.addEventListener('mousedown', event => event.preventDefault());
        box.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          this.#host.toggleTodo(this.id);
        });
        this.#marker.append(box);
        break;
      }
      case 'callout':
        this.#marker.innerHTML = icon.callout;
        break;
      default:
        this.#marker.style.display = 'none';
        break;
    }
  }

  #buildImage(block: Block): void {
    if (!this.#image) return;
    this.#image.replaceChildren();
    this.#caption = null;
    const src = block.props.src ?? '';
    if (!src) {
      const wrap = document.createElement('div');
      wrap.className = 'nb-image-placeholder';
      wrap.contentEditable = 'false';
      const row = document.createElement('div');
      row.className = 'nb-image-placeholder-row';
      const input = document.createElement('input');
      input.className = 'nb-image-input';
      input.type = 'url';
      input.placeholder = 'Paste an image URL…';
      input.setAttribute('aria-label', 'Image URL');
      const button = document.createElement('button');
      button.className = 'nb-link-apply';
      button.type = 'button';
      button.textContent = 'Add image';
      const commit = (): void => {
        const value = input.value.trim();
        if (!value) return;
        this.#host.setImage(this.id, { src: value });
      };
      button.addEventListener('click', event => {
        event.preventDefault();
        commit();
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      });
      input.addEventListener('mousedown', event => event.stopPropagation());
      row.append(input, button);
      const hint = document.createElement('div');
      hint.className = 'nb-image-hint';
      hint.textContent = 'Use a direct image link (https://…/photo.jpg).';
      wrap.append(row, hint);
      this.#image.append(wrap);
      return;
    }

    const img = document.createElement('img');
    img.className = 'nb-image';
    img.src = safeImageSrc(src) ?? '';
    img.alt = block.props.alt ?? '';
    img.loading = 'lazy';
    img.draggable = false;
    img.contentEditable = 'false';
    img.addEventListener(
      'error',
      () => {
        img.alt = 'Image failed to load';
      },
      { once: true }
    );

    const caption = document.createElement('div');
    caption.className = 'nb-caption';
    caption.contentEditable = this.#host.readonly ? 'false' : 'true';
    caption.dataset.placeholder = 'Write a caption…';
    caption.spellcheck = true;
    caption.textContent = block.props.caption ?? '';
    caption.addEventListener('blur', () => {
      const value = caption.textContent ?? '';
      if (value !== (this.block.props.caption ?? '')) {
        this.#host.setImage(this.id, { caption: value });
      }
    });
    caption.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        caption.blur();
      }
    });
    caption.addEventListener('paste', event => {
      event.preventDefault();
      const text = event.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, text.replace(/\r?\n/gu, ' '));
    });
    this.#caption = caption;
    this.#image.append(img, caption);
  }

  #syncChildren(blocks: readonly Block[], depth: number): void {
    if (blocks.length === 0 && this.#childViews.size === 0) return;
    if (this.#childViews.size > 0) {
      const ids = new Set(blocks.map(block => block.id));
      for (const [id, view] of this.#childViews) {
        if (ids.has(id)) continue;
        view.destroy();
        this.#childViews.delete(id);
      }
    }

    let cursor = this.#children.firstChild;
    let number = 0;
    blocks.forEach((block, index) => {
      number = block.type === 'numbered' ? number + 1 : 0;
      let view = this.#childViews.get(block.id);
      if (!view) {
        view = new BlockView(this.#host, block, {
          depth,
          index,
          number,
        });
        this.#childViews.set(block.id, view);
      }
      if (view.element === cursor) {
        cursor = cursor.nextSibling;
      } else {
        this.#children.insertBefore(view.element, cursor);
      }
      view.update(block, { depth, index, number });
    });
  }

  get textElement(): HTMLElement | null {
    return this.#text;
  }

  setPlaceholder(value: string): void {
    if (this.#text && (this.#text.dataset.placeholder ?? '') !== value) {
      this.#text.dataset.placeholder = value;
    }
  }

  focusTable(): void {
    this.#table?.focusFirstCell();
  }

  focusImageInput(): void {
    const input = this.#image?.querySelector<HTMLInputElement>('input.nb-image-input');
    input?.focus();
  }

  focusImageCaption(): void {
    this.#caption?.focus();
  }

  focusDatabase(): void {
    this.#database?.focusFirstCell();
  }

  setReadonly(readonly: boolean): void {
    this.#table?.setReadonly(readonly);
    if (this.#codeLang) this.#codeLang.disabled = readonly;
    if (this.#toneSelect) this.#toneSelect.disabled = readonly;
    if (this.#caption) this.#caption.contentEditable = readonly ? 'false' : 'true';
    this.#database?.setReadonly(readonly);
    for (const view of this.#childViews.values()) view.setReadonly(readonly);
  }

  caretOffset(): number {
    const text = this.#text;
    if (!text) return 0;
    const selection = nativeSelection(this.element.getRootNode() as ShadowRoot);
    if (!selection || selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    if (!text.contains(range.startContainer)) return 0;
    return domPointToOffset(text, range.startContainer, range.startOffset);
  }

  destroy(): void {
    this.#database?.destroy();
    this.#database = null;
    this.#table?.destroy();
    this.#table = null;
    for (const view of this.#childViews.values()) view.destroy();
    this.#childViews.clear();
    this.#host.unregisterView(this.id);
    this.element.remove();
  }
}
