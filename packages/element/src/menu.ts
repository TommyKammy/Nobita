import type { Translate } from './dictionary.js';
import { el } from './dom.js';
import { dismissFloating, placeFloating } from './floating.js';

export interface MenuItem {
  id: string;
  label: string;
  description?: string;
  icon: string;
  group?: string;
  keywords?: string[];
  englishLabel?: string;
  shortcut?: string;
  action: () => void;
}

export interface MenuOptions {
  items: MenuItem[];
  anchor: { x: number; y: number; bottom: number; top: number; left: number; right: number };
  filterable?: boolean;
  query?: string;
  width?: number;
  onClose?: () => void;
}

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/gu, '');
}

// Labels support ordered subsequences (e.g. "hd1" for "Heading 1").
function matchesLabel(label: string, needle: string): boolean {
  const plain = normalize(label);
  let cursor = 0;
  for (const char of needle) {
    const found = plain.indexOf(char, cursor);
    if (found < 0) return false;
    cursor = found + char.length;
  }
  return true;
}

export class Menu {
  readonly element: HTMLElement;
  #root: ShadowRoot;
  #overlay: HTMLElement;
  #items: MenuItem[] = [];
  #filtered: MenuItem[] = [];
  #active = 0;
  #open = false;
  #filterable = false;
  #query = '';
  #onClose: (() => void) | undefined;
  #dismiss: (() => void) | null = null;
  #width = 322;

  constructor(root: ShadowRoot, overlay: HTMLElement, private readonly t: Translate, private readonly composing: (event: KeyboardEvent) => boolean) {
    this.#root = root;
    this.#overlay = overlay;
    this.element = el('div', 'nb-menu');
    this.element.setAttribute('role', 'menu');
    this.element.tabIndex = -1;
    this.element.addEventListener('mousemove', event => {
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-index]');
      if (!target) return;
      const index = Number(target.dataset.index ?? '-1');
      if (index >= 0) this.#setActive(index);
    });
    this.element.addEventListener('pointerdown', event => {
      // Keep focus in the document while clicking an item.
      event.preventDefault();
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-index]');
      if (!target) return;
      const index = Number(target.dataset.index ?? '-1');
      const item = this.#filtered[index];
      if (item) this.#run(item);
    });
  }

  get isOpen(): boolean {
    return this.#open;
  }

  open(options: MenuOptions): void {
    this.close(false);
    this.#items = options.items;
    this.#filterable = options.filterable ?? false;
    this.#query = options.query ?? '';
    this.#width = options.width ?? 322;
    this.#onClose = options.onClose;
    this.element.style.width = `${this.#width}px`;
    this.element.style.visibility = 'hidden';
    this.element.style.left = '0px';
    this.element.style.top = '0px';
    this.#overlay.append(this.element);
    this.#filter();
    this.#position(options.anchor);
    this.element.style.visibility = '';
    this.#open = true;
    this.#root.addEventListener('keydown', this.#onKeyDown as EventListener, true);
    this.#dismiss = dismissFloating({
      element: this.element,
      pointerTarget: this.#root,
      escape: false,
      scroll: true,
      resize: true,
      onDismiss: () => this.close(),
    });
  }

  /** Replace the candidate list while the menu is open. */
  setItems(items: readonly MenuItem[]): void {
    this.#items = [...items];
    this.#filter();
    if (this.#open) this.#repositionToAnchor();
  }

  setQuery(query: string): void {
    if (!this.#filterable) return;
    if (query === this.#query) return;
    this.#query = query;
    this.#filter();
    this.#open && this.#repositionToAnchor();
  }

  close(notify = true): void {
    if (!this.#open) return;
    this.#open = false;
    this.element.remove();
    this.#root.removeEventListener('keydown', this.#onKeyDown as EventListener, true);
    this.#dismiss?.();
    this.#dismiss = null;
    const callback = this.#onClose;
    this.#onClose = undefined;
    if (notify) callback?.();
  }

  #anchorRect: MenuOptions['anchor'] | null = null;

  #position(anchor: MenuOptions['anchor']): void {
    this.#anchorRect = anchor;
    this.#repositionToAnchor();
  }

  #repositionToAnchor(): void {
    const anchor = this.#anchorRect;
    if (!anchor) return;
    placeFloating(this.element, anchor, {
      align: 'start',
      side: 'below',
      gap: 6,
      margin: 10,
      fallback: 'clamp',
    });
  }

  #filter(): void {
    const query = normalize(this.#query);
    this.#filtered = query ? this.#items.filter(item =>
      matchesLabel(item.label, query) ||
      (item.englishLabel && matchesLabel(item.englishLabel, query)) ||
      item.keywords?.some(keyword => normalize(keyword).includes(query))
    ) : this.#items;
    this.#active = Math.min(this.#active, Math.max(0, this.#filtered.length - 1));
    this.#render();
  }

  #render(): void {
    const fragment = document.createDocumentFragment();
    if (this.#filtered.length === 0) {
      fragment.append(el('div', 'nb-menu-empty', this.t('No results')));
      this.element.replaceChildren(fragment);
      return;
    }
    let currentGroup: string | undefined;
    this.#filtered.forEach((item, index) => {
      if (item.group && item.group !== currentGroup) {
        currentGroup = item.group;
        fragment.append(el('div', 'nb-menu-group', item.group));
      }
      const row = el('div', 'nb-menu-item');
      row.dataset.index = String(index);
      row.dataset.active = String(index === this.#active);
      row.setAttribute('role', 'menuitem');
      row.id = `nb-menu-item-${index}`;

      const icon = el('span', 'nb-menu-icon');
      icon.innerHTML = item.icon;

      const copy = el('span', 'nb-menu-copy');
      copy.append(el('span', 'nb-menu-label', item.label));
      if (item.description) {
        copy.append(el('span', 'nb-menu-desc', item.description));
      }

      row.append(icon, copy);
      if (item.shortcut) {
        row.append(el('span', 'nb-menu-key', item.shortcut));
      }
      fragment.append(row);
    });
    this.element.replaceChildren(fragment);
    this.element.setAttribute('aria-activedescendant', `nb-menu-item-${this.#active}`);
  }

  #setActive(index: number): void {
    if (index === this.#active) return;
    this.#active = index;
    for (const child of Array.from(this.element.querySelectorAll<HTMLElement>('[data-index]'))) {
      child.dataset.active = String(Number(child.dataset.index) === index);
    }
    const active = this.element.querySelector<HTMLElement>(`[data-index="${index}"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }

  #run(item: MenuItem): void {
    this.close();
    item.action();
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (!this.#open || this.composing(event)) return;
    const count = this.#filtered.length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        if (count > 0) this.#setActive((this.#active + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        if (count > 0) this.#setActive((this.#active - 1 + count) % count);
        break;
      case 'Home':
        event.preventDefault();
        event.stopPropagation();
        this.#setActive(0);
        break;
      case 'End':
        event.preventDefault();
        event.stopPropagation();
        this.#setActive(Math.max(0, count - 1));
        break;
      case 'Enter':
        event.preventDefault();
        event.stopPropagation();
        {
          const item = this.#filtered[this.#active];
          if (item) this.#run(item);
        }
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.close();
        break;
      case 'Tab':
        event.preventDefault();
        event.stopPropagation();
        break;
      default:
        break;
    }
  };
}
