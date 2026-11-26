import * as A from '@automerge/automerge';
import type { Doc, InlineRun } from '@nobita/core';
import {
  SharedAdapter,
  type Backend,
  type PresenceChannel,
} from '@nobita/core/collab-runtime';

type State = {
  fields: Record<string, string>;
  lists: Record<string, string[]>;
  texts: Record<string, string>;
};
type Action = () => void;

class AutomergeBackend implements Backend {
  doc: A.Doc<State>;
  // Flat field identities avoid competing Automerge map creations on previously empty blocks.
  private names = new Map<string, Set<string>>();
  reindex() {
    this.names.clear();
    for (const path of Object.keys(this.doc.fields)) {
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
        const v = this.state.fields[JSON.stringify([k, n])];
        return v === undefined ? [] : [[n, JSON.parse(v)]];
      })
    );
  }
  field(k: string, n: string, v: unknown) {
    this.track(k, n);
    const path = JSON.stringify([k, n]),
      map = this.state.fields;
    const old = map[path],
      encoded = JSON.stringify(v);
    if (old === encoded) return;
    if (encoded === undefined) delete map[path];
    else map[path] = encoded;
    if (k !== 'clocks')
      this.recording.push(() => {
        if (this.state.fields[path] === encoded)
          this.field(k, n, old === undefined ? undefined : JSON.parse(old));
      });
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
    return A.spans(this.state, ['texts', k]).flatMap((s) =>
      s.type === 'text'
        ? [
            {
              text: s.value,
              ...(s.marks &&
                Object.keys(s.marks).length && {
                  marks: Object.fromEntries(
                    Object.entries(s.marks).map(([n, v]) => [
                      n,
                      JSON.parse(String(v)),
                    ])
                  ),
                }),
            },
          ]
        : []
    );
  }
  cursor(k: string, i: number) {
    if (this.state.texts[k] === undefined) return () => 0;
    const path = ['texts', k],
      c = A.getCursor(this.state, path, i);
    return () => A.getCursorPosition(this.state, path, c);
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
          for (const [name, value] of Object.entries(marks[j]!))
            this.format(k, pos, ch.length, name, JSON.parse(String(value)));
          pos += ch.length;
        });
      }
    });
  }
  format(k: string, i: number, n: number, name: string, v: unknown) {
    const path = ['texts', k],
      state = this.state,
      encoded = JSON.stringify(v);
    let offset = i;
    for (const ch of state.texts[k]!.slice(i, i + n)) {
      const cursor = A.getCursor(state, path, offset),
        previous = A.marksAt(state, path, offset)[name];
      this.recording.push(() => {
        const at = A.getCursorPosition(this.state, path, cursor);
        if (
          A.getCursor(this.state, path, at) === cursor &&
          A.marksAt(this.state, path, at)[name] === encoded
        )
          this.format(
            k,
            at,
            ch.length,
            name,
            previous === undefined ? undefined : JSON.parse(String(previous))
          );
      });
      offset += ch.length;
    }
    const range = { start: i, end: i + n, expand: 'none' as const };
    if (encoded === undefined) A.unmark(state, path, range, name);
    else A.mark(state, path, range, name, encoded);
  }
  private change(fn: Action) {
    const actions: Action[] = [];
    this.recording = actions;
    try {
      this.doc = A.change(this.doc, (d) => {
        this.draft = d;
        fn();
      });
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
    this.backend.reindex();
    if (!A.equals(old, merged)) this.received();
  }
}
