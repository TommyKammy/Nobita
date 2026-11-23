# Cloudflare D1 example

A minimal Worker that stores Nobita documents in D1, plus a browser client.

```
worker.ts      auth, CORS, JSON routes, D1 driver, schema bootstrap
schema.sql     D1 schema (mirrors SQLITE_SCHEMA)
wrangler.toml  D1 binding and local CORS origin
client.ts      HttpDocumentStore configured for this Worker
```

The document itself remains plain JSON; D1 stores one row per document. There is no per-block or per-database-row SQL model.

## Run locally

From the repository root:

```bash
pnpm install
pnpm build
```

Then:

```bash
cd examples/cloudflare-d1
npx wrangler d1 create nobita
```

Copy the printed `database_id` into `wrangler.toml`, then:

```bash
npx wrangler d1 execute nobita --local --file=./schema.sql
echo 'NOBITA_TOKEN="dev-token"' > .dev.vars
npx wrangler dev
```

The Worker listens on `http://127.0.0.1:8787`. `ALLOWED_ORIGIN` defaults to `http://127.0.0.1:5173` for the demo.

## Try the API

```bash
curl -X PUT http://127.0.0.1:8787/docs/demo \
  -H 'authorization: Bearer dev-token' \
  -H 'content-type: application/json' \
  -H 'if-match: 0' \
  --data '{
    "doc": {
      "version": 1,
      "id": "demo",
      "title": "Hello D1",
      "blocks": [
        {
          "id": "b1",
          "type": "paragraph",
          "text": [{ "text": "Stored as plain JSON in D1." }],
          "props": {},
          "children": []
        }
      ]
    }
  }'
```

```bash
curl http://127.0.0.1:8787/docs \
  -H 'authorization: Bearer dev-token'

curl http://127.0.0.1:8787/docs/demo \
  -H 'authorization: Bearer dev-token'
```

`If-Match: 0` creates; use the returned version for the next update. A stale version returns `409`.

## Connect the editor

```ts
import { createDoc, type Doc } from '@nobita/core';
import { createCloudflareStore } from './client';

const store = createCloudflareStore({
  baseUrl: 'http://127.0.0.1:8787',
  token: 'dev-token',
});

const pageId = 'demo';
const stored = await store.load(pageId);
let version = stored?.version ?? 0;

const editor = document.querySelector('nobita-editor')!;
editor.doc = stored?.doc ?? createDoc({ id: pageId });

let timer = 0;
editor.addEventListener('nobita-change', event => {
  const { doc } = (event as CustomEvent<{ doc: Doc }>).detail;
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const saved = await store.save(doc, { version });
    version = saved.version;
  }, 700);
});
```

In a real app, flush the pending save on `blur` / `visibilitychange`, and handle `DocumentConflictError` by reloading or merging.

## Production notes

- Replace `NOBITA_TOKEN` with Cloudflare Access, a signed session cookie, or your identity provider.
- Derive the workspace from the authenticated session. Do not trust a client header.
- Require `If-Match` for updates if more than one tab or user can edit a document.
- Store image binaries in R2; keep only references in the JSON document.
- D1 caps a row at 2 MB. The Worker rejects documents over 1.8 MB.
- `ensureSqlSchema()` runs lazily on the first request. In production you can apply `schema.sql` as a migration and remove that call.

## Typecheck

```bash
pnpm --filter @nobita/example-cloudflare-d1 typecheck
```

The example declares only the small D1 surface it uses, so it does not require `@cloudflare/workers-types`. In a real project, replace those declarations with `wrangler types`.
