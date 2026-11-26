// A paragraph join keeps the native CRDT text of each source paragraph alive.
// The editor addresses the resulting sequence using one logical UTF-16 offset.
import type { Backend } from './collab-runtime.js';
import { normalizeRuns, runsLength } from './text.js';

export const bodyText = (id: string) => JSON.stringify([id, 'text']);
type Join = { into: string; clock: number; actor: string };
type Part = { path: string; length: number };
export type TextBackend = Pick<
  Backend,
  'diffText' | 'ensureText' | 'runs' | 'splice' | 'format'
>;

export class JoinedText implements TextBackend {
  private groups = new Map<string, Part[]>();
  private owners = new Map<string, string>();
  readonly diffText: Backend['diffText'];
  constructor(
    private store: Backend,
    live: readonly string[]
  ) {
    this.diffText = store.diffText;
    const joins = store.read('joins') as Record<string, Join>;
    if (!Object.keys(joins).length) return;
    const visible = new Set(live),
      children = new Map<string, string[]>();
    for (const id of Object.keys(joins)) {
      if (visible.has(id)) continue;
      const dest = joins[id]!.into;
      const group = children.get(dest) ?? [];
      group.push(id);
      children.set(dest, group);
    }
    for (const group of children.values())
      group.sort((a, b) => {
        const x = joins[a]!,
          y = joins[b]!;
        return (
          x.clock - y.clock ||
          (x.actor < y.actor ? -1 : x.actor > y.actor ? 1 : a < b ? -1 : 1)
        );
      });
    for (const id of live) {
      if (!children.has(id)) continue;
      const parts: Part[] = [],
        pending = [id];
      while (pending.length) {
        const part = pending.pop()!,
          path = bodyText(part);
        parts.push({ path, length: runsLength(store.runs(path)) });
        this.owners.set(path, id);
        const following = children.get(part) ?? [];
        for (let i = following.length - 1; i >= 0; i--)
          pending.push(following[i]!);
      }
      this.groups.set(bodyText(id), parts);
    }
  }
  owner(path: string) {
    return this.owners.get(path);
  }
  ensureText(path: string) {
    this.store.ensureText(path);
  }
  runs(path: string) {
    const parts = this.groups.get(path);
    return parts
      ? normalizeRuns(parts.flatMap((p) => this.store.runs(p.path)))
      : this.store.runs(path);
  }
  at(path: string, offset: number, snapshot = false) {
    const parts = this.groups.get(path);
    if (parts)
      for (const part of parts) {
        const size = snapshot
          ? part.length
          : runsLength(this.store.runs(part.path));
        if (offset <= size || part === parts.at(-1))
          return { path: part.path, offset };
        offset -= size;
      }
    return { path, offset };
  }
  prefix(path: string, part: string, snapshot = false): number | null {
    let offset = 0;
    for (const entry of this.groups.get(path) ?? []) {
      if (entry.path === part) return offset;
      offset += snapshot
        ? entry.length
        : runsLength(this.store.runs(entry.path));
    }
    return path === part ? 0 : null;
  }
  private ranges(path: string, i: number, length: number) {
    const parts = this.groups.get(path);
    if (!parts) return [{ path, i, length }];
    const result = [];
    for (const part of parts) {
      const size = runsLength(this.store.runs(part.path)),
        take = Math.min(length, size - i);
      if (take > 0) {
        result.push({ path: part.path, i, length: take });
        length -= take;
      }
      if (!length) break;
      i = Math.max(0, i - size);
    }
    return result;
  }
  splice(path: string, i: number, n: number, text: string) {
    if (!this.groups.has(path)) {
      this.store.splice(path, i, n, text);
      return;
    }
    const anchor = this.at(path, i);
    for (const range of this.ranges(path, i, n).reverse())
      this.store.splice(range.path, range.i, range.length, '');
    if (text) this.store.splice(anchor.path, anchor.offset, 0, text);
  }
  format(path: string, i: number, n: number, name: string, value: unknown) {
    for (const range of this.ranges(path, i, n))
      this.store.format(range.path, range.i, range.length, name, value);
  }
  anchor(path: string, i: number, exact = false) {
    // An exact cursor identifies the character on its right, even at a join.
    const point = exact ? this.ranges(path, i, 1)[0] : undefined;
    const address = point
      ? { path: point.path, offset: point.i }
      : this.at(path, i);
    return {
      path: address.path,
      resolve: this.store.cursor(address.path, address.offset, exact),
    };
  }
}
