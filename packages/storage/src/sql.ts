import type {
  Doc,
  DocSummary,
  DocumentStore,
  SaveDocumentOptions,
  StoredDoc,
} from '@nobita/core';
import { DocumentConflictError, DocumentStoreError } from './errors.js';
import { assertDoc, assertVersion } from './validate.js';

/** JSON documents only need these SQLite value types. */
export type SqlValue = string | number | null;

/**
 * The minimum surface shared by local SQLite drivers and Cloudflare D1.
 * Implementations should execute exactly one statement per call.
 */
export interface SqlDriver {
  all<T = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlValue[]
  ): Promise<T[]>;
  run(
    sql: string,
    params?: readonly SqlValue[]
  ): Promise<{ changes: number }>;
}

export interface SqlDocumentStoreOptions {
  /** Tenant/workspace partition. Defaults to `default`. */
  workspaceId?: string;
  now?: () => number;
}

/**
 * SQLite schema for plain JSON documents.
 *
 * Run these statements at startup (see `ensureSqlSchema`) or apply
 * `examples/cloudflare-d1/schema.sql` with `wrangler d1 execute`.
 */
export const SQLITE_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS nobita_docs (
    workspace_id TEXT NOT NULL,
    id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    doc TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS nobita_docs_updated
    ON nobita_docs (workspace_id, updated_at DESC)`,
];

export async function ensureSqlSchema(driver: SqlDriver): Promise<void> {
  for (const statement of SQLITE_SCHEMA) {
    await driver.run(statement);
  }
}

interface DocumentRow {
  id: string;
  title: string;
  doc: string;
  version: number;
  updated_at: number;
}

interface VersionRow {
  version: number;
  updated_at: number;
}

const CREATE = `INSERT INTO nobita_docs
  (workspace_id, id, title, doc, version, created_at, updated_at)
  VALUES (?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT(workspace_id, id) DO NOTHING`;

const UPDATE = `UPDATE nobita_docs
   SET title = ?, doc = ?, version = version + 1, updated_at = ?
 WHERE workspace_id = ? AND id = ? AND version = ?`;

const UPSERT = `INSERT INTO nobita_docs
  (workspace_id, id, title, doc, version, created_at, updated_at)
  VALUES (?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT(workspace_id, id) DO UPDATE SET
    title = excluded.title,
    doc = excluded.doc,
    version = nobita_docs.version + 1,
    updated_at = excluded.updated_at`;

/**
 * Portable SQLite store. The same implementation runs on local SQLite and
 * Cloudflare D1; only the `SqlDriver` differs.
 */
export class SqlDocumentStore implements DocumentStore {
  #driver: SqlDriver;
  #workspaceId: string;
  #now: () => number;

  constructor(driver: SqlDriver, options: SqlDocumentStoreOptions = {}) {
    this.#driver = driver;
    this.#workspaceId = options.workspaceId ?? 'default';
    this.#now = options.now ?? Date.now;
  }

  async load(id: string): Promise<StoredDoc | null> {
    const rows = await this.#driver.all<DocumentRow>(
      `SELECT id, title, doc, version, updated_at
         FROM nobita_docs
        WHERE workspace_id = ? AND id = ?`,
      [this.#workspaceId, id]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      doc: parseStoredDoc(row),
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  async save(doc: Doc, options: SaveDocumentOptions = {}): Promise<DocSummary> {
    assertDoc(doc);
    assertVersion(options.version);
    const now = this.#now();
    const serialized = JSON.stringify(doc);
    const expected = options.version;

    if (expected !== undefined) {
      const { changes } =
        expected === 0
          ? await this.#driver.run(CREATE, [
              this.#workspaceId,
              doc.id,
              doc.title,
              serialized,
              now,
              now,
            ])
          : await this.#driver.run(UPDATE, [
              doc.title,
              serialized,
              now,
              this.#workspaceId,
              doc.id,
              expected,
            ]);
      if (changes === 0) throw new DocumentConflictError(expected);
      return {
        id: doc.id,
        title: doc.title,
        version: expected + 1,
        updatedAt: now,
      };
    }

    await this.#driver.run(UPSERT, [
      this.#workspaceId,
      doc.id,
      doc.title,
      serialized,
      now,
      now,
    ]);
    const rows = await this.#driver.all<VersionRow>(
      `SELECT version, updated_at
         FROM nobita_docs
        WHERE workspace_id = ? AND id = ?`,
      [this.#workspaceId, doc.id]
    );
    const row = rows[0];
    if (!row) {
      throw new DocumentStoreError(`Document ${doc.id} disappeared after saving`);
    }
    return {
      id: doc.id,
      title: doc.title,
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  async list(): Promise<DocSummary[]> {
    const rows = await this.#driver.all<{
      id: string;
      title: string;
      version: number;
      updated_at: number;
    }>(
      `SELECT id, title, version, updated_at
         FROM nobita_docs
        WHERE workspace_id = ?
        ORDER BY updated_at DESC, id ASC`,
      [this.#workspaceId]
    );
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      version: row.version,
      updatedAt: row.updated_at,
    }));
  }

  async delete(id: string): Promise<boolean> {
    const { changes } = await this.#driver.run(
      `DELETE FROM nobita_docs WHERE workspace_id = ? AND id = ?`,
      [this.#workspaceId, id]
    );
    return changes > 0;
  }
}

function parseStoredDoc(row: DocumentRow): Doc {
  let doc: Doc;
  try {
    doc = JSON.parse(row.doc) as Doc;
  } catch (error) {
    throw new DocumentStoreError(`Stored document ${row.id} is not valid JSON`, {
      cause: error,
    });
  }
  try {
    assertDoc(doc);
  } catch (error) {
    throw new DocumentStoreError(
      `Stored document ${row.id} has an invalid shape`,
      { cause: error }
    );
  }
  return doc;
}
