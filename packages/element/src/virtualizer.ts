import type { Block } from '@nobita/core';

/** Negative entries represent omitted height, positive/zero entries are document indices. */
export function windowLayout(
  offsets: Float64Array,
  first: number,
  end: number,
  pins: number[]
): number[] {
  const indices = new Set(pins);
  for (let i = first; i < end; i++) indices.add(i);
  const layout: number[] = [];
  let cursor = 0;
  for (const i of [...indices].sort((a, b) => a - b)) {
    if (i > cursor) layout.push(offsets[cursor]! - offsets[i]!);
    layout.push(i);
    cursor = i + 1;
  }
  if (cursor < offsets.length - 1)
    layout.push(offsets[cursor]! - offsets[offsets.length - 1]!);
  return layout;
}

function scrollParent(body: HTMLElement): HTMLElement | Window {
  for (
    let node: Node | null = body.parentNode;
    node;
    node = node instanceof ShadowRoot ? node.host : node.parentNode
  ) {
    if (
      node !== document.body &&
      node !== document.documentElement &&
      node instanceof HTMLElement &&
      /^(auto|scroll)$/.test(getComputedStyle(node).overflowY)
    )
      return node;
  }
  return window;
}

const estimates: Partial<Record<Block['type'], number>> = {
  heading: 44,
  code: 120,
  table: 240,
  database: 240,
};

export class Virtualizer {
  #parent: HTMLElement | Window = window;
  #awaitingAttachment;
  #observer;
  #heights = new Map<string, number>();
  #pending = new Map<string, number>();
  #blocks: readonly Block[] = [];
  #indices = new Map<string, number>();
  #offsets = new Float64Array(1);
  #frame = 0;
  #schedule = () => {
    if (!this.#frame)
      this.#frame = requestAnimationFrame(() => {
        this.#frame = 0;
        this.refresh();
      });
  };
  constructor(
    private body: HTMLElement,
    private overscan: number,
    private refresh: () => void
  ) {
    this.#awaitingAttachment = !body.isConnected;
    window.addEventListener('resize', this.#schedule);
    this.#observer = new ResizeObserver((entries) => {
      if (this.#awaitingAttachment && body.isConnected) {
        this.#awaitingAttachment = false;
        this.#bindParent();
        this.#schedule();
      }
      for (const entry of entries) {
        if (entry.target === this.#parent) {
          this.#schedule();
          continue;
        }
        const el = entry.target as HTMLElement;
        const style = getComputedStyle(el);
        const height =
          (entry.borderBoxSize[0]?.blockSize ?? el.offsetHeight) +
          parseFloat(style.marginTop) +
          parseFloat(style.marginBottom);
        const id = el.dataset.blockId!;
        if (height > 0 && this.#heights.get(id) !== height) {
          this.#pending.set(id, height);
          this.#schedule();
        }
      }
    });
    this.#bindParent();
    this.body.style.overflowAnchor = 'none';
  }
  #bindParent() {
    this.#parent.removeEventListener('scroll', this.#schedule);
    if (this.#parent instanceof HTMLElement) this.#observer.unobserve(this.#parent);
    this.#parent = scrollParent(this.body);
    this.#parent.addEventListener('scroll', this.#schedule, { passive: true });
    if (this.#parent instanceof HTMLElement) this.#observer.observe(this.#parent);
  }
  anchor(views: Iterable<{ element: HTMLElement }>) {
    const top =
      this.#parent instanceof HTMLElement
        ? this.#parent.getBoundingClientRect().top
        : 0;
    const bottom =
      top +
      (this.#parent instanceof HTMLElement
        ? this.#parent.clientHeight
        : innerHeight);
    for (const { element } of views) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom > top && rect.top < bottom) {
        return () => {
          if (element.isConnected)
            this.#parent.scrollBy(
              0,
              element.getBoundingClientRect().top - rect.top
            );
        };
      }
    }
  }
  has(id: string) {
    return this.#indices.has(id);
  }
  observe(el: HTMLElement) {
    this.#observer.observe(el);
  }
  unobserve(el: HTMLElement) {
    this.#observer.unobserve(el);
  }
  destroy() {
    this.#observer.disconnect();
    this.#parent.removeEventListener('scroll', this.#schedule);
    window.removeEventListener('resize', this.#schedule);
    cancelAnimationFrame(this.#frame);
    this.body.style.overflowAnchor = '';
  }
  #at(y: number) {
    let left = 0,
      right = this.#blocks.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (this.#offsets[mid + 1]! <= y) left = mid + 1;
      else right = mid;
    }
    return left;
  }
  layout(blocks: readonly Block[], pins: (string | null | undefined)[]) {
    const parent = this.#parent;
    const top =
      (parent instanceof HTMLElement
        ? parent.getBoundingClientRect().top + parent.clientTop
        : 0) - this.body.getBoundingClientRect().top;
    const height =
      parent instanceof HTMLElement ? parent.clientHeight : window.innerHeight;
    const changed = blocks !== this.#blocks;
    const anchor = this.#at(top);

    let delta = 0;
    if (changed || this.#pending.size) {
      for (const [id, h] of this.#pending) {
        const previous = this.#heights.get(id);
        if (
          !changed &&
          previous !== undefined &&
          this.#indices.get(id)! < anchor
        )
          delta += h - previous;
        this.#heights.set(id, h);
      }
      this.#pending.clear();
      if (changed) {
        this.#blocks = blocks;
        this.#indices.clear();
        const index = (b: Block, i: number) => {
          this.#indices.set(b.id, i);
          for (const child of b.children) index(child, i);
        };
        blocks.forEach(index);
        for (const id of this.#heights.keys())
          if (!this.#indices.has(id)) this.#heights.delete(id);
        this.#offsets = new Float64Array(blocks.length + 1);
      }
      blocks.forEach((b, i) => {
        this.#offsets[i + 1] =
          this.#offsets[i]! +
          (this.#heights.get(b.id) ??
            (estimates[b.type] ?? 32) + b.children.length * 32);
      });
    }
    if (delta) parent.scrollBy(0, delta);
    const fixed: number[] = [];
    for (const id of pins) {
      const i = id && this.#indices.get(id);
      if (typeof i === 'number') {
        fixed.push(i);
        if (i > 0) fixed.push(i - 1);
        if (i + 1 < blocks.length) fixed.push(i + 1);
      }
    }
    return windowLayout(
      this.#offsets,
      this.#at(top + delta - this.overscan),
      Math.min(
        blocks.length,
        this.#at(top + delta + height + this.overscan) + 1
      ),
      fixed
    );
  }
}
