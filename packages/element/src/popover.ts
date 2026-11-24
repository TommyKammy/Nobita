export interface PopoverRow<T> {
  key: string;
  value: T;
  element: HTMLButtonElement;
  section?: string;
}

export interface PopoverListOptions<T> {
  ariaLabel: string;
  className?: string;
  rows: readonly PopoverRow<T>[];
  /** Rows behave like radio options and expose aria-checked. */
  selectable?: boolean;
}

/**
 * Shared floating list used by the toolbar menus.
 *
 * It owns positioning, outside-click dismissal, keyboard navigation and event
 * delegation. Rows are plain buttons; a single click listener handles all of
 * them, so menus with many entries do not add per-row listeners.
 */
export class PopoverList<T> {
  readonly element: HTMLElement;
  onHide: (() => void) | null = null;
  #overlay: HTMLElement;
  #rows: PopoverRow<T>[];
  #selectable: boolean;
  #selected = new Set<string>();
  #focusIndex = -1;
  #trigger: HTMLElement | null = null;
  #onPick: ((value: T) => void) | null = null;
  #visible = false;

  constructor(overlay: HTMLElement, options: PopoverListOptions<T>) {
    this.#overlay = overlay;
    this.#rows = [...options.rows];
    this.#selectable = options.selectable ?? false;
    this.element = document.createElement('div');
    this.element.className =
      `nb-popover ${options.className ?? ''}`.trim();
    this.element.setAttribute('role', 'menu');
    this.element.setAttribute('aria-label', options.ariaLabel);

    let section: string | undefined;
    for (const row of this.#rows) {
      if (row.section && row.section !== section) {
        const heading = document.createElement('div');
        heading.className = 'nb-popover-heading';
        heading.textContent = row.section;
        this.element.append(heading);
        section = row.section;
      }
      row.element.dataset.rowKey = row.key;
      this.element.append(row.element);
    }

    this.element.addEventListener('pointerdown', event => {
      const target = event.target as Element | null;
      if (target?.closest('[data-row-key]')) event.preventDefault();
    });
    this.element.addEventListener('click', event => {
      const target = (event.target as Element | null)?.closest<HTMLElement>(
        '[data-row-key]'
      );
      if (!target) return;
      const row = this.#rows.find(entry => entry.element === target);
      if (!row) return;
      event.preventDefault();
      this.#pick(row);
    });
  }

  get isVisible(): boolean {
    return this.#visible;
  }

  show(
    anchor: DOMRect,
    trigger: HTMLElement,
    onPick: (value: T) => void
  ): void {
    this.hide();
    this.#trigger = trigger;
    this.#onPick = onPick;
    const selected = this.#rows.findIndex(row => this.#selected.has(row.key));
    this.#focusIndex = selected >= 0 ? selected : -1;
    this.#render();
    this.#overlay.append(this.element);
    this.#visible = true;
    this.element.style.visibility = 'hidden';
    this.#position(anchor);
    this.element.style.visibility = '';
    window.addEventListener('pointerdown', this.#onDocPointerDown, true);
    window.addEventListener('keydown', this.#onKeyDown, true);
  }

  setSelected(keys: readonly string[]): void {
    this.#selected = new Set(keys);
    if (this.#visible) this.#renderSelection();
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

  #position(anchor: DOMRect): void {
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    let left = anchor.left + anchor.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = anchor.bottom + 6;
    if (top + height > window.innerHeight - 8) {
      top = anchor.top - height - 6;
    }
    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.max(8, top)}px`;
  }

  #render(): void {
    this.#renderSelection();
    this.#renderFocus();
  }

  #renderSelection(): void {
    if (!this.#selectable) return;
    for (const row of this.#rows) {
      const selected = this.#selected.has(row.key);
      row.element.dataset.selected = String(selected);
      row.element.setAttribute('aria-checked', String(selected));
    }
  }

  #renderFocus(): void {
    this.#rows.forEach((row, index) => {
      row.element.dataset.focus = String(index === this.#focusIndex);
    });
  }

  #moveFocus(delta: number): void {
    const count = this.#rows.length;
    if (count === 0) return;
    if (this.#focusIndex < 0) {
      this.#focusIndex = delta > 0 ? 0 : count - 1;
    } else {
      this.#focusIndex = (this.#focusIndex + delta + count) % count;
    }
    this.#renderFocus();
    this.#rows[this.#focusIndex]?.element.scrollIntoView({
      block: 'nearest',
    });
  }

  #pick(row: PopoverRow<T>): void {
    const onPick = this.#onPick;
    this.hide();
    onPick?.(row.value);
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
        this.#renderFocus();
        break;
      case 'End':
        this.#focusIndex = this.#rows.length - 1;
        this.#renderFocus();
        break;
      case 'Enter':
      case ' ': {
        const row = this.#rows[this.#focusIndex];
        if (row) this.#pick(row);
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
