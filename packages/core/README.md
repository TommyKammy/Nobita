# @nobita/core

The document model and editing commands for Nobita. Use this package to create, transform, search or serialize documents in a browser or in Node.js. It has no runtime dependencies and works without a DOM.

## Create a document

```ts
import { blocksToMarkdown, createBlock, createDoc, docToJSON, parseDoc } from '@nobita/core';

const doc = createDoc({
  title: 'Meeting notes',
  blocks: [createBlock('paragraph', { text: 'Discuss the next release.' })],
});

const json = docToJSON(doc);
const restored = parseDoc(JSON.parse(json));
const markdown = blocksToMarkdown(restored);
```

Use JSON to retain the complete block tree and typed properties. Use `EditorStore` when you also need editing history and change notifications. The main entry includes simple-table, database and workspace helpers. The `@nobita/core/collab-runtime` entry provides the shared runtime used by the collaboration adapters.

See the [public API](../../docs/public-api.md) for more document and editing operations.
