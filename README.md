# Nobita

**A fast, lightweight, Notion-like block editor you can embed anywhere.**

Nobita is a from-scratch block editor built with **TypeScript 7.0.2**. It takes the interaction model people know from Notion and AFFiNE — blocks, a slash menu, a hover gutter, drag to reorder, markdown shortcuts — and packages it as a small, framework-free web component with plain JSON documents.

<p>
  <img src="docs/media/nobita-light.png" alt="Nobita editor in light mode" width="49%" />
  <img src="docs/media/nobita-dark.png" alt="Nobita editor in dark mode" width="49%" />
</p>
<p>
  <img src="docs/media/nobita-data.png" alt="Table and database blocks in Nobita" width="100%" />
</p>
<p>
  <img src="docs/media/nobita-mobile.png" alt="Nobita on a mobile viewport" width="280" />
</p>

- **104.9 KB gzipped** (`383.8 KB` raw) standalone ESM bundle — minified with build-time CSS minification, including the core and data views.
- **Zero runtime dependencies** — no Lit, React, ProseMirror, Yjs, or virtual DOM.
- **Shadow DOM web component** — host styles cannot leak in, editor styles cannot leak out.
- **Plain JSON documents** — persist to localStorage, IndexedDB, your API, or a file.
- **Framework agnostic** — vanilla API, `<nobita-editor>`, and a thin React wrapper.
- **AFFiNE-informed, not an AFFiNE port** — see [the analysis](docs/affine-analysis.md).

## What works today

| Area | Included |
| --- | --- |
| Blocks | Text, headings 1–6, bulleted / numbered / to-do lists, quote, callout, code, divider, image, simple table, database, page links |
| Inline | Bold, italic, underline, strikethrough, inline code, links, mentions, `[[` inline page chips, alignment, 8-color highlight and text-color palettes |
| Editing | Enter / Backspace / Delete merging, Tab indent, block move, undo / redo, block selection (`Escape`, gutter `Shift`/`Cmd`-click, staged `Cmd/Ctrl+A`, `Shift+Arrow`, batch delete / duplicate / copy / paste / drag across text & non-text blocks) |
| Data views | Multiple named table and board views per database, AFFiNE-style view settings (`⋯`), per-view column order/widths/visibility, nested AND/OR filters, multi-sort, container-aware expandable search (auto-hidden below `560px`), footer statistics, sticky add-column/new-record controls, table grouping/collapse with persisted group state; rich-text cells (`B`/`I`/`U`/`S`/code toolbar & shortcuts, highlight/color rendering, IME & plain-text paste safe), editable record pages (`row.page.content`), board card covers (`coverColumnId`), board card add/open/drag-reorder/group actions (preserving multi-select tags), drag cell selection & fill, TSV copy/paste, readonly view switching & record-page viewing; 11 typed columns (`text`, `number`, `progress`, `select`, `multi-select`, `date`, `checkbox`, `url`, `image`, `files`, `people`) |
| Menus | Slash menu with fuzzy search and block/page actions (move/copy/link/new page), block handle & right-click context menus (single/multi-block, simple tables, database rows/columns/board cards, `Shift+Right-click` for native menu), selection toolbar with Turn into / Align / format / Color, link popover, `@` mention picker, `[[` page link picker |
| Drag | Reorder blocks, drop between blocks or nest into a block |
| Markdown | `# `, `- `, `1. `, `[] `, `> `, ` ``` `, `--- `, Markdown tables; inline `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `[links](url)` |
| Clipboard | Rich HTML, Markdown, plain text, a private `application/x-nobita+json` format, and image paste through an upload adapter |
| Persistence | JSON in / JSON out, `onChange`, `setDoc`, readonly mode (read-only view switching and record pages in databases), theming; optional `@nobita/storage` adapters for localStorage, SQLite/D1 and HTTP |
| A11y | Keyboard menus and row/card actions (`Mod+Enter` opens record pages), record-page modal focus trap & focus restoration, `:focus-visible` outlines, `aria-pressed` / `data-active` formatting toolbars, `@media (hover: none)` touch controls |

Not in the box: synced blocks, comments, math, embeds, collaboration, a managed image host, and virtualization for very large documents. Image uploads are supported through a host adapter. See [Roadmap](#roadmap).

## Quick start

```bash
pnpm install
pnpm dev          # demo at http://127.0.0.1:5173
pnpm test         # core + storage unit tests
pnpm typecheck    # TypeScript 7 project build
pnpm build        # packages + bundled editor + demo
```

### Web component

```html
<script type="module">
  import '@nobita/element'; // auto-defines <nobita-editor>

  const editor = document.querySelector('nobita-editor');
  editor.doc = await fetch('/doc.json').then(response => response.json());

  editor.addEventListener('nobita-change', event => {
    save(event.detail.doc);
  });
</script>

<nobita-editor theme="auto" placeholder="Type '/' for commands"></nobita-editor>
```

`packages/element/dist/nobita.js` is the standalone ESM build. `dist/nobita.global.js` is an IIFE for a plain `<script>` tag and exposes `window.Nobita`.

### Imperative API

```ts
import { createEditor } from '@nobita/element';
import type { Doc } from '@nobita/core';

const editor = createEditor(document.querySelector('#editor')!, {
  doc: await fetch('/doc.json').then(response => response.json()) as Doc,
  theme: 'light',
  placeholder: "Type '/' for commands",
  onChange(doc, meta) {
    localStorage.setItem('nobita-doc', JSON.stringify(doc));
  },
  onSelectionChange(selection) {
    console.log(selection);
  },
});

editor.focus();
editor.insertMarkdown('## Pasted markdown\n\n- becomes\n- blocks');
```

### React

```tsx
import { useRef } from 'react';
import { NobitaEditor, type NobitaReactHandle } from '@nobita/react';

export function Document() {
  const editor = useRef<NobitaReactHandle>(null);

  return (
    <NobitaEditor
      ref={editor}
      theme="auto"
      minHeight="480px"
      doc={initialDoc}
      onChange={doc => save(doc)}
    />
  );
}
```

The React wrapper only manages the host element; React never renders a block. That keeps typing off the React render path.

## Storage

The editor itself remains plain JSON in / JSON out. Nothing in `@nobita/element` imports a database, and the 104.9 KB gzipped bundle is unchanged.

`@nobita/storage` is an optional package for hosts that want a ready-made persistence port:

| Adapter | Use |
| --- | --- |
| `MemoryDocumentStore` | Tests, previews, ephemeral sessions |
| `LocalStorageDocumentStore` | `localStorage` / `sessionStorage` |
| `HttpDocumentStore` | Your API, including the Cloudflare D1 example |
| `SqlDocumentStore` | Local SQLite and Cloudflare D1 through a small `SqlDriver` |

```ts
import { LocalStorageDocumentStore } from '@nobita/storage';

const store = new LocalStorageDocumentStore();
const stored = await store.load('page-id');
await store.save(editor.getDoc(), {
  version: stored?.version ?? 0,
});
```

`version: 0` creates a document, a positive version enforces optimistic concurrency, and omitting it does a last-write-wins save. Each document stays one JSON value.

For Cloudflare D1, [examples/cloudflare-d1](examples/cloudflare-d1) contains a Worker, schema, D1 driver and browser client. Deployment steps and D1 limits are in [docs/storage.md](docs/storage.md).

## Document model

A document is deliberately simple, stable JSON:

```json
{
  "version": 1,
  "id": "d3f8k2",
  "title": "Hello",
  "icon": "👋",
  "blocks": [
    {
      "id": "b7k2m1",
      "type": "paragraph",
      "text": [
        { "text": "Hello " },
        { "text": "world", "marks": { "bold": true } }
      ],
      "props": {},
      "children": []
    }
  ]
}
```

- `text` is an array of runs. Each run has `text` and optional `marks`.
- `children` is a tree, used by nested lists and callouts.
- `props` is small and typed: heading `level`, todo `checked`, code `language`, callout `tone`, image `src` / `caption`, table `table`, database `database`, alignment, collapsed state.
- `parseDoc()` validates unknown JSON before it reaches the editor, deduplicates block ids, and fills defaults.

### Data views

**Table** and **Database** are separate blocks.

- A `table` block is a simple editable grid (`props.table`). It follows AFFiNE's table model: row/column handles sit on the first cell edges (click for menus, drag to reorder rows/columns), cells support inline rich-text formatting (`cell.runs` with `cell.text` plain projection and HTML/Markdown table round-trip), drag selection covers multiple cells (copy, cut, paste and clear), hover plus controls add rows/columns, and row/column background colors are available. It has no properties or views.
- A `database` block is the typed data view (`props.database`). It has typed columns, row records and one or more named views.

```json
{
  "type": "database",
  "text": [],
  "props": {
    "database": {
      "variant": "database",
      "title": "Tasks",
      "columns": [
        { "id": "c1", "name": "Task", "type": "text" },
        { "id": "c2", "name": "Status", "type": "select", "options": ["Todo", "Done"] },
        { "id": "c3", "name": "Due", "type": "date" },
        { "id": "c4", "name": "Done", "type": "checkbox" }
      ],
      "rows": [
        {
          "id": "r1",
          "cells": {
            "c1": {
              "text": "Ship it",
              "runs": [
                { "text": "Ship", "marks": { "bold": true } },
                { "text": " it" }
              ]
            },
            "c2": { "text": "Done" },
            "c3": { "text": "2026-12-01" },
            "c4": { "checked": true }
          },
          "page": {
            "content": [{ "text": "Release checklist and notes." }]
          }
        }
      ],
      "views": [
        {
          "id": "v1",
          "name": "Table",
          "type": "table",
          "columns": [
            { "id": "c1", "width": 200 },
            { "id": "c2", "width": 130 },
            { "id": "c3", "width": 120 },
            { "id": "c4", "width": 86, "stat": "checked" }
          ],
          "sorts": [{ "columnId": "c3", "direction": "asc" }]
        },
        {
          "id": "v2",
          "name": "Board",
          "type": "board",
          "groupBy": "c2",
          "groupProperties": [
            { "key": "Done", "manuallyCardSort": ["r1"] }
          ],
          "filter": {
            "mode": "and",
            "conditions": [{ "columnId": "c2", "operator": "is", "value": "Done" }]
          }
        }
      ],
      "activeViewId": "v1"
    }
  },
  "children": []
}
```

Column types are `text`, `number`, `select`, `multi-select`, `date`, `checkbox`, `url`, `files` and `people`. Text cells store optional rich-text `runs` alongside the plain `text` projection (used for search, filtering, sorting, statistics and TSV/Markdown export), and empty cells are omitted so documents stay compact. Rows can also carry an optional rich-text `page.content` body edited inside the record page panel. Each view stores its own column layout (order, width, visibility and footer stat), nested `filter` tree, `sorts`, `groupBy` and `groupProperties` (group order, hidden/collapsed state and `manuallyCardSort`). Markdown/HTML tables import as simple tables; TSV paste fills database cells. Legacy documents with a single `view`, `sort`, flat `filters` or `hiddenColumns` still load and migrate on the next edit.

## API

See [docs/public-api.md](docs/public-api.md) for the stable import surface, editor options, events and internal-module boundary.

### `NobitaEditor`

| Member | Description |
| --- | --- |
| `getDoc()` | Current immutable document |
| `getJSON(pretty?)` | Serialize the document |
| `getMarkdown()` / `getHTML()` | Export helpers |
| `setDoc(doc, { history? })` | Replace the document |
| `setTitle(title)` | Update only the title |
| `getSelection()` | Current block/offset selection or `null` |
| `focus(blockId?, offset?)` | Focus the editor or a block |
| `focusTitle()` / `blur()` | Focus control |
| `undo()` / `redo()` | History |
| `setReadonly(value)` / `setTheme(theme)` / `setPlaceholder(value)` | Runtime configuration |
| `insertMarkdown(markdown)` | Insert blocks at the caret |
| `getBlockLink(blockId)` | Return the stable `#block-…` link for a block |
| `insertPageLink(page, { afterBlockId? })` | Insert a block-level reference card to a host-owned page |
| `insertInlinePageLink(page)` | Insert an atomic inline page link chip at the selection |
| `refreshPageLinks()` | Re-read optional page metadata for cards and inline chips after a rename |
| `setMentionProvider(provider)` | Replace the mention directory at runtime |
| `setPageProvider(provider)` | Replace the `[[` / `/page` page directory at runtime |
| `setUploadImage(handler)` | Replace the image upload adapter at runtime |
| `destroy()` | Remove listeners and DOM |

Options: `doc`, `readonly`, `theme` (`light` / `dark` / `auto`), `placeholder`, `autofocus`, `spellcheck`, `historyLimit`, `onChange(doc, { source })`, `onSelectionChange(selection)`, `mentionProvider`, `pageProvider`, `uploadImage`, `onOpenPage`, `resolvePage`.

### Mentions, links and images

Mentions are inline marks, not a separate node type. The host supplies the directory and decides how to resolve `{ id, label, kind }` later:

```ts
editor.mentionProvider = {
  async search(query) {
    const response = await fetch(`/api/people?q=${encodeURIComponent(query)}`);
    return (await response.json()).map((user: { id: string; name: string }) => ({
      id: user.id,
      label: user.name,
      kind: 'user',
    }));
  },
};

editor.uploadImage = async file => {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch('/api/uploads', { method: 'POST', body });
  const result = await response.json();
  return { src: result.url, alt: file.name };
};
```

Typing `@` opens the picker; mention references stay atomic while typing and deleting. `getBlockLink(blockId)` returns `#block-<id>` for links the host can copy; clicking one inside the same document focuses the block. Image paste and drop only run when `uploadImage` is set, and the adapter owns storage, authentication and URL lifetime.

### Page links & workspace primitives

Pages stay separate `Doc`s. The editor supports both block-level page cards (`page` blocks) and atomic inline page chips (`[[` picker / `marks.page`), without loading or embedding target page content:

```ts
editor.pageProvider = {
  search: query => pages.filter(p => p.title.toLowerCase().includes(query.toLowerCase())),
  create: title => createWorkspacePage(title),
};
editor.onOpenPage = pageId => router.open(`/pages/${pageId}`);
editor.resolvePage = pageId => pageCache.get(pageId) ?? null;

// After a host-side rename:
pageCache.set('p1', { id: 'p1', title: 'Product roadmap' });
editor.refreshPageLinks();
```

`@nobita/core` also exports pure, DOM-free workspace helpers (`extractPageLinks`, `buildBacklinkIndex`, `getBacklinks`, `buildPageTree`, `getPageBreadcrumbs`, `canReparentPage`, `isTrashedPage`, `partitionTrashedPages`, `collectTrashTargetIds`, `resolveRestoreParentId`, `collectRestoreTargetIds`, `searchWorkspacePages`) so hosts can build backlinks panels, drag-and-drop page trees, Trash workflows, and full-text search without coupling them to the editor bundle.

The placeholder behaves like AFFiNE: it appears only on the **focused empty paragraph** (or heading, which shows “Heading 1/2/3/4/5/6”), and disappears as soon as text exists or focus leaves the body. It is not shown while the page title is focused. The default is `Type '/' for commands`; set `placeholder` to override the paragraph text.

### `<nobita-editor>`

Attributes: `readonly`, `theme`, `placeholder`, `min-height`, `doc` (JSON string).
Properties: `doc`, `value` (JSON), `markdown`, `editor`, `mentionProvider`, `pageProvider`, `uploadImage`, `onOpenPage`, `resolvePage`.
Methods: `focus()`, `undo()`, `redo()`, `getMarkdown()`, `getJSON()`, `insertPageLink()`, `insertInlinePageLink()`, `refreshPageLinks()`, `setReadonly()`, `setTheme()`.
Events: `nobita-change` (`{ doc, source }`), `nobita-selection` (`{ selection }`), `nobita-page-open` (`{ pageId }`), `nobita-ready`.

Use `doc` as a property for normal use. Set `doc` **before** the element connects, or use the property after mount; the element keeps the last document across disconnect/reconnect.

### Theming

Every visual token is a CSS custom property on the host element:

| Variable | Purpose |
| --- | --- |
| `--nb-font`, `--nb-mono` | Font families |
| `--nb-bg`, `--nb-surface`, `--nb-bg-subtle`, `--nb-hover` | Surfaces |
| `--nb-text`, `--nb-text-secondary`, `--nb-text-tertiary`, `--nb-text-placeholder` | Ink |
| `--nb-border`, `--nb-border-strong` | Rules |
| `--nb-accent`, `--nb-accent-soft`, `--nb-selection` | Accent and selection |
| `--nb-code-bg` | Code block background |
| `--nb-hl-{red,orange,yellow,green,teal,blue,purple,grey}` | Inline highlight palette |
| `--nb-fg-{red,orange,yellow,green,teal,blue,purple,grey}` | Inline text-color palette |
| `--nb-shadow`, `--nb-shadow-lg` | Chrome |
| `--nb-page-width`, `--nb-page-padding-y`, `--nb-page-padding-x` | Page geometry |
| `--nb-db-bleed` | Horizontal surface bleed for root data views (`8px` by default; content is inset by the same amount so tables align with body text) |
| `--nb-min-height` | Minimum editor height |

```css
nobita-editor {
  --nb-font: 'Newsreader', Georgia, serif;
  --nb-accent: #0f766e;
  --nb-page-width: 760px;
}
```

Dark mode is built in (`theme="dark"` or `auto`). The shadow root uses `color-scheme`, so native controls follow the theme.

## Testing

Unit, type and browser regression checks, plus size and performance baselines, are documented in [docs/testing.md](docs/testing.md).

```bash
pnpm test:browser
pnpm size
pnpm bench
```

## Performance

Measured in headless Chromium via `pnpm bench` (`setDoc` + full render, median of 5 runs, production build):

| Blocks | `setDoc` + render (median) |
| --- | ---: |
| 200 | 2.4 ms |
| 1,000 | 12.6 ms |
| 3,000 | 43.9 ms |

Data-view cell edits update cells in-place by reference identity without rebuilding the grid, memoize per-state view queries, apply differential selection updates, and delegate table header/body events.

Bundle sizes (`pnpm size`):

| Artifact | Raw | Gzip |
| --- | ---: | ---: |
| Editor ESM (`nobita.js`) | 383.8 KB | **104.9 KB** |
| Editor IIFE (`nobita.global.js`) | 383.7 KB | **104.9 KB** |
| Demo app (editor + UI + seed data) | 439.5 KB | 119.8 KB |

The optional `@nobita/storage` package is not part of any editor bundle; it is only present when a host imports it.

Why it stays small: immutable path-copy updates mean undo is a pointer swap; per-block DOM views are patched by reference; CSS is minified at bundle time; no framework runtime ships; the renderer never re-renders unchanged blocks. See [architecture](docs/architecture.md).

The numbers are directional, not a guarantee: timing varies by hardware and browser version.

## Repository layout

```
packages/core      Document model, commands, markdown, JSON validation, history — no DOM
packages/element   Editor engine, block views, modular database views, selection, menus, toolbar, web component, CSS bundler
packages/react     Thin React host wrapper
packages/storage   Optional persistence port and adapters (localStorage, SQLite/D1, HTTP)
apps/demo          Notion-like demo: sidebar, pages, search, export, embed dialog
examples/          Optional integrations, including the Cloudflare D1 Worker
docs/              AFFiNE analysis, architecture, public API, command comparison, testing and storage notes
```

## Design notes

Nobita began with an analysis of AFFiNE 0.27.x, both the live app and the BlockSuite source. The useful lessons were the block schema tree, delta-based rich text, a single command layer behind every menu and hotkey, and overlay chrome. The deliberate divergences are a dependency-free core, direct DOM rendering, and one editing host per shadow root.

That last point matters: Chromium clamps ranges that span separate `contenteditable` elements inside a shadow root. To get real cross-block selection, formatting, copy and delete, Nobita places all blocks inside **one** contenteditable body while keeping per-block rendering and a block/offset selection model. The trade-off and internals are documented in [docs/architecture.md](docs/architecture.md).

Data views follow the same rule: one `database` block, model-driven rich-text runs via `@nobita/core`, delegated table listeners, structural-key + reference-identity sync to avoid rebuilding the grid while typing, and plain row JSON. No grid library is shipped.

A command-by-command comparison with AFFiNE is in [docs/command-comparison.md](docs/command-comparison.md).

## Roadmap

- Database: formulas and relations. Calendar view is intentionally out of scope.
- Simple table: merged cells.
- Collaboration adapter (Yjs/Automerge) behind an explicit interface.
- Virtualized rendering for 10k+ block documents.
- Vue/Svelte wrappers (the web component already works in both).
- Published packages and CDN builds.

## License

MIT. See [LICENSE](LICENSE).
