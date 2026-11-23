import type { Doc } from './types.js';

/** A small listing entry. `list()` never needs to load full documents. */
export interface DocSummary {
  id: string;
  title: string;
  /** Monotonic per-document version used for optimistic concurrency. */
  version: number;
  updatedAt: number;
}

/** A document plus the metadata needed for a safe read-modify-write cycle. */
export interface StoredDoc {
  doc: Doc;
  version: number;
  updatedAt: number;
}

export interface SaveDocumentOptions {
  /**
   * The version the caller last read.
   *
   * - `0` creates a new document and fails if one already exists.
   * - A positive number updates only if the stored version still matches.
   * - Omit it for a last-write-wins save (useful for single-writer hosts).
   */
  version?: number;
}

/**
 * Optional persistence port.
 *
 * Nobita itself stays JSON-in / JSON-out: the editor does not depend on this
 * interface. Hosts can implement it with localStorage, IndexedDB, a file, an
 * HTTP API, local SQLite or Cloudflare D1.
 */
export interface DocumentStore {
  /** Returns `null` when the document does not exist. */
  load(id: string): Promise<StoredDoc | null>;
  /** Creates or updates a document and returns its new summary. */
  save(doc: Doc, options?: SaveDocumentOptions): Promise<DocSummary>;
  /** Lists documents, most recently updated first. */
  list(): Promise<DocSummary[]>;
  /** Returns `true` when a document was removed. */
  delete(id: string): Promise<boolean>;
}
