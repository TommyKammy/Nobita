import { HIGHLIGHT_COLORS } from '@nobita/core';
import type { HighlightColor, InlineMark, TextAlign } from '@nobita/core';
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

class HighlightPopover {
  readonly element: HTMLElement;
  onHide: (() => void) | null = null;
  #overlay: HTMLElement;
  #active: HighlightColor | undefined;
  #trigger: HTMLElement | null = null;
  #onPick: ((color: HighlightColor | null) => void) | null = null;
  #buttons: { color: HighlightColor | null; element: HTMLButtonElement }[] = [];
  #focusIndex = 0;
  #visible = false;

  constructor(overlay: HTMLElement) {
    this.#overlay = overlay;
    this.element = document.createElement('div');
    this.element.className = 'nb-hl-popover';
    this.element.setAttribute('role', 'menu');
    this.element.setAttribute('aria-label', 'Highlight color');

    for (const color of HIGHLIGHT_COLORS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-hl-swatch';
      button.dataset.color = color;
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-label', `${color} highlight`);
      button.title = color.charAt(0).toUpperCase() + color.slice(1);
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', event => {
        event.preventDefault();
        this.#pick(color === this.#active ? null : color);
      });
      this.#buttons.push({ color, element: button });
      this.element.append(button);
    }

    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'nb-hl-none';
    none.dataset.color = 'none';
    none.setAttribute('role', 'menuitemradio');
    none.setAttribute('aria-label', 'No highlight');
    none.innerHTML = `${icon.x}<span>No highlight</span>`;
    none.addEventListener('pointerdown', event => event.preventDefault());
    none.addEventListener('click', event => {
      event.preventDefault();
      this.#pick(null);
    });
    this.#buttons.push({ color: null, element: none });
    this.element.append(none);
  }

  get isVisible(): boolean {
    return this.#visible;
  }

  show(
    anchor: DOMRect,
    active: HighlightColor | undefined,
    trigger: HTMLElement,
    onPick: (color: HighlightColor | null) => void
  ): void {
    this.hide();
    this.#trigger = trigger;
    this.#onPick = onPick;
    this.setActive(active);
    this.#overlay.append(this.element);
    this.#visible = true;
    this.element.style.visibility = 'hidden';
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    let left = anchor.left + anchor.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = anchor.bottom + 6;
    if (top + height > window.innerHeight - 8) {
      top = anchor.top - height - 6;
    }
    top = Math.max(8, top);
    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
    this.element.style.visibility = '';
    window.addEventListener('pointerdown', this.#onDocPointerDown, true);
    window.addEventListener('keydown', this.#onKeyDown, true);
  }

  setActive(active: HighlightColor | undefined): void {
    this.#active = active;
    const selected = this.#buttons.findIndex(
      entry => entry.color === (active ?? null)
    );
    this.#focusIndex = selected >= 0 ? selected : 0;
    this.#render();
  }

  hide(): void {
    if (!this.#visible) return;
    this.#visible = false;
    this.element.remove();
    this.#onPick = null;
    this.#trigger = null;
    window.removeEventListener('pointerdown', this.#onDocPointerDown, true);
    window.removeEventListener('keydown', this.#onKeyDown, true);
    this.onHide?.();
  }

  #render(): void {
    const selected = this.#buttons.findIndex(
      entry => entry.color === (this.#active ?? null)
    );
    this.#buttons.forEach((entry, index) => {
      entry.element.dataset.active = String(index === this.#focusIndex);
      entry.element.setAttribute(
        'aria-checked',
        String(index === selected)
      );
    });
  }

  #moveFocus(delta: number): void {
    const count = this.#buttons.length;
    if (count === 0) return;
    this.#focusIndex = (this.#focusIndex + delta + count) % count;
    this.#render();
    this.#buttons[this.#focusIndex]?.element.scrollIntoView({
      block: 'nearest',
    });
  }

  #pick(color: HighlightColor | null): void {
    const onPick = this.#onPick;
    this.hide();
    onPick?.(color);
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (!this.#visible) return;
    let handled = true;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        this.#moveFocus(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        this.#moveFocus(-1);
        break;
      case 'Home':
        this.#focusIndex = 0;
        this.#render();
        break;
      case 'End':
        this.#focusIndex = this.#buttons.length - 1;
        this.#render();
        break;
      case 'Enter':
      case ' ': {
        const color = this.#buttons[this.#focusIndex]?.color ?? null;
        this.#pick(color === this.#active ? null : color);
        break;
      }
      case 'Escape':
        this.hide();
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  #onDocPointerDown = (event: PointerEvent): void => {
    if (!this.#visible) return;
    const path = event.composedPath();
    if (path.includes(this.element) || (this.#trigger && path.includes(this.#trigger))) {
      return;
    }
    this.hide();
  };
}

export class Toolbar {
  readonly element: HTMLElement;
  #overlay: HTMLElement;
  #buttons = new Map<ToolbarMark, HTMLButtonElement>();
  #alignButtons = new Map<TextAlign, HTMLButtonElement>();
  #onToggle: (key: ToolbarMark) => void;
  #onLink: () => void;
  #onAlign: (align: TextAlign) => void;
  #onHighlight: (color: HighlightColor | null) => void;
  #highlightButton: HTMLButtonElement;
  #highlightPopover: HighlightPopover;
  #activeHighlight: HighlightColor | undefined;
  #visible = false;

  constructor(
    overlay: HTMLElement,
    onToggle: (key: ToolbarMark) => void,
    onLink: () => void,
    onAlign: (align: TextAlign) => void,
    onHighlight: (color: HighlightColor | null) => void
  ) {
    this.#overlay = overlay;
    this.#onToggle = onToggle;
    this.#onLink = onLink;
    this.#onAlign = onAlign;
    this.#onHighlight = onHighlight;
    this.#highlightPopover = new HighlightPopover(overlay);
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

    const highlight = document.createElement('button');
    highlight.type = 'button';
    highlight.className = 'nb-tool nb-tool-highlight';
    highlight.dataset.key = 'highlight';
    highlight.setAttribute('aria-label', 'Highlight color');
    highlight.setAttribute('aria-haspopup', 'menu');
    highlight.setAttribute('aria-expanded', 'false');
    highlight.title = 'Highlight color';
    highlight.innerHTML = icon.highlight;
    highlight.addEventListener('pointerdown', event => event.preventDefault());
    highlight.addEventListener('click', event => {
      event.preventDefault();
      this.#toggleHighlight();
    });
    this.#highlightButton = highlight;
    this.#highlightPopover.onHide = () => {
      this.#highlightButton.setAttribute('aria-expanded', 'false');
    };
    this.element.append(highlight);

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

  #toggleHighlight(): void {
    if (this.#highlightPopover.isVisible) {
      this.#highlightPopover.hide();
      return;
    }
    const rect = this.#highlightButton.getBoundingClientRect();
    this.#highlightPopover.show(
      rect,
      this.#activeHighlight,
      this.#highlightButton,
      color => this.#onHighlight(color)
    );
    this.#highlightButton.setAttribute('aria-expanded', 'true');
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
    this.#activeHighlight = state.highlight;
    this.#highlightButton.dataset.active = String(Boolean(state.highlight));
    this.#highlightButton.setAttribute('aria-pressed', String(Boolean(state.highlight)));
    this.#highlightButton.dataset.highlight = state.highlight ?? 'none';
    this.#highlightButton.style.setProperty(
      '--nb-hl-active',
      state.highlight ? `var(--nb-hl-${state.highlight})` : 'transparent'
    );
    this.#highlightPopover.setActive(state.highlight);
    for (const [key, button] of this.#alignButtons) {
      const active = key === align;
      button.dataset.active = String(active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  hide(): void {
    this.#highlightPopover.hide();
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
