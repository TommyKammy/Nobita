import type {
  Doc,
  DocSummary,
  DocumentStore,
  SaveDocumentOptions,
  StoredDoc,
} from '@nobita/core';
import { DocumentConflictError } from './errors.js';
import { assertDoc, assertVersion, cloneDoc } from './validate.js';

interface MemoryEntry {
  doc: Doc;
  version: number;
  updatedAt: number;
}

export interface MemoryDocumentStoreOptions {
  now?: () => number;
}

/**
 * In-memory adapter for tests, previews and short-lived sessions.
 * Documents are cloned on the way in and out so callers cannot mutate the map.
 */
export class MemoryDocumentStore implements DocumentStore {
  #docs = new Map<string, MemoryEntry>();
  #now: () => number;

  constructor(options: MemoryDocumentStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  async load(id: string): Promise<StoredDoc | null> {
    const entry = this.#docs.get(id);
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
    const current = this.#docs.get(doc.id);
    const currentVersion = current?.version ?? 0;
    if (options.version !== undefined && options.version !== currentVersion) {
      throw new DocumentConflictError(options.version);
    }

    const version = currentVersion + 1;
    const updatedAt = this.#now();
    this.#docs.set(doc.id, { doc: cloneDoc(doc), version, updatedAt });
    return { id: doc.id, title: doc.title, version, updatedAt };
  }

  async list(): Promise<DocSummary[]> {
    return [...this.#docs.values()]
      .map(entry => ({
        id: entry.doc.id,
        title: entry.doc.title,
        version: entry.version,
        updatedAt: entry.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }

  async delete(id: string): Promise<boolean> {
    return this.#docs.delete(id);
  }
}

