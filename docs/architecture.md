# Nobita architecture

This document explains how the editor works, why it is split into packages, and which trade-offs are deliberate.

## Layers

```
@nobita/core      pure TypeScript: document model, rich-text operations, commands,
                  markdown, JSON validation, history, storage port types, no DOM
@nobita/element   DOM engine: block views, selection, input, clipboard, menus,
                  toolbar, drag & drop, <nobita-editor> web component
@nobita/storage   optional persistence adapters: memory, Web Storage, HTTP,
                  portable SQL (local SQLite / Cloudflare D1)
@nobita/react     host wrapper only; React never renders editor content
apps/demo         Notion-like shell: pages, search, favorites, export, embed dialog
examples/         optional integrations, including the Cloudflare D1 Worker
```

`core` is testable in Node and can be reused for import/export, migrations, or a
server-side renderer. `element` owns everything that needs a browser.

## Document model

```ts
interface Doc { version: 1; id: string; title: string; icon?: string; blocks: Block[] }
interface Block { id: string; type: BlockType; text: InlineRun[]; props: BlockProps; children: Block[] }
interface InlineRun { text: string; marks?: InlineMark }
```

Invariants:

- Block ids are unique within a document; `parseDoc` repairs duplicates.
- `text` is normalized: no empty runs, adjacent runs with equal marks merged.
- Text never contains `\r`.
- `children` is the only nesting mechanism. Lists, callouts and any future
  container block use it.
- Untouched branches keep **reference identity** across updates. This is what
  makes rendering and history cheap.

Inline marks are five boolean flags (`bold`, `italic`, `underline`, `strike`,
`code`) plus three value marks: `link` (a URL string), `highlight` (background)
and `color` (foreground). Highlight and text color share the same eight named
palette tokens. They are stored as palette names, not CSS strings, so documents
stay small and HTML import can whitelist values. `parseDoc` drops unknown colors.
The editor renders them as `data-highlight` and `data-text-color`; HTML export
uses `<mark data-nb-highlight>` and `<span data-nb-color>`. Markdown
intentionally drops both colors.

`core/doc.ts` implements structural updates by recursively copying only the path
to the changed block. `core/store.ts` builds transactions and history on top.

## Store and history

`EditorStore` owns the current immutable document and a selection of
`{ anchor, focus }` block/offset points. A transaction is:

```ts
store.update(doc => someCommand(doc), {
  mergeKey: 'text:blockId', // optional coalescing key
  selection: { anchor, focus },
  history: true,
});
```

- Snapshots are cheap because unchanged branches are shared.
- Consecutive typing updates with the same `mergeKey` collapse into one undo
  step inside a 700 ms window.
- Undo restores both the document and the selection that produced it.
- `replaceDoc` clears history by default, which is what opening another page
  should do.

The store emits one synchronous `change` event. The DOM engine renders before
`store.update` returns, so a caller can restore the caret immediately after.

## Persistence

Persistence is deliberately outside the editor. `Doc` is plain JSON and the
only boundary is `getDoc()` / `setDoc()` / `onChange`; the editor bundle does
not import a storage client or a database driver.

`@nobita/core` exports type-only `DocumentStore`, `StoredDoc`, `DocSummary` and
`SaveDocumentOptions` ports. `@nobita/storage` is an optional package with
implementations:

- `MemoryDocumentStore` for tests and ephemeral sessions.
- `LocalStorageDocumentStore` for one JSON entry per document.
- `HttpDocumentStore` for an authenticated JSON API.
- `SqlDocumentStore` for local SQLite and Cloudflare D1 through `SqlDriver`.

Documents are stored as one JSON row with a monotonic `version`. A save may pass
the version it read; a stale version changes nothing and throws
`DocumentConflictError`. This gives multi-tab and multi-user hosts a safe
read-modify-write cycle without putting collaboration state into the editor.

Cloudflare D1 deployment, the SQL schema and its row-size limits are documented
in [storage.md](storage.md). The Worker example is in
[`examples/cloudflare-d1`](../examples/cloudflare-d1).

Page references keep that boundary: a `page` block stores only
`{ pageId, pageTitle, pageIcon? }`. The host supplies routing through
`onOpenPage` and optional cached metadata through `resolvePage`; the editor
never loads or embeds the referenced document. This keeps one `Doc` small and
avoids turning page navigation into a second document tree.

## Rendering

Each block has a `BlockView` with a stable root element and child views in a
`Map<blockId, BlockView>`. On a change, `NobitaEditor.#syncBody` walks the block
list and reuses views by id:

- If the `Block` reference is unchanged and the layout context is unchanged,
  the view is skipped.
- If the text array changed, only that block's runs are rebuilt.
- If the children array changed, child views are reconciled recursively.
- Moving a block moves its existing DOM subtree; it is not rebuilt.

There is no virtual DOM and no diff of the document. Reference identity is the
diff.

Numbered lists need the ordinal of the previous numbered sibling; the editor
passes a precomputed `number` in the render context instead of the sibling
array, so a text edit in one block never invalidates marker rendering in its
siblings.

## One editing host

Chromium does not allow a selection range to span separate `contenteditable`
elements inside a shadow root: the range is clamped to the first editing host.
Light-DOM siblings do allow it, and a single editing host inside a shadow root
does too. This was verified directly:

| Structure | Cross-block range |
| --- | --- |
| Two `contenteditable` divs in light DOM | spans both |
| Two `contenteditable` divs in a shadow root | clamped |
| One `contenteditable` host with two text blocks in a shadow root | spans both |

Therefore the whole document body is one `contenteditable` element
(`.nb-body`). Block text elements are ordinary children (`contenteditable` is
not set on them). This is the key architectural divergence from AFFiNE's
per-block rich-text editors, and it is what makes native multi-block selection,
Shift+Arrow, mouse drag selection, copy, formatting and delete work inside an
isolated shadow tree.

Consequences:

- Input events are bound once on the body, then mapped to the block containing
  the selection.
- Buttons, checkboxes, gutters, code labels, dividers and images are marked
  `contenteditable="false"` so they never become text.
- Image captions are a nested editing host; body handlers ignore events from
  captions and inputs.
- Readonly mode flips one attribute on the body instead of touching every block.

## Selection mapping

`nativeSelection(root)` prefers `ShadowRoot#getSelection()` and falls back to
`window.getSelection()`. The document-level selection can report a stale caret
on the host page when the real selection lives in the shadow tree.

Two pure functions convert between DOM points and text offsets:

- `domPointToOffset(root, node, offset)` walks text nodes and counts UTF-16
  units. Element endpoints are resolved by summing preceding subtree lengths.
- `offsetToDomPoint(root, offset)` returns the nearest text node point.

A block-local selection becomes `{ blockId, offset }` twice (anchor and focus).
`compareTextPositions` orders points using document order, so a backwards
selection behaves the same as a forward one. A range that spans blocks is
handled by splicing the first block's prefix onto the last block's suffix and
removing everything between.

Carets are restored after every controlled edit: the store update re-renders
the affected block, then `#restoreSelection` focuses the body and calls
`Selection.setBaseAndExtent` with the mapped points.

## Input pipeline

Handled inputs are fully controlled. `beforeinput` is intercepted and the
editor applies document operations itself:

- `insertText` → `insertTextAt`
- `insertParagraph` → split block or exit an empty list
- `insertLineBreak` → insert `\n`
- delete variants → delete a character/range or merge blocks
- `formatBold` / `formatItalic` / `formatUnderline` / `formatStrikeThrough` →
  toggle marks
- `historyUndo` / `historyRedo`
- `insertFromDrop` → rejected

Paste is handled from the `paste` event because `beforeinput` does not expose
clipboard data. Copy and cut are serialized from the model, not from the DOM.

Anything not intercepted (IME composition, autocorrect, spellcheck replacement,
speech input, future input types) is allowed to mutate the DOM. On `input`, the
editor reconstructs runs from the affected block with `readRunsFromDom` and
commits the difference. During composition, input events are ignored and the
final text is reconciled on `compositionend`.

Markdown shortcuts run inside `insertText`:

- Block shortcuts are checked when the typed character is a space:
  `# `, `## `, `### `, `- `, `1. `, `[] `, `> `, ` ``` `, `--- `.
- Inline shortcuts are checked when a closing delimiter is followed by a space:
  `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `[label](url)`.

## Commands and block operations

Tree operations live in `core/doc.ts`: `splitBlock`, `mergeBlockWithPrevious`,
`mergeBlockWithNext`, `indentBlock`, `dedentBlock`, `moveBlock`,
`insertBlocksAfter`, `duplicateBlockTree`. Higher-level conversions live in
`core/commands.ts`.

UI actions never mutate the DOM directly. Slash-menu items, hotkeys, the block
menu, markdown rules and drag-and-drop all call the same command functions and
then commit through the store. This keeps undo, selection and persistence
consistent.

## Clipboard

Copy writes three representations:

- `text/plain` — readable text with list markers.
- `text/html` — semantic HTML with inline marks, including `<mark data-nb-highlight>` and `<span data-nb-color>`.
- `application/x-nobita+json` — exact blocks, including nesting and props.

Selection copy, the block menu Copy and `/copy` share this serializer. The
async clipboard attempts all three types, then text/plain + text/html when the
browser rejects custom MIME types; a legacy `execCommand` fallback keeps the
custom format where the platform supports it.

Paste prefers the private format for lossless round-trips, then HTML (parsed
into blocks with heading/list/quote/code/image support), then Markdown, then
plain text. HTML paste uses `DOMParser`; links are restricted to safe schemes.

## Placeholders

Placeholders are per focused block, matching AFFiNE. An empty paragraph shows
the configured placeholder (`Type '/' for commands` by default); an empty
heading shows `Heading 1/2/3/4/5/6`. Nothing is shown while the page title, a
database cell, an image caption, or a non-empty block has focus, and the
placeholder disappears as soon as the block has any text. The editor updates
this state from the live selection, focus changes, composition events and store
changes rather than from a document-wide "is empty" flag.

## Menus, toolbar and drag- The slash menu is a positioned overlay inside the shadow root. The `/` and
  query stay in the block text until an item is chosen; the query is then
  removed in a non-history transaction before the action commits.
- Menu keyboard handling is installed as a capture listener on the shadow root,
  so Arrow/Enter/Escape work while focus stays in the editor and typing keeps
  filtering.
- The formatting toolbar is shown on non-collapsed selections and updated from
  `markStateInRange`. Buttons use `pointerdown` + `preventDefault` to preserve
  the selection.
- Drag uses pointer events, not HTML drag-and-drop. A threshold separates click
  (open the block menu) from drag. `ShadowRoot#elementFromPoint` finds the drop
  target; dropping on the right side nests, otherwise a line marks before/after.
- All per-editor state is instance-local. The block-view registry is a `Map` on
  the editor, so two editors can show the same JSON (same block ids) at once.

## Tables and data views

A simple table and a database are separate blocks.

A `table` block stores a plain grid:

```ts
interface TableData {
  columns: { id; width?; backgroundColor? }[];
  rows: { id; backgroundColor?; cells: Record<columnId, { text }> }[];
}
```

A `database` block stores typed columns, row records and named views:

```ts
interface DatabaseData {
  variant: 'database' | 'table'; // 'table' is legacy-only
  title?: string;
  columns: { id; name; type; options?; width? }[];
  rows: {
    id;
    cells: Record<columnId, {
      text?; checked?;
      values?: string[];
      files?: { name; url }[];
      people?: { id; label }[];
    }>;
  }[];
  views?: DatabaseView[];
  activeViewId?: string;
  view?: DatabaseView; // legacy single view
}

interface DatabaseView {
  id?; name?;
  type: 'table' | 'board';
  filters: { columnId; operator; value? }[];
  filterMode?: 'and' | 'or';
  groupBy?: columnId;
  sorts?: { columnId; direction }[];
  hiddenColumns?: string[];
  stats?: Record<columnId, 'count' | 'countValues' | 'sum' | 'average' | 'median' | 'min' | 'max'>;
}
```

- `table` defaults to a 3×3 plain-text grid; `database` defaults to Name / Status / Due / Done.
- Column types are text, number, select, multi-select, date, checkbox, URL, files and people.
- Empty cells are omitted, so row data stays compact. `parseDoc` normalizes table grids, database columns, view ids/names, filters, filter mode, multiple sorts, hidden columns and footer statistics.
- `duplicateBlockTree` remaps every row, column and view id, so duplicated pages and pasted blocks never share database identity.

Rendering lives in `SimpleTableView` (`packages/element/src/table-view.ts`) for simple grids and `DatabaseView` (`packages/element/src/database-view.ts`) for typed data. Both cards are `contenteditable="false"`; their cells opt back in as nested editing hosts. The body-level editor ignores events from `.nb-table` and `.nb-db`, exactly as it ignores image captions and image URL inputs. This is the same pattern as the single-editing-host design, scoped one level deeper:

- The card container disables editing so the table structure cannot be typed into.
- Text/URL cells are nested `contenteditable` hosts.
- Number, date, checkbox and select cells are native controls or buttons.
- Tab / Shift+Tab move between cells; Enter moves down; arrow keys cross cell boundaries at caret edges; Escape returns to the document.
- Cell edits commit through `updateDatabase`/`updateTable` without restoring the body selection, which would steal focus from the cell. Text commits use a `mergeKey`, so one typing burst is one undo step.
- A cell write does not rebuild the grid. Both views compare a structural key (columns, rows, views, hidden columns, stats, readonly). Values are synced in place; structure changes re-render and restore focus to the active cell when possible.
- Sorting, filtering, search and grouping are derived at render time (`filteredDatabaseRows`, `searchDatabaseRows`, `groupedDatabaseRows`), so the underlying row order is never mutated.
- A database can hold multiple named views. Each view owns its table/board mode, filters, filter mode, multiple sort keys, grouping, hidden columns and footer statistics. Board cards can be dragged between select, multi-select and checkbox groups; table views can group and collapse by text, number, date, select, multi-select or checkbox columns.
- Column headers open a popover for rename/type/options/insert/delete/sort and expose a resize handle. Row handles open insert/duplicate/delete. Select/multi-select/files/people cells open pickers.
- Shift+click selects a cell rectangle; copy/paste uses TSV and can import spreadsheet ranges.
- Readonly mode disables controls, removes row/column actions and leaves plain text cells non-editable.

Exports are part of the core, not the UI:

- Simple tables emit Markdown pipe tables, HTML `<table>` and TSV; Markdown/HTML table paste creates a simple `table` block.
- Database exports still render a pipe/HTML table from typed rows and preserve the database JSON.
- `blocksToPlainText` and `countWords` include simple-table cells, database rows and cells.

The data view intentionally uses no grid library. 100 rows × 6 columns render in about 12 ms in the benchmark environment; the browser is the layout engine.

## Theming and isolation

The component creates its own shadow root and injects one stylesheet. The host
controls tokens through CSS custom properties. `theme="dark"` sets attributes
that swap the token set; `auto` follows `prefers-color-scheme`. No global CSS is
injected and block content is rendered with DOM APIs and `textContent`, not
HTML strings, except for trusted static icon markup.

## Performance characteristics

- Initial render is O(n) block views and one DOM append per block.
- Typing is O(path to block + changed block + view loop). The view loop skips
  unchanged blocks by reference.
- Data-view cell edits do not rebuild the grid; only structure changes do.
- Undo is O(1) document swap plus a render pass that reuses views.
- Drag moves existing subtrees.
- The main scaling limit is the number of DOM nodes. At 3,000 blocks the editor
  is still responsive (see README benchmarks); 10k+ blocks would benefit from
  windowing, which is on the roadmap.

## Extension points

Today, adding a block type means:

1. Add the type and props to `core/types.ts`.
2. Add defaults/conversion handling in `core/doc.ts` and `core/commands.ts`.
3. Render it in `packages/element/src/block-view.ts`.
4. Add a slash-menu entry and markdown rules.
5. Add HTML/Markdown import/export cases.

This is intentionally explicit: there is no plugin runtime yet, and no hidden
schema registry to fight. A formal block registry can be layered on without
changing the document format.

## Known limitations

- No collaboration/CRDT in the base build; the JSON boundary is the intended
  integration point.
- The optional D1 adapter stores the whole document as one JSON row. D1 caps a
  row at 2 MB, so images belong in R2 and very large documents need splitting or
  a different backend.
- Data views support multiple named table/board views, per-view filters, multi-sort, search, hidden columns, footer statistics and table grouping. Calendar view, per-view column widths and nested filter groups are not implemented yet. Date cells store ISO strings and are edited with a date input.
- Simple tables follow AFFiNE's interaction model: hover row/column handles are overlaid on the first row/column cells, dragging across cells selects a range for copy/cut/clear, handles open AFFiNE-style row/column menus, hover plus controls add rows/columns (including drag-to-add), and row/column background colors are stored on the grid and adapt to the dark theme. Cell text keeps Shift+Enter line breaks, and Markdown export/import round-trips multiline and literal `<br>` text. Text cells, column resize and Markdown/HTML/TSV import are implemented; rich-text cells, merged cells and drag reorder are not yet implemented.
- No synced blocks, comments, math or embeds. Mentions are represented as inline marks with a host-provided provider.
- Page links are references to host-owned documents; there is no page registry, backlink index, page tree or in-editor router.
- Images support URL insertion plus a host-provided `uploadImage` adapter for pasted/dropped files; Nobita does not host storage.
- Code language and callout tone are editable from the block UI.
- Very large documents need virtualized rendering.
- The title is a separate editing host, so text selection cannot span from the
  title into the body (same browser constraint described above).
