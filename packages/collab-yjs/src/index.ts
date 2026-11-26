import diffText from 'fast-diff';
import * as Y from 'yjs';
import type { Doc, InlineRun, PeerPresence } from '@nobita/core';
import {
  SharedAdapter,
  type Backend,
  type HistorySelection,
  type OffsetMap,
  type PresenceChannel,
} from '@nobita/core/collab-runtime';

const selectionKey = Symbol();
class YBackend implements Backend {
  readonly diffText = diffText;
  offsets: OffsetMap = (_, i) => i;
  captureOffsets(tx: Y.Transaction) {
    const deltas = new Map<Y.Text, Y.YTextEvent['delta']>();
    for (const events of tx.changedParentTypes.values())
      for (const event of events) {
        if (event instanceof Y.YTextEvent)
          deltas.set(event.target, event.delta);
      }
    this.offsets = (key, offset) => {
      let old = 0,
        next = 0;
      for (const op of deltas.get(this.text(key)) ?? []) {
        if (op.retain) {
          if (offset < old + op.retain) return next + offset - old;
          old += op.retain;
          next += op.retain;
        }
        if (op.insert)
          next += typeof op.insert === 'string' ? op.insert.length : 1;
        if (op.delete) {
          if (offset < old + op.delete) return next;
          old += op.delete;
        }
      }
      return next + offset - old;
    };
  }
  readonly origin = {};
  readonly history: Y.UndoManager;
  constructor(readonly doc: Y.Doc) {
    const layout = this.map('splitLayout'),
      upgrades = this.map('splitUpgrades');
    this.history = new Y.UndoManager(doc, {
      trackedOrigins: new Set([this.origin]),
      captureTimeout: 0,
      deleteFilter: (item) =>
        item.parent !== layout &&
        item.parent !== upgrades &&
        !(
          item.content instanceof Y.ContentEmbed &&
          (item.content.embed as { nobitaSplit?: boolean } | null)
            ?.nobitaSplit === true
        ),
    });
  }
  get actor() {
    return String(this.doc.clientID);
  }
  map(k: string) {
    return this.doc.getMap('nobita:m:' + k);
  }
  array(k: string) {
    return this.doc.getArray<string>('nobita:a:' + k);
  }
  text(k: string) {
    return this.doc.getText('nobita:t:' + k);
  }
  read(k: string) {
    return Object.fromEntries(this.map(k));
  }
  field(k: string, n: string, v: unknown) {
    if (v === undefined) this.map(k).delete(n);
    else this.map(k).set(n, v);
  }
  ensureList(k: string) {
    this.array(k);
  }
  list(k: string) {
    return this.array(k).toArray();
  }
  insert(k: string, i: number, v: string) {
    this.array(k).insert(i, [v]);
  }
  ensureText(k: string) {
    this.text(k);
  }
  textLength(k: string) {
    return this.text(k).length;
  }
  runs(k: string): InlineRun[] {
    return this.text(k)
      .toDelta()
      .map((d: { insert: string; attributes?: InlineRun['marks'] }) => ({
        text: typeof d.insert === 'string' ? d.insert : '\uFFFC',
        ...(d.attributes && { marks: d.attributes }),
      }));
  }
  splice(k: string, i: number, n: number, v: string) {
    const t = this.text(k);
    if (n) t.delete(i, n);
    if (v) t.insert(i, v);
  }
  format(k: string, i: number, n: number, name: string, v: unknown) {
    this.text(k).format(i, n, { [name]: v ?? null });
  }
  insertSplitMarker(k: string, i: number) {
    this.text(k).insertEmbed(i, { nobitaSplit: true });
    return JSON.stringify(
      Y.createRelativePositionFromTypeIndex(this.text(k), i)
    );
  }
  resolveBoundary(_k: string, token: string) {
    return (
      Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(JSON.parse(token)),
        this.doc
      )?.index ?? 0
    );
  }
  cursor(k: string, i: number, exact = false) {
    const p = Y.createRelativePositionFromTypeIndex(this.text(k), i);
    return () => {
      const at = Y.createAbsolutePositionFromRelativePosition(
        p,
        this.doc
      )?.index;
      if (
        at === undefined ||
        (exact &&
          !Y.compareRelativePositions(
            p,
            Y.createRelativePositionFromTypeIndex(this.text(k), at)
          ))
      )
        return null;
      return at;
    };
  }
  transact(fn: () => void, selection?: HistorySelection) {
    const previous = this.history.undoStack.at(-1);
    this.doc.transact(fn, this.origin);
    const entry = this.history.undoStack.at(-1);
    if (selection && entry && entry !== previous)
      entry.meta.set(selectionKey, selection);
  }
  get canUndo() {
    return this.history.canUndo();
  }
  get canRedo() {
    return this.history.canRedo();
  }
  private replay(direction: 'undo' | 'redo') {
    const entry = this.history[direction]();
    if (!entry) return false;
    const selection = entry.meta.get(selectionKey) as
      HistorySelection | undefined;
    const inverse = (
      direction === 'undo' ? this.history.redoStack : this.history.undoStack
    ).at(-1);
    if (selection && inverse) inverse.meta.set(selectionKey, selection);
    return selection ?? true;
  }
  undo() {
    return this.replay('undo');
  }
  redo() {
    return this.replay('redo');
  }
  clearHistory() {
    this.history.clear();
  }
}

export class YjsCollaborationAdapter extends SharedAdapter {
  #off: () => void;
  constructor(doc: Y.Doc, seed?: Doc, presence?: PresenceChannel) {
    const backend = new YBackend(doc);
    super(backend, seed, presence);
    const listener = (tx: Y.Transaction) => {
      if (!tx.changed.size || tx.origin === backend.origin) return;
      backend.captureOffsets(tx);
      if (tx.origin !== backend.history) this.received();
    };
    doc.on('afterTransaction', listener);
    this.#off = () => {
      doc.off('afterTransaction', listener);
      backend.history.destroy();
    };
  }
  override destroy() {
    this.#off();
    super.destroy();
  }
}

/** Bind a y-protocols Awareness instance without taking ownership of its transport. */
export function awarenessPresence(
  awareness: {
    clientID: number;
    setLocalStateField(field: string, value: unknown): void;
    getStates(): Map<number, Record<string, unknown>>;
    on(event: 'change', fn: () => void): void;
    off(event: 'change', fn: () => void): void;
  },
  user?: PeerPresence['user']
): PresenceChannel {
  return {
    ...(user && { user }),
    publish: (p) => awareness.setLocalStateField('nobita', p),
    subscribe: (fn) => {
      const refresh = () =>
        fn(
          [...awareness.getStates()].flatMap(([id, state]) =>
            id !== awareness.clientID && state.nobita
              ? [{ ...(state.nobita as PeerPresence), clientId: String(id) }]
              : []
          )
        );
      awareness.on('change', refresh);
      refresh();
      return () => awareness.off('change', refresh);
    },
  };
}
