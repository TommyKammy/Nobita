export type {
  DocSummary,
  DocumentStore,
  SaveDocumentOptions,
  StoredDoc,
} from '@nobita/core';

export { DocumentConflictError, DocumentStoreError } from './errors.js';
export { MemoryDocumentStore } from './memory.js';
export type { MemoryDocumentStoreOptions } from './memory.js';
export { LocalStorageDocumentStore } from './local-storage.js';
export type {
  LocalStorageDocumentStoreOptions,
  StorageLike,
} from './local-storage.js';
export { HttpDocumentStore } from './http.js';
export type { HttpDocumentStoreOptions } from './http.js';
export {
  SQLITE_SCHEMA,
  SqlDocumentStore,
  ensureSqlSchema,
} from './sql.js';
export type {
  SqlDocumentStoreOptions,
  SqlDriver,
  SqlValue,
} from './sql.js';
