# @nobita/element

Nobita’s browser editor renders and edits a document inside a shadow root. Its only runtime dependency is the workspace package `@nobita/core`. Storage, UI frameworks and collaboration adapters are optional host choices.

## Mount an editor

Place `<div id="notes"></div>` in the page, then run this code after the container exists.

```ts
import { createDoc } from '@nobita/core';
import { createEditor } from '@nobita/element';

const editor = createEditor(document.querySelector<HTMLElement>('#notes')!, {
  doc: createDoc({ title: 'Notes' }),
  theme: 'auto',
  onChange(doc) {
    localStorage.setItem('notes', JSON.stringify(doc));
  },
});
editor.focus();
```

Use `getDoc()` to read the current document, `setDoc(doc)` to replace it and `destroy()` when disposing of the host. For declarative markup, importing `@nobita/element` in a browser registers `<nobita-editor>`. Its `doc` property accepts a document or JSON string and its `nobita-change` event carries `detail.doc`. The `@nobita/element/styles` entry exports the editor CSS as the string `styles`.

Register a renderer for a host-defined block with `editor.registerCustomBlock()`. Clients without that renderer preserve the block’s type and JSON data. See [host-defined blocks](../../docs/public-api.md#host-defined-blocks) for an example.

See the [public API](../../docs/public-api.md) for editor options, events and methods.
