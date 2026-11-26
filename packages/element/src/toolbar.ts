import type { Translate } from './dictionary.js';
import { formattingControls } from './formatting-controls.js';
import { btn } from './database-dom.js';
import { el } from './dom.js';
import { PALETTE_COLORS, TURN_INTO_TYPES } from '@nobita/core';
import type {
  BlockType,
  BooleanMarkKey,
  HeadingLevel,
  InlineMark,
  PaletteColor,
  TextAlign,
} from '@nobita/core';
import { dismissFloating, placeFloating } from './floating.js';
import { blockIcon, icon } from './icons.js';
import { PopoverList, type PopoverRow } from './popover.js';

export type ToolbarMark = BooleanMarkKey;

const INLINE_ORDER: readonly (ToolbarMark | 'link')[] = [
  'bold',
  'code',
  'italic',
  'link',
  'strike',
  'underline',
];

const ALIGN_BUTTONS: readonly { align: TextAlign; label: string; icon: string }[] = [
  { align: 'left', label: 'Align left', icon: icon.alignLeft },
  { align: 'center', label: 'Align center', icon: icon.alignCenter },
  { align: 'right', label: 'Align right', icon: icon.alignRight },
];

const capitalize = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

type ColorKind = 'color' | 'background';

interface ColorPick {
  kind: ColorKind;
  color: PaletteColor | null;
}

interface TurnIntoValue {
  type: BlockType;
  level: HeadingLevel | undefined;
}

const COLOR_SECTIONS: readonly {
  kind: ColorKind;
  title: string;
  defaultLabel: string;
}[] = [
  { kind: 'color', title: 'Color', defaultLabel: 'Default Color' },
  { kind: 'background', title: 'Background', defaultLabel: 'Default Background' },
];

function labeledRow<T>(
  value: T,
  key: string,
  label: string,
  iconMarkup: string
): PopoverRow<T> {
  const button = btn('nb-popover-row');
  button.setAttribute('role', 'menuitemradio');
  button.setAttribute('aria-label', label);
  button.innerHTML = `<span class="nb-align-icon">${iconMarkup}</span><span class="nb-align-label"></span><span class="nb-popover-check">${icon.check}</span>`;
  button.querySelector('.nb-align-label')!.textContent = label;
  return { key, value, element: button };
}

function colorRow(
  t: Translate,
  kind: ColorKind,
  color: PaletteColor | null,
  fallbackLabel: string,
  section: string
): PopoverRow<ColorPick> {
  const button = btn('nb-popover-row');
  button.setAttribute('role', 'menuitem');
  button.setAttribute(
    'aria-label',
    color
      ? t(`${capitalize(color)} ${kind === 'color' ? 'text color' : 'background'}`)
      : fallbackLabel
  );

  const sample = el('span', 'nb-color-a');
  sample.textContent = 'A';
  sample.dataset.kind = kind;
  if (color) {
    if (kind === 'color') sample.style.color = `var(--nb-fg-${color})`;
    else sample.style.background = `var(--nb-hl-${color})`;
  }

  const text = el('span', 'nb-color-label');
  text.textContent = fallbackLabel;
  button.append(sample, text);
  return {
    key: `${kind}:${color ?? 'default'}`,
    value: { kind, color },
    element: button,
    section,
  };
}

function createColorPopover(overlay: HTMLElement, t: Translate): PopoverList<ColorPick> {
  const rows: PopoverRow<ColorPick>[] = [];
  for (const section of COLOR_SECTIONS) {
    for (const color of [null, ...PALETTE_COLORS] as (PaletteColor | null)[]) {
      const label = color
        ? capitalize(color)
        : section.defaultLabel;
      rows.push(colorRow(t, section.kind, color, t(label), t(section.title)));
    }
  }
  return new PopoverList(overlay, {
    ariaLabel: t('Color and highlight'),
    className: 'nb-color-popover',
    rows,
  });
}

function alignKey(align: TextAlign): string {
  return `align:${align}`;
}

function createAlignPopover(overlay: HTMLElement, t: Translate): PopoverList<TextAlign> {
  return new PopoverList(overlay, {
    ariaLabel: t('Alignment'),
    className: 'nb-align-popover',
    selectable: true,
    rows: ALIGN_BUTTONS.map(item =>
      labeledRow(item.align, alignKey(item.align), t(item.label), item.icon)
    ),
  });
}

function turnIntoKey(type: BlockType, level: HeadingLevel | undefined): string {
  return `turn:${type}:${level ?? ''}`;
}

function createTurnIntoPopover(
  overlay: HTMLElement, t: Translate
): PopoverList<TurnIntoValue> {
  return new PopoverList(overlay, {
    ariaLabel: t('Turn into'),
    className: 'nb-align-popover nb-turninto-popover',
    selectable: true,
    rows: TURN_INTO_TYPES.map(entry =>
      labeledRow(
        { type: entry.type, level: entry.level },
        turnIntoKey(entry.type, entry.level),
        t(entry.label),
        blockIcon(entry.type, entry.level)
      )
    ),
  });
}

export class Toolbar {
  readonly element: HTMLElement;
  #overlay: HTMLElement;
  #buttons = new Map<ToolbarMark, HTMLButtonElement>();
  #linkButton: HTMLButtonElement | null = null;
  #onToggle: (key: ToolbarMark) => void;
  #onLink: () => void;
  #onAlign: (align: TextAlign) => void;
  #onTurnInto: (type: BlockType, level?: HeadingLevel) => void;
  #onHighlight: (color: PaletteColor | null) => void;
  #onTextColor: (color: PaletteColor | null) => void;
  #turnIntoButton: HTMLButtonElement;
  #alignButton: HTMLButtonElement;
  #colorButton: HTMLButtonElement;
  #turnIntoPopover: PopoverList<TurnIntoValue> | null = null;
  #alignPopover: PopoverList<TextAlign> | null = null;
  #colorPopover: PopoverList<ColorPick> | null = null;
  #activeAlign: TextAlign = 'left';
  #activeTurnIntoType: BlockType = 'paragraph';
  #activeTurnIntoLevel: HeadingLevel | undefined;
  #visible = false;

  constructor(
    private readonly t: Translate,
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
    this.element = el('div', 'nb-toolbar');
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', t('Text formatting'));
    this.element.style.visibility = 'hidden';

    const turnInto = btn('nb-tool nb-tool-dropdown');
    turnInto.dataset.key = 'turn-into';
    turnInto.setAttribute('aria-label', t('Turn into'));
    turnInto.setAttribute('aria-haspopup', 'menu');
    turnInto.setAttribute('aria-expanded', 'false');
    turnInto.title = t('Turn into');
    turnInto.innerHTML = `${icon.turnInto}<span class="nb-chev">${icon.chevron}</span>`;
    turnInto.addEventListener('pointerdown', event => event.preventDefault());
    turnInto.addEventListener('click', event => {
      event.preventDefault();
      this.#toggleTurnInto();
    });
    this.#turnIntoButton = turnInto;
    this.element.append(turnInto);

    const align = btn('nb-tool nb-tool-dropdown nb-tool-group-start');
    align.dataset.key = 'align';
    align.setAttribute('aria-label', t('Alignment: Left'));
    align.setAttribute('aria-haspopup', 'menu');
    align.setAttribute('aria-expanded', 'false');
    align.title = t('Alignment');
    align.innerHTML = `${icon.alignLeft}<span class="nb-chev">${icon.chevron}</span>`;
    align.addEventListener('pointerdown', event => event.preventDefault());
    align.addEventListener('click', event => {
      event.preventDefault();
      this.#toggleAlign();
    });
    this.#alignButton = align;
    this.element.append(align);

    for (const key of INLINE_ORDER) {
      if (key === 'link') {
        const link = btn('nb-tool');
        link.dataset.key = 'link';
        link.setAttribute('aria-label', t('Add link'));
        link.title = t('Link · K');
        link.innerHTML = icon.link;
        link.addEventListener('pointerdown', event => event.preventDefault());
        link.addEventListener('click', event => {
          event.preventDefault();
          this.#onLink();
        });
        this.#linkButton = link;
        this.element.append(link);
        continue;
      }
      const button = formattingControls.find(item => item.key === key);
      if (!button) continue;
      const element = document.createElement('button');
      element.type = 'button';
      element.className =
        key === 'bold' ? 'nb-tool nb-tool-group-start' : 'nb-tool';
      element.dataset.key = button.key;
      element.setAttribute('aria-label', `${t(button.label)} (${button.shortcut})`);
      element.title = `${t(button.label)} · ${button.shortcut}`;
      element.innerHTML = button.icon;
      element.addEventListener('pointerdown', event => event.preventDefault());
      element.addEventListener('click', event => {
        event.preventDefault();
        this.#onToggle(button.key);
      });
      this.#buttons.set(button.key, element);
      this.element.append(element);
    }

    const color = btn('nb-tool nb-tool-dropdown nb-tool-group-start');
    color.dataset.key = 'color';
    color.setAttribute('aria-label', t('Highlight'));
    color.setAttribute('aria-haspopup', 'menu');
    color.setAttribute('aria-expanded', 'false');
    color.title = t('Highlight');
    color.innerHTML = `${icon.highlight}<span class="nb-chev">${icon.chevron}</span>`;
    color.addEventListener('pointerdown', event => event.preventDefault());
    color.addEventListener('click', event => {
      event.preventDefault();
      this.#toggleColor();
    });
    this.#colorButton = color;
    this.element.append(color);
  }

  get isVisible(): boolean {
    return this.#visible;
  }

  #ensureTurnInto(): PopoverList<TurnIntoValue> {
    if (!this.#turnIntoPopover) {
      const popover = createTurnIntoPopover(this.#overlay, this.t);
      popover.onHide = () => {
        this.#turnIntoButton.setAttribute('aria-expanded', 'false');
      };
      this.#turnIntoPopover = popover;
    }
    return this.#turnIntoPopover;
  }

  #ensureAlign(): PopoverList<TextAlign> {
    if (!this.#alignPopover) {
      const popover = createAlignPopover(this.#overlay, this.t);
      popover.onHide = () => {
        this.#alignButton.setAttribute('aria-expanded', 'false');
      };
      this.#alignPopover = popover;
    }
    return this.#alignPopover;
  }

  #ensureColor(): PopoverList<ColorPick> {
    if (!this.#colorPopover) {
      const popover = createColorPopover(this.#overlay, this.t);
      popover.onHide = () => {
        this.#colorButton.setAttribute('aria-expanded', 'false');
      };
      this.#colorPopover = popover;
    }
    return this.#colorPopover;
  }

  #closePopovers(): void {
    this.#turnIntoPopover?.hide();
    this.#alignPopover?.hide();
    this.#colorPopover?.hide();
  }

  #toggleTurnInto(): void {
    const popover = this.#ensureTurnInto();
    if (popover.isVisible) {
      popover.hide();
      return;
    }
    this.#closePopovers();
    popover.setSelected([
      turnIntoKey(this.#activeTurnIntoType, this.#activeTurnIntoLevel),
    ]);
    popover.show(
      this.#turnIntoButton.getBoundingClientRect(),
      this.#turnIntoButton,
      value => this.#onTurnInto(value.type, value.level)
    );
    this.#turnIntoButton.setAttribute('aria-expanded', 'true');
  }

  #toggleAlign(): void {
    const popover = this.#ensureAlign();
    if (popover.isVisible) {
      popover.hide();
      return;
    }
    this.#closePopovers();
    popover.setSelected([alignKey(this.#activeAlign)]);
    popover.show(
      this.#alignButton.getBoundingClientRect(),
      this.#alignButton,
      align => this.#onAlign(align)
    );
    this.#alignButton.setAttribute('aria-expanded', 'true');
  }

  #toggleColor(): void {
    const popover = this.#ensureColor();
    if (popover.isVisible) {
      popover.hide();
      return;
    }
    this.#closePopovers();
    popover.show(
      this.#colorButton.getBoundingClientRect(),
      this.#colorButton,
      value =>
        value.kind === 'color'
          ? this.#onTextColor(value.color)
          : this.#onHighlight(value.color)
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
      this.t(`Alignment: ${align.charAt(0).toUpperCase()}${align.slice(1)}`)
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
    placeFloating(this.element, rect, {
      align: 'center',
      side: 'above',
      gap: 8,
      margin: 8,
    });
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
    if (this.#linkButton) {
      this.#linkButton.dataset.active = String(Boolean(state.link));
    }
    if (align !== this.#activeAlign) {
      this.#activeAlign = align;
      this.#setAlignIcon(align);
    }
    this.#alignPopover?.setSelected([alignKey(align)]);
    this.#activeTurnIntoType = blockType;
    this.#activeTurnIntoLevel = level;
    this.#turnIntoPopover?.setSelected([
      turnIntoKey(blockType, level),
    ]);
  }

  hide(): void {
    this.#closePopovers();
    if (!this.#visible) return;
    this.#visible = false;
    this.element.remove();
  }
}

export class LinkPopover {
  readonly element: HTMLElement;
  #overlay: HTMLElement;
  #input: HTMLInputElement;
  #onApply: ((value: string | null) => void) | null = null;
  #visible = false;
  #dismiss: (() => void) | null = null;

  constructor(overlay: HTMLElement, t: Translate) {
    this.#overlay = overlay;
    this.element = el('div', 'nb-link-popover');
    this.element.style.visibility = 'hidden';
    this.#input = el('input', 'nb-link-input');
    this.#input.type = 'url';
    this.#input.placeholder = t('Paste or type a link…');
    this.#input.setAttribute('aria-label', t('Link URL'));
    const apply = btn('nb-link-apply');
    apply.textContent = t('Apply');
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
    placeFloating(this.element, rect, {
      align: 'start',
      side: 'above',
      gap: 10,
      marginX: 10,
      marginY: 8,
    });
    this.element.style.visibility = '';
    this.#dismiss = dismissFloating({
      element: this.element,
      onDismiss: () => this.#finish(null),
    });
    this.#input.focus();
    this.#input.select();
  }

  hide(): void {
    if (this.#visible) {
      this.#visible = false;
      this.element.remove();
      this.#dismiss?.();
      this.#dismiss = null;
    }
    this.#onApply = null;
  }

  #finish(value: string | null): void {
    const apply = this.#onApply;
    this.hide();
    apply?.(value);
  }
}
