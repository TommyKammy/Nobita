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

export interface MemoryDocumentStoreOptions {
  now?: () => number;
}

/**
 * In-memory adapter for tests, previews and short-lived sessions.
 * Documents are cloned on the way in and out so callers cannot mutate the map.
 */
export class MemoryDocumentStore implements DocumentStore {
  #docs = new Map<string, DocumentEntry>();
  #now: () => number;

  constructor(options: MemoryDocumentStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  async load(id: string): Promise<StoredDoc | null> {
    const entry = this.#docs.get(id);
    return entry ? storedDoc(entry) : null;
  }

  async save(doc: Doc, options: SaveDocumentOptions = {}): Promise<DocSummary> {
    const entry = prepareEntry(
      doc,
      options,
      () => this.#docs.get(doc.id),
      this.#now
    );
    this.#docs.set(doc.id, entry);
    return docSummary(entry);
  }

  async list(): Promise<DocSummary[]> {
    return sortSummaries([...this.#docs.values()].map(docSummary));
  }

  async delete(id: string): Promise<boolean> {
    return this.#docs.delete(id);
  }
}
