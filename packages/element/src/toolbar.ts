import { PALETTE_COLORS } from '@nobita/core';
import type { InlineMark, PaletteColor, TextAlign } from '@nobita/core';
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

const capitalize = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

class ColorPalettePopover {
  readonly element: HTMLElement;
  onHide: (() => void) | null = null;
  #overlay: HTMLElement;
  #kind: 'highlight' | 'text';
  #active: PaletteColor | undefined;
  #current: HTMLElement;
  #trigger: HTMLElement | null = null;
  #onPick: ((color: PaletteColor | null) => void) | null = null;
  #buttons: { color: PaletteColor | null; element: HTMLButtonElement }[] = [];
  #focusIndex = 0;
  #visible = false;

  constructor(overlay: HTMLElement, kind: 'highlight' | 'text') {
    this.#overlay = overlay;
    this.#kind = kind;
    this.element = document.createElement('div');
    this.element.className = 'nb-color-popover';
    this.element.dataset.kind = kind;
    this.element.setAttribute('role', 'menu');
    this.element.setAttribute(
      'aria-label',
      kind === 'highlight' ? 'Highlight color' : 'Text color'
    );

    const title = document.createElement('div');
    title.className = 'nb-color-title';
    const label = document.createElement('span');
    label.textContent = kind === 'highlight' ? 'Highlight' : 'Text color';
    this.#current = document.createElement('span');
    this.#current.className = 'nb-color-current';
    title.append(label, this.#current);
    this.element.append(title);

    for (const color of PALETTE_COLORS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-color-swatch';
      button.dataset.color = color;
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute(
        'aria-label',
        `${color} ${kind === 'highlight' ? 'highlight' : 'text color'}`
      );
      button.title = capitalize(color);
      button.style.background =
        kind === 'highlight'
          ? `var(--nb-hl-${color})`
          : `var(--nb-fg-${color})`;
      const check = document.createElement('span');
      check.className = 'nb-color-check';
      check.innerHTML = icon.check;
      button.append(check);
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
    none.className = 'nb-color-none';
    none.dataset.color = 'none';
    none.setAttribute('role', 'menuitemradio');
    const noneLabel = kind === 'highlight' ? 'No highlight' : 'Default color';
    none.setAttribute('aria-label', noneLabel);
    none.innerHTML = `${icon.x}<span>${noneLabel}</span>`;
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
    active: PaletteColor | undefined,
    trigger: HTMLElement,
    onPick: (color: PaletteColor | null) => void
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

  setActive(active: PaletteColor | undefined): void {
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
    this.#current.textContent = this.#active
      ? capitalize(this.#active)
      : this.#kind === 'highlight'
        ? 'None'
        : 'Default';
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

  #pick(color: PaletteColor | null): void {
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

class AlignPopover {
  readonly element: HTMLElement;
  onHide: (() => void) | null = null;
  #overlay: HTMLElement;
  #active: TextAlign = 'left';
  #trigger: HTMLElement | null = null;
  #onPick: ((align: TextAlign) => void) | null = null;
  #buttons: { align: TextAlign; element: HTMLButtonElement }[] = [];
  #focusIndex = 0;
  #visible = false;

  constructor(overlay: HTMLElement) {
    this.#overlay = overlay;
    this.element = document.createElement('div');
    this.element.className = 'nb-align-popover';
    this.element.setAttribute('role', 'menu');
    this.element.setAttribute('aria-label', 'Alignment');

    for (const item of ALIGN_BUTTONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-align-item';
      button.dataset.align = item.align;
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-label', item.label);
      const check = document.createElement('span');
      check.className = 'nb-align-check';
      check.innerHTML = icon.check;
      button.innerHTML = `<span class="nb-align-icon">${item.icon}</span><span class="nb-align-label">${item.label}</span>`;
      button.append(check);
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', event => {
        event.preventDefault();
        this.#pick(item.align);
      });
      this.#buttons.push({ align: item.align, element: button });
      this.element.append(button);
    }
  }

  get isVisible(): boolean {
    return this.#visible;
  }

  show(
    anchor: DOMRect,
    active: TextAlign,
    trigger: HTMLElement,
    onPick: (align: TextAlign) => void
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

  setActive(active: TextAlign): void {
    this.#active = active;
    const selected = this.#buttons.findIndex(entry => entry.align === active);
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
    this.#buttons.forEach((entry, index) => {
      entry.element.dataset.active = String(index === this.#focusIndex);
      entry.element.setAttribute(
        'aria-checked',
        String(entry.align === this.#active)
      );
    });
  }

  #moveFocus(delta: number): void {
    const count = this.#buttons.length;
    if (count === 0) return;
    this.#focusIndex = (this.#focusIndex + delta + count) % count;
    this.#render();
  }

  #pick(align: TextAlign): void {
    const onPick = this.#onPick;
    this.hide();
    onPick?.(align);
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (!this.#visible) return;
    let handled = true;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        this.#moveFocus(1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
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
        const align = this.#buttons[this.#focusIndex]?.align;
        if (align) this.#pick(align);
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
  #onToggle: (key: ToolbarMark) => void;
  #onLink: () => void;
  #onAlign: (align: TextAlign) => void;
  #onHighlight: (color: PaletteColor | null) => void;
  #onTextColor: (color: PaletteColor | null) => void;
  #highlightButton: HTMLButtonElement;
  #textColorButton: HTMLButtonElement;
  #alignButton: HTMLButtonElement;
  #highlightPopover: ColorPalettePopover;
  #textColorPopover: ColorPalettePopover;
  #alignPopover: AlignPopover;
  #activeHighlight: PaletteColor | undefined;
  #activeTextColor: PaletteColor | undefined;
  #activeAlign: TextAlign = 'left';
  #visible = false;

  constructor(
    overlay: HTMLElement,
    onToggle: (key: ToolbarMark) => void,
    onLink: () => void,
    onAlign: (align: TextAlign) => void,
    onHighlight: (color: PaletteColor | null) => void,
    onTextColor: (color: PaletteColor | null) => void
  ) {
    this.#overlay = overlay;
    this.#onToggle = onToggle;
    this.#onLink = onLink;
    this.#onAlign = onAlign;
    this.#onHighlight = onHighlight;
    this.#onTextColor = onTextColor;
    this.#highlightPopover = new ColorPalettePopover(overlay, 'highlight');
    this.#textColorPopover = new ColorPalettePopover(overlay, 'text');
    this.#alignPopover = new AlignPopover(overlay);
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
    highlight.className =
      'nb-tool nb-tool-dropdown nb-tool-swatch nb-tool-highlight';
    highlight.dataset.key = 'highlight';
    highlight.setAttribute('aria-label', 'Highlight color');
    highlight.setAttribute('aria-haspopup', 'menu');
    highlight.setAttribute('aria-expanded', 'false');
    highlight.title = 'Highlight color';
    highlight.innerHTML = `${icon.highlight}<span class="nb-chev">${icon.chevron}</span>`;
    highlight.addEventListener('pointerdown', event => event.preventDefault());
    highlight.addEventListener('click', event => {
      event.preventDefault();
      this.#togglePalette('highlight');
    });
    this.#highlightButton = highlight;
    this.#highlightPopover.onHide = () => {
      this.#highlightButton.setAttribute('aria-expanded', 'false');
    };
    this.element.append(highlight);

    const textColor = document.createElement('button');
    textColor.type = 'button';
    textColor.className =
      'nb-tool nb-tool-dropdown nb-tool-swatch nb-tool-text-color';
    textColor.dataset.key = 'text-color';
    textColor.setAttribute('aria-label', 'Text color');
    textColor.setAttribute('aria-haspopup', 'menu');
    textColor.setAttribute('aria-expanded', 'false');
    textColor.title = 'Text color';
    textColor.innerHTML = `${icon.textColor}<span class="nb-chev">${icon.chevron}</span>`;
    textColor.addEventListener('pointerdown', event => event.preventDefault());
    textColor.addEventListener('click', event => {
      event.preventDefault();
      this.#togglePalette('text');
    });
    this.#textColorButton = textColor;
    this.#textColorPopover.onHide = () => {
      this.#textColorButton.setAttribute('aria-expanded', 'false');
    };
    this.element.append(textColor);

    const separator = document.createElement('div');
    separator.className = 'nb-tool-sep';
    this.element.append(separator);

    const align = document.createElement('button');
    align.type = 'button';
    align.className = 'nb-tool nb-tool-dropdown';
    align.dataset.key = 'align';
    align.setAttribute('aria-label', 'Alignment');
    align.setAttribute('aria-haspopup', 'menu');
    align.setAttribute('aria-expanded', 'false');
    align.title = 'Alignment';
    align.innerHTML = `${icon.alignLeft}<span class="nb-chev">${icon.chevron}</span>`;
    align.addEventListener('pointerdown', event => event.preventDefault());
    align.addEventListener('click', event => {
      event.preventDefault();
      this.#toggleAlign();
    });
    this.#alignButton = align;
    this.#alignPopover.onHide = () => {
      this.#alignButton.setAttribute('aria-expanded', 'false');
    };
    this.element.append(align);

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

  #closePopovers(): void {
    this.#highlightPopover.hide();
    this.#textColorPopover.hide();
    this.#alignPopover.hide();
  }

  #togglePalette(kind: 'highlight' | 'text'): void {
    const button =
      kind === 'highlight' ? this.#highlightButton : this.#textColorButton;
    const popover =
      kind === 'highlight' ? this.#highlightPopover : this.#textColorPopover;
    if (popover.isVisible) {
      popover.hide();
      return;
    }
    this.#closePopovers();
    const active =
      kind === 'highlight' ? this.#activeHighlight : this.#activeTextColor;
    popover.show(button.getBoundingClientRect(), active, button, color => {
      if (kind === 'highlight') this.#onHighlight(color);
      else this.#onTextColor(color);
    });
    button.setAttribute('aria-expanded', 'true');
  }

  #toggleAlign(): void {
    if (this.#alignPopover.isVisible) {
      this.#alignPopover.hide();
      return;
    }
    this.#closePopovers();
    this.#alignPopover.show(
      this.#alignButton.getBoundingClientRect(),
      this.#activeAlign,
      this.#alignButton,
      align => this.#onAlign(align)
    );
    this.#alignButton.setAttribute('aria-expanded', 'true');
  }

  #setAlignIcon(align: TextAlign): void {
    const markup =
      align === 'center'
        ? icon.alignCenter
        : align === 'right'
          ? icon.alignRight
          : icon.alignLeft;
    this.#alignButton.innerHTML = `${markup}<span class="nb-chev">${icon.chevron}</span>`;
    this.#alignButton.setAttribute(
      'aria-label',
      `Alignment: ${align.charAt(0).toUpperCase()}${align.slice(1)}`
    );
  }

  #updateSwatch(
    button: HTMLButtonElement,
    color: PaletteColor | undefined,
    prefix: 'hl' | 'fg'
  ): void {
    button.dataset.active = String(Boolean(color));
    button.setAttribute('aria-pressed', String(Boolean(color)));
    button.dataset.color = color ?? 'none';
    button.style.setProperty(
      '--nb-tool-active',
      color ? `var(--nb-${prefix}-${color})` : 'transparent'
    );
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
    this.#activeTextColor = state.color;
    this.#updateSwatch(this.#highlightButton, state.highlight, 'hl');
    this.#updateSwatch(this.#textColorButton, state.color, 'fg');
    this.#highlightPopover.setActive(state.highlight);
    this.#textColorPopover.setActive(state.color);
    this.#activeAlign = align;
    this.#setAlignIcon(align);
    this.#alignPopover.setActive(align);
  }

  hide(): void {
    this.#closePopovers();
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
