# Public API

Nobita has one supported entry point for each package. Import only from these
entry points; files under `src/` other than the package entry are internal
implementation details.

## Package entry points

| Package | Entry | Purpose |
| --- | --- | --- |
| `@nobita/core` | `@nobita/core` | Document model, commands, serialization, Markdown/HTML |
| `@nobita/element` | `@nobita/element` | Editor, web component, clipboard helpers, icons |
| `@nobita/element/styles` | `@nobita/element/styles` | CSS string for advanced host integrations |
| `@nobita/react` | `@nobita/react` | React wrapper around `<nobita-editor>` |
| `@nobita/storage` | `@nobita/storage` | Optional persistence adapters |

## `@nobita/element`

Stable exports:

- `NobitaEditor`
- `createEditor(host, options)`
- `NobitaEditorElement`
- `defineNobitaEditor(tagName?)`
- `NobitaOptions`
- `NobitaTheme`
- `NobitaChangeDetail`
- `MentionItem`, `MentionProvider`, `ImageUploadResult`, `ImageUploadHandler`
- `htmlToBlocks`, `plainTextToBlocks`, `readClipboardPayload`
- `icon`

The following are internal and are not exported from the package entry:
`Menu`, `Toolbar`, `PopoverList`, `BlockView`, `DatabaseView`, floating and
selection helpers, and menu item builders. Do not import these files directly.

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
| `onChange` | `(doc, { source }) => void` | Document change callback |
| `onSelectionChange` | `(selection \| null) => void` | Selection change callback |
| `mentionProvider` | `MentionProvider` | Host directory used by the `@` mention picker |
| `uploadImage` | `ImageUploadHandler` | Upload pasted/dropped images |

`MentionProvider.search(query)` may return items synchronously or as a Promise. Each item is
`{ id, label, kind?, keywords? }`; the selected item becomes an inline
`mention: { id, label, kind? }` mark. The editor never fetches users or stores
uploads itself. Mentions survive JSON and HTML; Markdown export degrades them to
their label text.

`ImageUploadHandler` receives the pasted/dropped `File` and returns a URL string
or `{ src, alt?, caption? }`. A notable failure leaves the document unchanged.
Without a handler, image clipboard/drop events are ignored rather than inserting
browser-native HTML.

`getBlockLink(blockId)` returns `#block-<id>`. Clicking a matching link inside
the same document focuses the block. Use normal URLs for links across documents.

### Editor methods

`getDoc()`, `getJSON(pretty?)`, `getMarkdown()`, `getHTML()`, `setDoc(doc, { history? })`,
`getSelection()`, `focus(blockId?, offset?)`, `focusTitle()`, `blur()`, `setTitle(title)`,
`setReadonly(value)`, `setTheme(theme)`, `setPlaceholder(value)`, `undo()`, `redo()`,
`insertMarkdown(markdown)`, `getBlockLink(blockId)`, `setMentionProvider(provider)`,
`setUploadImage(handler)`, `destroy()`.

### `<nobita-editor>`

Attributes: `readonly`, `theme`, `placeholder`, `min-height`, `doc` (JSON string).

Properties: `doc`, `value` (JSON), `markdown`, `editor`, `mentionProvider`, `uploadImage`.

Methods: `focus()`, `undo()`, `redo()`, `getMarkdown()`, `getJSON()`,
`setReadonly()`, `setTheme()`.

Events:

- `nobita-change`: `{ doc: Doc, source: string }`
- `nobita-selection`: `{ selection: EditorSelection | null }`
- `nobita-ready`

## `@nobita/core`

Stable exports include:

- Document types: `Doc`, `Block`, `BlockProps`, `InlineRun`, `InlineMark`, `MentionRef`, `EditorSelection`
- Serialization: `parseDoc`, `docToJSON`, `blocksToMarkdown`, `markdownToBlocks`,
  `blocksToHtml`
- Editing commands: `setBlockType`, `setBlockAlign`, `toggleChecked`,
  `setCodeLanguage`, `setCalloutTone`, `insertBlockAfter`, etc.
- Data views: `DatabaseView`, `DatabaseFilter`, `databaseView`,
  `filteredDatabaseRows`, `groupedDatabaseRows`
- Store: `EditorStore`
- Validation/URL helpers: `safeHref`, `safeImageSrc`

The package is DOM-free and can run in Node.js. `Doc.version` currently is `1`;
document migrations must keep that boundary explicit.

## `@nobita/react`

Stable exports:

- `NobitaEditor` component
- `NobitaEditorProps`
- `NobitaReactHandle`

The wrapper only owns the host element; React never renders individual blocks.

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
