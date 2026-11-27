# Testing and benchmarks

## Unit and type checks

```bash
pnpm typecheck
pnpm test
```

`pnpm typecheck` includes:

- package project builds and React/demo/D1 type checks
- `pnpm typecheck:public-api`, which compiles the consumer fixture at `tests/public-api/public-api.ts`

`pnpm test` runs the core and storage suites, then the shared collaboration suite against the Yjs and Automerge adapters. On `e9458f0`, all 293 of those tests passed (165 core, 16 storage and 112 collaboration). The separate Playwright step passed 305 browser tests against the production bundle, bringing the local total to 598. [Test results](../README.md#testing)

## Browser regression tests

Playwright covers the public `<nobita-editor>` integration path:

```bash
pnpm exec playwright install chromium  # once
pnpm test:browser
```

The Vite fixture runs at `127.0.0.1:4174`. By default it exercises the editor source. To test the built standalone editor and lazy collaboration module, run `pnpm build`, then `NOBITA_TEST_BUNDLE=1 pnpm test:browser`. Start the fixture with the same setting if reusing an existing local server. Dedicated fixture pages also exercise React controlled updates and collaborative peers.

Covered today:

- registered and unregistered clients exchanging custom-block JSON, renderer isolation and failure, native widget keyboard activation and clipboard round-trips. [Custom block tests](../tests/browser/custom-block.spec.ts)
- host slash commands, including Japanese IME confirmation, focus and undo/redo after insertion, paragraphs with text or children, stale or removed commands, conflicting block IDs and undo across peers. [Slash block tests](../tests/browser/slash-block.spec.ts)
- partial-dictionary English fallback, per-editor isolation, Japanese IME and English slash aliases, translated actions and unchanged saved values. [Dictionary tests](../tests/browser/dictionary.spec.ts)
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

On `e9458f0`, the local Node.js 22.23.5 build measured 114,636 B gzip for the standalone editor ESM and 132,463 B for the demo. The optional Japanese module measured 4,970 B gzip separately. To reproduce the locale measurement after building, run the following from the repository root. [All raw and gzip sizes](../README.md#performance)

```bash
node -e "const b = require('node:fs').readFileSync('packages/element/dist/locales/ja.js'); console.log(b.length, require('node:zlib').gzipSync(b, { level: 9 }).length)"
```

| Artifact | Gzip limit |
| --- | --- |
| Artifacts with a baseline entry | 110% of baseline, rounded down to a whole byte |
| Standalone editor ESM | Also subject to an absolute cap of 114,672 B |
| Demo main JavaScript | The greater of its baseline-derived limit and 132,653 B |
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
| Measured median on `e9458f0` (local Chromium, production bundle) | 0.4 ms | 0.7 ms | 1.2 ms | 3.3 ms |
| Maximum median | 2.6 ms | 10 ms | 12 ms | 15 ms |

On the 10,000-block document the benchmark scrolls and inserts text at 15 positions. The maximum input or scroll work must stay at or below 16.6 ms and the mounted top-level block count must stay below 150. A separate 100-row, five-formula benchmark must have a median below 2 ms across 15 evaluations. `pnpm bench:check` and `pnpm bench --strict` run the same checks. `pnpm bench --write` records the initial-render medians. [Benchmark implementation](../scripts/benchmark.mjs)

The same run measured 2.5 ms maximum input time, 4.4 ms maximum scroll time and 86 mounted blocks at peak. Formula evaluation took 0.30 ms (median of 15). [Measurement conditions and results](../README.md#performance)

## CI

GitHub Actions runs the following command on pushes, pull requests and manual dispatches using Node.js 22 and Chromium:

```bash
BENCH=1 NOBITA_TEST_BUNDLE=1 pnpm test:ci
```

The script runs type checking, unit and collaboration tests, the production build, Playwright and the strict size check, in that order. `BENCH=1` adds the strict performance check. To reproduce CI locally, install Chromium using the command above and use the same two environment variables. [Workflow](../.github/workflows/ci.yml) · [CI script](../scripts/ci.sh)

## Dictionary benchmark

Build each revision and serve its production browser fixture on a separate port.
For example, run `NOBITA_TEST_BUNDLE=1 pnpm exec vite --config tests/browser/vite.config.ts --port 4196`
in the baseline checkout and the same command with port 4197 in the changed checkout.
From the changed checkout run:

```bash
node scripts/benchmark-dictionary.mjs http://127.0.0.1:4196 http://127.0.0.1:4197
```

The benchmark rotates the baseline, English and Japanese configurations over nine runs.
Each run discards three warmups and measures 15 mounts of a 40-row, four-column
database and its block menu. Both timings include synchronous layout. The reported
value is the median of the nine run medians. Locale download time is excluded.

In the local Chromium run recorded for `e9458f0`, mounting the database took 5.8 ms in English and 6.3 ms in Japanese. Opening the block menu took 0.7 ms and 1.6 ms respectively. [Measurement table](../README.md#performance)

## Slash command benchmark

Use the production fixtures described above. To reproduce the single-revision comparison in the README, pass the same fixture URL twice. For a before/after comparison, pass the base URL first and the candidate URL second.

```bash
node scripts/benchmark-slash-block.mjs http://127.0.0.1:4197 http://127.0.0.1:4197
```

The script rotates the base, candidate and candidate-with-one-command configurations. It measures menu opening and filtering by `h1` in all three, and ticket-card insertion in the registered configuration. Each result is the median of seven round medians, with three warmups and 20 measured operations per round. On `e9458f0`, opening took 0.90 ms and filtering took 0.20 ms both with and without the command. Selecting and inserting the card took 0.10 ms. [Benchmark implementation](../scripts/benchmark-slash-block.mjs)

## Baseline policy

Update a baseline only when the size or performance change is intentional and
understood. Include the before/after numbers in the commit message.
