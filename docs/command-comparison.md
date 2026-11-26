# AFFiNE → Nobita command comparison

Comparison date: 2026-11-24  
AFFiNE: source `0.27.5` (`e866985`, local clone) and live app `0.27.4`  
Nobita: `0.1.0` (`packages/*`), editor bundle **91.1 KB gzip**

> P0 pass applied 2026-11-24: alignment, date slash commands, Heading 4–6 and
> `Mod-Backspace` are now implemented. A follow-up pass added Move Up / Move
> Down, standard block Copy, the eight-color highlight palette and the
> eight-color text-color palette. Statuses below reflect those passes.

Scope: the **document editor** and its Table / Database surfaces. AFFiNE's
edgeless canvas, cloud account, sync, AI and admin features are listed only as
out-of-scope context.

Legend:

- ✅ implemented with equivalent behavior
- 🟡 partially implemented, different shortcut/UI, or available through another surface
- ❌ not implemented
- — intentionally out of scope for Nobita's editor core

AFFiNE command sources checked:

- `blocksuite/affine/rich-text/src/conversion.ts`, `align.ts`
- `blocksuite/affine/inlines/preset/src/command/config.ts`, `keymap/*`
- `blocksuite/affine/blocks/note/src/{note-keymap,move-block,quick-action,configs/slash-menu}.ts`
- `blocksuite/affine/blocks/{paragraph,list,callout,code,table}/src/*keymap*.ts`
- `blocksuite/affine/blocks/root/src/configs/toolbar.ts`
- `blocksuite/affine/blocks/*/src/configs/slash-menu*.ts`
- `blocksuite/affine/widgets/slash-menu/src/config.ts`
- `blocksuite/affine/data-view/src/view-presets/*/controller/hotkeys.ts`
- `blocksuite/affine/blocks/table/src/table-cell.ts`

## Executive summary

Nobita already covers the writing path well: block insertion, text conversion,
markdown rules, indentation, block move, clipboard, undo/redo and a compact
typed data view.

Against AFFiNE, the remaining gaps are not "missing block types" but
**convenience commands around selection, formatting and data-view querying**.
The P0/P1 passes have already closed alignment, dates, Heading 4–6,
`Mod-Backspace`, move/copy, highlight colors and text colors; the current gaps are:

1. **Inline equation** is absent and needs a math renderer.
2. **Block selection** (Escape, Shift+Arrow, Cmd+A stages) is absent. Nobita can
   select text across blocks, but non-text blocks (image, database, divider, page)
   cannot be selected as blocks.
3. **Database search**, nested typed filters, multi-sort, multiple views, per-view columns, footer statistics, rich-text cells and row pages are implemented; calendar view remains intentionally out of scope.
4. **Database drag selection**, drag fill, row selection/deletion and TSV copy/paste are implemented.
5. **Page workspace / `[[` / comments** are app-level features that should
   not be pulled into the editor core casually. Mentions and page references
   are generic primitives; routing, backlinks and page trees stay in the host.

Recommended order is in [Priorities](#priorities).

## 1. Slash menu (`/`) commands

AFFiNE's `/` menu is broad because it also exposes formatting and line actions.
Nobita keeps `/` focused on block insertion; some AFFiNE entries already exist
in Nobita's toolbar or block menu.

### 1.1 Basic blocks and conversion

| AFFiNE command | AFFiNE shortcut | Nobita | Notes |
| --- | --- | --- | --- |
| Text | `Mod-Alt-0`, `Mod-Shift-0` | ✅ | Mod-Alt-0 only |
| Heading 1 | `Mod-Alt-1`, `Mod-Shift-1` | ✅ | Mod-Alt-1 only |
| Heading 2 | `Mod-Alt-2`, `Mod-Shift-2` | ✅ | Mod-Alt-2 only |
| Heading 3 | `Mod-Alt-3`, `Mod-Shift-3` | ✅ | Mod-Alt-3 only |
| Heading 4–6 | `Mod-Alt-4..6`, `Mod-Shift-4..6` | ✅ | Slash/block menu and `Mod-Alt-4..6`; Shift aliases not mapped |
| Bulleted list | `Mod-Alt-8`, `Mod-Shift-8` | ✅ | Mod-Alt-8 only |
| Numbered list | `Mod-Alt-9`, `Mod-Shift-9` | ✅ | Mod-Alt-9 only |
| To-do list | — | ✅ | — |
| Code block | `Mod-Alt-C` | ✅ | — |
| Quote | — | ✅ | — |
| Callout | — | ✅ | — |
| Divider | `Mod-Alt-D`, `Mod-Shift-D` | 🟡 | Insert via `/`; no hotkey |
| Align left / center / right | `Mod-Shift-L/E/R` | ✅ | Toolbar + slash + hotkeys |
| Bold / Italic / Underline / Strikethrough | `Mod-B/I/U`, `Mod-Shift-S` | 🟡 | Available in toolbar/hotkeys, not in `/` |
| Today / Tomorrow / Yesterday / Now | — | ✅ | Inserts local `YYYY-MM-DD` / `YYYY-MM-DD HH:mm` |
| Move Up / Move Down | — | ✅ | Hotkeys and `/` |
| Copy / Duplicate / Delete line | — | ✅ | Copy in `/` and block menu; Duplicate/Delete and Copy as Markdown in block menu |

### 1.2 Page, media, embeds and math

| AFFiNE command | Nobita | Notes |
| --- | --- | --- |
| New Doc | ✅ | Exposed via `/new-page` and `[[` create-on-the-fly when `pageProvider.create` is set |
| Linked Doc | ✅ | Block-level page cards (`/page`) + inline `[[` page chips (`marks.page`), live `resolvePage` refresh, and core backlinks/page-tree helpers |
| Table (simple table block) | ✅ | Separate `table` block; AFFiNE-style hover handles, row/column drag reorder, rich-text cells, drag cell selection, row/column menus, colors, hover add controls and HTML/Markdown import |
| Image | ✅ | URL-based |
| Link (bookmark card) | 🟡 | Inline links work; no bookmark card |
| Attachment / PDF | ❌ | No file storage/upload layer |
| Embed (generic iframe) | ❌ | — |
| YouTube / GitHub / Figma / Loom | ❌ | — |
| Equation / Inline equation | ❌ | LaTeX renderer not shipped |
| Frame / Mind Map | — | Edgeless-only in AFFiNE |

### 1.3 Database views

| AFFiNE command | Nobita | Notes |
| --- | --- | --- |
| Table View | ✅ | Database block; simple tables are a separate block |
| Calendar View | ❌ | — |
| Kanban View | ✅ | Board view with grouping and card drag |
| Todo data view | ❌ | AFFiNE feature-flagged block query view |

## 2. Text conversion and inline formatting

| AFFiNE command | AFFiNE shortcut | Nobita | Notes |
| --- | --- | --- | --- |
| Bold | `Mod-B` | ✅ | — |
| Italic | `Mod-I` | ✅ | — |
| Underline | `Mod-U` | ✅ | — |
| Strikethrough | `Mod-Shift-S` | ✅ | — |
| Inline code | `Mod-E` | ✅ | — |
| Link | `Mod-K` | ✅ | Link popover, URL normalization/sanitization |
| Alignment | `Mod-Shift-L/E/R` | ✅ | Toolbar, slash menu, hotkeys |
| Highlight colors | Toolbar dropdown | ✅ | Combined Color / Background menu; 8 colors; HTML round-trip; Markdown drops color |
| Text colors | Toolbar dropdown | ✅ | Combined Color / Background menu; 8 colors; HTML round-trip; Markdown drops color |
| Inline equation | Toolbar | ❌ | Needs a math renderer |
| Auto-pair brackets | Type `(`, `[`, `{`, quotes | ❌ | Does not insert closing pair |
| Backtick wraps selection in code | Select text + `` ` `` | ❌ | Inline code shortcut supports markdown only |
| `[[` linked doc conversion | `[[` picker & `[[Title]]` | ✅ | Inline page link picker (`pageProvider`), create-on-the-fly, and exact-title `]]` auto-convert |
| Markdown input rules | `# `, `- `, `1. `, `[] `, `> `, fences, divider | ✅ | Also inline `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, links |
## 3. Block editing and navigation hotkeys

| Command | AFFiNE | Nobita | Notes |
| --- | --- | --- | --- |
| Undo / redo | `Mod-Z`, `Mod-Shift-Z` | ✅ | Title and database cells included |
| Enter split | ✅ | ✅ | Heading/quote/callout at end create paragraph |
| Add block after | `Mod-Enter` | ✅ | — |
| Backspace at start | convert list/heading → text, merge, dedent | 🟡 | Callout/list nuances differ |
| Delete / forward delete | merge next block | ✅ | Images/DB blocks guarded |
| Indent / dedent | `Tab`, `Shift-Tab` | ✅ | Code block Tab inserts spaces |
| Dedent to root | `Mod-Backspace` | ✅ | Dedents the focused block to the document root |
| Move block up/down | `Mod-Alt-Arrow`, `Mod-Shift-Arrow` | ✅ | Both aliases supported |
| Move line up/down via `/` | — | ❌ | Hotkeys and block menu already exist |
| Select all | `Mod-A` (text → block → all blocks) | 🟡 | First block text, then all text; no block-selection stage |
| Escape block selection | `Escape` | ❌ | Escape only closes menus |
| Shift+Arrow block selection | `Shift-ArrowUp/Down` | ❌ | Text Shift+Arrow works |
| Arrow across non-text blocks | Arrow keys | 🟡 | Text blocks only; image/DB not selectable as blocks |
| Block selection + Enter | Enter | ❌ | AFFiNE inserts a paragraph after block selection |
| Create linked doc from selection | `Mod-Shift-L` | ❌ | Conflicts with align hotkey; selection type disambiguates |
| Code bracket auto-pair | type brackets | ❌ | — |
| Code block add paragraph after | `Mod-Enter` | ✅ | Generic add-after works |
| Cell navigation in database | Tab/Shift-Tab, Enter, arrows | ✅ | DatabaseView |
| Row/area selection in database | Shift+Arrows, `Mod-A`, `Delete`/`Backspace` | 🟡 | Drag/Shift-click range and row checkbox selection with `Delete`/`Backspace`; no `Shift+Arrows` or `Mod-A` |
| `/` row menu in database | `/` | ❌ | Column header and row handle menus exist |
| Table cell context menu | right-click / menu | ✅ | Notion-style right-click context menus across blocks (single & multi-block), simple table cells/handles, and database rows/columns/board cards (`Shift+Right-click` preserves native browser menu) |

## 4. Block toolbar and block menu

| AFFiNE action | Nobita | Notes |
| --- | --- | --- |
| Turn into (text, H1–H6, lists, quote, code, callout, divider) | ✅ | Selection toolbar, block menu and slash menu cover the implemented block types |
| Alignment | ✅ | Selection toolbar, slash menu, hotkeys |
| Bold / italic / underline / strike / code / link | ✅ | Selection toolbar |
| Inline equation | ❌ | — |
| Highlight colors | ✅ | Selection toolbar Color / Background menu; 8 colors |
| Text colors | ✅ | Selection toolbar Color / Background menu; 8 foreground colors |
| Create Table from selected blocks | ❌ | Convert selection to database rows |
| Create Linked Doc | ❌ | Page-level feature |
| Comment | ❌ | No comment model |
| Copy block | ✅ | Standard text/HTML copy in the block menu and `/`; Copy as Markdown remains |
| Duplicate | ✅ | Block menu |
| Delete | ✅ | Block menu |
| Indent / outdent | ✅ | Block menu + Tab |
| Drag reorder/nest | ✅ | Gutter drag and drop |
| Add block below | ✅ | Gutter `+` |

## 5. Data views (Table / Database)

AFFiNE has a separate **simple table block** and a **database block** with
table, calendar and kanban views. Nobita now mirrors that split: `table` is a
plain editable grid, while `database` is a typed data view with multiple named
table/board views.

### 5.1 View and query features

| AFFiNE | Nobita | Notes |
| --- | --- | --- |
| Table view | ✅ | Database view; simple tables are a separate `table` block |
| Kanban view | ✅ | Board view with card add/open/reorder, group actions and select/checkbox grouping |
| Calendar view | ❌ | Intentionally out of scope |
| Todo/data view | ❌ | Feature-flagged in AFFiNE |
| Multiple views per database | ✅ | Named table/board views |
| Add / rename / duplicate / delete view | ✅ | View bar and menu |
| Filter | ✅ | Typed operators, nested AND/OR groups |
| Sort | ✅ | Multiple sort keys, empty last |
| Search | ✅ | Live search across visible rows |
| Group by | ✅ | Table: text/number/date/select/multi-select/checkbox; board: select/multi-select/checkbox |
| View options | ✅ | View settings, properties, per-view columns, group settings and layout; date grouping settings remain partial |
| Add row / add column | ✅ | Header/footer and table actions |
| Database title editing | ✅ | Editable inline title and database menu surface |

### 5.2 Properties and cells

| AFFiNE property | Nobita | Notes |
| --- | --- | --- |
| Title / page | 🟡 | Record page side panel with title, properties and rich-text body (`row.page.content`); rows are not standalone workspace pages |
| Text / rich text | ✅ | Rich-text cells (`cell.runs`) with bold/italic/underline/strike/code toolbar and shortcuts; `cell.text` kept in sync |
| Number | ✅ | Native number input |
| Select | ✅ | Single-select with options |
| Multi-select | ✅ | Comma-separated option editing |
| Checkbox | ✅ | — |
| Date | 🟡 | ISO text input; no native picker/calendar |
| Progress | ✅ | Interactive 0–100% progress bar (pointer scrub, keyboard arrows, range slider in record page), numeric sort/filter and `%` stats |
| Image | ✅ | Validated image URL or host `uploadImage` adapter with thumbnail cells, preview popover, and Board card covers (`view.coverColumnId`) |
| Link | 🟡 | URL column behaves as text |
| Created time | ❌ | — |
| Property colors / tags | 🟡 | Select dots colored; no custom tag colors |
| Rename / change type / delete / insert / resize column | ✅ | Column popover and drag handle |
| Move / duplicate / hide column | ✅ | Column popover (move left/right, duplicate, hide in view) and view properties menu |
| Row insert / duplicate / delete | ✅ | Row handle menu |
| Row detail / open as page | ✅ | Row expand button, `Mod+Enter`, and board card click open record page side panel with rich-text body |
| Row/area selection | 🟡 | Drag/Shift-click cell range selection and row checkbox selection |
| Delete selected rows (keyboard) | ✅ | `Delete`/`Backspace` deletes selected rows or clears selected cell ranges |
| Cell background color / merge | ❌ | Simple table block supports cell/row/column background colors; no cell merge |
| Copy/paste cell ranges | ✅ | TSV copy/paste; files/people use pickers |
| Undo / redo | ✅ | Cell edits merge into typing steps |
| Readonly | ✅ | Edits disabled and write actions hidden; view switching and record page viewing remain available |
| JSON / Markdown / HTML table round-trip | ✅ | JSON full; Markdown/HTML values and table structure |

### 5.3 AFFiNE simple-table-only commands

AFFiNE's separate table block additionally offers:

- Insert row above/below, insert column left/right
- Move row up/down, move column left/right
- Duplicate row/column
- Clear row/column contents and style
- Cell/row/column background colors
- Delete row/column

Nobita's separate `table` block covers rich-text cells (`cell.runs`),
row/column drag reorder and insert/move/duplicate/delete, clear row/column
contents, cell range clear/copy/paste and cell/row/column background colors,
while `database` covers row insert/duplicate/delete, column
insert/move/duplicate/hide/delete, and board card reorder. Merged cells in the
simple `table` block remain unimplemented.

## 6. Clipboard, import and export

| Feature | AFFiNE | Nobita |
| --- | --- | --- |
| Rich copy/cut/paste | ✅ | ✅ |
| Cross-block selection copy | ✅ | ✅ |
| HTML paste | ✅ | ✅ incl. `<table>` → database |
| Markdown paste/export | ✅ | ✅ incl. pipe tables |
| Notion HTML import | ✅ | ❌ |
| Block slice copy | ✅ | 🟡 custom JSON + Markdown/HTML |
| Database cell/area copy | ✅ | ✅ TSV range copy/cut/paste |
| Image upload / paste | ✅ | ✅ Host `uploadImage` adapter (block paste/drop & database image cells) |
| Attachment / PDF import | ✅ | ❌ |
| Page Markdown/JSON export | App-level | ✅ demo |
| Import/export app workflows | ✅ | ❌ |

## 7. Page and workspace shell (demo scope)

These are AFFiNE app commands, not BlockSuite editor commands. Nobita's demo
implements a small subset deliberately.

| AFFiNE | Nobita demo |
| --- | --- |
| New page / nested page | ✅ |
| Drag-and-drop page tree / reparent | ✅ |
| Favorites | ✅ |
| Search pages | ✅ title + full-text block search with jump-to-block |
| Duplicate / rename / delete page | ✅ |
| Export Markdown / JSON | ✅ |
| Theme | ✅ |
| Embed/integration demo | ✅ (Nobita-specific) |
| Backlinks | ✅ live collapsible backlinks panel with source snippet and jump-to-block |
| Trash | ✅ soft delete (`deletedAt`), Trash view with search, read-only preview banner, Undo toast, restore (with parent fallback) and permanent delete / Empty trash |
| Right-click page menu | ✅ right-click context menu on sidebar pages (active & trashed) |
| Templates | ❌ |
| Journals | ❌ |
| Tags / collections | ❌ |
| Backlinks / outline / references | ❌ |
| Comments / history | ❌ |
| Share / sync / permissions | ❌ |
| Import from Notion | ❌ |

## 8. Intentionally out of scope

These are large subsystems or product surfaces. They should not be pulled into
the editor core just for parity:

- **Edgeless canvas:** frame, mind map, shape, connector, group, surface refs.
- **Cloud/product:** sync, sharing, permissions, history, notifications, telemetry.
- **Collaboration:** comments, presence, CRDT.
- **Media platform:** attachments, PDF viewer, managed image hosting, bookmark previews,
  YouTube/GitHub/Figma/Loom/iframe embeds.
- **Math:** LaTeX rendering and inline equations.
- **Navigation graph:** linked docs, backlinks, synced docs.
- **Full data-view framework:** calendar view, progress/image properties and
  formulas/relations (rich-text cells and row pages are implemented).
- **AI features.**

## 9. Priorities

### P0/P1 — implemented

- ✅ **Alignment** (`Mod-Shift-L/E/R`, toolbar group, `/` entries).
- ✅ **Date slash commands** (`/today`, `/tomorrow`, `/yesterday`, `/now`).
- ✅ **Heading 4–6** in slash menu, block menu, `Mod-Alt-4..6`, CSS, Markdown
  and HTML.
- ✅ **`Mod-Backspace`** dedents the focused block to the document root.
- ✅ **Move Up / Move Down** in `/`, reusing the sibling-aware `moveBlock`
  command.
- ✅ **Standard block Copy** in `/` and the block menu, using the same
  text/HTML/private-JSON serialization as selection copy.
- ✅ **Highlight colors** (P1): combined Color / Background menu in the
  selection toolbar, HTML `<mark>` round-trip, Markdown degradation.
- ✅ **Text colors** (P1): eight-color foreground palette, default-color reset,
  HTML `<span data-nb-color>` round-trip, Markdown degradation.
- ✅ **Block selection model** (P1): selected block IDs independent of text
  range (`Escape`, gutter `Shift`/`Mod`-click, staged `Mod+A`, `Shift+Arrow`,
  `Enter` to insert after, `Backspace`/`Delete` batch delete, `Mod+D` batch
  duplicate, batch `copy`/`cut`/`paste`, multi-block drag, and non-text block
  selection for `divider`/`image`/`table`/`database`/`page`).

### P0 — remaining small wins

1. **Divider + conversion aliases.**
   - `Mod-Alt-D`, `Mod-Shift-D`; add `Mod-Shift-0–6`, `8`, `9` aliases.
   - Est. <0.5 KB.

### P1 — remaining

1. **Database calendar view.**
   - Rich-text cells, editable row pages and board add/reorder/group actions are now implemented. Calendar remains intentionally out of scope.
2. **Create Table from selected blocks** (toolbar/block selection).
   - Convert selected blocks into database rows (builds on the block selection model).
   - Est. 2–3 KB.
3. **Bracket auto-pair and backtick-wrap-selection.**
   - Text-only, small but edge-case heavy.
   - Est. 1–2 KB.

### P2 — large or scope expansion

- Calendar database view (intentionally out of scope).
- Database formulas and relations (progress/image properties and Board card covers are implemented).
- ✅ **Page workspace primitives (`[[` links, backlinks, page tree)**: `PageProvider`, `[[` inline page picker with create-on-the-fly and `[[Title]]` conversion, `/page` and `/new-page` slash commands, atomic inline page chips (`marks.page`) with live `resolvePage` refresh, plus DOM-free `@nobita/core` backlink index, cycle-safe page tree, breadcrumbs, reparent validation and full-text search wired into the demo workspace.
- Comments and collaboration.
- Attachments/PDF, managed image hosting, bookmark previews, embeds.
- LaTeX/equation blocks.
- Simple table merged cells (rich-text cells and row/column drag reorder are implemented).
- Edgeless, AI, cloud import/sync.

## 10. What to avoid for Nobita's identity

- Do not add a grid/spreadsheet library for the current table view.
- Do not make rows pages until linked docs and a page registry exist.
- Do not add network previews (bookmarks/embeds) to the core bundle; treat them
  as host-provided blocks/adapters.
- Do not chase AFFiNE's edgeless or AI surfaces.
- Prefer commands that reuse the existing block tree, inline runs and immutable
  store over new document primitives.

The current editor is 91.1 KB gzip. Phase 1 data views added about 7.5 KB gzip,
Phase 2 references/input added about 2.4 KB, page links about 1.3 KB, table/database P1 about 27.0 KB and the
database UI alignment/hover/toolbar pass about 0.6 KB and the P2 rich-text/row-page/board pass about 4.4 KB; remaining items are incremental on top of the existing view model.
