# @nobita/storage

Optional persistence adapters for plain Nobita documents. The package depends only on `@nobita/core`. Choose `MemoryDocumentStore` for ephemeral state, `LocalStorageDocumentStore` for Web Storage, `HttpDocumentStore` for the JSON HTTP API, or `SqlDocumentStore` for SQLite and Cloudflare D1.

## Save and update a document

```ts
import { createDoc } from '@nobita/core';
import { MemoryDocumentStore } from '@nobita/storage';

const store = new MemoryDocumentStore();
const doc = createDoc({ title: 'Draft' });
const created = await store.save(doc, { version: 0 });
await store.save({ ...doc, title: 'Published' }, { version: created.version });
const stored = await store.load(doc.id);
```

Version zero requests creation. Passing the last stored version requests a conditional update. A stale version raises `DocumentConflictError`, and omitting the version requests an unconditional save. `load(id)` returns the document and its storage metadata, or `null` if absent. Use `list()` for summaries and `delete(id)` to remove a document.

For SQL, supply a `SqlDriver` and initialize its schema with `ensureSqlSchema(driver)`. Both the SQL store and its driver interface are available from `@nobita/storage/sql`. See the [storage guide](../../docs/storage.md) and the [D1 Worker example](../../examples/cloudflare-d1/README.md).
