# @nobita/collab-automerge

Connects a Nobita document to Automerge for concurrent editing, offline merging and local undo/redo. The adapter depends on `@nobita/core` and `fast-diff`. Its peer dependency is `@automerge/automerge@^3.5.0`. The host stores and transports the binary snapshots.

## Initialize once and merge a peer’s changes

```ts
import { createDoc } from '@nobita/core';
import { AutomergeCollaborationAdapter } from '@nobita/collab-automerge';

const first = new AutomergeCollaborationAdapter(createDoc({ title: 'Notes' }));
const second = new AutomergeCollaborationAdapter(first.save());

// After edits on the second client, deliver its snapshot to the first.
first.receive(second.save());
```

On each client, attach its adapter with `await editor.setCollaboration(adapter)`. Persist `save()` bytes to retain shared history. Initialize additional clients from those bytes, then use `receive(bytes)` to merge snapshots as they arrive. Use the same adapter version on all peers.

For remote selections, pass a presence channel with `publish` and `subscribe` as the second constructor argument. On teardown, await `editor.setCollaboration(null)` before calling `adapter.destroy()`. See [collaborative editing](../../README.md#collaborative-editing) for editor lifecycle details.
