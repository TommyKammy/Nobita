import diffText from 'fast-diff';
import * as A from '@automerge/automerge';
import { normalizeRuns, type Doc, type InlineRun } from '@nobita/core';
import {
  SharedAdapter,
  type Backend,
  type OffsetMap,
  type PresenceChannel,
} from '@nobita/core/collab-runtime';

type State = {
  fields: Record<string, string>;
  lists: Record<string, string[]>;
  texts: Record<string, string>;
};
type Action = () => void;

// New writes include a unique identity, including deletions. Older snapshots contain bare JSON.
function payload(value: string | undefined) {
  if (value?.startsWith('@'))
    return value.slice(value.indexOf('|') + 1) || undefined;
  return value;
}

class AutomergeBackend implements Backend {
  readonly diffText = diffText;
  doc: A.Doc<State>;
  offsets: OffsetMap = (_, i) => i;
  captureOffsets(before: A.Doc<State>, after: A.Doc<State>) {
    this.offsets = (key, offset) => {
      const path = ['texts', key],
        old = before.texts[key],
        next = after.texts[key];
      if (next === undefined) return 0;
      if (old === undefined || offset >= old.length) return next.length;
      return A.getCursorPosition(
        after,
        path,
        A.getCursor(before, path, offset)
      );
    };
  }
  private sequence = 0;
  private markClock = 0;
  // Flat field identities avoid competing Automerge map creations on previously empty blocks.
  private names = new Map<string, Set<string>>();
  reindex() {
    this.names.clear();
    for (const path of Object.keys(this.doc.fields)) {
      if (path.startsWith('!clock:'))
        this.markClock = Math.max(
          this.markClock,
          Number(this.doc.fields[path])
        );
      if (path.startsWith('!')) continue;
      const [k, n] = JSON.parse(path) as [string, string];
      this.track(k, n);
    }
  }
  private track(k: string, n: string) {
    let group = this.names.get(k);
    if (!group) this.names.set(k, (group = new Set()));
    group.add(n);
  }
  private draft?: State;
  private recording: Action[] = [];
  private past: Action[][] = [];
  private future: Action[][] = [];
  constructor(bytes?: Uint8Array) {
    this.doc = bytes
      ? A.load<State>(bytes)
      : A.from<State>({ fields: {}, lists: {}, texts: {} });
    this.reindex();
  }
  get actor() {
    return A.getActorId(this.doc);
  }
  get state() {
    return this.draft ?? this.doc;
  }
  read(k: string) {
    return Object.fromEntries(
      Array.from(this.names.get(k) ?? []).flatMap((n) => {
        const v = payload(this.visibleField(JSON.stringify([k, n])));
        return v === undefined ? [] : [[n, JSON.parse(v)]];
      })
    );
  }
  field(k: string, n: string, v: unknown) {
    this.track(k, n);
    const path = JSON.stringify([k, n]),
      value = JSON.stringify(v);
    const previous = this.visibleField(path);
    if (payload(previous) === value) return;
    const token = `@${this.actor}:${++this.sequence}`;
    this.state.fields[path] = token + '|' + (value ?? '');
    if (k !== 'clocks')
      this.recording.push(() => this.toggleUndo('!' + token, previous ?? ''));
  }

  // Mask just this operation. Assigning to the register here would resolve *all*
  // concurrent writes, including those belonging to other actors.
  private toggleUndo(key: string, previous: string) {
    const fields = this.state.fields;
    if (fields[key] === undefined) fields[key] = previous;
    else delete fields[key];
    this.recording.push(() => this.toggleUndo(key, previous));
  }

  private visibleField(path: string) {
    const fields = this.state.fields;
    let winner = fields[path];
    const undone = (v: string | undefined) =>
      v?.startsWith('@') ? fields['!' + v.slice(0, v.indexOf('|'))] : undefined;
    if (undone(winner) === undefined) return winner;
    const conflicts = A.getConflicts(fields, path);
    if (conflicts) {
      // Match Automerge's register ordering among the still-active operations.
      let bestCounter = -1,
        bestActor = '',
        best: string | undefined;
      for (const [id, raw] of Object.entries(conflicts)) {
        if (typeof raw !== 'string' || undone(raw) !== undefined) continue;
        const split = id.indexOf('@'),
          counter = Number(id.slice(0, split)),
          actor = id.slice(split + 1);
        if (
          counter > bestCounter ||
          (counter === bestCounter && actor > bestActor)
        ) {
          bestCounter = counter;
          bestActor = actor;
          best = raw;
        }
      }
      if (best !== undefined) return best;
    }
    let predecessor = undone(winner);
    while (predecessor !== undefined) {
      winner = predecessor || undefined;
      predecessor = undone(winner);
    }
    return winner;
  }
  ensureList(k: string) {
    this.state.lists[k] ??= [];
  }
  list(k: string) {
    return [...(this.state.lists[k] ?? [])];
  }
  insert(k: string, i: number, v: string) {
    this.state.lists[k] ??= [];
    const a = this.state.lists[k]!;
    a.splice(i, 0, v);
    this.recording.push(() => {
      const list = this.state.lists[k]!,
        at = list.indexOf(v);
      if (at < 0) return;
      const following = list[at + 1];
      list.splice(at, 1);
      this.recording.push(() => {
        const arr = this.state.lists[k]!,
          index = following === undefined ? -1 : arr.indexOf(following);
        this.insert(k, index < 0 ? arr.length : index, v);
      });
    });
  }
  ensureText(k: string) {
    if (this.state.texts[k] === undefined) this.state.texts[k] = '';
  }
  runs(k: string): InlineRun[] {
    if (!this.state.texts[k]) return [];
    const runs: InlineRun[] = [];
    for (const span of A.spans(this.state, ['texts', k])) {
      if (span.type !== 'text') continue;
      const marks: Record<string, unknown> = {};
      const latest = new Map<string, { clock: number; actor: string }>();
      for (const [id, raw] of Object.entries(span.marks ?? {})) {
        if (!id.startsWith('@')) {
          // Native marks from older snapshots form the base layer.
          if (!latest.has(id)) marks[id] = JSON.parse(String(raw));
          continue;
        }
        if (this.state.fields['!' + id] !== undefined) continue;
        const [clock, actor, name] = JSON.parse(id.slice(1)) as [
          number,
          string,
          string,
        ];
        const winner = latest.get(name);
        if (
          winner &&
          (winner.clock > clock ||
            (winner.clock === clock && winner.actor >= actor))
        )
          continue;
        latest.set(name, { clock, actor });
        if (raw === '') delete marks[name];
        else marks[name] = JSON.parse(String(raw));
      }
      runs.push({ text: span.value, marks });
    }
    return normalizeRuns(runs);
  }
  cursor(k: string, i: number): () => number;
  cursor(k: string, i: number, exact: boolean): () => number | null;
  cursor(k: string, i: number, exact = false) {
    if (this.state.texts[k] === undefined) return () => (exact ? null : 0);
    const path = ['texts', k],
      c = A.getCursor(this.state, path, i);
    return () => {
      const at = A.getCursorPosition(this.state, path, c);
      return exact && A.getCursor(this.state, path, at) !== c ? null : at;
    };
  }
  splice(k: string, i: number, n: number, v: string) {
    this.ensureText(k);
    const path = ['texts', k],
      state = this.state,
      old = state.texts[k]!.slice(i, i + n);
    let markOffset = i;
    const marks = Array.from(old, (ch) => {
      const m = A.marksAt(state, path, markOffset);
      markOffset += ch.length;
      return m;
    });
    const after = this.cursor(k, i + n);
    A.splice(state, path, i, n, v);
    let offset = i;
    const added = Array.from(v, (ch) => {
      const c = A.getCursor(state, path, offset);
      offset += ch.length;
      return { c, length: ch.length };
    });
    this.recording.push(() => {
      for (const { c, length } of added.reverse()) {
        const at = A.getCursorPosition(this.state, path, c);
        if (A.getCursor(this.state, path, at) === c)
          this.splice(k, at, length, '');
      }
      if (old) {
        let pos = after();
        this.splice(k, pos, 0, old);
        Array.from(old).forEach((ch, j) => {
          // Restore the original native marks, including their operation identities.
          const range = {
            start: pos,
            end: pos + ch.length,
            expand: 'none' as const,
          };
          const inherited = A.marksAt(this.state, path, pos),
            saved = marks[j]!;
          for (const name of Object.keys(inherited))
            if (!(name in saved)) A.unmark(this.state, path, range, name);
          for (const [name, value] of Object.entries(saved))
            if (value !== inherited[name])
              A.mark(this.state, path, range, name, value);
          pos += ch.length;
        });
      }
    });
  }
  format(k: string, i: number, n: number, name: string, v: unknown) {
    if (!n) return;
    // Each operation has its own native Peritext range. Undo masks that
    // operation only; overlapping peer marks remain on their original ranges.
    const actor = this.actor,
      clock = ++this.markClock;
    this.state.fields['!clock:' + actor] = String(clock);
    const id = '@' + JSON.stringify([clock, actor, name]);
    A.mark(
      this.state,
      ['texts', k],
      { start: i, end: i + n, expand: 'none' },
      id,
      JSON.stringify(v) ?? ''
    );
    this.recording.push(() => this.toggleUndo('!' + id, ''));
  }
  private change(fn: Action) {
    const actions: Action[] = [];
    this.recording = actions;
    try {
      const before = this.doc;
      this.doc = A.change(this.doc, (d) => {
        this.draft = d;
        fn();
      });
      this.captureOffsets(before, this.doc);
    } finally {
      delete this.draft;
      this.recording = [];
    }
    return actions;
  }
  transact(fn: Action) {
    const actions = this.change(fn);
    if (actions.length) {
      this.past.push(actions);
      this.future = [];
    }
  }
  get canUndo() {
    return !!this.past.length;
  }
  get canRedo() {
    return !!this.future.length;
  }
  private replay(from: Action[][], to: Action[][]) {
    const a = from.pop();
    if (!a) return false;
    to.push(
      this.change(() => {
        for (const fn of a.reverse()) fn();
      })
    );
    return true;
  }
  undo() {
    return this.replay(this.past, this.future);
  }
  redo() {
    return this.replay(this.future, this.past);
  }
  clearHistory() {
    this.past = [];
    this.future = [];
  }
}

/** Seed once, then create additional replicas from save(). Transport is host-owned. */
export class AutomergeCollaborationAdapter extends SharedAdapter {
  private backend: AutomergeBackend;
  constructor(initial: Doc | Uint8Array, presence?: PresenceChannel) {
    const backend = new AutomergeBackend(
      initial instanceof Uint8Array ? initial : undefined
    );
    super(
      backend,
      initial instanceof Uint8Array ? undefined : initial,
      presence
    );
    this.backend = backend;
  }
  save() {
    return A.save(this.backend.doc);
  }
  receive(bytes: Uint8Array) {
    const old = this.backend.doc;
    const merged = A.merge(old, A.load<State>(bytes));
    this.backend.doc = merged;
    this.backend.captureOffsets(old, merged);
    this.backend.reindex();
    if (!A.equals(old, merged)) this.received();
  }
}
