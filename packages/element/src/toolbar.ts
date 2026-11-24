import { PALETTE_COLORS, TURN_INTO_TYPES } from '@nobita/core';
import type {
  BlockType,
  HeadingLevel,
  InlineMark,
  PaletteColor,
  TextAlign,
} from '@nobita/core';
import { icon } from './icons.js';

export type ToolbarMark = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

const BUTTONS: readonly { key: ToolbarMark; label: string; icon: string; shortcut: string }[] = [
  { key: 'bold', label: 'Bold', icon: icon.bold, shortcut: 'B' },
  { key: 'italic', label: 'Italic', icon: icon.italic, shortcut: 'I' },
  { key: 'underline', label: 'Underline', icon: icon.underline, shortcut: 'U' },
  { key: 'strike', label: 'Strikethrough', icon: icon.strike, shortcut: 'S' },
  { key: 'code', label: 'Inline code', icon: icon.inlineCode, shortcut: 'E' },
];

const INLINE_ORDER: readonly (ToolbarMark | 'link')[] = [
  'bold',
  'code',
  'italic',
  'link',
  'strike',
  'underline',
];

const ALIGN_BUTTONS: readonly { align: TextAlign; label: string; icon: string; shortcut: string }[] = [
  { align: 'left', label: 'Align left', icon: icon.alignLeft, shortcut: '⇧L' },
  { align: 'center', label: 'Align center', icon: icon.alignCenter, shortcut: '⇧E' },
  { align: 'right', label: 'Align right', icon: icon.alignRight, shortcut: '⇧R' },
];

const capitalize = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

function turnIntoIcon(type: BlockType, level?: HeadingLevel): string {
  switch (type) {
    case 'heading':
      switch (level) {
        case 2:
          return icon.h2;
        case 3:
          return icon.h3;
        case 4:
          return icon.h4;
        case 5:
          return icon.h5;
        case 6:
          return icon.h6;
        default:
          return icon.h1;
      }
    case 'bulleted':
      return icon.bulleted;
    case 'numbered':
      return icon.numbered;
    case 'todo':
      return icon.todo;
    case 'quote':
      return icon.quote;
    case 'callout':
      return icon.callout;
    case 'code':
      return icon.code;
    case 'divider':
      return icon.divider;
    default:
      return icon.text;
  }
}

type ColorKind = 'color' | 'background';

const COLOR_SECTIONS: readonly {
  kind: ColorKind;
  title: string;
  defaultLabel: string;
}[] = [
  { kind: 'color', title: 'Color', defaultLabel: 'Default Color' },
  { kind: 'background', title: 'Background', defaultLabel: 'Default Background' },
];

interface ColorEntry {
  kind: ColorKind;
  color: PaletteColor | null;
  element: HTMLButtonElement;
}

class ColorPopover {
  readonly element: HTMLElement;
  onHide: (() => void) | null = null;
  #overlay: HTMLElement;
  #trigger: HTMLElement | null = null;
  #onPick: ((kind: ColorKind, color: PaletteColor | null) => void) | null = null;
  #buttons: ColorEntry[] = [];
  #focusIndex = -1;
  #visible = false;

  constructor(overlay: HTMLElement) {
    this.#overlay = overlay;
    this.element = document.createElement('div');
    this.element.className = 'nb-color-popover';
    this.element.setAttribute('role', 'menu');
    this.element.setAttribute('aria-label', 'Color and highlight');

    for (const section of COLOR_SECTIONS) {
      const heading = document.createElement('div');
      heading.className = 'nb-color-heading';
      heading.textContent = section.title;
      this.element.append(heading);

      for (const color of [null, ...PALETTE_COLORS] as (PaletteColor | null)[]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'nb-color-row';
        button.dataset.kind = section.kind;
        button.dataset.color = color ?? 'default';
        button.setAttribute('role', 'menuitem');
        button.setAttribute(
          'aria-label',
          color
            ? `${capitalize(color)} ${section.kind === 'color' ? 'text color' : 'background'}`
            : section.defaultLabel
        );

        const sample = document.createElement('span');
        sample.className = 'nb-color-a';
        sample.textContent = 'A';
        sample.dataset.kind = section.kind;
        if (color) {
          if (section.kind === 'color') {
            sample.style.color = `var(--nb-fg-${color})`;
          } else {
            sample.style.background = `var(--nb-hl-${color})`;
          }
        }

        const label = document.createElement('span');
        label.className = 'nb-color-label';
        label.textContent = color ? capitalize(color) : section.defaultLabel;

        button.append(sample, label);
        button.addEventListener('pointerdown', event => event.preventDefault());
        button.addEventListener('click', event => {
          event.preventDefault();
          this.#pick(section.kind, color);
        });
        this.#buttons.push({ kind: section.kind, color, element: button });
        this.element.append(button);
      }
    }
  }

  get isVisible(): boolean {
    return this.#visible;
  }

  show(
    anchor: DOMRect,
    trigger: HTMLElement,
    onPick: (kind: ColorKind, color: PaletteColor | null) => void
  ): void {
    this.hide();
    this.#trigger = trigger;
    this.#onPick = onPick;
    this.#focusIndex = -1;
    this.#render();
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
    });
  }

  #moveFocus(delta: number): void {
    const count = this.#buttons.length;
    if (count === 0) return;
    if (this.#focusIndex < 0) {
      this.#focusIndex = delta > 0 ? 0 : count - 1;
    } else {
      this.#focusIndex = (this.#focusIndex + delta + count) % count;
    }
    this.#render();
    this.#buttons[this.#focusIndex]?.element.scrollIntoView({
      block: 'nearest',
    });
  }

  #pick(kind: ColorKind, color: PaletteColor | null): void {
    const onPick = this.#onPick;
    this.hide();
    onPick?.(kind, color);
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
        const entry = this.#buttons[this.#focusIndex];
        if (entry) this.#pick(entry.kind, entry.color);
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

interface AlignEntry {
  align: TextAlign;
  element: HTMLButtonElement;
}

class AlignPopover {
  readonly element: HTMLElement;
  onHide: (() => void) | null = null;
  #overlay: HTMLElement;
  #active: TextAlign = 'left';
  #trigger: HTMLElement | null = null;
  #onPick: ((align: TextAlign) => void) | null = null;
  #buttons: AlignEntry[] = [];
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

interface TurnIntoEntry {
  type: BlockType;
  level: HeadingLevel | undefined;
  element: HTMLButtonElement;
}

class TurnIntoPopover {
  readonly element: HTMLElement;
  onHide: (() => void) | null = null;
  #overlay: HTMLElement;
  #activeType: BlockType = 'paragraph';
  #activeLevel: HeadingLevel | undefined;
  #trigger: HTMLElement | null = null;
  #onPick: ((type: BlockType, level?: HeadingLevel) => void) | null = null;
  #buttons: TurnIntoEntry[] = [];
  #focusIndex = 0;
  #visible = false;

  constructor(overlay: HTMLElement) {
    this.#overlay = overlay;
    this.element = document.createElement('div');
    this.element.className = 'nb-align-popover nb-turninto-popover';
    this.element.setAttribute('role', 'menu');
    this.element.setAttribute('aria-label', 'Turn into');

    for (const entry of TURN_INTO_TYPES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nb-align-item';
      button.dataset.type = entry.type;
      button.dataset.level = entry.level ? String(entry.level) : '';
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-label', entry.label);
      button.innerHTML = `<span class="nb-align-icon">${turnIntoIcon(entry.type, entry.level)}</span><span class="nb-align-label">${entry.label}</span>`;
      const check = document.createElement('span');
      check.className = 'nb-align-check';
      check.innerHTML = icon.check;
      button.append(check);
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', event => {
        event.preventDefault();
        this.#pick(entry.type, entry.level);
      });
      this.#buttons.push({
        type: entry.type,
        level: entry.level,
        element: button,
      });
      this.element.append(button);
    }
  }

  get isVisible(): boolean {
    return this.#visible;
  }

  show(
    anchor: DOMRect,
    activeType: BlockType,
    activeLevel: HeadingLevel | undefined,
    trigger: HTMLElement,
    onPick: (type: BlockType, level?: HeadingLevel) => void
  ): void {
    this.hide();
    this.#trigger = trigger;
    this.#onPick = onPick;
    this.setActive(activeType, activeLevel);
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

  setActive(type: BlockType, level?: HeadingLevel): void {
    this.#activeType = type;
    this.#activeLevel = level;
    const selected = this.#buttons.findIndex(
      entry =>
        entry.type === type &&
        (type !== 'heading' || (entry.level ?? 1) === (level ?? 1))
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
    this.#buttons.forEach((entry, index) => {
      entry.element.dataset.active = String(index === this.#focusIndex);
      entry.element.setAttribute(
        'aria-checked',
        String(
          entry.type === this.#activeType &&
            (entry.type !== 'heading' ||
              (entry.level ?? 1) === (this.#activeLevel ?? 1))
        )
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

  #pick(type: BlockType, level: HeadingLevel | undefined): void {
    const onPick = this.#onPick;
    this.hide();
    onPick?.(type, level);
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
        const entry = this.#buttons[this.#focusIndex];
        if (entry) this.#pick(entry.type, entry.level);
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
  #onTurnInto: (type: BlockType, level?: HeadingLevel) => void;
  #onHighlight: (color: PaletteColor | null) => void;
  #onTextColor: (color: PaletteColor | null) => void;
  #turnIntoButton: HTMLButtonElement;
  #alignButton: HTMLButtonElement;
  #colorButton: HTMLButtonElement;
  #turnIntoPopover: TurnIntoPopover;
  #alignPopover: AlignPopover;
  #colorPopover: ColorPopover;
  #activeAlign: TextAlign = 'left';
  #activeTurnIntoType: BlockType = 'paragraph';
  #activeTurnIntoLevel: HeadingLevel | undefined;
  #visible = false;

  constructor(
    overlay: HTMLElement,
    onToggle: (key: ToolbarMark) => void,
    onLink: () => void,
    onAlign: (align: TextAlign) => void,
    onTurnInto: (type: BlockType, level?: HeadingLevel) => void,
    onHighlight: (color: PaletteColor | null) => void,
    onTextColor: (color: PaletteColor | null) => void
  ) {
    this.#overlay = overlay;
    this.#onToggle = onToggle;
    this.#onLink = onLink;
    this.#onAlign = onAlign;
    this.#onTurnInto = onTurnInto;
    this.#onHighlight = onHighlight;
    this.#onTextColor = onTextColor;
    this.#turnIntoPopover = new TurnIntoPopover(overlay);
    this.#alignPopover = new AlignPopover(overlay);
    this.#colorPopover = new ColorPopover(overlay);
    this.element = document.createElement('div');
    this.element.className = 'nb-toolbar';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Text formatting');
    this.element.style.visibility = 'hidden';

    const turnInto = document.createElement('button');
    turnInto.type = 'button';
    turnInto.className = 'nb-tool nb-tool-dropdown';
    turnInto.dataset.key = 'turn-into';
    turnInto.setAttribute('aria-label', 'Turn into');
    turnInto.setAttribute('aria-haspopup', 'menu');
    turnInto.setAttribute('aria-expanded', 'false');
    turnInto.title = 'Turn into';
    turnInto.innerHTML = `${icon.turnInto}<span class="nb-chev">${icon.chevron}</span>`;
    turnInto.addEventListener('pointerdown', event => event.preventDefault());
    turnInto.addEventListener('click', event => {
      event.preventDefault();
      this.#toggleTurnInto();
    });
    this.#turnIntoButton = turnInto;
    this.#turnIntoPopover.onHide = () => {
      this.#turnIntoButton.setAttribute('aria-expanded', 'false');
    };
    this.element.append(turnInto);

    const align = document.createElement('button');
    align.type = 'button';
    align.className = 'nb-tool nb-tool-dropdown nb-tool-group-start';
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

    for (const key of INLINE_ORDER) {
      if (key === 'link') {
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
        continue;
      }
      const button = BUTTONS.find(item => item.key === key);
      if (!button) continue;
      const element = document.createElement('button');
      element.type = 'button';
      element.className =
        key === 'bold' ? 'nb-tool nb-tool-group-start' : 'nb-tool';
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

    const color = document.createElement('button');
    color.type = 'button';
    color.className = 'nb-tool nb-tool-dropdown nb-tool-group-start';
    color.dataset.key = 'color';
    color.setAttribute('aria-label', 'Highlight');
    color.setAttribute('aria-haspopup', 'menu');
    color.setAttribute('aria-expanded', 'false');
    color.title = 'Highlight';
    color.innerHTML = `${icon.highlight}<span class="nb-chev">${icon.chevron}</span>`;
    color.addEventListener('pointerdown', event => event.preventDefault());
    color.addEventListener('click', event => {
      event.preventDefault();
      this.#toggleColor();
    });
    this.#colorButton = color;
    this.#colorPopover.onHide = () => {
      this.#colorButton.setAttribute('aria-expanded', 'false');
    };
    this.element.append(color);
  }

  get isVisible(): boolean {
    return this.#visible;
  }

  #closePopovers(): void {
    this.#turnIntoPopover.hide();
    this.#alignPopover.hide();
    this.#colorPopover.hide();
  }

  #toggleTurnInto(): void {
    if (this.#turnIntoPopover.isVisible) {
      this.#turnIntoPopover.hide();
      return;
    }
    this.#closePopovers();
    this.#turnIntoPopover.show(
      this.#turnIntoButton.getBoundingClientRect(),
      this.#activeTurnIntoType,
      this.#activeTurnIntoLevel,
      this.#turnIntoButton,
      (type, level) => this.#onTurnInto(type, level)
    );
    this.#turnIntoButton.setAttribute('aria-expanded', 'true');
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

  #toggleColor(): void {
    if (this.#colorPopover.isVisible) {
      this.#colorPopover.hide();
      return;
    }
    this.#closePopovers();
    this.#colorPopover.show(
      this.#colorButton.getBoundingClientRect(),
      this.#colorButton,
      (kind, color) => {
        if (kind === 'color') this.#onTextColor(color);
        else this.#onHighlight(color);
      }
    );
    this.#colorButton.setAttribute('aria-expanded', 'true');
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

  show(
    rect: DOMRect,
    state: InlineMark,
    align: TextAlign = 'left',
    blockType: BlockType = 'paragraph',
    level?: HeadingLevel
  ): void {
    if (!this.#visible) {
      this.#overlay.append(this.element);
      this.#visible = true;
    }
    this.update(state, align, blockType, level);
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

  update(
    state: InlineMark,
    align: TextAlign = 'left',
    blockType: BlockType = 'paragraph',
    level?: HeadingLevel
  ): void {
    for (const [key, button] of this.#buttons) {
      button.dataset.active = String(state[key] === true);
      button.setAttribute('aria-pressed', String(state[key] === true));
    }
    const link = this.element.querySelector<HTMLElement>('[data-key="link"]');
    if (link) link.dataset.active = String(Boolean(state.link));
    this.#activeAlign = align;
    this.#setAlignIcon(align);
    this.#alignPopover.setActive(align);
    this.#activeTurnIntoType = blockType;
    this.#activeTurnIntoLevel = level;
    this.#turnIntoPopover.setActive(blockType, level);
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
