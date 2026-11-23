import type { Block } from '@nobita/core';
import { createDatabaseData, safeHref, safeImageSrc } from '@nobita/core';
import type { BlockHost } from './bridge.js';
import { DatabaseView, type DatabaseHost } from './database-view.js';
import { domPointToOffset, nativeSelection } from './dom.js';
import { icon } from './icons.js';

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
  #codeLang: HTMLElement | null = null;
  #image: HTMLElement | null = null;
  #caption: HTMLElement | null = null;
  #database: DatabaseView | null = null;
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
    add.innerHTML = icon.plus;
    add.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      host.addBlockAfter(this.id);
    });
    const drag = document.createElement('button');
    drag.type = 'button';
    drag.className = 'nb-gutter-btn nb-drag';
    drag.setAttribute('aria-label', 'Drag to move, click for actions');
    drag.title = 'Drag to move · click for actions';
    drag.innerHTML = icon.drag;
    drag.addEventListener('pointerdown', event => {
      event.preventDefault();
      host.beginDrag(this.id, event, drag);
    });
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

    this.#row.addEventListener('click', event => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest('button, input, .nb-text, .nb-caption, .nb-db')) return;
      host.focusBlock(this.id, 0);
    });

    this.update(block, context, true);
  }

  update(block: Block, context: BlockRenderContext, force = false): void {
    const previous = this.block;
    const contextChanged =
      !this.#context ||
      this.#context.index !== context.index ||
      this.#context.depth !== context.depth ||
      this.#context.number !== context.number;
    if (!force && previous === block && !contextChanged) return;
    this.block = block;
    this.#context = context;

    if (force || previous.type !== block.type) {
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

    if (this.#text) {
      if (force || previous.text !== block.text) {
        this.#renderRuns();
      }
    }

    if (this.#codeLang) {
      this.#codeLang.textContent = block.props.language ?? 'text';
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
    this.#text = null;
    this.#codeLang = null;
    this.#image = null;
    this.#caption = null;
    this.#content.replaceChildren();

    if (block.type === 'database') {
      const host = this.#host;
      const blockId = this.id;
      const view = new DatabaseView(
        {
          get readonly() {
            return host.readonly;
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
      const lang = document.createElement('div');
      lang.className = 'nb-code-lang';
      lang.textContent = block.props.language ?? 'text';
      lang.contentEditable = 'false';
      this.#codeLang = lang;
      this.#content.append(lang);
    }
  }

  #renderRuns(): void {
    const text = this.#text;
    if (!text) return;
    if (this.block.text.length === 0) {
      text.replaceChildren();
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const run of this.block.text) {
      const span = document.createElement('span');
      span.textContent = run.text;
      const marks = run.marks;
      if (marks) {
        const classes: string[] = [];
        const tokens: string[] = [];
        if (marks.bold) {
          classes.push('nb-m-bold');
          tokens.push('bold');
        }
        if (marks.italic) {
          classes.push('nb-m-italic');
          tokens.push('italic');
        }
        if (marks.underline) {
          classes.push('nb-m-underline');
          tokens.push('underline');
        }
        if (marks.strike) {
          classes.push('nb-m-strike');
          tokens.push('strike');
        }
        if (marks.code) {
          classes.push('nb-m-code');
          tokens.push('code');
        }
        if (marks.link) {
          const safe = safeHref(marks.link);
          if (safe) {
            classes.push('nb-m-link');
            span.dataset.link = safe;
            span.title = safe;
          }
        }
        if (classes.length > 0) span.className = classes.join(' ');
        if (tokens.length > 0) span.dataset.mark = tokens.join(' ');
      }
      fragment.append(span);
    }
    text.replaceChildren(fragment);
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
    const ids = new Set(blocks.map(block => block.id));
    for (const [id, view] of this.#childViews) {
      if (ids.has(id)) continue;
      view.destroy();
      this.#childViews.delete(id);
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
    if (this.#text) this.#text.dataset.placeholder = value;
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
    for (const view of this.#childViews.values()) view.destroy();
    this.#childViews.clear();
    this.#host.unregisterView(this.id);
    this.element.remove();
  }
}
