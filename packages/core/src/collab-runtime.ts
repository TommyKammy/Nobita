// Shared by the optional CRDT packages. This entry point is separate from the editor.
import {
  diffDocs,
  type CollaborationAdapter,
  type CompositionTarget,
  type DocPatch,
  type PeerPresence,
  type RemoteDocUpdate,
} from './collab.js';
import { BOOLEAN_MARK_KEYS } from './types.js';
import { marksAt, plainText } from './text.js';
import type {
  Block,
  DatabaseData,
  DatabaseRow,
  Doc,
  DocChange,
  InlineMark,
  InlineRun,
  TableData,
} from './types.js';

export type Fields = Record<string, unknown>;
export type OffsetMap = (key: string, offset: number) => number;
export interface Backend {
  offsets: OffsetMap;
  diffText(
    previous: string,
    next: string
  ): readonly (readonly [-1 | 0 | 1, string])[];
  actor: string;
  read(key: string): Fields;
  field(key: string, name: string, value: unknown): void;
  ensureList(key: string): void;
  list(key: string): string[];
  insert(key: string, index: number, value: string): void;
  ensureText(key: string): void;
  runs(key: string): InlineRun[];
  splice(key: string, index: number, count: number, text: string): void;
  format(
    key: string,
    index: number,
    length: number,
    name: string,
    value: unknown
  ): void;
  cursor(key: string, index: number, exact?: boolean): () => number | null;
  transact(fn: () => void): void;
  undo(): boolean;
  redo(): boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  clearHistory(): void;
}
export interface PresenceChannel {
  user?: PeerPresence['user'];
  publish(value: Omit<PeerPresence, 'clientId'> | null): void;
  subscribe(listener: (peers: readonly PeerPresence[]) => void): () => void;
}
const key = (...path: string[]) => JSON.stringify(path);
const equal = (a: unknown, b: unknown) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);
function fields(store: Backend, path: string, before: Fields, next: Fields) {
  for (const name of new Set([...Object.keys(before), ...Object.keys(next)]))
    if (!equal(before[name], next[name])) store.field(path, name, next[name]);
}
function writeText(
  store: Backend,
  path: string,
  before: InlineRun[],
  next: InlineRun[]
) {
  store.ensureText(path);
  let offset = 0;
  for (const [op, text] of store.diffText(plainText(before), plainText(next))) {
    if (op === -1) store.splice(path, offset, text.length, '');
    else {
      if (op === 1) store.splice(path, offset, 0, text);
      offset += text.length;
    }
  }
  // Align existing and desired mark spans without replacing unchanged characters.
  const actual = store.runs(path);
  let pos = 0,
    ai = 0,
    used = 0;
  for (const run of next) {
    let left = run.text.length;
    while (left > 0 && ai < actual.length) {
      const span = actual[ai]!,
        n = Math.min(left, span.text.length - used);
      for (const k of new Set([
        ...Object.keys(span.marks ?? {}),
        ...Object.keys(run.marks ?? {}),
      ]) as Set<keyof InlineMark>)
        if (!equal(span.marks?.[k], run.marks?.[k]))
          store.format(path, pos, n, k, run.marks?.[k]);
      pos += n;
      left -= n;
      used += n;
      if (used === span.text.length) {
        ai++;
        used = 0;
      }
    }
  }
}
function gridText(cell?: Fields): InlineRun[] {
  return (
    (cell?.runs as InlineRun[] | undefined) ??
    (cell?.text ? [{ text: String(cell.text) }] : [])
  );
}
type Grid = TableData | DatabaseData;
function ids(store: Backend, path: string) {
  // Entries are immutable. Only the newest position for a given ID is visible.
  const entries = store
    .list(path)
    .map((s) => JSON.parse(s) as [string, number, string]);
  const winner = new Map<string, (typeof entries)[number]>();
  for (const e of entries) {
    const w = winner.get(e[0]);
    if (!w || e[1] > w[1] || (e[1] === w[1] && e[2] > w[2]))
      winner.set(e[0], e);
  }
  return entries.flatMap((e, i) =>
    winner.get(e[0]) === e ? [{ id: e[0], index: i }] : []
  );
}
function place(
  store: Backend,
  path: string,
  id: string,
  following: string | undefined,
  clock: number,
  previous?: { id: string; index: number }
) {
  const index =
    previous && previous.id === following
      ? previous.index
      : following === undefined
        ? undefined
        : ids(store, path).find((e) => e.id === following)?.index;
  const at = index ?? store.list(path).length;
  store.insert(path, at, JSON.stringify([id, clock, store.actor]));
  return { id, index: at };
}
function writeGrid(
  store: Backend,
  id: string,
  kind: 'table' | 'database',
  before: Grid | undefined,
  next: Grid | undefined,
  clock: number
) {
  const base = key(id, kind);
  if (!!before !== !!next)
    store.field(key(id, 'grids'), kind, next ? true : undefined);
  if (!next) return;
  const { rows, columns, ...meta } = next;
  if (!before) {
    store.ensureList(key(id, kind, 'columns'));
    store.ensureList(key(id, kind, 'rows'));
  }
  if (!before || before.rows !== rows || before.columns !== columns) {
    const priorRows = new Set(before?.rows.map((r) => r.id)),
      priorColumns = new Set(before?.columns.map((c) => c.id));
    const newColumns = columns.filter((c) => !priorColumns.has(c.id));
    for (const row of rows)
      for (const col of priorRows.has(row.id) ? newColumns : columns)
        store.ensureText(key(id, kind, row.id, col.id));
  }
  const {
    rows: oldRows = [],
    columns: oldColumns = [],
    ...prev
  } = before ?? {};
  fields(store, base, prev, meta);
  function order(
    axis: string,
    a: readonly { id: string }[],
    b: readonly { id: string }[]
  ) {
    if (
      a === b ||
      (a.length === b.length && a.every((v, i) => v.id === b[i]!.id))
    )
      return;
    const nextIds = new Set(b.map((x) => x.id)),
      oldIds = new Set(a.map((x) => x.id));
    if (a.length === 0 && store.list(key(id, kind, axis)).length === 0) {
      const path = key(id, kind, axis),
        active = key(id, kind, axis, 'active');
      b.forEach((item, i) => {
        store.insert(path, i, JSON.stringify([item.id, clock, store.actor]));
        store.field(active, item.id, true);
      });
      return;
    }
    const oldOrder = a.map((x) => x.id).filter((x) => nextIds.has(x));
    for (let i = b.length - 1; i >= 0; i--) {
      const item = b[i]!,
        at = oldOrder.indexOf(item.id),
        following = b[i + 1]?.id;
      if (at >= 0 && oldOrder[at + 1] === following) continue;
      if (at >= 0) oldOrder.splice(at, 1);
      oldOrder.splice(
        following === undefined ? oldOrder.length : oldOrder.indexOf(following),
        0,
        item.id
      );
      place(store, key(id, kind, axis), item.id, following, clock);
    }
    const active = key(id, kind, axis, 'active');
    for (const x of nextIds) if (!oldIds.has(x)) store.field(active, x, true);
    for (const x of oldIds)
      if (!nextIds.has(x)) store.field(active, x, undefined);
  }
  order('columns', oldColumns, columns);
  order('rows', oldRows, rows);
  const oldCols = new Map(oldColumns.map((c) => [c.id, c]));
  for (const c of columns)
    if (c !== oldCols.get(c.id))
      fields(
        store,
        key(id, kind, 'col', c.id),
        { ...oldCols.get(c.id) },
        { ...c }
      );
  const oldById = new Map(oldRows.map((r) => [r.id, r]));
  for (const row of rows) {
    const old = oldById.get(row.id);
    if (row === old) continue;
    const { cells, page, ...props }: DatabaseRow = row;
    const {
      cells: oldCells = {},
      page: oldPage,
      ...oldProps
    }: Partial<DatabaseRow> = old ?? {};
    const rowPath = key(id, kind, 'row', row.id);
    fields(store, rowPath, oldProps, props);
    if (kind === 'database' && (!old || page !== oldPage)) {
      const contentPath = key(id, 'recordPage', row.id);
      store.ensureText(contentPath);
      if (page || oldPage) {
        // Older replicas stored the whole page in the row field. Seed the text
        // from its actual backend contents when the page is first edited.
        writeText(
          store,
          contentPath,
          store.runs(contentPath),
          page?.content ?? []
        );
        if (!oldPage || !page || store.read(rowPath).page !== true)
          store.field(rowPath, 'page', page ? true : undefined);
      }
    }
    for (const col of new Set([
      ...Object.keys(cells),
      ...Object.keys(oldCells),
    ])) {
      const c = cells[col],
        previous = oldCells[col];
      if (c === previous) continue;
      const path = key(id, kind, row.id, col);
      const { text, runs, ...attrs } = c ?? {},
        { text: ot, runs: or, ...oa } = previous ?? {};
      fields(store, path, oa, attrs);
      if (typeof text !== typeof ot)
        store.field(path, 'hasText', text !== undefined || undefined);
      if (Boolean(runs) !== Boolean(or))
        store.field(path, 'hasRuns', runs ? true : undefined);
      if (!previous || !equal(text, ot) || !equal(runs, or))
        writeText(
          store,
          path,
          gridText(previous as Fields),
          gridText(c as Fields)
        );
    }
  }
}
function readGrid(store: Backend, id: string, kind: string): Grid {
  const axis = (name: string) => {
    const active = store.read(key(id, kind, name, 'active'));
    return ids(store, key(id, kind, name))
      .map((e) => e.id)
      .filter((x) => active[x]);
  };
  const columns = axis('columns').map((c) => ({
    ...store.read(key(id, kind, 'col', c)),
    id: c,
  }));
  const rows = axis('rows').map((r) => {
    const cells: Fields = Object.create(null);
    for (const c of columns) {
      const path = key(id, kind, r, c.id),
        { hasText, hasRuns, ...attrs } = store.read(path);
      const runs = store.runs(path);
      if (hasText || hasRuns || runs.length || Object.keys(attrs).length)
        cells[c.id] = {
          ...attrs,
          ...((hasText || runs.length) && { text: plainText(runs) }),
          ...((hasRuns || runs.some((x) => x.marks)) && { runs }),
        };
    }
    const { page, ...props } = store.read(key(id, kind, 'row', r));
    const content =
      kind === 'database' ? store.runs(key(id, 'recordPage', r)) : [];
    return {
      ...props,
      ...(page === true || content.length
        ? { page: { content } }
        : page
          ? { page }
          : {}),
      id: r,
      cells,
    };
  });
  return { ...store.read(key(id, kind)), rows, columns } as Grid;
}
const bodyText = (id: string) => key(id, 'text');
type Location = { parent: string | null; clock: number; actor: string };
export class SharedAdapter implements CollaborationAdapter {
  #listeners = new Set<(u: RemoteDocUpdate) => void>();
  #snapshot: Doc;
  #composition:
    | {
        target: CompositionTarget;
        path: string;
        start: () => number | null;
        selected: { offset: () => number | null; length: number }[];
      }
    | undefined;
  constructor(
    protected store: Backend,
    seed?: Doc,
    private presence?: PresenceChannel
  ) {
    if (!store.read('doc').id) {
      if (!seed)
        throw new Error(
          'Initialize one shared document before connecting peers'
        );
      const empty: Doc = { id: seed.id, version: 1, title: '', blocks: [] };
      store.transact(() => {
        store.ensureList(key('children', 'root', ''));
        store.field('doc', 'id', seed.id);
        this.#write(seed, diffDocs(empty, seed));
      });
      store.clearHistory();
    }
    this.#snapshot = this.#read();
  }
  getDoc() {
    return this.#snapshot;
  }
  #write(doc: Doc, patches: readonly DocPatch[]) {
    const s = this.store,
      clock = 1 + Math.max(0, ...Object.values(s.read('clocks')).map(Number));
    const placements: {
      blockId: string;
      parentId: string | null;
      index: number;
    }[] = [];
    for (const p of patches) {
      if (p.type === 'setTitle') {
        s.field('doc', 'title', p.title);
        continue;
      }
      if (p.type === 'setIcon') {
        s.field('doc', 'icon', p.icon);
        continue;
      }
      const id = p.type === 'insertBlock' ? p.block.id : p.blockId;
      const props = (v: Block['props']) => {
        const { table, database, ...other } = v;
        fields(s, key(id, 'props'), s.read(key(id, 'props')), other);
        if (table || s.read(key(id, 'grids')).table)
          writeGrid(
            s,
            id,
            'table',
            s.read(key(id, 'grids')).table
              ? (readGrid(s, id, 'table') as TableData)
              : undefined,
            table,
            clock
          );
        if (database || s.read(key(id, 'grids')).database)
          writeGrid(
            s,
            id,
            'database',
            s.read(key(id, 'grids')).database
              ? (readGrid(s, id, 'database') as DatabaseData)
              : undefined,
            database,
            clock
          );
      };
      switch (p.type) {
        case 'insertBlock':
          s.ensureList(key('children', 'block', id));
          s.field('types', id, p.block.type);
          props(p.block.props);
          writeText(s, bodyText(id), s.runs(bodyText(id)), p.block.text);
          placements.push({ ...p, blockId: id });
          break;
        case 'deleteBlock':
          s.field('types', id, undefined);
          break;
        case 'moveBlock':
          placements.push(p);
          break;
        case 'replaceBlockText':
          writeText(s, bodyText(id), p.previous, p.next);
          break;
        case 'setBlockType':
          s.field('types', id, p.blockType);
          props(p.props);
          break;
        case 'updateBlockProps':
          for (const [k, v] of Object.entries(p.patch))
            s.field(key(id, 'props'), k, v);
          break;
        case 'updateDatabase':
          writeGrid(s, id, 'database', p.previous, p.next, clock);
          break;
        case 'updateTable':
          writeGrid(s, id, 'table', p.previous, p.next, clock);
          break;
      }
    }
    if (placements.length) {
      const parents = new Map<string | null, Block[]>([[null, doc.blocks]]);
      const visit = (blocks: Block[]) => {
        for (const b of blocks)
          if (b.children.length) {
            parents.set(b.id, b.children);
            visit(b.children);
          }
      };
      visit(doc.blocks);
      const lastInsert = new Map<
        string | null,
        { id: string; index: number }
      >();
      for (const p of placements.sort((a, b) => b.index - a.index)) {
        const parent = p.parentId,
          following = parents.get(parent)?.[p.index + 1]?.id;
        const location: Location = { parent, clock, actor: s.actor };
        s.field(key('locations', p.blockId), s.actor, location);
        lastInsert.set(
          parent,
          place(
            s,
            key('children', parent === null ? 'root' : 'block', parent ?? ''),
            p.blockId,
            following,
            clock,
            lastInsert.get(parent)
          )
        );
      }
    }
    s.field('clocks', s.actor, clock);
  }
  #read(): Doc {
    const s = this.store,
      meta = s.read('doc'),
      types = s.read('types');
    const live = Object.keys(types).sort(),
      parents = new Map<string, string | null>();
    for (const id of live) {
      const choices = Object.values(s.read(key('locations', id))) as Location[];
      const win = choices.reduce<Location | undefined>(
        (a, b) =>
          !a || b.clock > a.clock || (b.clock === a.clock && b.actor > a.actor)
            ? b
            : a,
        undefined
      );
      parents.set(
        id,
        win?.parent && Object.hasOwn(types, win.parent) ? win.parent : null
      );
    }
    // Concurrent ancestor moves may form a cycle. Detach its lowest ID on every replica.
    const done = new Set<string>();
    for (const id of live) {
      const path = new Set<string>();
      let node: string | null = id;
      while (node !== null && !done.has(node)) {
        if (path.has(node)) {
          const cycle = [...path].slice([...path].indexOf(node));
          parents.set(cycle.sort()[0]!, null);
          break;
        }
        path.add(node);
        node = parents.get(node) ?? null;
      }
      for (const n of path) done.add(n);
    }
    const groups = new Map<string | null, string[]>();
    for (const [id, parent] of parents) {
      const group = groups.get(parent) ?? [];
      group.push(id);
      groups.set(parent, group);
    }
    const children = (parent: string | null): Block[] => {
      const group = groups.get(parent);
      if (!group) return [];
      const missing = new Set(group),
        ordered = ids(
          s,
          key('children', parent === null ? 'root' : 'block', parent ?? '')
        ).flatMap((e) => (missing.delete(e.id) ? [e.id] : []));
      return [...ordered, ...missing].map((id) => {
        const props = s.read(key(id, 'props')),
          grids = s.read(key(id, 'grids'));
        for (const kind of Object.keys(grids))
          props[kind] = readGrid(s, id, kind);
        return {
          id,
          type: types[id] as Block['type'],
          props,
          text: s.runs(bodyText(id)),
          children: children(id),
        };
      });
    };
    return {
      version: 1,
      id: String(meta.id),
      title: String(meta.title ?? ''),
      ...(meta.icon !== undefined && { icon: String(meta.icon) }),
      blocks: children(null),
    };
  }
  applyLocalChange(change: DocChange, patches: readonly DocPatch[]) {
    if (patches.length)
      this.store.transact(() => this.#write(change.doc, patches));
    this.#snapshot = this.#read();
  }
  protected received(history?: RemoteDocUpdate['history']) {
    const offsets = this.store.offsets;
    this.#snapshot = this.#read();
    const doc = this.#snapshot;
    const update: RemoteDocUpdate = {
      doc,
      ...(history && { history }),
      remapPoint: (p) =>
        find(doc.blocks, p.blockId)
          ? { ...p, offset: offsets(bodyText(p.blockId), p.offset) }
          : null,
      remapCellOffset: (id, row, col, i) => {
        const b = find(doc.blocks, id),
          grid = b?.props.table ?? b?.props.database;
        if (
          !grid?.rows.some((r) => r.id === row) ||
          !grid.columns.some((c) => c.id === col)
        )
          return null;
        return offsets(
          key(id, b?.props.table ? 'table' : 'database', row, col),
          i
        );
      },
    };
    for (const fn of this.#listeners) fn(update);
  }
  subscribe(fn: (u: RemoteDocUpdate) => void) {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }
  get canUndo() {
    return this.store.canUndo;
  }
  get canRedo() {
    return this.store.canRedo;
  }
  undo() {
    if (!this.store.undo()) return false;
    this.received('undo');
    return true;
  }
  redo() {
    if (!this.store.redo()) return false;
    this.received('redo');
    return true;
  }
  beginComposition(target: CompositionTarget) {
    const block = find(this.#snapshot.blocks, target.blockId);
    const path =
      target.rowId === undefined
        ? bodyText(target.blockId)
        : target.columnId === undefined
          ? key(target.blockId, 'recordPage', target.rowId)
          : key(
              target.blockId,
              block?.type === 'table' ? 'table' : 'database',
              target.rowId,
              target.columnId
            );
    let i = target.from;
    const selected =
      target.from === target.to
        ? []
        : Array.from(
            plainText(this.store.runs(path)).slice(target.from, target.to),
            (ch) => {
              const offset = this.store.cursor(path, i, true);
              i += ch.length;
              return { offset, length: ch.length };
            }
          );
    this.#composition = {
      target,
      path,
      start: this.store.cursor(path, target.from),
      selected,
    };
  }
  commitComposition(text: string): RemoteDocUpdate {
    const comp = this.#composition;
    this.#composition = undefined;
    if (!comp) return { doc: this.#snapshot };
    const start = comp.start();
    const block = find(this.#snapshot.blocks, comp.target.blockId);
    if (start === null || !block) return { doc: this.#snapshot };
    if (comp.target.rowId !== undefined) {
      const grid = block.props.table ?? block.props.database,
        { rowId, columnId } = comp.target;
      if (
        !grid?.rows.some((r) => r.id === rowId) ||
        (columnId !== undefined
          ? !grid.columns.some((c) => c.id === columnId)
          : !block.props.database)
      )
        return { doc: this.#snapshot };
    }
    const ranges: { start: number; length: number }[] = [];
    for (const char of comp.selected) {
      const at = char.offset();
      if (at === null) continue;
      const last = ranges.at(-1);
      if (last && last.start + last.length === at) last.length += char.length;
      else ranges.push({ start: at, length: char.length });
    }
    let from = start;
    this.store.transact(() => {
      for (const range of ranges.reverse()) {
        this.store.splice(comp.path, range.start, range.length, '');
        from -= Math.max(0, Math.min(range.length, from - range.start));
      }
      this.store.splice(comp.path, from, 0, text);
      if (!text.length) return;
      const inherited = marksAt(this.store.runs(comp.path), from + text.length);
      for (const mark of ['mention', 'page'] as const)
        if (inherited?.[mark])
          this.store.format(comp.path, from, text.length, mark, undefined);
      if (comp.target.pendingMarks)
        for (const name of BOOLEAN_MARK_KEYS)
          this.store.format(
            comp.path,
            from,
            text.length,
            name,
            comp.target.pendingMarks[name]
          );
    });
    this.#snapshot = this.#read();
    return {
      doc: this.#snapshot,
      remapPoint: () => ({
        blockId: comp.target.blockId,
        offset: from + text.length,
      }),
    };
  }
  cancelComposition(): RemoteDocUpdate {
    this.#composition = undefined;
    return { doc: this.#snapshot };
  }
  setLocalPresence(p: Omit<PeerPresence, 'clientId'> | null) {
    this.presence?.publish(
      p && this.presence.user ? { ...p, user: this.presence.user } : p
    );
  }
  subscribePresence(fn: (peers: readonly PeerPresence[]) => void) {
    return this.presence?.subscribe(fn) ?? (() => {});
  }
  destroy() {
    this.#listeners.clear();
    this.#composition = undefined;
    this.presence?.publish(null);
  }
}
function find(blocks: Block[], id: string): Block | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    const child = find(b.children, id);
    if (child) return child;
  }
}
