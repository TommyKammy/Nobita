import type { CollaborationAdapter, RemoteDocUpdate } from './collab.js';
import type { Doc, DocChange, EditorSelection } from './types.js';
import { findBlock } from './doc.js';

export interface StoreOptions {
  historyLimit?: number;
  mergeWindowMs?: number;
}

export interface UpdateOptions {
  /** Record this change for undo. Defaults to true. */
  history?: boolean;
  /** Consecutive updates sharing a key within the merge window become one undo step. */
  mergeKey?: string;
  /** Selection to publish with the change. */
  selection?: EditorSelection | null;
  source?: string;
}

interface HistoryEntry {
  before: Doc;
  after: Doc;
  selectionBefore: EditorSelection | null;
  selectionAfter: EditorSelection | null;
  time: number;
  mergeKey?: string;
}

type DocListener = (change: DocChange) => void;
type SelectionListener = (selection: EditorSelection | null) => void;

const DEFAULT_HISTORY_LIMIT = 200;
const DEFAULT_MERGE_WINDOW = 700;

/**
 * Small transactional document store. Updates are immutable path copies, so a
 * snapshot for undo costs almost nothing and renderers can skip unchanged
 * branches by reference.
 */
export class EditorStore {
  #doc: Doc;
  #selection: EditorSelection | null = null;
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  #listeners = new Set<DocListener>();
  #selectionListeners = new Set<SelectionListener>();
  #historyLimit: number;
  #mergeWindow: number;
  #lastEntry: HistoryEntry | null = null;
  #destroyed = false;

  constructor(doc: Doc, options: StoreOptions = {}) {
    this.#doc = doc;
    this.#historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.#mergeWindow = options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW;
  }

  get doc(): Doc {
    return this.#doc;
  }

  get selection(): EditorSelection | null {
    return this.#selection;
  }

  #historyAdapter: CollaborationAdapter | null = null;

  setHistoryAdapter(adapter: CollaborationAdapter | null): void {
    this.#historyAdapter = adapter;
    this.#undo = [];
    this.#redo = [];
    this.#lastEntry = null;
  }

  applyRemote(doc: Doc, remap?: RemoteDocUpdate['remapPoint']): void {
    let selection = this.selection;
    if (selection && remap) {
      const anchor = remap(selection.anchor), focus = remap(selection.focus);
      selection = anchor && focus ? { anchor, focus } : null;
    }
    this.update(() => doc, { source: 'remote', history: false, selection });
  }

  get canUndo(): boolean {
    if (this.#historyAdapter) return !!this.#historyAdapter.undo && (this.#historyAdapter.canUndo ?? true);
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    if (this.#historyAdapter) return !!this.#historyAdapter.redo && (this.#historyAdapter.canRedo ?? true);
    return this.#redo.length > 0;
  }

  subscribe(listener: DocListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeSelection(listener: SelectionListener): () => void {
    this.#selectionListeners.add(listener);
    return () => this.#selectionListeners.delete(listener);
  }

  setSelection(selection: EditorSelection | null): void {
    if (sameSelection(this.#selection, selection)) return;
    this.#selection = selection;
    for (const listener of this.#selectionListeners) listener(selection);
  }

  /** Replace the document, e.g. when opening another page. Clears history by default. */
  replaceDoc(doc: Doc, options: { history?: boolean } = {}): void {
    if (doc === this.#doc) return;
    const previous = this.#doc;
    this.#doc = doc;
    this.#selection = null;
    this.#lastEntry = null;
    if (!this.#historyAdapter && options.history && previous !== doc) {
      this.#undo.push({
        before: previous,
        after: doc,
        selectionBefore: null,
        selectionAfter: null,
        time: Date.now(),
      });
      this.#trim();
      this.#redo = [];
    } else {
      this.#undo = [];
      this.#redo = [];
    }
    this.#emit({ doc, previous, selection: null, source: 'replace' });
  }

  update(mutator: (doc: Doc) => Doc, options: UpdateOptions = {}): Doc {
    if (this.#destroyed) return this.#doc;
    const previous = this.#doc;
    const next = mutator(previous);
    if (next === previous) {
      if (options.selection !== undefined) this.setSelection(options.selection);
      return previous;
    }
    const selectionBefore = this.#selection;
    const selectionAfter = options.selection === undefined ? this.#selection : options.selection;
    const now = Date.now();
    if (!this.#historyAdapter && options.history !== false) {
      const mergeKey = options.mergeKey;
      const last = this.#undo[this.#undo.length - 1];
      const canMerge =
        mergeKey !== undefined &&
        last !== undefined &&
        last === this.#lastEntry &&
        last.mergeKey === mergeKey &&
        now - last.time <= this.#mergeWindow &&
        this.#redo.length === 0;
      if (canMerge) {
        last.after = next;
        last.selectionAfter = selectionAfter;
        last.time = now;
      } else {
        const entry: HistoryEntry = {
          before: previous,
          after: next,
          selectionBefore,
          selectionAfter,
          time: now,
          ...(mergeKey ? { mergeKey } : {}),
        };
        this.#undo.push(entry);
        this.#lastEntry = entry;
        this.#trim();
        this.#redo = [];
      }
    } else {
      this.#lastEntry = null;
    }
    this.#doc = next;
    if (options.selection !== undefined) this.#selection = selectionAfter;
    this.#emit({
      doc: next,
      previous,
      selection: this.#selection,
      source: options.source ?? 'update',
    });
    return next;
  }

  undo(): boolean {
    if (this.#historyAdapter) return this.canUndo && (this.#historyAdapter.undo?.() ?? false);
    const entry = this.#undo.pop();
    if (!entry) return false;
    this.#redo.push(entry);
    this.#lastEntry = null;
    const previous = this.#doc;
    this.#doc = entry.before;
    this.#selection = entry.selectionBefore;
    this.#emit({ doc: entry.before, previous, selection: this.#selection, source: 'undo' });
    return true;
  }

  redo(): boolean {
    if (this.#historyAdapter) return this.canRedo && (this.#historyAdapter.redo?.() ?? false);
    const entry = this.#redo.pop();
    if (!entry) return false;
    this.#undo.push(entry);
    this.#lastEntry = null;
    const previous = this.#doc;
    this.#doc = entry.after;
    this.#selection = entry.selectionAfter;
    this.#emit({ doc: entry.after, previous, selection: this.#selection, source: 'redo' });
    return true;
  }

  /** True when a block still exists; useful before restoring a stale selection. */
  hasBlock(id: string): boolean {
    return findBlock(this.#doc.blocks, id) !== null;
  }

  destroy(): void {
    this.#destroyed = true;
    this.#listeners.clear();
    this.#selectionListeners.clear();
  }

  #trim(): void {
    while (this.#undo.length > this.#historyLimit) this.#undo.shift();
  }

  #emit(change: DocChange): void {
    for (const listener of this.#listeners) listener(change);
  }
}

export function samePoint(
  a: { blockId: string; offset: number } | null,
  b: { blockId: string; offset: number } | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.blockId === b.blockId && a.offset === b.offset;
}

export function sameSelection(a: EditorSelection | null, b: EditorSelection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return samePoint(a.anchor, b.anchor) && samePoint(a.focus, b.focus);
}
