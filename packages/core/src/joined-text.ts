// Paragraph splits and joins retain the original native CRDT text.
// The editor addresses the resulting sequence using one logical UTF-16 offset.
import type { Backend } from './collab-runtime.js';
import { normalizeRuns, runsLength, sliceRuns } from './text.js';

export const bodyText = (id: string) => JSON.stringify([id, 'text']);
type Join = { into: string; clock: number; actor: string };
type Split = {
  from: string;
  path: string;
  token: string;
  clock: number;
  actor: string;
};
// A native cursor bounds a slice even when another replica edits its text.
type Part = {
  path: string;
  from?: string;
  to?: string;
  start: number;
  end: number;
};
const partFor = (id: string): Part => ({
  path: bodyText(id),
  start: 0,
  end: 0,
});
export type TextBackend = Pick<
  Backend,
  'diffText' | 'ensureText' | 'runs' | 'splice' | 'format'
>;

export class JoinedText implements TextBackend {
  private groups = new Map<string, Part[]>();
  private owners = new Map<string, Set<string>>();
  readonly diffText: Backend['diffText'];
  constructor(
    private store: Backend,
    live: readonly string[]
  ) {
    this.diffText = store.diffText;
    const joins = Object.entries(store.read('joins') as Record<string, Join>);
    const splits = Object.entries(
      store.read('splits') as Record<string, Split>
    );
    if (!joins.length && !splits.length) return;
    const visible = new Set(live);
    const layout = new Map<string, Part[]>();
    // Each end marker travels with its paragraph when it is joined. This
    // retains the insertion point for a concurrent join into that paragraph.
    const ends = new Map<string, Part>();
    const markers = new Set<Part>();
    const group = (id: string) => {
      let parts = layout.get(id);
      if (!parts) {
        const end = partFor(id);
        ends.set(id, end);
        markers.add(end);
        layout.set(id, (parts = [partFor(id), end]));
      }
      return parts;
    };
    // Replay structural operations in causal order. A later split can cut a
    // paragraph assembled from several joins, or a slice from an earlier split.
    const operations = [...joins, ...splits].sort(
      ([ai, a], [bi, b]) =>
        a.clock - b.clock ||
        (a.actor < b.actor
          ? -1
          : a.actor > b.actor
            ? 1
            : ai < bi
              ? -1
              : ai > bi
                ? 1
                : 0)
    );
    for (const [id, op] of operations) {
      if ('into' in op) {
        if (!visible.has(id) && id !== op.into) {
          const dest = group(op.into),
            end = ends.get(op.into)!;
          const target = dest.includes(end)
            ? dest
            : Array.from(layout.values()).find((parts) => parts.includes(end));
          const source = group(id);
          if (target && target !== source) {
            target.splice(target.indexOf(end), 0, ...source);
            layout.set(id, []);
          }
        }
        continue;
      }
      const cut = store.resolveBoundary(op.path, op.token);
      const contains = (part: Part) =>
        !markers.has(part) &&
        part.path === op.path &&
        cut >= this.start(part) &&
        cut <= this.end(part);
      let source = group(op.from);
      if (!source.some(contains)) {
        // Concurrent splits may have moved the cut into a sibling already.
        const moved = Array.from(layout.values()).find((parts) =>
          parts.some(contains)
        );
        if (!moved) continue;
        source = moved;
      }
      const index = source.findIndex(contains),
        part = source[index]!;
      const following = source.splice(index + 1, source.length - index - 2);
      const destination = group(id);
      destination.splice(
        destination.length - 1,
        0,
        { ...part, from: op.token },
        ...following
      );
      part.to = op.token;
    }
    for (const [id, parts] of layout) {
      if (!visible.has(id)) continue;
      const textParts = parts.filter((part) => !markers.has(part));
      this.groups.set(bodyText(id), textParts);
      for (const part of textParts) {
        part.start = this.start(part);
        part.end = this.end(part);
        let owners = this.owners.get(part.path);
        if (!owners) this.owners.set(part.path, (owners = new Set()));
        owners.add(id);
      }
    }
  }
  private start(p: Part) {
    return p.from === undefined
      ? 0
      : this.store.resolveBoundary(p.path, p.from);
  }
  private end(p: Part) {
    return p.to === undefined
      ? runsLength(this.store.runs(p.path))
      : this.store.resolveBoundary(p.path, p.to);
  }
  logical(path: string, offset: number, preferred: string, snapshot = false) {
    const owners = this.owners.get(path);
    if (!owners) return { blockId: JSON.parse(path)[0] as string, offset };
    for (const id of [preferred, ...owners]) {
      let prefix = 0;
      for (const part of this.groups.get(bodyText(id)) ?? []) {
        const start = snapshot ? part.start : this.start(part),
          end = snapshot ? part.end : this.end(part);
        if (part.path === path && start <= offset && offset <= end)
          return { blockId: id, offset: prefix + offset - start };
        prefix += end - start;
      }
    }
    return null;
  }
  ensureText(path: string) {
    this.store.ensureText(path);
  }
  runs(path: string) {
    const parts = this.groups.get(path);
    return parts
      ? normalizeRuns(
          parts.flatMap((p) => {
            const runs = this.store.runs(p.path);
            return p.from === undefined && p.to === undefined
              ? runs
              : sliceRuns(
                  runs,
                  this.start(p),
                  p.to === undefined ? Infinity : this.end(p)
                );
          })
        )
      : this.store.runs(path);
  }
  at(path: string, offset: number, snapshot = false) {
    const parts = this.groups.get(path);
    if (parts)
      for (const part of parts) {
        const start = snapshot ? part.start : this.start(part),
          size = (snapshot ? part.end : this.end(part)) - start;
        if (offset <= size || part === parts.at(-1))
          return { path: part.path, offset: start + offset };
        offset -= size;
      }
    return { path, offset };
  }
  private ranges(path: string, i: number, length: number) {
    const parts = this.groups.get(path);
    if (!parts) return [{ path, i, length }];
    const result = [];
    for (const part of parts) {
      const start = this.start(part),
        size = this.end(part) - start,
        take = Math.min(length, size - i);
      if (take > 0) {
        result.push({ path: part.path, i: start + i, length: take });
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
    // Logical slices can visit the same native text out of order. Descending
    // native offsets keep every remaining deletion valid within its own path.
    const ranges = this.ranges(path, i, n).sort((a, b) => b.i - a.i);
    for (const range of ranges) {
      this.store.splice(range.path, range.i, range.length, '');
      if (text && range.path === anchor.path && range.i < anchor.offset)
        anchor.offset -= Math.min(range.length, anchor.offset - range.i);
    }
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
