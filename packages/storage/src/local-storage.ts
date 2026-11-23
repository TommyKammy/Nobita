import type {
  Doc,
  DocSummary,
  DocumentStore,
  SaveDocumentOptions,
  StoredDoc,
} from '@nobita/core';
import { DocumentConflictError, DocumentStoreError } from './errors.js';
import { assertDoc, assertVersion, cloneDoc } from './validate.js';

/** The subset of the Web Storage API used by the adapter. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalStorageDocumentStoreOptions {
  storage?: StorageLike;
  /** Defaults to `nobita:doc:`. */
  prefix?: string;
  now?: () => number;
}

interface StoredEntry {
  doc: Doc;
  version: number;
  updatedAt: number;
}

/**
 * localStorage / sessionStorage adapter. Each document is one JSON entry, so
 * the persisted value stays easy to inspect and migrate.
 */
export class LocalStorageDocumentStore implements DocumentStore {
  #storage: StorageLike;
  #prefix: string;
  #now: () => number;

  constructor(options: LocalStorageDocumentStoreOptions = {}) {
    const storage =
      options.storage ??
      (typeof localStorage === 'undefined' ? undefined : localStorage);
    if (!storage) {
      throw new DocumentStoreError('No Web Storage implementation is available');
    }
    this.#storage = storage;
    this.#prefix = options.prefix ?? 'nobita:doc:';
    this.#now = options.now ?? Date.now;
  }

  async load(id: string): Promise<StoredDoc | null> {
    const entry = this.#read(id);
    if (!entry) return null;
    return {
      doc: cloneDoc(entry.doc),
      version: entry.version,
      updatedAt: entry.updatedAt,
    };
  }

  async save(doc: Doc, options: SaveDocumentOptions = {}): Promise<DocSummary> {
    assertDoc(doc);
    assertVersion(options.version);
    const current = this.#read(doc.id);
    const currentVersion = current?.version ?? 0;
    if (options.version !== undefined && options.version !== currentVersion) {
      throw new DocumentConflictError(options.version);
    }

    const version = currentVersion + 1;
    const updatedAt = this.#now();
    const entry: StoredEntry = { doc: cloneDoc(doc), version, updatedAt };
    try {
      this.#storage.setItem(this.#key(doc.id), JSON.stringify(entry));
    } catch (error) {
      throw new DocumentStoreError(`Could not persist document ${doc.id}`, {
        cause: error,
      });
    }
    return { id: doc.id, title: doc.title, version, updatedAt };
  }

  async list(): Promise<DocSummary[]> {
    const summaries: DocSummary[] = [];
    for (let index = 0; index < this.#storage.length; index += 1) {
      const key = this.#storage.key(index);
      if (!key || !key.startsWith(this.#prefix)) continue;
      try {
        const entry = this.#read(key.slice(this.#prefix.length));
        if (!entry) continue;
        summaries.push({
          id: entry.doc.id,
          title: entry.doc.title,
          version: entry.version,
          updatedAt: entry.updatedAt,
        });
      } catch {
        // Ignore corrupt or foreign entries instead of breaking the listing.
      }
    }
    return summaries.sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
    );
  }

  async delete(id: string): Promise<boolean> {
    const key = this.#key(id);
    if (this.#storage.getItem(key) === null) return false;
    this.#storage.removeItem(key);
    return true;
  }

  #key(id: string): string {
    return `${this.#prefix}${id}`;
  }

  #read(id: string): StoredEntry | null {
    const raw = this.#storage.getItem(this.#key(id));
    if (raw === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new DocumentStoreError(`Stored document ${id} is not valid JSON`, {
        cause: error,
      });
    }
    if (!isRecord(value)) {
      throw new DocumentStoreError(`Stored document ${id} is not an object`);
    }
    const doc = value.doc;
    if (!isRecord(doc) || typeof value.version !== 'number') {
      throw new DocumentStoreError(`Stored document ${id} is incomplete`);
    }
    const stored = doc as unknown as Doc;
    assertDoc(stored);
    assertVersion(value.version);
    if (stored.id !== id) {
      throw new DocumentStoreError(
        `Stored document key ${id} points at ${stored.id}`
      );
    }
    return {
      doc: stored,
      version: value.version,
      updatedAt:
        typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
