# AFFiNE → Nobita command comparison

Comparison date: 2026-11-24  
AFFiNE: source `0.27.5` (`e866985`, local clone) and live app `0.27.4`  
Nobita: `0.1.0` (`packages/*`), editor bundle **59.2 KB gzip**

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
3. **Database search** is absent; filters, grouping and board views are implemented.
4. **Database keyboard row deletion** is absent; cell range selection and copy/paste are implemented.
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
| New Doc | ❌ | Demo shell can create pages; not exposed from `/` |
| Linked Doc | ◐ | Page reference block + host routing; no page registry or backlinks |
| Table (simple table block) | 🟡 | Nobita "Table" is the table view of a database block |
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
| Table View | ✅ | Nobita `Database` / `Table` variants |
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
| `[[` linked doc conversion | `[[` with selected text | ❌ | Page-level feature |
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
| Row/area selection in database | Shift+Arrows, `Mod-A`, `Delete`/`Backspace` | ❌ | Only cell-level navigation |
| `/` row menu in database | `/` | ❌ | Column header and row handle menus exist |
| Table cell context menu | right-click / menu | 🟡 | Simple table block not implemented; database has row/column menus |

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
table, calendar and kanban views. Nobita uses one `database` block with
`variant: 'table' | 'database'`, currently rendering a table view.

### 5.1 View and query features

| AFFiNE | Nobita | Notes |
| --- | --- | --- |
| Table view | ✅ | Both `Table` and `Database` variants |
| Kanban view | ✅ | Board view with select/checkbox grouping and card drag |
| Calendar view | ❌ | Needs date property + calendar grid |
| Todo/data view | ❌ | Feature-flagged in AFFiNE |
| Multiple views per database | ❌ | One saved view per block |
| Add / rename / duplicate / delete view | ❌ | — |
| Filter | ✅ | Column/operator/value filters |
| Sort | ✅ | Asc/desc/clear, empty last |
| Search | ❌ | — |
| Group by | ✅ | Select, multi-select and checkbox columns |
| View options | ❌ | Hide empty groups, date settings, etc. |
| Add row / add column | ✅ | Header and footer buttons |
| Database title editing | ❌ | Label is fixed ("Table"/"Database") |

### 5.2 Properties and cells

| AFFiNE property | Nobita | Notes |
| --- | --- | --- |
| Title / page | ❌ | Rows are plain data, not pages |
| Text / rich text | ✅ | Plain text only |
| Number | ✅ | Native number input |
| Select | ✅ | Single-select with options |
| Multi-select | ✅ | Comma-separated option editing |
| Checkbox | ✅ | — |
| Date | 🟡 | ISO text input; no native picker/calendar |
| Progress | ❌ | — |
| Image | ❌ | — |
| Link | 🟡 | URL column behaves as text |
| Created time | ❌ | — |
| Property colors / tags | 🟡 | Select dots colored; no custom tag colors |
| Rename / change type / delete / insert / resize column | ✅ | Column popover and drag handle |
| Move / duplicate / hide column | ❌ | — |
| Row insert / duplicate / delete | ✅ | Row handle menu |
| Row detail / open as page | ❌ | — |
| Row/area selection | 🟡 | Cell range selection; row selection only |
| Delete selected rows (keyboard) | ❌ | Cell text deletion works |
| Cell background color / merge | ❌ | Simple table feature in AFFiNE |
| Copy/paste cell ranges | ✅ | TSV copy/paste; files/people use pickers |
| Undo / redo | ✅ | Cell edits merge into typing steps |
| Readonly | ✅ | Controls disabled, actions hidden |
| JSON / Markdown / HTML table round-trip | ✅ | JSON full; Markdown/HTML values and table structure |

### 5.3 AFFiNE simple-table-only commands

AFFiNE's separate table block additionally offers:

- Insert row above/below, insert column left/right
- Move row up/down, move column left/right
- Duplicate row/column
- Clear row/column contents and style
- Cell/row/column background colors
- Delete row/column

Nobita's database table covers insert/duplicate/delete rows and insert/delete
columns, but not cell colors, merges, row/column move, or clear-style actions.
A separate simple table block is probably not worth the payload unless those
table-specific actions become a priority.

## 6. Clipboard, import and export

| Feature | AFFiNE | Nobita |
| --- | --- | --- |
| Rich copy/cut/paste | ✅ | ✅ |
| Cross-block selection copy | ✅ | ✅ |
| HTML paste | ✅ | ✅ incl. `<table>` → database |
| Markdown paste/export | ✅ | ✅ incl. pipe tables |
| Notion HTML import | ✅ | ❌ |
| Block slice copy | ✅ | 🟡 custom JSON + Markdown/HTML |
| Database cell/area copy | ✅ | 🟡 single-cell native only |
| Image upload / paste | ✅ | ❌ URL only |
| Attachment / PDF import | ✅ | ❌ |
| Page Markdown/JSON export | App-level | ✅ demo |
| Import/export app workflows | ✅ | ❌ |

## 7. Page and workspace shell (demo scope)

These are AFFiNE app commands, not BlockSuite editor commands. Nobita's demo
implements a small subset deliberately.

| AFFiNE | Nobita demo |
| --- | --- |
| New page / nested page | ✅ |
| Favorites | ✅ |
| Search pages | ✅ title search only |
| Duplicate / rename / delete page | ✅ |
| Export Markdown / JSON | ✅ |
| Theme | ✅ |
| Embed/integration demo | ✅ (Nobita-specific) |
| Trash | ❌ |
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
- **Full data-view framework:** row pages, calendar/kanban views, filters,
  grouping, multi-select, progress/image properties, view tabs.
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

### P0 — remaining small wins

1. **Divider + conversion aliases.**
   - `Mod-Alt-D`, `Mod-Shift-D`; add `Mod-Shift-0–6`, `8`, `9` aliases.
   - Est. <0.5 KB.

### P1 — remaining

1. **Block selection model.**
   - Selected block ids independent of text range.
   - Escape, gutter click, Shift+Arrow, Cmd+A stages, Enter to insert after,
     Delete selected, batch duplicate/copy.
   - Makes image/database/divider selectable and unlocks table-from-selection.
   - Est. 4–6 KB plus careful tests.
2. **Database search.**
   - Search over cell text; derived rows, no schema break.
3. **Multiple saved views, column move/hide/duplicate.**
   - View tabs and configuration; reuse the existing view model.
4. **Create Table from selected blocks** (toolbar/block selection).
   - Convert blocks into database rows; requires block selection first.
   - Est. 2–3 KB.
6. **Bracket auto-pair and backtick-wrap-selection.**
   - Text-only, small but edge-case heavy.
   - Est. 1–2 KB.

### P2 — large or scope expansion

- Calendar database view.
- Row detail pages / title property / page-per-row.
- Page workspace navigation, `[[`, backlinks.
- Comments and collaboration.
- Attachments/PDF, managed image hosting, bookmark previews, embeds.
- LaTeX/equation blocks.
- Simple table cell colors/merges and row/column move.
- Edgeless, AI, cloud import/sync.

## 10. What to avoid for Nobita's identity

- Do not add a grid/spreadsheet library for the current table view.
- Do not make rows pages until linked docs and a page registry exist.
- Do not add network previews (bookmarks/embeds) to the core bundle; treat them
  as host-provided blocks/adapters.
- Do not chase AFFiNE's edgeless or AI surfaces.
- Prefer commands that reuse the existing block tree, inline runs and immutable
  store over new document primitives.

The current editor is 59.2 KB gzip. Phase 1 data views added about 7.5 KB gzip,
Phase 2 references/input added about 2.4 KB and page links about 1.3 KB; remaining search/multi-view
items are incremental on top of the existing view model.
