# Testing and benchmarks

## Unit and type checks

```bash
pnpm typecheck
pnpm test
```

`pnpm typecheck` includes:

- package project builds and React/demo/D1 type checks
- `pnpm typecheck:public-api`, which compiles the consumer fixture at `tests/public-api/public-api.ts`

`pnpm test` runs the core and storage suites, then the shared collaboration suite against the Yjs and Automerge adapters. The README’s verified run contained 164 core, 16 storage, 110 collaboration and 288 browser tests. [Test counts and reference run](../README.md#testing)

## Browser regression tests

Playwright covers the public `<nobita-editor>` integration path:

```bash
pnpm exec playwright install chromium  # once
pnpm test:browser
```

The Vite fixture runs at `127.0.0.1:4174`. By default it exercises the editor source. To test the built standalone editor and lazy collaboration module, run `pnpm build`, then `NOBITA_TEST_BUNDLE=1 pnpm test:browser`. Start the fixture with the same setting if reusing an existing local server. Dedicated fixture pages also exercise React controlled updates and collaborative peers.

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
- database rich-text cells (rendering, inline toolbar, run persistence), editable row pages, board card add/open/reorder and group add/delete actions
- merged and split table cells, span-aware clipboard operations and HTML table round-trips
- calculated values and linked-row rollups, reverse relations, host refresh and undo
- virtual window eviction and remount, nested pins, IME, logical cross-window selection, printing, measured heights and offscreen block navigation
- collaborative typing, split/join, presence, selection and undo, plus React feedback and document switching

Add a test when changing toolbar, menus, selection, clipboard, drag, data views
or mobile layout. Prefer `data-*` selectors over UI copy.

## Size report

```bash
pnpm build
pnpm size
```

The report measures raw bytes and level-9 gzip for the bundled core public entry, standalone editor ESM, global IIFE, on-demand `collaboration.js` and the demo’s main JavaScript asset. It builds the core measurement in memory from the compiled public entry. Baseline entries are stored in [size-baseline.json](../benchmarks/size-baseline.json).

| Artifact | Gzip limit |
| --- | --- |
| Artifacts with a baseline entry | 110% of baseline, rounded down to a whole byte |
| Standalone editor ESM | Also subject to an absolute cap of 114,089 B |
| Demo main JavaScript | The greater of its baseline-derived limit and 131,905 B |
| Collaboration module | Reported separately. It currently has no baseline entry. |

`pnpm size --strict` fails on a budget overrun. The default report warns on overruns. Missing required build artifacts also fail the report. Use `pnpm size --write` to record an intentional baseline update. [Size report implementation](../scripts/size-report.mjs)

## Performance benchmark

```bash
pnpm bench
pnpm bench:check
```

The script starts or reuses the browser fixture. It measures the median of five `setDoc` calls plus initial rendering at each size. The larger fixtures use the default virtual window. Strict mode enforces these absolute limits and flags a slowdown greater than 50% where [perf-baseline.json](../benchmarks/perf-baseline.json) contains a reference value.

| Top-level blocks | 200 | 1,000 | 3,000 | 10,000 |
| --- | ---: | ---: | ---: | ---: |
| Maximum median | 2.6 ms | 10 ms | 12 ms | 15 ms |

On the 10,000-block document the benchmark scrolls and inserts text at 15 positions. The maximum input or scroll work must stay at or below 16.6 ms and the mounted top-level block count must stay below 150. A separate 100-row, five-formula benchmark must have a median below 2 ms across 15 evaluations. `pnpm bench:check` and `pnpm bench --strict` run the same checks. `pnpm bench --write` records the initial-render medians. [Benchmark implementation](../scripts/benchmark.mjs)

## CI

GitHub Actions runs the following command on pushes, pull requests and manual dispatches using Node.js 22 and Chromium:

```bash
BENCH=1 NOBITA_TEST_BUNDLE=1 pnpm test:ci
```

The script runs type checking, unit and collaboration tests, the production build, Playwright and the strict size check, in that order. `BENCH=1` adds the strict performance check. To reproduce CI locally, install Chromium using the command above and use the same two environment variables. [Workflow](../.github/workflows/ci.yml) · [CI script](../scripts/ci.sh)

## Baseline policy

Update a baseline only when the size or performance change is intentional and
understood. Include the before/after numbers in the commit message.
