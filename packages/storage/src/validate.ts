import type { Doc } from '@nobita/core';
import { DocumentStoreError } from './errors.js';

/** Deep copy for adapters that keep documents in memory. */
export function cloneDoc(doc: Doc): Doc {
  return structuredClone(doc);
}

/** Reject versions that cannot be stored in the monotonic version column. */
export function assertVersion(version: number | undefined): void {
  if (version !== undefined && (!Number.isInteger(version) || version < 0)) {
    throw new DocumentStoreError(
      'Document version must be a non-negative integer'
    );
  }
}

/** Minimal shape check shared by adapters before persisting a document. */
export function assertDoc(doc: Doc): void {
  if (!doc || typeof doc !== 'object') {
    throw new DocumentStoreError('Cannot save a non-object document');
  }
  if (typeof doc.id !== 'string' || doc.id.length === 0) {
    throw new DocumentStoreError('Cannot save a document without an id');
  }
  if (typeof doc.title !== 'string') {
    throw new DocumentStoreError(`Document ${doc.id} has no title`);
  }
  if (!Array.isArray(doc.blocks)) {
    throw new DocumentStoreError(`Document ${doc.id} has no blocks array`);
  }
}
