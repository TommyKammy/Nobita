# Public API

Use the package entry points declared in each package’s `exports` map. The core and standalone editor have zero external runtime dependencies. Hosts opt into React, storage and collaboration separately.

## Package entry points

| Package | Entry | Purpose |
| --- | --- | --- |
| `@nobita/core` | `@nobita/core` | Document model, commands, serialization, Markdown/HTML |
| `@nobita/element` | `@nobita/element` | Editor, web component, clipboard helpers, icons |
| `@nobita/element` | `@nobita/element/styles` | Named `styles` CSS string for host integrations |
| `@nobita/element` | `@nobita/element/locales/ja` | Named `ja` export with Japanese UI messages |
| `@nobita/react` | `@nobita/react` | React wrapper around `<nobita-editor>` |
| `@nobita/storage` | `@nobita/storage` | Optional persistence adapters |
| `@nobita/storage` | `@nobita/storage/sql` | SQL document store, schema and driver types |
| `@nobita/core` | `@nobita/core/collab-runtime` | Shared adapter implementation and backend/presence contracts |
| `@nobita/collab-yjs` | `@nobita/collab-yjs` | Yjs adapter and awareness binding |
| `@nobita/collab-automerge` | `@nobita/collab-automerge` | Automerge adapter |

## `@nobita/element`

Stable exports:

- `NobitaEditor`
- `createEditor(host, options)`
- `NobitaEditorElement`
- `defineNobitaEditor(tagName?)`
- `NobitaOptions`, `NobitaDictionary`, `CustomBlockRenderer`, `SlashBlockCommand`
- `NobitaTheme`
- `NobitaChangeDetail`, `NobitaPageOpenDetail`
- `MentionItem`, `MentionProvider`, `PageProvider`, `ImageUploadResult`, `ImageUploadHandler`
- `htmlToBlocks`, `plainTextToBlocks`, `readClipboardPayload`
- `icon`

The following are internal and are not exported from the package entry:
`Menu`, `Toolbar`, `PopoverList`, `BlockView`, the internal `DatabaseView` UI
class, floating and selection helpers, and menu item builders. Do not import
these files directly. The core `DatabaseView` type is exported from
`@nobita/core`; the UI class is not.

### `NobitaOptions`

| Option | Type | Description |
| --- | --- | --- |
| `dictionary` | `NobitaDictionary` | Per-editor UI messages, supplied at construction |
| `doc` | `Doc \| string` | Initial document |
| `readonly` | `boolean` | Disable editing |
| `theme` | `'light' \| 'dark' \| 'auto'` | Editor theme |
| `placeholder` | `string` | First empty paragraph hint |
| `autofocus` | `boolean` | Focus after mount |
| `spellcheck` | `boolean` | Native spellcheck |
| `historyLimit` | `number` | Undo history limit |
| `virtualize` | `boolean \| { threshold?: number; overscanPx?: number }` | Window top-level blocks starting at 300 blocks, with 800 px overscan by default |
| `collaboration` | `CollaborationAdapter \| null` | Connect an optional shared document adapter |
| `databaseProvider` | `(query: string) => readonly DatabaseTarget[] \| Promise<readonly DatabaseTarget[]>` | Discover external relation targets |
| `resolveDatabase` | `DatabaseResolver` | Synchronously return the database snapshot for an ID and optional page ID |
| `onRelationSync` | `(change: RelationChange) => void` | Let the host apply a paired relation change to an external target |
| `onChange` | `(doc, { source }) => void` | Document change callback |
| `onSelectionChange` | `(selection \| null) => void` | Selection change callback |
| `mentionProvider` | `MentionProvider` | Host directory used by the `@` mention picker |
| `pageProvider` | `PageProvider` | Host page directory used by `[[` inline links and `/page` / `/new-page` |
| `uploadImage` | `ImageUploadHandler` | Upload pasted/dropped images |
| `onOpenPage` | `(pageId) => void` | Host navigation for page reference blocks |
| `resolvePage` | `(pageId) => PageInfo \| null` | Optional cached metadata for live page titles/icons |

### UI dictionaries

Use the original English message as the key. For example, `{ dictionary: { 'New Record': 'Add ticket' } }` changes one label and keeps the remaining labels in English.
The optional Japanese module can be imported on its own or spread into a host dictionary.

```ts
import { createEditor, type NobitaDictionary } from '@nobita/element';
import { ja } from '@nobita/element/locales/ja';

const dictionary = { ...ja, 'New Record': '案件を追加' } satisfies NobitaDictionary;
createEditor(container, { dictionary });
```

For a custom element, set its `dictionary` property before connecting it to the document.
Each editor snapshots its dictionary on construction. Labels render as plain text, including
menu items, toolbar tooltips and accessible names. Keep placeholder names such as
`{count}` and `{name}` in translated messages. Document content, stored view names and
host-supplied search results retain their original values. Slash commands also accept
their English search terms.

### Mentions, uploads and page references

`MentionProvider.search(query)` may return items synchronously or as a Promise. Each item is
`{ id, label, kind?, keywords? }`; the selected item becomes an inline
`mention: { id, label, kind? }` mark. The editor never fetches users or stores
uploads itself. Mentions survive JSON and HTML; Markdown export degrades them to
their label text.

`ImageUploadHandler` receives the pasted/dropped `File` and returns a URL string
or `{ src, alt?, caption? }`. A failed upload leaves the document unchanged.
Without a handler, image clipboard/drop events are ignored rather than inserting
browser-native HTML.

`getBlockLink(blockId)` returns `#block-<id>`. Clicking a matching link inside
the same document focuses the block. Use normal URLs for links across documents.

Page references can be block-level cards (`page` block with `{ pageId, pageTitle, pageIcon? }`)
or atomic inline chips (`marks.page: PageInfo`), and never embed target page content.
`insertPageLink(page, { afterBlockId? })` creates a block card; `insertInlinePageLink(page)`
creates an inline chip; `pageProvider` powers the `[[` wiki-link picker and `/page` / `/new-page`
slash commands; `refreshPageLinks()` re-reads optional `resolvePage` metadata for both block cards
and inline chips after a host rename. The resolver must be synchronous and cached; `onOpenPage`
owns loading and routing.

### Editor methods

`getDoc()`, `getJSON(pretty?)`, `getMarkdown()`, `getHTML()`, `setDoc(doc, { history? })`,
`getSelection()`, `getSelectedBlockIds()`, `selectBlocks(ids)`, `clearBlockSelection()`,
`focus(blockId?, offset?)`, `scrollToBlock(blockId): boolean`, `focusTitle()`, `blur()`, `setTitle(title)`,
`setReadonly(value)`, `setTheme(theme)`, `setPlaceholder(value)`, `undo()`, `redo()`,
`insertMarkdown(markdown)`, `insertPageLink(page, { afterBlockId? })`,
`insertInlinePageLink(page)`, `refreshPageLinks()`,
`getBlockLink(blockId)`, `setMentionProvider(provider)`, `setPageProvider(provider)`,
`setUploadImage(handler)`, `registerCustomBlock(type, renderer)`, `registerSlashBlock(command): () => void`, `destroy()`.

`scrollToBlock(id)` mounts and reveals a nested or top-level block without moving the caret. Its boolean result indicates whether the editor found the block. After replacing a host-provided database snapshot, call `editor.refreshDatabases()` to refresh formula and relation views. `setRelationSync(callback)` replaces the external relation callback.

### `<nobita-editor>`

Attributes: `readonly`, `theme`, `placeholder`, `min-height`, `doc` (JSON string).

Properties: `dictionary` (set before connection), `doc`, `value` (JSON), `markdown`, `editor`, `mentionProvider`, `pageProvider`,
`uploadImage`, `onOpenPage`, `resolvePage`, `collaboration`, `databaseProvider`, `resolveDatabase`, `onRelationSync`.

Methods: `focus()`, `undo()`, `redo()`, `getMarkdown()`, `getJSON()`,
`getSelectedBlockIds()`, `selectBlocks(ids)`, `clearBlockSelection()`,
`insertPageLink()`, `insertInlinePageLink()`, `refreshPageLinks()`, `setReadonly()`, `setTheme()`.

Events:

- `nobita-change`: `{ doc: Doc, source: string }`
- `nobita-selection`: `{ selection: EditorSelection | null }`
- `nobita-page-open`: `{ pageId: string }`
- `nobita-ready` (waits for an initially configured collaboration adapter)

## Host-defined blocks

Use a stable `custom:`-prefixed type for each host-defined block. Store its payload as JSON in `props.data`. Standard inline `text` can provide a portable description for text or Markdown export. The editor treats the block body as one non-editable unit and renders its children normally.

```ts
import { createBlock, createDoc } from '@nobita/core';
import { createEditor } from '@nobita/element';

const editor = createEditor(document.querySelector<HTMLElement>('#notes')!, {
  doc: createDoc({ blocks: [createBlock('paragraph')] }),
});

editor.registerCustomBlock('custom:ticket', block => {
  const data = block.props.data;
  if (data && typeof data === 'object' && 'number' in data && typeof data.number === 'string') {
    return `案件（${data.number}）`;
  }
  return '案件カード';
});
```

`registerCustomBlock(type, renderer)` registers or replaces a renderer on one editor. Each call refreshes matching mounted blocks. Renderers receive the current block and a boolean indicating read-only mode. Return a DOM node or a string (displayed as text). Treat the input as immutable. Host controls should respect read-only mode and submit edits through the document store. Pass `null` to remove the renderer. For a web component, access the editor through `element.editor` after it is ready.

Register a `SlashBlockCommand` on the same editor. Users can type `/案件` or `/ticket` and choose **案件カード**.

```ts
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

The host supplies localized labels and search terms. The synchronous factory runs on selection and should return a new custom block with fresh IDs and no side effects. In a childless paragraph containing only the slash query, selecting the command inserts the card at that position and focuses the empty paragraph immediately after it. Undo restores the empty paragraph. Registering the same ID replaces its command. Calling the returned disposer removes only that registration. Changing registrations dismisses an open slash menu.

The runnable example renders an editable form. Submitting the ticket number and status uses one `editor.store.update` call, and `onChange` saves the resulting JSON to localStorage. Open the same document in unregistered mode, edit a neighboring paragraph, and reload in registered mode to verify the card fields survive. [Run the ticket card example](../examples/ticket-card/README.md) · [Host implementation](../examples/ticket-card/host.js)

If a renderer is absent or throws while displaying an unfamiliar payload, the editor displays the type name. Editing other blocks and saving as Nobita JSON preserves the custom type, JSON payload, inline text and children. This requires a client with custom-block support. Earlier versions normalize unknown block types to paragraphs. Markdown and HTML are presentation formats; use Nobita JSON to retain the opaque payload.

## `@nobita/core`

Stable exports include:

- Document types: `Doc`, `Block`, `BlockProps`, `InlineRun`, `InlineMark`, `MentionRef`, `PageInfo`, `TableData`, `TableRow`, `TableColumn`, `TableCell`, `EditorSelection`
- Custom blocks: `CustomBlockType`, `JsonValue`, `isCustomBlockType(type)`
- Serialization: `parseDoc`, `docToJSON`, `blocksToMarkdown`, `markdownToBlocks`,
  `blocksToHtml`
- Editing commands: `setBlockType`, `setBlockAlign`, `toggleChecked`,
  `setCodeLanguage`, `setCalloutTone`, `insertBlockAfter`,
  `selectedTopLevelBlocks`, `removeBlocks`, `duplicateBlocks`, `moveBlocks`, etc.
- Data views: `DatabaseView`, `DatabaseViewColumn`, `DatabaseCell`,
  `DatabaseRow`, `DatabaseRowPage`, `DatabaseFilter`, `DatabaseFilterGroup`,
  `DatabaseFilterNode`, `DatabaseGroupProperty`, `DatabaseStatType`,
  `databaseView`, `databaseViews`, `databaseSorts`,
  `databaseFilterGroup`, `databaseTitleColumn`, `databaseVisibleColumns`,
  `databaseViewColumnStates`, `filteredDatabaseRows`, `searchDatabaseRows`,
  `groupedDatabaseRows`, `groupFilteredDatabaseRows`, `databaseStatValue`
- Computed data: `DatabaseEvalContext`, `storedDatabase`, `formulaNames`, `DatabaseFormulaConfig`, `DatabaseRelationConfig`, `DatabaseRelationRef`, `DatabaseTarget`, `DatabaseResolver`, `RelationChange`, `updateDatabaseRelations`
- Simple tables: `createTableData`, `normalizeTableData`, `duplicateTableData`,
  `insertTableRow`, `insertTableColumn`, `deleteTableRow`, `deleteTableColumn`,
  `duplicateTableRow`, `duplicateTableColumn`, `moveTableRow`, `moveTableRowTo`,
  `moveTableColumn`, `moveTableColumnTo`, `clearTableRow`, `clearTableColumn`,
  `setTableCellText`, `setTableCellRuns`, `setTableColumnWidth`,
  `setTableRowColor`, `setTableColumnColor`, `TableRect`, `buildTableOccupancyGrid`,
  `expandTableRange`, `mergeTableCells`, `unmergeTableCell`, `unmergeTableRange`
- Workspace graph, tree & trash helpers: `extractPageLinks`, `buildBacklinkIndex`,
  `getBacklinks`, `buildPageTree`, `flattenPageTree`, `getPageBreadcrumbs`,
  `getPageDescendantIds`, `canReparentPage`, `isTrashedPage`,
  `partitionTrashedPages`, `collectTrashTargetIds`, `resolveRestoreParentId`,
  `collectRestoreTargetIds`, `searchWorkspacePages`
- Store: `EditorStore`
- Validation/URL helpers: `parseInlineRuns`, `safeHref`, `safeImageSrc`

The package is DOM-free and can run in Node.js. `Doc.version` currently is `1`;
document migrations must keep that boundary explicit.

## Collaboration adapters

`@nobita/core` exports the `CollaborationAdapter` contract, `DocPatch`, `RemoteDocUpdate`, `PeerPresence`, `CompositionTarget` and `diffDocs`. Adapter authors can import `SharedAdapter`, `Backend` and `PresenceChannel` from `@nobita/core/collab-runtime`.

| Package | Initialize and synchronize |
| --- | --- |
| `@nobita/collab-yjs` | Construct `YjsCollaborationAdapter(yDoc, seed?, presence?)` with a Y.Doc. Seed once and synchronize Yjs updates through the host’s provider. `awarenessPresence(awareness, user?)` binds remote selections. |
| `@nobita/collab-automerge` | Construct `AutomergeCollaborationAdapter(initial, presence?)` with a Nobita doc or saved bytes. Initialize peers from the same history using `save()` and deliver later snapshots to `receive(bytes)`. |

Await `editor.setCollaboration(adapter)` to attach and `editor.setCollaboration(null)` to disconnect. When using an option or element property, await `editor.collaborationReady` before issuing edits. Each attachment or detachment starts a fresh undo history. To open another document ID, disconnect first. The host owns the adapter and its transport. For standalone editor builds, serve the on-demand `collaboration.js` file alongside the main bundle. [Integration example](../README.md#collaborative-editing)

## `@nobita/react`

Stable exports:

- `NobitaEditor` component
- `NobitaEditorProps`
- `NobitaReactHandle`

The wrapper owns the host element. It accepts `collaboration`, `databaseProvider`, `resolveDatabase` and `onRelationSync`. Call `ref.current?.refreshDatabases()` when an external snapshot changes. With a custom element, use `element.editor?.refreshDatabases()`.

## `@nobita/storage`

Optional adapters: `MemoryDocumentStore`, `LocalStorageDocumentStore`,
`HttpDocumentStore`, `SqlDocumentStore`. The editor itself has no storage
dependency.

## Versioning rules

- Removing or renaming a public export is a breaking change.
- Adding an optional option, event, method or helper is non-breaking.
- `Doc` JSON changes require a versioned migration in `@nobita/core`.
- Internal modules may change at any time.
- `icon` is a convenience utility; icon markup may change without a major
  version.

## Verification

The type-only fixture at `tests/public-api/public-api.ts` imports only from
package entry points. Run:

```bash
pnpm typecheck:public-api
```

Browser integration tests exercise the same public entry points through
`tests/browser/fixture`.

### Table of contents

The workspace demo registers this optional block in each editor. To enable it in an embedded editor:

```ts
import { createEditor } from '@nobita/element';
import { registerTableOfContents } from '@nobita/element/table-of-contents';

const editor = createEditor(host, { doc });
const unregister = registerTableOfContents(editor);
```

Type `/toc`, `/table of contents` or `/目次` in an empty paragraph. Each outline lists the current document's H1–H6 headings in document order, including nested headings. Entries use block IDs, so repeated titles navigate independently. Navigation reveals collapsed ancestors locally and works in readonly mode. Only the `custom:table-of-contents` block is stored in JSON. A host without the renderer preserves the block through the existing custom-block fallback. Call `unregister()` to remove this editor's renderer and insertion command.
