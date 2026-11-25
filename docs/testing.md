# Testing and benchmarks

## Unit and type checks

```bash
pnpm typecheck
pnpm test
```

`pnpm typecheck` includes:

- package project builds and React/demo/D1 type checks
- `test:public-api`: a fixture that imports only package entry points

## Browser regression tests

Playwright covers the public `<nobita-editor>` integration path:

```bash
pnpm exec playwright install chromium  # once
pnpm test:browser
```

The fixture at `tests/browser/fixture` imports only `@nobita/element` and
`@nobita/core` entry points. It is served by `tests/browser/vite.config.ts` on
port `4174`.

Covered today:

- mount and document round-trip
- typing and `nobita-change`
- bold, color and alignment
- Turn into and slash menu
- cross-block deletion
- readonly and 375px viewport layout
- table/board switching, board card movement and filters
- multi-select, files and people pickers
- column resize
- cell-range selection, TSV paste and copy
- mention insertion, async filtering, atomic typing/deleting and HTML round-trip
- image paste/drop through the upload adapter, including readonly and document-replacement guards
- code language / callout tone pickers
- block-link navigation, including the legacy clipboard fallback
- page reference insertion, navigation, resolver refresh and missing-page fallback
- simple table rendering, editing, hover handles, drag cell selection, row/column menus, colors, drag-to-add and HTML import
- database multi-view, multi-sort, nested filters, search, per-view columns, statistics, table grouping, drag selection/fill, row detail, column menus and view settings
- database surface geometry, hover/focus toolbar visibility, filter-bar toggling, hidden statistics, expandable search, view-settings consolidation, sticky add/new-record controls, row-action overlays and narrow-width header overflow

Add a test when changing toolbar, menus, selection, clipboard, drag, data views
or mobile layout. Prefer `data-*` selectors over UI copy.

## Size report

```bash
pnpm build
pnpm size
```

The script reports raw and gzip sizes for the editor, global build, core entry
and demo bundle. The committed baseline is `benchmarks/size-baseline.json`.

- default: warn when gzip grows more than 10%
- `pnpm size --strict`: exit non-zero above the threshold
- `pnpm size --write`: intentionally refresh the baseline

## Performance benchmark

```bash
pnpm bench
```

The benchmark starts the browser fixture, runs `setDoc+render` for 200, 1,000
and 3,000 blocks, and compares medians with
`benchmarks/perf-baseline.json`.

- default: report differences
- `pnpm bench:check`: fail when a case is more than 50% slower
- `pnpm bench --write`: intentionally refresh the baseline

Performance is intentionally not a required check on every CI run because
headless runner variance is high. Normal CI runs `pnpm bench` as a non-blocking
report; manual `workflow_dispatch` runs `pnpm bench --strict` as a gate.

## CI

`pnpm test:ci` runs:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
pnpm size --strict
```

Set `BENCH=1` to include the performance check. The same sequence is in
`.github/workflows/ci.yml`.

## Baseline policy

Update a baseline only when the size or performance change is intentional and
understood. Include the before/after numbers in the commit message.
