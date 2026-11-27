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

See the [public API](../../docs/public-api.md) for editor options, events and methods.

## Insert a host-defined block

On the editor mounted above, register a renderer for the saved block type and a slash command for inserting it. The command’s synchronous `create` function runs when the user selects the item and returns a fresh block each time.

```ts
import { createBlock } from '@nobita/core';

editor.registerCustomBlock('custom:ticket', block =>
  block.text.map(run => run.text).join('')
);

const unregister = editor.registerSlashBlock({
  id: 'acme.insert-ticket',
  label: '案件カード',
  keywords: ['案件', 'ticket'],
  create: () => createBlock('custom:ticket', {
    text: '案件（未採番）',
    props: { data: { version: 1, number: '未採番', status: 'open' } },
  }),
});
```

Type `/案件` or `/ticket` in an empty paragraph with no children and choose **案件カード**. Continue typing in the paragraph after the card, or undo the insertion to return to the original empty paragraph. Call `unregister()` to remove the command from this editor.

The runnable example adds a form for the ticket number and status, saves edits as Nobita JSON and reloads them. A client without the renderer can edit adjacent text and resave the document while preserving the card’s type and data. [Run the ticket card example](../../examples/ticket-card/README.md) · [Host code](../../examples/ticket-card/host.js) · [Host-defined block API](../../docs/public-api.md#host-defined-blocks)

## Customize UI messages

Pass a partial English-keyed dictionary to `createEditor`. Missing entries keep
the built-in English wording. Import Japanese explicitly when your host needs it.

```ts
import { createEditor } from '@nobita/element';
import { ja } from '@nobita/element/locales/ja';

createEditor(container, { dictionary: { ...ja, 'New Record': '案件を追加' } });
```

See the [dictionary API](../../docs/public-api.md#ui-dictionaries) for custom elements and message placeholders.
