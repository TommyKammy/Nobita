import type {
  Doc,
  DocSummary,
  DocumentStore,
  SaveDocumentOptions,
  StoredDoc,
} from '@nobita/core';
import {
  docSummary,
  prepareEntry,
  sortSummaries,
  storedDoc,
  type DocumentEntry,
} from './entry.js';
import { DocumentStoreError } from './errors.js';
import { assertDoc, assertVersion } from './validate.js';

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
    return entry ? storedDoc(entry) : null;
  }

  async save(doc: Doc, options: SaveDocumentOptions = {}): Promise<DocSummary> {
    const entry = prepareEntry(
      doc,
      options,
      () => this.#read(doc.id)?.version ?? 0,
      this.#now
    );
    try {
      this.#storage.setItem(this.#key(doc.id), JSON.stringify(entry));
    } catch (error) {
      throw new DocumentStoreError(`Could not persist document ${doc.id}`, {
        cause: error,
      });
    }
    return docSummary(entry);
  }

  async list(): Promise<DocSummary[]> {
    const summaries: DocSummary[] = [];
    for (let index = 0; index < this.#storage.length; index += 1) {
      const key = this.#storage.key(index);
      if (!key || !key.startsWith(this.#prefix)) continue;
      try {
        const entry = this.#read(key.slice(this.#prefix.length));
        if (entry) summaries.push(docSummary(entry));
      } catch {
        // Ignore corrupt or foreign entries instead of breaking the listing.
      }
    }
    return sortSummaries(summaries);
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

  #read(id: string): DocumentEntry | null {
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
