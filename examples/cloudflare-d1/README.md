# Cloudflare D1 example

A minimal Worker that stores Nobita documents in D1, plus a browser client.

```
worker.ts      auth, CORS, JSON routes, D1 driver, schema bootstrap
schema.sql     D1 schema (mirrors SQLITE_SCHEMA)
wrangler.toml  D1 binding and local CORS origin
client.ts      HttpDocumentStore configured for this Worker
```

The document itself remains plain JSON; D1 stores one row per workspace and document ID. There is no per-block or per-database-row SQL model.

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

The examples below use the local Worker at `http://127.0.0.1:8787`. The checked-in `wrangler.toml` sets `WORKSPACE_ID` to `default` and `ALLOWED_ORIGIN` to `http://127.0.0.1:5173`. Set the latter to the origin of your browser client. Without it, the Worker omits CORS headers.

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

The `version: 1` inside `doc` identifies the document format. The separate storage version increments with each save. Send `If-Match: 0` to create a document, then pass the version returned by GET or PUT for the next update. A stale version returns `409`. Omitting the header requests an unconditional save.

To delete the example document, send `DELETE /docs/demo` with the same bearer token. A successful delete returns `204`, and a missing document returns `404`.

## Connect the editor

In your browser app, place a `<nobita-editor></nobita-editor>` element on the page and import the example’s `client.ts` from your entry point. The local demo token below is for development.

```ts
import { createDoc } from '@nobita/core';
import { defineNobitaEditor, type NobitaChangeDetail, type NobitaEditorElement } from '@nobita/element';
import { createCloudflareStore } from './client';

const store = createCloudflareStore({
  baseUrl: 'http://127.0.0.1:8787',
  token: 'dev-token',
});

const pageId = 'demo';
const stored = await store.load(pageId);
let version = stored?.version ?? 0;

defineNobitaEditor();
const editor = document.querySelector<NobitaEditorElement>('nobita-editor')!;
editor.doc = stored?.doc ?? createDoc({ id: pageId });

let timer = 0;
let saves = Promise.resolve();
let paused = false;
editor.addEventListener('nobita-change', event => {
  if (paused) return;
  const { doc } = (event as CustomEvent<NobitaChangeDetail>).detail;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    saves = saves.then(async () => {
      if (paused) return;
      const saved = await store.save(doc, { version });
      version = saved.version;
    }).catch(error => {
      paused = true;
      console.error('Autosave paused. Local edits are still in the editor.', error);
    });
  }, 700);
});
```

The debounce groups rapid edits. Serializing requests lets each save use the storage version returned by the previous one. In a host app, surface save failures to the user. On `DocumentConflictError`, load the latest stored document and reconcile it with local edits before resuming.

## Production notes

- Replace `NOBITA_TOKEN` with Cloudflare Access, a signed session cookie, or your identity provider.
- Derive the workspace from the authenticated session. Do not trust a client header.
- Require `If-Match` for updates if more than one tab or user can edit a document.
- Store image binaries in R2; keep only references in the JSON document.
- The Worker returns `413` when the entire UTF-8 PUT body, including the `{ doc }` wrapper, exceeds 1,800,000 bytes.
- `ensureSqlSchema()` runs lazily after bearer authentication and caches its promise within the Worker instance. A failed initialization can be retried. In production you can apply `schema.sql` as a migration and remove that call.

## Typecheck

```bash
pnpm --filter @nobita/example-cloudflare-d1 typecheck
```

The example declares only the small D1 surface it uses, so it does not require `@cloudflare/workers-types`. In a real project, replace those declarations with `wrangler types`.
