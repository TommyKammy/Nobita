import type {
  Doc,
  DocSummary,
  SaveDocumentOptions,
  StoredDoc,
} from '@nobita/core';
import { DocumentConflictError } from './errors.js';
import { assertDoc, assertVersion, cloneDoc } from './validate.js';

/** One persisted document plus its optimistic-concurrency metadata. */
export interface DocumentEntry {
  doc: Doc;
  version: number;
  updatedAt: number;
}

/**
 * Validate a save, resolve the stored version and build the next entry.
 * `currentVersion` is a callback so adapters can keep validation ahead of I/O.
 */
export function prepareEntry(
  doc: Doc,
  options: SaveDocumentOptions,
  currentVersion: () => number,
  now: () => number
): DocumentEntry {
  assertDoc(doc);
  assertVersion(options.version);
  const version = currentVersion();
  if (options.version !== undefined && options.version !== version) {
    throw new DocumentConflictError(options.version);
  }
  return {
    doc: cloneDoc(doc),
    version: version + 1,
    updatedAt: now(),
  };
}

/** Clone an entry into the public load shape. */
export function storedDoc(entry: DocumentEntry): StoredDoc {
  return {
    doc: cloneDoc(entry.doc),
    version: entry.version,
    updatedAt: entry.updatedAt,
  };
}

export function docSummary(entry: DocumentEntry): DocSummary {
  return {
    id: entry.doc.id,
    title: entry.doc.title,
    version: entry.version,
    updatedAt: entry.updatedAt,
  };
}

export function sortSummaries(summaries: DocSummary[]): DocSummary[] {
  return summaries.sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
  );
}
