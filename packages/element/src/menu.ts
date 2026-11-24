import { dismissFloating, placeFloating } from './floating.js';

export interface MenuItem {
  id: string;
  label: string;
  description?: string;
  icon: string;
  group?: string;
  keywords?: string[];
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

function score(label: string, keywords: readonly string[], query: string): number | null {
  if (!query) return 1;
  const needle = normalize(query);
  const plain = normalize(label);
  if (plain === needle) return 100;
  if (plain.startsWith(needle)) return 80 - plain.length * 0.01;
  const wordIndex = plain.split(/\s+/u).findIndex(word => word.startsWith(needle));
  if (wordIndex >= 0) return 60 - wordIndex;
  if (plain.includes(needle)) return 40 - plain.indexOf(needle) * 0.01;
  for (const keyword of keywords) {
    const candidate = normalize(keyword);
    if (candidate.startsWith(needle)) return 30;
    if (candidate.includes(needle)) return 20;
  }
  // subsequence match: "h1" matches "heading 1"
  let cursor = 0;
  let gaps = 0;
  for (const char of needle) {
    const found = plain.indexOf(char, cursor);
    if (found < 0) return null;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return 10 - gaps * 0.1;
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

  constructor(root: ShadowRoot, overlay: HTMLElement) {
    this.#root = root;
    this.#overlay = overlay;
    this.element = document.createElement('div');
    this.element.className = 'nb-menu';
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
      scroll: true,
      resize: true,
      onDismiss: () => this.close(),
    });
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
    const scored: { item: MenuItem; score: number; order: number }[] = [];
    this.#items.forEach((item, order) => {
      const value = score(item.label, item.keywords ?? [], this.#query);
      if (value !== null) scored.push({ item, score: value, order });
    });
    scored.sort((a, b) => a.order - b.order);
    this.#filtered = scored.map(entry => entry.item);
    this.#active = Math.min(this.#active, Math.max(0, this.#filtered.length - 1));
    this.#render();
  }

  #render(): void {
    const fragment = document.createDocumentFragment();
    if (this.#filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'nb-menu-empty';
      empty.textContent = 'No results';
      fragment.append(empty);
      this.element.replaceChildren(fragment);
      return;
    }
    let currentGroup: string | undefined;
    this.#filtered.forEach((item, index) => {
      if (item.group && item.group !== currentGroup) {
        currentGroup = item.group;
        const group = document.createElement('div');
        group.className = 'nb-menu-group';
        group.textContent = item.group;
        fragment.append(group);
      }
      const row = document.createElement('div');
      row.className = 'nb-menu-item';
      row.dataset.index = String(index);
      row.dataset.active = String(index === this.#active);
      row.setAttribute('role', 'menuitem');
      row.id = `nb-menu-item-${index}`;

      const icon = document.createElement('span');
      icon.className = 'nb-menu-icon';
      icon.innerHTML = item.icon;

      const copy = document.createElement('span');
      copy.className = 'nb-menu-copy';
      const label = document.createElement('span');
      label.className = 'nb-menu-label';
      label.textContent = item.label;
      copy.append(label);
      if (item.description) {
        const description = document.createElement('span');
        description.className = 'nb-menu-desc';
        description.textContent = item.description;
        copy.append(description);
      }

      row.append(icon, copy);
      if (item.shortcut) {
        const shortcut = document.createElement('span');
        shortcut.className = 'nb-menu-key';
        shortcut.textContent = item.shortcut;
        row.append(shortcut);
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
    if (!this.#open) return;
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
