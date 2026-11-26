# Public API

Use the package entry points declared in each package’s `exports` map. The core and standalone editor have zero external runtime dependencies. Hosts opt into React, storage and collaboration separately.

## Package entry points

| Package | Entry | Purpose |
| --- | --- | --- |
| `@nobita/core` | `@nobita/core` | Document model, commands, serialization, Markdown/HTML |
| `@nobita/element` | `@nobita/element` | Editor, web component, clipboard helpers, icons |
| `@nobita/element` | `@nobita/element/styles` | Named `styles` CSS string for host integrations |
| `@nobita/react` | `@nobita/react` | React wrapper around `<nobita-editor>` |
| `@nobita/storage` | `@nobita/storage` | Optional persistence adapters |
| `@nobita/core` | `@nobita/core/collab-runtime` | Shared adapter implementation and backend/presence contracts |
| `@nobita/collab-yjs` | `@nobita/collab-yjs` | Yjs adapter and awareness binding |
| `@nobita/collab-automerge` | `@nobita/collab-automerge` | Automerge adapter |

## `@nobita/element`

Stable exports:

- `NobitaEditor`
- `createEditor(host, options)`
- `NobitaEditorElement`
- `defineNobitaEditor(tagName?)`
- `NobitaOptions`
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
`setUploadImage(handler)`, `destroy()`.

`scrollToBlock(id)` mounts and reveals a nested or top-level block without moving the caret. Its boolean result indicates whether the editor found the block. After replacing a host-provided database snapshot, call `editor.refreshDatabases()` to refresh formula and relation views. `setRelationSync(callback)` replaces the external relation callback.

### `<nobita-editor>`

Attributes: `readonly`, `theme`, `placeholder`, `min-height`, `doc` (JSON string).

Properties: `doc`, `value` (JSON), `markdown`, `editor`, `mentionProvider`, `pageProvider`,
`uploadImage`, `onOpenPage`, `resolvePage`, `collaboration`, `databaseProvider`, `resolveDatabase`, `onRelationSync`.

Methods: `focus()`, `undo()`, `redo()`, `getMarkdown()`, `getJSON()`,
`getSelectedBlockIds()`, `selectBlocks(ids)`, `clearBlockSelection()`,
`insertPageLink()`, `insertInlinePageLink()`, `refreshPageLinks()`, `setReadonly()`, `setTheme()`.

Events:

- `nobita-change`: `{ doc: Doc, source: string }`
- `nobita-selection`: `{ selection: EditorSelection | null }`
- `nobita-page-open`: `{ pageId: string }`
- `nobita-ready` (waits for an initially configured collaboration adapter)

## `@nobita/core`

Stable exports include:

- Document types: `Doc`, `Block`, `BlockProps`, `InlineRun`, `InlineMark`, `MentionRef`, `PageInfo`, `TableData`, `TableRow`, `TableColumn`, `TableCell`, `EditorSelection`
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
