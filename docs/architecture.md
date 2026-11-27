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
@nobita/react     React host wrapper
@nobita/collab-yjs        optional Yjs adapter and awareness integration
@nobita/collab-automerge  optional Automerge adapter
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

Core recognizes `custom:` block types during parsing. It retains the type and JSON payload in `props.data` alongside the standard text runs and children. A client with custom-block support can edit another block and save the document as Nobita JSON even when it has no renderer for the custom type. [Document parser](../packages/core/src/serialize.ts)

Inline marks are five boolean flags (`bold`, `italic`, `underline`, `strike`,
`code`) plus atomic mention and page references and three formatting values: `link` (a URL string), `highlight` (background)
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

## Collaborative editing

A host connects a `CollaborationAdapter` through `editor.setCollaboration(adapter)`. The editor loads its collaboration bridge on demand. The bridge sends local document patches to the adapter and applies remote snapshots to the store, remapping selections as edits arrive. It coordinates IME composition with remote updates. The host supplies transport and, optionally, peer presence.

Yjs peers synchronize a shared Y.Doc. Automerge peers start from the same saved document history and merge subsequent snapshots with `receive(bytes)`. While connected, the store delegates Undo/Redo to the adapter so local undo preserves peer edits. Attaching or detaching starts a fresh history. Disconnect before switching document IDs. [Adapter entry points and lifecycle](public-api.md#collaboration-adapters)

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
read-modify-write cycle. In the SQL adapter, version zero is create-only, a positive version guards the update, and an unconditional upsert returns the version and timestamp from its own write.

Cloudflare D1 deployment, the SQL schema and its row-size limits are documented
in [storage.md](storage.md). The Worker example is in
[`examples/cloudflare-d1`](../examples/cloudflare-d1).

Page references keep that boundary: a `page` block stores only
`{ pageId, pageTitle, pageIcon? }`. The host supplies routing through
`onOpenPage` and optional cached metadata through `resolvePage`; the editor
never loads or embeds the referenced document. This keeps one `Doc` small and
avoids turning page navigation into a second document tree.

## Rendering

Each mounted block has a `BlockView` with a stable root element and child views in a
`Map<blockId, BlockView>`. On a change, `NobitaEditor.#syncBody` walks the block
list and reuses views by id:

- If the `Block` reference is unchanged and the layout context is unchanged,
  the view is skipped.
- If the text array changed, only that block's runs are rebuilt.
- If the children array changed, child views are reconciled recursively.
- Reordering mounted siblings moves their existing elements within the container.

At 300 top-level blocks the default renderer switches to a viewport window with 800 px of overscan on each side. Spacer elements represent omitted ranges. The virtualizer maps descendant IDs to their top-level block and uses cumulative heights to locate the viewport. It pins active selections, IME composition, dragging and open record panels. Printing temporarily mounts the full document.

Text edits copy the path to the changed block. If one path changed and its IDs, child layout and top-level type still match, the virtualizer reuses its index and cumulative heights. Bulk replacements rebuild the index directly. A ResizeObserver updates measured heights when content wraps or changes size. Model-based navigation can reveal an unmounted block with `scrollToBlock(id)`.

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
- Readonly mode disables the body editing host and updates the mounted views and their nested controls.

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
heading shows its localized heading label (English defaults range from `Heading 1` to `Heading 6`). Nothing is shown while the page title, a
database cell, an image caption, or a non-empty block has focus, and the
placeholder disappears as soon as the block has any text. The editor updates
this state from the live selection, focus changes, composition events and store
changes rather than from a document-wide "is empty" flag.

## Menus, toolbar and drag

- The slash menu is a positioned overlay inside the shadow root. The `/` and
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
  rows: { id; backgroundColor?; cells: Record<columnId, { text; runs?: InlineRun[]; rowspan?; colspan? }> }[];
}
```

A `database` block stores typed columns, row records and named views:

```ts
interface DatabaseData {
  variant: 'database' | 'table'; // 'table' is legacy-only
  title?: string;
  titleColumnId?: string;
  columns: { id; name; type; options?; data?; width?; formula?; relation? }[];
  rows: {
    id;
    cells: Record<columnId, {
      text?; runs?: InlineRun[]; checked?;
      values?: string[];
      files?: { name; url }[];
      people?: { id; label }[];
      relations?: DatabaseRelationRef[];
    }>;
    page?: { content: InlineRun[] };
  }[];
  views?: DatabaseView[];
  activeViewId?: string;
  view?: DatabaseView | null; // legacy single view
}

interface DatabaseView {
  id?; name?;
  type: 'table' | 'board';
  filters: DatabaseFilter[];
  filter?: { type: 'group'; op: 'and' | 'or'; conditions: FilterNode[] };
  columns?: { id; width?; hide?; stat? }[];
  groupBy?: columnId;
  groupProperties?: { key; hide?; collapsed?; manuallyCardSort? }[];
  hideEmptyGroups?: boolean;
  sorts?: { columnId; direction }[];
  header?: { titleColumnId?; iconColumnId? };
  coverColumnId?: string | null;
}

type FilterNode =
  | { type?: 'filter'; columnId; operator; value? }
  | { type: 'group'; op: 'and' | 'or'; conditions: FilterNode[] };
```

- `table` defaults to a 3×3 plain-text grid; `database` defaults to Name / Status / Due / Done.
- Database columns support text, number, progress, select, multi-select, date, checkbox, URL, image, files, people, relation and formula. Board views can use an image property for card covers.
- A formula stores its expression with column IDs. `DatabaseEvalContext` projects calculated cells for display, queries and export. `storedDatabase` removes transient calculated values before commit. Relations store target row IDs and can pair with a reverse column. Same-document reverse updates belong to the same history entry. Hosts resolve external databases and receive paired changes through `onRelationSync`.
- A paired update copies the target row array on its first write and builds a row-ID index on repeated lookup. Grouped searches reuse the filtered and sorted rows for the current view.
- Text cells can carry rich `runs`; `text` remains the plain projection used by filters, search, statistics, TSV and exports. Row pages store a rich-text `page.content` body.
- Empty cells are omitted, so row data stays compact. `parseDoc` normalizes table grids, database columns, rich runs, row pages, view ids/names, nested filters, view columns, group settings and title columns.
- Legacy `filters` / `filterMode` / `hiddenColumns` / `stats` fields are accepted and converted to the v2 view shape. Writers keep `filters` and `filterMode` as compatibility aliases for flat roots.
- Database duplication generates new row, column and view IDs. It remaps filter and formula references and redirects self-relations to the copied database.
- The table consumes view columns in their saved order and width; the title column is explicit (`titleColumnId`) but falls back to the first column for older documents.

Rendering lives in `SimpleTableView` (`packages/element/src/table-view.ts`) for simple grids and `DatabaseView` (`packages/element/src/database-view.ts`) for typed data. Both cards are `contenteditable="false"`; their cells opt back in as nested editing hosts. The body-level editor ignores events from `.nb-table` and `.nb-db`, exactly as it ignores image captions and image URL inputs. This is the same pattern as the single-editing-host design, scoped one level deeper:

- The card container disables editing so the table structure cannot be typed into.
- Table cells support click, Shift+click and drag range selection. Drag the fill handle to copy the focused cell down a single column.
- The row gutter exposes hover row selection and dragging; selected rows can be copied, cut or deleted.
- The row expand control opens a record page with previous/next navigation, inline title/property editing, Add Property and a persistent rich-text page body.
- Text cells store rich runs plus a plain text projection. A floating B/I/U/S/code toolbar and keyboard shortcuts edit marks; filters, search, statistics, TSV and exports keep using the plain text.
- Board cards can be added from group headers or the group footer, opened from card actions, reordered within a group, moved between groups and deleted from the group menu. Manual card order is stored per group.
- Column headers open the AFFiNE-style menu: number format, hide in view, filter, sort, insert, move, duplicate and delete. Headers can be resized and reordered.
- Root data views use an 8px surface bleed with matching inner padding, so the table edge aligns with body text and the 24px row gutter indents column content (AFFiNE geometry).
- The header is split into a title/count row and a viewbar/tools row. View tools fade in on hover or keyboard focus and stay visible while a popover is open; touch devices show them permanently.
- The viewbar keeps view tabs and the add-view control. The hover toolbar exposes Filter, Search, View settings (`⋯`) and New Record. View settings contains view name, table/board layout, properties, filter, sort, group, view move, duplicate and delete.
- Search expands from a 28px icon to a 168px field with a clear control and Escape handling. Below 560px it is hidden so view tabs and New Record keep their space; crossing that breakpoint clears an active query so filtered rows never outlive the visible clear control.
- Filter builders support nested AND/OR groups, per-type operators and a chip summary. The chip bar stays hidden until the filter control opens it; readonly views show existing filters without the toggle. Sort supports multiple keys. Group settings persist order, visibility and collapsed state, and can hide empty groups.
- Footer statistics stay hidden until the footer is hovered or focused; calculated statistics remain visible.
- The add-column header stays pinned right and the New Record label stays pinned left while the table scrolls horizontally. Row actions overlay the title cell instead of reserving width.
- Cell edits commit through `updateDatabase`/`updateTable` without restoring the body selection, which would steal focus from the cell. Text commits use a `mergeKey`, so one typing burst is one undo step.
- A database edit updates visible cells in place when grid structure and displayed row order still match. A change to filtering, sorting or grouping can require a new layout.
- Sorting, filtering, search and grouping are derived at render time (`filteredDatabaseRows`, `searchDatabaseRows`, `groupedDatabaseRows`), so the underlying row order is never mutated.
- A database can hold multiple named views. Each view owns its table/board mode, nested filters, sort keys, grouping, view columns, hidden columns and footer statistics. Board cards can be dragged between select, multi-select and checkbox groups and reordered within a group.
- Select/multi-select/files/people cells open pickers. Copy/paste uses TSV and can import spreadsheet ranges.
- Readonly mode disables controls, removes row/column actions and leaves plain text cells non-editable.

Exports are part of the core, not the UI:

- Simple tables support rich-text cells, axis reordering and rectangular merges. The anchor cell stores the spans. HTML preserves merged geometry, while Markdown and TSV emit the anchor text and empty covered positions. Markdown/HTML table paste creates a simple `table` block.
- Database exports still render a pipe/HTML table from typed rows and preserve the database JSON.
- `blocksToPlainText` and `countWords` include simple-table cells, database rows and cells.

## Theming and isolation

The component creates its own shadow root and injects one stylesheet. The host
controls tokens through CSS custom properties. `theme="dark"` sets attributes
that swap the token set; `auto` follows `prefers-color-scheme`. No global CSS is
injected and block content is rendered with DOM APIs and `textContent`, not
HTML strings, except for trusted static icon markup.

## Performance characteristics

- Initial window construction indexes the document tree and estimates top-level heights. DOM work scales with mounted blocks and their children. The document model stays in memory.
- A single-block edit still compares sibling references. It usually avoids rebuilding the index, allocating a height array and rendering offscreen views.
- Local history restores immutable document snapshots. Collaborative history uses adapter operations.

See the [measured editing times and bundle sizes](../README.md#performance) and [CI performance limits](testing.md#performance-benchmark).

## Extension points

### Custom block renderers

The host registers a renderer by type with `editor.registerCustomBlock(type, renderer)`. Each editor owns its renderer map, so two editors can display the same saved block differently. Registration, replacement and removal refresh matching mounted views. A block mounted later, including after virtual eviction, reads the current map.

`BlockView` places the returned DOM node or text inside a non-editable widget and renders the block’s children normally. When the renderer is absent or throws, the widget displays the type name. Passing `null` removes the renderer. Registration changes the view only. An independent, editor-local `registerSlashBlock` registry supplies host insertion commands to the slash menu. [Host-defined block API](public-api.md#host-defined-blocks) · [Block view](../packages/element/src/block-view.ts)

### UI dictionaries

At construction the editor copies the host’s message overrides. Menus, formatting toolbars and database views use that instance’s translator for visible text and accessible names. A missing key resolves to its English message. User content and saved property names stay in the document model. The Japanese messages ship in a separate module, `@nobita/element/locales/ja`. [Dictionary API](public-api.md#ui-dictionaries)

The slash menu matches both translated and original English command labels. During IME composition the editor leaves candidate navigation and confirmation to the input method and refreshes the slash query when composition ends. [Menu implementation](../packages/element/src/menu.ts)

## Known limitations

- Windowing applies to top-level blocks. An individual large table or database still renders its own view.
- The D1 adapter stores each document as a single JSON row. Database row-size limits apply to that payload. [Storage details](storage.md)
- Database views support table and board layouts. Record pages store a rich-text body. Page navigation, document loading, collaboration transport and image storage belong to the host. Core supplies backlink, page-tree, search and Trash helpers.
- The title and body are separate editing hosts, so a native text selection cannot span both.
- Synced blocks, comments, math and embeds remain outside the current block model.
