# @nobita/collab-yjs

Connects a Nobita document to a Yjs shared document for concurrent edits, local undo/redo and optional remote selections. The adapter depends on `@nobita/core` and `fast-diff`. Its peer dependency is `yjs@^13.6.33`. The host provides synchronization and persistence.

## Initialize once and join from another replica

```ts
import { createDoc } from '@nobita/core';
import { YjsCollaborationAdapter } from '@nobita/collab-yjs';
import * as Y from 'yjs';

const shared = new Y.Doc();
const writer = new YjsCollaborationAdapter(shared, createDoc({ title: 'Notes' }));

// On a second client, apply the shared state before opening the adapter.
const replica = new Y.Doc();
Y.applyUpdate(replica, Y.encodeStateAsUpdate(shared));
const reader = new YjsCollaborationAdapter(replica);
```

Attach the local adapter with `await editor.setCollaboration(writer)` (or `reader` on the second client). After the initial transfer, deliver Yjs updates through your provider. Persist Yjs state so future clients can rejoin the same history. Use the same adapter version on all peers.

For remote selections, pass `awarenessPresence(awareness, user)` as the third constructor argument. On teardown, await `editor.setCollaboration(null)` before calling `adapter.destroy()`. See [collaborative editing](../../README.md#collaborative-editing) for editor lifecycle details.
