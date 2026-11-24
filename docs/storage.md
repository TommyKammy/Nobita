# Storage

Nobita's default contract is still plain JSON:

```ts
const editor = createEditor(host, {
  doc,
  onChange(doc) {
    // Persist with whatever adapter the host chooses.
  },
});

const doc = editor.getDoc();          // Doc
editor.setDoc(doc);                   // replace
```

No storage library is imported by `@nobita/element`. The 57.6 KB editor bundle is unchanged whether a host persists to localStorage, IndexedDB, a file, an API, SQLite or Cloudflare D1.

`@nobita/storage` is an **optional** package for hosts that want a ready-made persistence port and adapters.

## The port

```ts
interface DocumentStore {
  load(id: string): Promise<StoredDoc | null>;
  save(doc: Doc, options?: { version?: number }): Promise<DocSummary>;
  list(): Promise<DocSummary[]>;
  delete(id: string): Promise<boolean>;
}

interface StoredDoc {
  doc: Doc;
  version: number;
  updatedAt: number;
}
```

Version rules:

- `version: 0` creates a document and fails if it already exists.
- `version: N` updates only when the stored version is still `N`.
- Omitting `version` is a last-write-wins save for simple single-writer hosts.

`load()` returns the version so a browser tab can do a safe read-modify-write cycle. A stale save throws `DocumentConflictError`; the host can reload, merge or ask the user.

## Adapters

| Adapter | Backing store | Notes |
| --- | --- | --- |
| `MemoryDocumentStore` | `Map` | Tests, previews, ephemeral sessions |
| `LocalStorageDocumentStore` | Web Storage | One JSON entry per document; works with `localStorage` or `sessionStorage` |
| `HttpDocumentStore` | Any JSON API | Implements the Worker contract in `examples/cloudflare-d1` |
| `SqlDocumentStore` | SQLite / D1 | One `SqlDriver` interface; same SQL everywhere |

IndexedDB and file adapters are intentionally not bundled. Both are small `DocumentStore` implementations; keeping them in the host preserves the "plain JSON anywhere" default and the editor's dependency-free profile.

### localStorage

```ts
import { LocalStorageDocumentStore } from '@nobita/storage';

const store = new LocalStorageDocumentStore();
const stored = await store.load('page-123');
await store.save(editor.getDoc(), {
  version: stored?.version ?? 0,
});
```

Each document is stored under `nobita:doc:<id>` as `{ doc, version, updatedAt }`. The prefix is configurable. This keeps the "inspect the JSON in DevTools" property of the original demo.

### SQLite and Cloudflare D1

`SqlDocumentStore` takes a tiny driver:

```ts
interface SqlDriver {
  all<T>(sql: string, params?: readonly (string | number | null)[]): Promise<T[]>;
  run(sql: string, params?: readonly (string | number | null)[]): Promise<{ changes: number }>;
}
```

The schema is one row per document:

```sql
CREATE TABLE nobita_docs (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  doc TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS nobita_docs_updated
  ON nobita_docs (workspace_id, updated_at DESC);
```

`ensureSqlSchema(driver)` creates it at startup. `examples/cloudflare-d1/schema.sql` mirrors it for `wrangler d1 execute`.

A Node SQLite driver with the built-in `node:sqlite` module (Node 22.13+):

```ts
import { DatabaseSync } from 'node:sqlite';
import { SqlDocumentStore, ensureSqlSchema } from '@nobita/storage/sql';
import type { SqlDriver } from '@nobita/storage/sql';

const db = new DatabaseSync('nobita.db');
const driver: SqlDriver = {
  async all(sql, params = []) {
    return db.prepare(sql).all(...params) as never[];
  },
  async run(sql, params = []) {
    const result = db.prepare(sql).run(...params);
    return { changes: Number(result.changes) };
  },
};

await ensureSqlSchema(driver);
const store = new SqlDocumentStore(driver, { workspaceId: 'local' });
```

A D1 driver is the same shape:

```ts
const driver: SqlDriver = {
  async all(sql, params = []) {
    const result = await env.DB.prepare(sql).bind(...params).all();
    return result.results ?? [];
  },
  async run(sql, params = []) {
    const result = await env.DB.prepare(sql).bind(...params).run();
    return { changes: result.meta.changes ?? 0 };
  },
};
```

A versioned save is a single `INSERT ... ON CONFLICT DO NOTHING` (create) or `UPDATE ... WHERE version = ?` (update), so a conflict changes nothing and returns `changes: 0`. It does not need an interactive transaction.

## Cloudflare D1

See [examples/cloudflare-d1](../examples/cloudflare-d1) for a complete Worker:

```text
examples/cloudflare-d1/
  worker.ts      auth, CORS, JSON routes, D1 driver, schema bootstrap
  schema.sql     wrangler migration
  wrangler.toml  D1 binding
  client.ts      HttpDocumentStore for the browser
```

The Worker exposes:

| Method | Route | Body / header | Response |
| --- | --- | --- | --- |
| `GET` | `/docs` | — | `{ docs: DocSummary[] }` |
| `GET` | `/docs/:id` | — | `{ doc, version, updatedAt }` or 404 |
| `PUT` | `/docs/:id` | `{ doc }`, `If-Match: <version>` | `{ version, updatedAt }` |
| `DELETE` | `/docs/:id` | — | 204 or 404 |

The browser never connects to D1 directly. It sends an authenticated request to the Worker; the Worker binds `env.DB` and scopes every query with `workspace_id`.

### Deployment outline

```bash
pnpm install
pnpm build

cd examples/cloudflare-d1
npx wrangler d1 create nobita
# copy database_id into wrangler.toml
npx wrangler d1 execute nobita --local --file=./schema.sql
echo 'NOBITA_TOKEN="dev-token"' > .dev.vars
npx wrangler dev
```

For production, set the secret and apply the schema remotely:

```bash
npx wrangler secret put NOBITA_TOKEN
npx wrangler d1 execute nobita --remote --file=./schema.sql
npx wrangler deploy
```

Replace the example bearer-token check with Cloudflare Access, a signed session cookie, or your identity provider. Derive `workspace_id` from the authenticated session, never from a client-controlled header.

### D1 limits that affect the schema

| Limit | Consequence |
| --- | --- |
| Row/string/BLOB max **2 MB** | A whole-document JSON row must stay under it. The example rejects documents over 1.8 MB. |
| 100 bound parameters per query | The store uses 6–7. |
| 100 KB SQL statement | The JSON is bound, not interpolated. |
| Query result max **50 MB** | `list()` selects summaries, not full documents. |
| 30 s query duration | Keep writes small; do not rewrite thousands of rows per request. |
| One D1 database is single-threaded | Debounce saves; do not write on every keystroke. |
| No interactive transactions | The store needs only one statement per save. Use `batch()` when adding projection tables. |
| Read replication is eventually consistent | If enabled, use `withSession()` / bookmarks for read-your-writes. |

Practical rules:

- **Do not store image data URLs in the document.** Put images in R2 and keep only keys/URLs in the JSON.
- **Debounce** `save()` by 500–1000 ms and flush on blur or `visibilitychange`.
- **Require `If-Match`** in production if multiple tabs or users can edit the same document.
- **Keep a local cache** if the product must work offline; D1 alone is online-only.

## Standard usage stays standard

The demo still persists a single JSON state blob in localStorage. The editor still accepts and returns `Doc` objects. `@nobita/storage` is only imported by hosts that choose it, so the default path remains:

> Plain JSON documents — persist to localStorage, IndexedDB, your API, or a file.

## Tests

```bash
pnpm --filter @nobita/storage test
```

The SQL suite runs against real SQLite through `node:sqlite` (Node 22.13+); the HTTP suite uses a fake `fetch`; the localStorage suite uses an in-memory `Storage` implementation.
