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
  createdAt?: number | undefined;
  updatedAt: number;
}

/**
 * Validate a save, resolve the stored version and build the next entry.
 * `currentEntry` is a callback so adapters can keep validation ahead of I/O.
 */
export function prepareEntry(
  doc: Doc,
  options: SaveDocumentOptions,
  currentEntry: () => DocumentEntry | undefined | null,
  now: () => number
): DocumentEntry {
  assertDoc(doc);
  assertVersion(options.version);
  const previous = currentEntry();
  const version = previous?.version ?? 0;
  if (options.version !== undefined && options.version !== version) {
    throw new DocumentConflictError(options.version);
  }
  const timestamp = now();
  const changed = !previous || previous.doc.title !== doc.title ||
    JSON.stringify(previous.doc.blocks) !== JSON.stringify(doc.blocks);
  return {
    createdAt: previous ? previous.createdAt : timestamp,
    doc: cloneDoc(doc),
    version: version + 1,
    updatedAt: changed ? timestamp : previous.updatedAt,
  };
}

/** Clone an entry into the public load shape. */
export function storedDoc(entry: DocumentEntry): StoredDoc {
  return {
    doc: cloneDoc(entry.doc),
    version: entry.version,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export function docSummary(entry: DocumentEntry): DocSummary {
  return {
    id: entry.doc.id,
    title: entry.doc.title,
    version: entry.version,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export function sortSummaries(summaries: DocSummary[]): DocSummary[] {
  return summaries.sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
  );
}
