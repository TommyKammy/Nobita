# AFFiNE analysis → Nobita design notes

Analysis date: 2026-11-23 · AFFiNE 0.27.5 (source) / app.affine.pro 0.27.4 (live bundle)

The observations below describe that AFFiNE release. The Nobita comparison was checked against the implementation on 2026-11-27. See the [command comparison](command-comparison.md) for individual actions and shortcuts.

## Evidence collected

| What | How | Evidence |
| --- | --- | --- |
| Live editor loaded without login (local-first workspace) | Chrome 158 + CDP, REA `list_browser_targets` | `ev_32a5034351c26253edc195935969710af333e1f97475ad1e4f5648298c74c969` |
| Editor DOM: 8,070 nodes, custom elements per block, `data-block-id` | REA `inspect_web_page` | `ev_99dd4a554a34fca3056f66077c31609714ad4a7d5ee040a8993b7ca6adbee089` |
| Editor geometry & typography (computed CSS) | CDP `Runtime.evaluate` on the live page | capture recorded in this analysis |
| Block/rich-text architecture | Source: `blocksuite/affine/model`, `blocksuite/framework/std/src/inline` | commit at clone time |
| Slash-menu inventory, conversion configs, hotkeys | Source: `blocksuite/affine/rich-text/src/conversion.ts`, `blocks/*/configs/slash-menu.ts` | — |

Own-words summary; no AFFiNE code is copied into Nobita.

## What the AFFiNE app rendered on 2026-11-23

- Each block is a custom element (`affine-paragraph`, `affine-list`, `affine-note`, …) with `data-block-id`.
- The page is a `affine-page-root` → `affine-note` (content column). Note width measured **752 px** at a 1440 px viewport, block row height **24 px** (16 px text) and **~10 px** block gap.
- Font stack: `Inter, "Source Sans 3", Poppins, -apple-system, system-ui, "Helvetica Neue", …`; base text **16 px**, primary ink `#121212`, paper `#fff`.
- Editing is **per-block contenteditable** with a shared rich-text engine, not one giant contenteditable.
- First-run workspace is local (IndexedDB + `nbstore` shared worker) and fully usable without an account.

## Architectural takeaways from AFFiNE

1. **Block tree + schema registry.** A block is `{ id, flavour, props, children }`; text is a CRDT (`Y.Text`) serialized as a delta. Schemas declare allowed parents and a version.
2. **Delta text model.** Rich text is `DeltaInsert[]` (`{ insert, attributes }`), rendered to spans; native `Range` is converted to text offsets and back. Marks are a small object (`bold/italic/underline/strike/code/link/color`).
3. **Per-block editable, cross-block selection.** Each block owns a contenteditable root; the editor layer maps multi-block native selections to block+offset pairs for delete/format/copy.
4. **Controlled input.** `beforeinput` is intercepted for text, split, delete, paste and markdown; composition is left to the browser and reconciled from the DOM afterwards.
5. **Commands, not mutations.** Slash menu, hotkeys, drag-handle menu and markdown rules all dispatch the same conversion commands (`updateBlockType`, `indent/dedent`, `move`, `format`).
6. **Widgets are overlays.** Slash menu, block hub, format bar and drag handle are positioned portals driven by selection/geometry, so block rendering stays cheap.

## Document editor interactions

| Area | AFFiNE behaviour | Nobita |
| --- | --- | --- |
| Block types | text, h1–h6, bulleted/numbered/todo, quote, code, divider, callout, image, bookmark, embed, database, table, latex | text, h1–h6, bulleted/numbered/todo, quote, code, divider, callout, image, page cards, simple tables and databases |
| Slash menu | grouped, searchable, aliases, submenu for h4–h6 | grouped + fuzzy search + aliases |
| Hotkeys | `Mod-Alt-0..9`, `Mod-Alt-c/d`, `Mod-Enter`, `Mod-Alt-ArrowUp/Down`, `Mod-a` | `Mod-Alt-0..6`, `8`, `9` and `C` convert blocks. Use `/` for a divider. `Mod-Enter` inserts a paragraph, `Mod-Alt-Up/Down` moves a block, and staged `Mod-A` selects block text then all top-level blocks |
| Markdown input | `# `, `- `, `1. `, `[] `, `> `, ` ``` `, `---` | same + inline `**bold**`, `*italic*`, `` `code` ``, `~~strike~~` |
| Drag handle | hover gutter, click menu, drag reorder, drop indicator | same |
| Toolbar | selection format bar + link editor | same, compact |
| Persistence | local-first IndexedDB, optional sync | JSON in/out; demo localStorage; optional `@nobita/storage` adapters (localStorage, SQLite/D1, HTTP) |

## Deliberate divergences

Nobita is not a BlockSuite port. It targets **embeddability and payload size**:

- Zero runtime dependencies; no Lit, signals, RxJS or Yjs in the default build.
- Direct DOM rendering uses per-block views and immutable path-copy updates. Long documents render a window of blocks while the full document remains in the model.
- Hosts persist the plain JSON `Doc`. The editor uses the private MIME type `application/x-nobita+json` on the clipboard to preserve structured selections.
- Shadow-DOM web component so host CSS cannot leak in; themeable through CSS custom properties.
- Optional Yjs and Automerge adapters handle collaborative edits, offline merges and local undo/redo. The host supplies transport and persists CRDT history.

## Source-level findings (AFFiNE 0.27.5 checkout)

AFFiNE's editor is BlockSuite. The parts that matter for Nobita:

### Block schema

`blocksuite/affine/model/src/blocks/paragraph/paragraph-model.ts`

- A block is declared with `defineBlockSchema({ flavour, props, metadata, toModel })`.
- `flavour` is a stable string (`affine:paragraph`, `affine:list`, …).
- Props include the rich text object (`internal.Text()`), a type discriminator
  (`text | quote | h1…h6`), alignment, collapse state and comment anchors.
- `metadata` declares a schema `version`, a `role` and allowed parents. This is
  how the editor knows a paragraph may live inside a note, callout or list.
- `ParagraphBlockModel.isEmpty()` is simply "no text and no children".

`blocksuite/affine/model/src/blocks/list/list-model.ts`

- List type is `bulleted | numbered | todo | toggle` (toggle deprecated).
- `checked` and `order` are props; `order` is only meaningful for numbered
  lists. Numbering is therefore explicit data, not inferred at render time.

`blocksuite/affine/model/src/blocks/root` and the `affine:note` block split the
page into a root, a note/content column and content blocks. Edgeless mode reuses
the same block schemas on a surface.

### Rich text

`blocksuite/affine/rich-text/src/rich-text.ts`

- Each block hosts an `InlineEditor` bound to a `Y.Text`.
- Text is a delta (`Y.Text.toDelta()`), rendered into line/element nodes.
- Copy and cut read `yTextString` and the inline range; paste inserts text
  through the editor service.
- `blocksuite/framework/std/src/inline/` contains the real engine: text, delta,
  range, attribute, render and event services plus DOM-point ⇄ text-point
  conversion. This is the part whose complexity Nobita avoids by not building a
  CRDT-backed inline editor.

### Command surfaces

`blocksuite/affine/rich-text/src/conversion.ts`

- One `TextConversionConfig[]` powers the slash menu, format bar and hotkey
  bindings. Entries include flavour, type, name, description, hotkeys and icon.
- Representative bindings: `Mod-Alt-0..6` for text/headings, `Mod-Alt-8/9` for
  bulleted/numbered lists, `Mod-Alt-c` for code, `Mod-Alt-d` for divider.
- Slash descriptions are short actions ("Create a bulleted list.", "Code
  snippet with formatting."), not feature prose.

`blocksuite/affine/blocks/note/src/configs/slash-menu.ts`

- The note slash menu is assembled from conversion configs and filtered by
  `when` predicates (block available, not inside edgeless text).
- Items carry groups (`0_Basic@…`, `1_List@…`, …), icons, tooltips, aliases and
  actions that dispatch the same commands as hotkeys.

`blocksuite/affine/blocks/note/src/note-keymap.ts`

- Keybindings are registered in one keymap table (`Mod-Alt-…` conversions,
  `Shift-Tab` dedent, `Mod-Backspace`, `Mod-a`, move-block shortcuts) and call
  commands rather than touching DOM directly.

### Runtime observations (app.affine.pro 0.27.4)

- Blocks are custom elements (`affine-page-root`, `affine-note`,
  `affine-paragraph`, `affine-list`) carrying `data-block-id`.
- The content column measured 752 px at a 1440 px viewport; body text 16 px with
  a 24 px line box, block gap ~10 px.
- Font stack starts with Inter; primary ink `#121212` on white.
- The first-run workspace is local (IndexedDB plus an `nbstore` shared worker)
  and usable without an account.
- REA browser evidence: `ev_32a5034351c26253edc195935969710af333e1f97475ad1e4f5648298c74c969` (target discovery), `ev_99dd4a554a34fca3056f66077c31609714ad4a7d5ee040a8993b7ca6adbee089` (DOM/a11y inspection), plus a CDP computed-style capture.

## How Nobita answers each idea

| AFFiNE idea | Nobita implementation |
| --- | --- |
| Schema-declared blocks | TypeScript union + typed props, explicit defaults and conversion functions |
| Delta rich text | Plain `InlineRun[]` with a small mark set |
| Per-block inline editors | Document text blocks share one editable body for cross-block selections. The title and table cells have their own editing controls |
| Yjs text | Plain JSON runs in core, with optional collaboration adapters |
| Command layer | Pure document and command functions in `packages/core/src` |
| Slash menu config list | One `MenuItem[]` builder per menu surface |
| Lit/web components | Zero-dependency DOM and a `<nobita-editor>` custom element |

### Data views

The AFFiNE checkout has a simple table block under `blocksuite/affine/blocks/table/`. Its database block stores properties, rows and views. The table view of a database is one of the presets under `blocksuite/affine/data-view/`.

Nobita also has two distinct blocks:

- A `table` is an editable grid with rich-text cells, row and column operations, and rectangular cell merging and splitting. HTML preserves merged spans. Markdown and TSV keep the text in the anchor cell and leave covered positions empty.
- A `database` stores typed properties, rows and named table or board views. Views support nested filters, sorting and grouping. Properties include formulas and bidirectional relations. A record can have its own rich-text body in `row.page.content` and opens in a detail panel.

Both blocks use the editor’s document store for editing and undo. For the supported property types and examples, see [Data views in the README](../README.md#data-views).

## What Nobita deliberately does not copy

- **BlockSuite's runtime and schemas.** No Lit, signals, RxJS or Yjs in the
  default bundle, and no attempt to be wire-compatible with BlockSuite docs.
- **Per-block contenteditable inside shadow DOM.** Chromium clamps cross-block
  ranges in that setup, so Nobita uses a single editable body while keeping
  block-level selection and rendering.
- **Edgeless mode and AI panels.** Nobita focuses on the document editor. Its demo provides a page tree, search, backlinks and trash.
- **Hosted sync.** Hosts choose their storage and, for collaborative sessions, the transport between replicas.
