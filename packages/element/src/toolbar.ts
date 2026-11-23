import type { InlineMark, TextAlign } from '@nobita/core';
import { icon } from './icons.js';

export type ToolbarMark = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

const BUTTONS: readonly { key: ToolbarMark; label: string; icon: string; shortcut: string }[] = [
  { key: 'bold', label: 'Bold', icon: icon.bold, shortcut: 'B' },
  { key: 'italic', label: 'Italic', icon: icon.italic, shortcut: 'I' },
  { key: 'underline', label: 'Underline', icon: icon.underline, shortcut: 'U' },
  { key: 'strike', label: 'Strikethrough', icon: icon.strike, shortcut: 'S' },
  { key: 'code', label: 'Inline code', icon: icon.inlineCode, shortcut: 'E' },
];

const ALIGN_BUTTONS: readonly { align: TextAlign; label: string; icon: string; shortcut: string }[] = [
  { align: 'left', label: 'Align left', icon: icon.alignLeft, shortcut: '⇧L' },
  { align: 'center', label: 'Align center', icon: icon.alignCenter, shortcut: '⇧E' },
  { align: 'right', label: 'Align right', icon: icon.alignRight, shortcut: '⇧R' },
];

export class Toolbar {
  readonly element: HTMLElement;
  #overlay: HTMLElement;
  #buttons = new Map<ToolbarMark, HTMLButtonElement>();
  #alignButtons = new Map<TextAlign, HTMLButtonElement>();
  #onToggle: (key: ToolbarMark) => void;
  #onLink: () => void;
  #onAlign: (align: TextAlign) => void;
  #visible = false;

  constructor(
    overlay: HTMLElement,
    onToggle: (key: ToolbarMark) => void,
    onLink: () => void,
    onAlign: (align: TextAlign) => void
  ) {
    this.#overlay = overlay;
    this.#onToggle = onToggle;
    this.#onLink = onLink;
    this.#onAlign = onAlign;
    this.element = document.createElement('div');
    this.element.className = 'nb-toolbar';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Text formatting');
    this.element.style.visibility = 'hidden';

    for (const button of BUTTONS) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'nb-tool';
      element.dataset.key = button.key;
      element.setAttribute('aria-label', `${button.label} (${button.shortcut})`);
      element.title = `${button.label} · ${button.shortcut}`;
      element.innerHTML = button.icon;
      element.addEventListener('pointerdown', event => event.preventDefault());
      element.addEventListener('click', event => {
        event.preventDefault();
        this.#onToggle(button.key);
      });
      this.#buttons.set(button.key, element);
      this.element.append(element);
    }

    const separator = document.createElement('div');
    separator.className = 'nb-tool-sep';
    this.element.append(separator);

    for (const button of ALIGN_BUTTONS) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'nb-tool';
      element.dataset.key = `align-${button.align}`;
      element.setAttribute('aria-label', `${button.label} (${button.shortcut})`);
      element.title = `${button.label} · ${button.shortcut}`;
      element.innerHTML = button.icon;
      element.addEventListener('pointerdown', event => event.preventDefault());
      element.addEventListener('click', event => {
        event.preventDefault();
        this.#onAlign(button.align);
      });
      this.#alignButtons.set(button.align, element);
      this.element.append(element);
    }

    const alignSeparator = document.createElement('div');
    alignSeparator.className = 'nb-tool-sep';
    this.element.append(alignSeparator);

    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'nb-tool';
    link.dataset.key = 'link';
    link.setAttribute('aria-label', 'Add link');
    link.title = 'Link · K';
    link.innerHTML = icon.link;
    link.addEventListener('pointerdown', event => event.preventDefault());
    link.addEventListener('click', event => {
      event.preventDefault();
      this.#onLink();
    });
    this.element.append(link);
  }

  get isVisible(): boolean {
    return this.#visible;
  }

  show(rect: DOMRect, state: InlineMark, align: TextAlign = 'left'): void {
    if (!this.#visible) {
      this.#overlay.append(this.element);
      this.#visible = true;
    }
    this.update(state, align);
    this.element.style.visibility = 'hidden';
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.top - height - 8;
    if (top < 8) top = rect.bottom + 8;
    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
    this.element.style.visibility = '';
  }

  update(state: InlineMark, align: TextAlign = 'left'): void {
    for (const [key, button] of this.#buttons) {
      button.dataset.active = String(state[key] === true);
      button.setAttribute('aria-pressed', String(state[key] === true));
    }
    const link = this.element.querySelector<HTMLElement>('[data-key="link"]');
    if (link) link.dataset.active = String(Boolean(state.link));
    for (const [key, button] of this.#alignButtons) {
      const active = key === align;
      button.dataset.active = String(active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  hide(): void {
    if (!this.#visible) return;
    this.#visible = false;
    this.element.remove();
  }

  contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.element.contains(target);
  }
}

export class LinkPopover {
  readonly element: HTMLElement;
  #overlay: HTMLElement;
  #input: HTMLInputElement;
  #onApply: ((value: string | null) => void) | null = null;
  #visible = false;
  #onDocPointerDown = (event: PointerEvent): void => {
    if (!this.#visible) return;
    if (event.composedPath().includes(this.element)) return;
    this.#finish(null);
  };

  constructor(overlay: HTMLElement) {
    this.#overlay = overlay;
    this.element = document.createElement('div');
    this.element.className = 'nb-link-popover';
    this.element.style.visibility = 'hidden';
    this.#input = document.createElement('input');
    this.#input.className = 'nb-link-input';
    this.#input.type = 'url';
    this.#input.placeholder = 'Paste or type a link…';
    this.#input.setAttribute('aria-label', 'Link URL');
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'nb-link-apply';
    apply.textContent = 'Apply';
    apply.addEventListener('pointerdown', event => event.preventDefault());
    apply.addEventListener('click', () => this.#finish(this.#input.value.trim() || null));
    this.#input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.#finish(this.#input.value.trim() || null);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.#finish(null);
      }
    });
    this.element.append(this.#input, apply);
  }

  show(rect: DOMRect, initial: string | undefined, onApply: (value: string | null) => void): void {
    this.hide();
    this.#onApply = onApply;
    this.#input.value = initial ?? '';
    this.#overlay.append(this.element);
    this.#visible = true;
    this.element.style.visibility = 'hidden';
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    let left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 10));
    let top = rect.top - height - 10;
    if (top < 8) top = rect.bottom + 10;
    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
    this.element.style.visibility = '';
    window.addEventListener('pointerdown', this.#onDocPointerDown, true);
    this.#input.focus();
    this.#input.select();
  }

  hide(): void {
    if (this.#visible) {
      this.#visible = false;
      this.element.remove();
      window.removeEventListener('pointerdown', this.#onDocPointerDown, true);
    }
    this.#onApply = null;
  }

  contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.element.contains(target);
  }

  #finish(value: string | null): void {
    const apply = this.#onApply;
    this.hide();
    apply?.(value);
  }
}
