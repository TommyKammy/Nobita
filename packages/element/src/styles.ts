export const styles = /* css */ `
:host {
  --nb-font-sans: var(--nb-font, Inter, "Source Sans 3", ui-sans-serif, -apple-system,
    BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif);
  --nb-font-mono: var(--nb-mono, ui-monospace, "SF Mono", "JetBrains Mono", Menlo,
    Consolas, monospace);
  --nb-bg: #ffffff;
  --nb-surface: #ffffff;
  --nb-bg-subtle: #f6f6f5;
  --nb-hover: #f1f1ef;
  --nb-text: #191919;
  --nb-text-secondary: #666664;
  --nb-text-tertiary: #9b9b97;
  --nb-text-placeholder: #b7b7b2;
  --nb-border: #e8e8e5;
  --nb-border-strong: #d8d8d3;
  --nb-accent: #2563eb;
  --nb-accent-soft: rgba(37, 99, 235, 0.1);
  --nb-selection: rgba(37, 99, 235, 0.18);
  --nb-code-bg: #f7f7f6;
  --nb-shadow: 0 1px 2px rgba(15, 15, 15, 0.05), 0 8px 24px rgba(15, 15, 15, 0.08);
  --nb-shadow-lg: 0 2px 4px rgba(15, 15, 15, 0.04), 0 18px 44px rgba(15, 15, 15, 0.14);
  --nb-min-height: 320px;
  --nb-page-width: 848px;
  --nb-page-padding-y: 56px;
  --nb-page-padding-x: 64px;
  --nb-callout-info: #eef4ff;
  --nb-callout-info-border: #cfe0ff;
  --nb-callout-success: #edf9f0;
  --nb-callout-success-border: #c9ecd5;
  --nb-callout-warning: #fff8e8;
  --nb-callout-warning-border: #f3e2b6;
  --nb-callout-danger: #fff0ee;
  --nb-callout-danger-border: #f4cdc7;

  --nb-hl-red: #fee2e2;
  --nb-hl-orange: #ffedd5;
  --nb-hl-yellow: #fef3c7;
  --nb-hl-green: #dcfce7;
  --nb-hl-teal: #ccfbf1;
  --nb-hl-blue: #dbeafe;
  --nb-hl-purple: #ede9fe;
  --nb-hl-grey: #eeeeec;
  --nb-fg-red: #b91c1c;
  --nb-fg-orange: #c2410c;
  --nb-fg-yellow: #a16207;
  --nb-fg-green: #15803d;
  --nb-fg-teal: #0f766e;
  --nb-fg-blue: #1d4ed8;
  --nb-fg-purple: #7e22ce;
  --nb-fg-grey: #6b7280;
  display: block;
  min-height: var(--nb-min-height);
  color: var(--nb-text);
  font-family: var(--nb-font-sans);
  font-size: 16px;
  line-height: 1.6;
  text-align: left;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  color-scheme: light;
}

:host([hidden]) { display: none; }
:host([data-theme="dark"]) {
  --nb-bg: #1b1b1b;
  --nb-surface: #232323;
  --nb-bg-subtle: #262626;
  --nb-hover: #2d2d2d;
  --nb-text: #ededeb;
  --nb-text-secondary: #a6a6a1;
  --nb-text-tertiary: #7c7c77;
  --nb-text-placeholder: #5f5f5b;
  --nb-border: #303030;
  --nb-border-strong: #414141;
  --nb-accent: #7aa2ff;
  --nb-accent-soft: rgba(122, 162, 255, 0.14);
  --nb-selection: rgba(122, 162, 255, 0.24);
  --nb-code-bg: #202020;
  --nb-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 10px 30px rgba(0, 0, 0, 0.4);
  --nb-shadow-lg: 0 2px 6px rgba(0, 0, 0, 0.4), 0 22px 50px rgba(0, 0, 0, 0.5);
  --nb-callout-info: #172235;
  --nb-callout-info-border: #25395a;
  --nb-callout-success: #15271b;
  --nb-callout-success-border: #24452f;
  --nb-callout-warning: #2a2315;
  --nb-callout-warning-border: #4b3d20;
  --nb-callout-danger: #2c1a18;
  --nb-callout-danger-border: #4c2a26;

  --nb-hl-red: #4a2222;
  --nb-hl-orange: #4a2e1a;
  --nb-hl-yellow: #4d4419;
  --nb-hl-green: #1d3a2a;
  --nb-hl-teal: #123c3a;
  --nb-hl-blue: #1e3a5f;
  --nb-hl-purple: #352a55;
  --nb-hl-grey: #333330;
  --nb-fg-red: #f87171;
  --nb-fg-orange: #fb923c;
  --nb-fg-yellow: #facc15;
  --nb-fg-green: #4ade80;
  --nb-fg-teal: #2dd4bf;
  --nb-fg-blue: #60a5fa;
  --nb-fg-purple: #c084fc;
  --nb-fg-grey: #9ca3af;
  color-scheme: dark;
}

@media (prefers-color-scheme: dark) {
  :host([data-theme="auto"]) {
    --nb-bg: #1b1b1b;
    --nb-surface: #232323;
    --nb-bg-subtle: #262626;
    --nb-hover: #2d2d2d;
    --nb-text: #ededeb;
    --nb-text-secondary: #a6a6a1;
    --nb-text-tertiary: #7c7c77;
    --nb-text-placeholder: #5f5f5b;
    --nb-border: #303030;
    --nb-border-strong: #414141;
    --nb-accent: #7aa2ff;
    --nb-accent-soft: rgba(122, 162, 255, 0.14);
    --nb-selection: rgba(122, 162, 255, 0.24);
    --nb-code-bg: #202020;
    --nb-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 10px 30px rgba(0, 0, 0, 0.4);
    --nb-shadow-lg: 0 2px 6px rgba(0, 0, 0, 0.4), 0 22px 50px rgba(0, 0, 0, 0.5);
    --nb-callout-info: #172235;
    --nb-callout-info-border: #25395a;
    --nb-callout-success: #15271b;
    --nb-callout-success-border: #24452f;
    --nb-callout-warning: #2a2315;
    --nb-callout-warning-border: #4b3d20;
    --nb-callout-danger: #2c1a18;
    --nb-callout-danger-border: #4c2a26;

    --nb-hl-red: #4a2222;
    --nb-hl-orange: #4a2e1a;
    --nb-hl-yellow: #4d4419;
    --nb-hl-green: #1d3a2a;
    --nb-hl-teal: #123c3a;
    --nb-hl-blue: #1e3a5f;
    --nb-hl-purple: #352a55;
    --nb-hl-grey: #333330;
    --nb-fg-red: #f87171;
    --nb-fg-orange: #fb923c;
    --nb-fg-yellow: #facc15;
    --nb-fg-green: #4ade80;
    --nb-fg-teal: #2dd4bf;
    --nb-fg-blue: #60a5fa;
    --nb-fg-purple: #c084fc;
    --nb-fg-grey: #9ca3af;
    color-scheme: dark;
  }
}

*, *::before, *::after { box-sizing: border-box; }

button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
button:disabled { cursor: default; }

input, select, textarea { font: inherit; color: inherit; }

.nb-root {
  position: relative;
  min-height: inherit;
  background: var(--nb-bg);
  font-family: var(--nb-font-sans);
  font-size: 16px;
  line-height: 1.6;
  color: var(--nb-text);
}

.nb-root ::selection { background: var(--nb-selection); }

.nb-scroll { width: 100%; }

.nb-page {
  width: 100%;
  max-width: var(--nb-page-width, 848px);
  margin: 0 auto;
  padding: var(--nb-page-padding-y, 56px) var(--nb-page-padding-x, 64px) 180px;
}

.nb-title-wrap { margin-bottom: 12px; }

.nb-title {
  font-size: 38px;
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: -0.025em;
  color: var(--nb-text);
  outline: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-height: 1.2em;
  padding: 2px 0;
  caret-color: var(--nb-accent);
}

.nb-title:empty::before {
  content: attr(data-placeholder);
  color: var(--nb-text-placeholder);
  pointer-events: none;
}

.nb-body {
  display: flex;
  flex-direction: column;
  outline: none;
  caret-color: var(--nb-accent);
}

.nb-block { position: relative; }

.nb-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  border-radius: 6px;
}

.nb-gutter {
  position: absolute;
  left: -50px;
  top: 0;
  display: flex;
  align-items: center;
  gap: 1px;
  height: 28px;
  opacity: 0;
  transition: opacity 120ms ease;
  z-index: 2;
  user-select: none;
}

.nb-block:hover > .nb-row > .nb-gutter,
.nb-block:focus-within > .nb-row > .nb-gutter,
.nb-gutter.is-visible { opacity: 1; }

.nb-gutter-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--nb-text-tertiary);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.nb-gutter-btn svg { width: 16px; height: 16px; }
.nb-gutter-btn:hover { background: var(--nb-hover); color: var(--nb-text-secondary); }
.nb-gutter-btn:active { background: var(--nb-border); }
.nb-gutter-btn.nb-drag { cursor: grab; }
.nb-gutter-btn.nb-drag:active { cursor: grabbing; }
.nb-gutter-btn:focus-visible,
.nb-checkbox:focus-visible,
.nb-link-apply:focus-visible,
.nb-image-input:focus-visible {
  outline: 2px solid var(--nb-accent);
  outline-offset: 1px;
}

.nb-marker {
  flex: 0 0 26px;
  width: 26px;
  display: none;
  align-items: flex-start;
  justify-content: flex-start;
  padding-top: 3px;
  color: var(--nb-text-tertiary);
  user-select: none;
}

.nb-marker svg { width: 18px; height: 18px; }

.nb-block[data-type="bulleted"] > .nb-row > .nb-marker,
.nb-block[data-type="numbered"] > .nb-row > .nb-marker,
.nb-block[data-type="todo"] > .nb-row > .nb-marker { display: flex; }

.nb-bullet {
  width: 6px;
  height: 6px;
  margin: 8px 0 0 3px;
  border-radius: 50%;
  background: currentColor;
}

.nb-bullet.nb-bullet-open {
  width: 5px;
  height: 5px;
  background: transparent;
  border: 1.5px solid currentColor;
}

.nb-number {
  min-width: 20px;
  padding-top: 0;
  font-size: 15px;
  line-height: 26px;
  font-variant-numeric: tabular-nums;
  text-align: left;
}

.nb-checkbox {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin-top: 3px;
  padding: 0;
  border: 1.5px solid var(--nb-border-strong);
  border-radius: 5px;
  background: transparent;
  color: transparent;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.nb-checkbox svg { width: 13px; height: 13px; stroke-width: 2.4; }
.nb-checkbox:hover { border-color: var(--nb-accent); }
.nb-checkbox[aria-checked="true"] {
  background: var(--nb-accent);
  border-color: var(--nb-accent);
  color: #fff;
}

.nb-content { flex: 1 1 auto; min-width: 0; }

.nb-text {
  outline: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-height: 1.6em;
  padding: 1px 0;
  caret-color: var(--nb-accent);
}

.nb-text:empty::before {
  content: attr(data-placeholder);
  color: var(--nb-text-placeholder);
  pointer-events: none;
}

.nb-m-bold { font-weight: 680; }
.nb-m-italic { font-style: italic; }
.nb-m-underline { text-decoration: underline; text-underline-offset: 2px; }
.nb-m-strike { text-decoration: line-through; }
.nb-m-strike.nb-m-underline { text-decoration: underline line-through; }
.nb-text [data-highlight] {
  border-radius: 3px;
  padding: 0.02em 0.08em;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.nb-text [data-highlight="red"] { background-color: var(--nb-hl-red); }
.nb-text [data-highlight="orange"] { background-color: var(--nb-hl-orange); }
.nb-text [data-highlight="yellow"] { background-color: var(--nb-hl-yellow); }
.nb-text [data-highlight="green"] { background-color: var(--nb-hl-green); }
.nb-text [data-highlight="teal"] { background-color: var(--nb-hl-teal); }
.nb-text [data-highlight="blue"] { background-color: var(--nb-hl-blue); }
.nb-text [data-highlight="purple"] { background-color: var(--nb-hl-purple); }
.nb-text [data-highlight="grey"] { background-color: var(--nb-hl-grey); }
.nb-text [data-text-color="red"] { color: var(--nb-fg-red); }
.nb-text [data-text-color="orange"] { color: var(--nb-fg-orange); }
.nb-text [data-text-color="yellow"] { color: var(--nb-fg-yellow); }
.nb-text [data-text-color="green"] { color: var(--nb-fg-green); }
.nb-text [data-text-color="teal"] { color: var(--nb-fg-teal); }
.nb-text [data-text-color="blue"] { color: var(--nb-fg-blue); }
.nb-text [data-text-color="purple"] { color: var(--nb-fg-purple); }
.nb-text [data-text-color="grey"] { color: var(--nb-fg-grey); }
.nb-m-code {
  font-family: var(--nb-font-mono);
  font-size: 0.87em;
  padding: 0.12em 0.32em;
  border: 1px solid var(--nb-border);
  border-radius: 4px;
  background: var(--nb-bg-subtle);
  color: #c2410c;
}
:host([data-theme="dark"]) .nb-m-code { color: #f0a878; }
@media (prefers-color-scheme: dark) {
  :host([data-theme="auto"]) .nb-m-code { color: #f0a878; }
}
.nb-m-link {
  color: var(--nb-accent);
  text-decoration: underline;
  text-decoration-color: color-mix(in oklab, var(--nb-accent) 40%, transparent);
  text-underline-offset: 2px;
  cursor: pointer;
}
.nb-tail { min-height: 140px; cursor: text; }


.nb-block[data-type="todo"][data-checked="true"] > .nb-row .nb-text {
  color: var(--nb-text-tertiary);
  text-decoration: line-through;
  text-decoration-color: var(--nb-border-strong);
}

.nb-block[data-type="heading"] > .nb-row > .nb-content > .nb-text {
  font-weight: 650;
  letter-spacing: -0.018em;
  line-height: 1.3;
}

.nb-block[data-type="heading"][data-level="1"] { margin-top: 22px; }
.nb-block[data-type="heading"][data-level="2"] { margin-top: 16px; }
.nb-block[data-type="heading"][data-level="3"] { margin-top: 10px; }
.nb-block[data-type="heading"][data-level="4"] { margin-top: 8px; }
.nb-block[data-type="heading"][data-level="5"] { margin-top: 6px; }
.nb-block[data-type="heading"][data-level="6"] { margin-top: 4px; }
.nb-body > .nb-block[data-type="heading"]:first-child { margin-top: 0; }

.nb-block[data-type="heading"][data-level="1"] > .nb-row > .nb-content > .nb-text { font-size: 30px; }
.nb-block[data-type="heading"][data-level="2"] > .nb-row > .nb-content > .nb-text { font-size: 23px; }
.nb-block[data-type="heading"][data-level="3"] > .nb-row > .nb-content > .nb-text { font-size: 19px; }
.nb-block[data-type="heading"][data-level="4"] > .nb-row > .nb-content > .nb-text { font-size: 17px; }
.nb-block[data-type="heading"][data-level="5"] > .nb-row > .nb-content > .nb-text { font-size: 15.5px; }
.nb-block[data-type="heading"][data-level="6"] > .nb-row > .nb-content > .nb-text {
  font-size: 14.5px;
  color: var(--nb-text-secondary);
  letter-spacing: 0.01em;
}

.nb-block[data-type="quote"] > .nb-row > .nb-content {
  padding-left: 14px;
  border-left: 3px solid var(--nb-border-strong);
  color: var(--nb-text-secondary);
}

.nb-block[data-type="quote"] > .nb-row > .nb-content > .nb-text { font-size: 16px; }

.nb-block[data-type="callout"] {
  margin: 6px 0;
  padding: 12px 16px 12px 9px;
  border: 1px solid var(--nb-callout-info-border);
  border-radius: 12px;
  background: var(--nb-callout-info);
}

.nb-block[data-type="callout"][data-tone="success"] { background: var(--nb-callout-success); border-color: var(--nb-callout-success-border); }
.nb-block[data-type="callout"][data-tone="warning"] { background: var(--nb-callout-warning); border-color: var(--nb-callout-warning-border); }
.nb-block[data-type="callout"][data-tone="danger"] { background: var(--nb-callout-danger); border-color: var(--nb-callout-danger-border); }
.nb-block[data-type="callout"] > .nb-row > .nb-marker { display: flex; color: var(--nb-text-secondary); padding-top: 7px; }
.nb-block[data-type="callout"] > .nb-row { padding-right: 4px; }

.nb-block[data-type="code"] {
  margin: 8px 0;
  border: 1px solid var(--nb-border);
  border-radius: 10px;
  background: var(--nb-code-bg);
}

.nb-block[data-type="code"] > .nb-row { padding: 13px 16px; }
.nb-block[data-type="code"] > .nb-row > .nb-marker { display: none; }
.nb-block[data-type="code"] .nb-text {
  font-family: var(--nb-font-mono);
  font-size: 13.5px;
  line-height: 1.62;
  min-height: 1.62em;
  white-space: pre-wrap;
}

.nb-code-lang {
  position: absolute;
  top: 8px;
  right: 10px;
  font-family: var(--nb-font-sans);
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.02em;
  color: var(--nb-text-tertiary);
  background: var(--nb-bg);
  border: 1px solid var(--nb-border);
  border-radius: 5px;
  padding: 4px 6px;
  user-select: none;
  opacity: 0;
  transition: opacity 120ms ease;
}

.nb-block[data-type="code"]:hover .nb-code-lang { opacity: 1; }

.nb-block[data-type="divider"] { padding: 9px 0; }
.nb-divider { height: 1px; background: var(--nb-border); }
.nb-block[data-type="divider"] > .nb-row > .nb-marker { display: none; }

.nb-block[data-type="image"] > .nb-row > .nb-marker { display: none; }
.nb-image { display: block; max-width: 100%; height: auto; border-radius: 10px; border: 1px solid var(--nb-border); }
.nb-image-placeholder {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px;
  border: 1px dashed var(--nb-border-strong);
  border-radius: 10px;
  background: var(--nb-bg-subtle);
}
.nb-image-placeholder-row { display: flex; gap: 8px; }
.nb-image-input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--nb-border);
  border-radius: 7px;
  background: var(--nb-surface);
  color: var(--nb-text);
  font: inherit;
  font-size: 14px;
  outline: none;
}
.nb-image-input:focus { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-soft); }
.nb-image-hint { font-size: 12px; color: var(--nb-text-tertiary); }
.nb-caption {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
  color: var(--nb-text-tertiary);
  outline: none;
  min-height: 1.5em;
}
.nb-caption:empty::before { content: attr(data-placeholder); color: var(--nb-text-placeholder); }

.nb-children { display: flex; flex-direction: column; margin-left: 26px; position: relative; }
.nb-children:empty { display: none; }
.nb-children::before {
  content: "";
  position: absolute;
  left: -13px;
  top: 2px;
  bottom: 2px;
  width: 1px;
  background: var(--nb-border);
  opacity: 0;
  transition: opacity 150ms ease;
}
.nb-block:hover > .nb-children::before { opacity: 1; }

.nb-block[data-collapsed="true"] > .nb-children { display: none; }

.nb-empty-hint {
  margin-top: 40px;
  font-size: 14px;
  color: var(--nb-text-tertiary);
  user-select: none;
}
.nb-empty-hint kbd {
  font-family: var(--nb-font-sans);
  font-size: 12px;
  padding: 1px 5px;
  border: 1px solid var(--nb-border);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--nb-bg-subtle);
}

/* ---------- data views ---------- */

.nb-body > .nb-block[data-type="database"] {
  width: calc(100% + var(--nb-db-bleed, 0px) * 2);
  margin-left: calc(-1 * var(--nb-db-bleed, 0px));
  margin-right: calc(-1 * var(--nb-db-bleed, 0px));
}
.nb-block[data-type="database"] > .nb-row > .nb-marker { display: none; }
.nb-block[data-type="database"] > .nb-row > .nb-content { min-width: 0; }

.nb-db {
  margin: 8px 0;
  border: 1px solid var(--nb-border);
  border-radius: 12px;
  background: var(--nb-surface);
  color: var(--nb-text);
  font-size: 13.5px;
}

.nb-db-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--nb-border);
}

.nb-db-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-weight: 600;
  font-size: 13px;
}

.nb-db-title svg { width: 16px; height: 16px; color: var(--nb-text-tertiary); }
.nb-db-count { font-size: 11px; font-weight: 450; color: var(--nb-text-tertiary); white-space: nowrap; }

.nb-db-tools { margin-left: auto; display: flex; gap: 4px; }

.nb-db-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--nb-text-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.nb-db-btn svg { width: 14px; height: 14px; }
.nb-db-btn:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-db-btn.bordered { border-color: var(--nb-border); background: var(--nb-bg); }

.nb-db-scroll { overflow-x: auto; border-radius: 0 0 12px 12px; }

.nb-db-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  min-width: 560px;
}

.nb-db-table th,
.nb-db-table td {
  height: 38px;
  padding: 0;
  border-right: 1px solid var(--nb-border);
  border-bottom: 1px solid var(--nb-border);
  text-align: left;
  vertical-align: middle;
}

.nb-db-table tr > *:last-child { border-right: 0; }
.nb-db-table tbody tr:last-child > * { border-bottom: 0; }

.nb-db-table tbody tr:hover > .nb-db-cell { background: color-mix(in oklab, var(--nb-hover) 55%, transparent); }

.nb-db-handle {
  width: 28px;
  background: var(--nb-bg-subtle);
}

.nb-db-rowmenu {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin: 0 auto;
  border-radius: 4px;
  color: var(--nb-text-tertiary);
  opacity: 0;
  transition: opacity 100ms ease, background 100ms ease;
}
.nb-db-rowmenu svg { width: 14px; height: 14px; }
.nb-db-table tr:hover .nb-db-rowmenu,
.nb-db-rowmenu:focus-visible { opacity: 1; }
.nb-db-rowmenu:hover { background: var(--nb-border); color: var(--nb-text); }

.nb-db-th { background: var(--nb-bg-subtle); }

.nb-db-col-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 37px;
  padding: 0 8px;
  color: var(--nb-text-secondary);
  font-size: 12px;
  text-align: left;
}
.nb-db-col-head:hover { background: var(--nb-hover); }
.nb-db-typeicon { display: grid; place-items: center; color: var(--nb-text-tertiary); }
.nb-db-typeicon svg { width: 14px; height: 14px; }
.nb-db-colname { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 560; }
.nb-db-sort { font-size: 10px; color: var(--nb-accent); font-variant-numeric: tabular-nums; }
.nb-db-colhead-chevron { color: var(--nb-text-tertiary); opacity: 0; }
.nb-db-colhead-chevron svg { width: 12px; height: 12px; }
.nb-db-col-head:hover .nb-db-colhead-chevron { opacity: 1; }

.nb-db-cell { padding: 0 8px; }

.nb-db-text {
  min-height: 24px;
  padding: 6px 0;
  outline: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  caret-color: var(--nb-accent);
}
.nb-db-text:empty::before { content: attr(data-placeholder); color: var(--nb-text-placeholder); pointer-events: none; }

.nb-db-input {
  width: 100%;
  height: 36px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  outline: none;
}
.nb-db-input[type="number"] { font-variant-numeric: tabular-nums; }
.nb-db-input::placeholder { color: var(--nb-text-placeholder); font-variant-numeric: tabular-nums; }
.nb-db-input:focus-visible { outline: 1px solid var(--nb-accent); outline-offset: -1px; border-radius: 3px; }

.nb-db-check {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 1.5px solid var(--nb-border-strong);
  border-radius: 4px;
  color: transparent;
  background: transparent;
}
.nb-db-check svg { width: 12px; height: 12px; stroke-width: 2.4; }
.nb-db-check[aria-checked="true"] { background: var(--nb-accent); border-color: var(--nb-accent); color: #fff; }

.nb-db-select {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  height: 22px;
  padding: 0 7px;
  border: 1px solid var(--nb-border);
  border-radius: 5px;
  background: var(--nb-bg-subtle);
  color: var(--nb-text-secondary);
  font-size: 11.5px;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nb-db-select:hover { border-color: var(--nb-border-strong); color: var(--nb-text); }
.nb-db-select .nb-db-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--nb-accent); flex: 0 0 6px; }
.nb-db-select.is-empty { color: var(--nb-text-placeholder); background: transparent; border-style: dashed; }

.nb-db-empty {
  height: 72px;
  text-align: center;
  color: var(--nb-text-tertiary);
  font-size: 12.5px;
}

.nb-db-addrow {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border-top: 1px solid var(--nb-border);
  color: var(--nb-text-tertiary);
  font-size: 12px;
}
.nb-db-addrow svg { width: 14px; height: 14px; }
.nb-db-addrow:hover { background: var(--nb-hover); color: var(--nb-text); }

.nb-db[data-readonly="true"] .nb-db-tools,
.nb-db[data-readonly="true"] .nb-db-rowmenu,
.nb-db[data-readonly="true"] .nb-db-addrow,
.nb-db[data-readonly="true"] .nb-db-colhead-chevron { display: none; }
.nb-db[data-readonly="true"] .nb-db-col-head { cursor: default; }

.nb-db-popover {
  position: fixed;
  z-index: 2147483002;
  width: 266px;
  padding: 10px;
  border: 1px solid var(--nb-border);
  border-radius: 10px;
  background: var(--nb-surface);
  box-shadow: var(--nb-shadow-lg);
  color: var(--nb-text);
  font-size: 12.5px;
  animation: nb-pop 110ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.nb-db-pop-title {
  margin-bottom: 8px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--nb-text-tertiary);
}

.nb-db-field { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
.nb-db-field > span { font-size: 10.5px; font-weight: 550; letter-spacing: 0.04em; color: var(--nb-text-tertiary); }
.nb-db-field input,
.nb-db-field select {
  height: 30px;
  padding: 0 7px;
  border: 1px solid var(--nb-border);
  border-radius: 6px;
  background: var(--nb-bg);
  color: var(--nb-text);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}
.nb-db-field input:focus,
.nb-db-field select:focus { border-color: var(--nb-accent); }

.nb-db-pop-actions { display: flex; flex-wrap: wrap; gap: 3px; }
.nb-db-pop-actions button {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 6px;
  border-radius: 5px;
  color: var(--nb-text-secondary);
  font-size: 11.5px;
}
.nb-db-pop-actions button svg { width: 13px; height: 13px; }
.nb-db-pop-actions button:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-db-pop-actions button.danger { color: #c2410c; }
.nb-db-pop-actions button.danger:hover { background: rgba(194, 65, 12, 0.1); }

.nb-db-opt {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 30px;
  padding: 0 7px;
  border-radius: 5px;
  color: var(--nb-text-secondary);
  font-size: 12.5px;
  text-align: left;
}
.nb-db-opt:hover { background: var(--nb-hover); color: var(--nb-text); }
.nb-db-opt .nb-db-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--nb-accent); }
.nb-db-opt .nb-db-opt-clear { color: var(--nb-text-tertiary); }

.nb-db-col-head:focus-visible,
.nb-db-btn:focus-visible,
.nb-db-rowmenu:focus-visible,
.nb-db-check:focus-visible,
.nb-db-select:focus-visible,
.nb-db-addrow:focus-visible,
.nb-db-opt:focus-visible,
.nb-db-pop-actions button:focus-visible {
  outline: 2px solid var(--nb-accent);
  outline-offset: -2px;
}



.nb-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
}

.nb-overlay > * { pointer-events: auto; }

.nb-menu {
  position: fixed;
  width: 322px;
  max-height: min(700px, 78vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  background: var(--nb-surface);
  border: 1px solid var(--nb-border);
  border-radius: 12px;
  box-shadow: var(--nb-shadow-lg);
  font-family: var(--nb-font-sans);
  color: var(--nb-text);
  animation: nb-pop 120ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.nb-menu-group {
  padding: 9px 10px 4px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--nb-text-tertiary);
}
.nb-menu-group:first-child { padding-top: 4px; }

.nb-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 5px 8px;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
}

.nb-menu-item[data-active="true"] { background: var(--nb-hover); }

.nb-menu-icon {
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--nb-border);
  border-radius: 7px;
  background: var(--nb-bg);
  color: var(--nb-text-secondary);
}
.nb-menu-icon svg { width: 17px; height: 17px; }

.nb-menu-copy { min-width: 0; display: flex; flex-direction: column; }
.nb-menu-label { font-size: 13.5px; line-height: 1.3; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nb-menu-desc { font-size: 11.5px; line-height: 1.35; color: var(--nb-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.nb-menu-key {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 10.5px;
  color: var(--nb-text-tertiary);
  border: 1px solid var(--nb-border);
  border-radius: 4px;
  padding: 1px 4px;
  background: var(--nb-bg-subtle);
}

.nb-menu-empty { padding: 22px 12px; text-align: center; font-size: 13px; color: var(--nb-text-tertiary); }

.nb-menu-sep { height: 1px; margin: 5px 8px; background: var(--nb-border); }

/* ---------- toolbar ---------- */

.nb-toolbar {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 6px;
  background: var(--nb-surface);
  border: 1px solid var(--nb-border);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 15, 15, 0.06), 0 10px 28px rgba(15, 15, 15, 0.12);
  animation: nb-pop 110ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
:host([data-theme="dark"]) .nb-toolbar {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 10px 30px rgba(0, 0, 0, 0.45);
}
@media (prefers-color-scheme: dark) {
  :host([data-theme="auto"]) .nb-toolbar {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 10px 30px rgba(0, 0, 0, 0.45);
  }
}

.nb-tool {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--nb-text-secondary);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.nb-tool > svg,
.nb-tool > .nb-chev { flex: 0 0 auto; pointer-events: none; }
.nb-tool > svg { width: 20px; height: 20px; }
.nb-color-row > *,
.nb-align-item > * { pointer-events: none; }
.nb-tool:hover,
.nb-tool[aria-expanded="true"] { background: var(--nb-hover); color: var(--nb-text); }
.nb-tool[data-active="true"] { background: var(--nb-accent-soft); color: var(--nb-accent); }
.nb-tool-dropdown {
  width: auto;
  min-width: 34px;
  padding: 0 3px;
  gap: 1px;
}
.nb-tool-group-start { margin-left: 6px; }
.nb-chev {
  display: grid;
  place-items: center;
  width: 9px;
  height: 9px;
  color: var(--nb-text-tertiary);
}
.nb-chev svg { width: 9px; height: 9px; stroke-width: 1.8; }

.nb-color-popover {
  position: fixed;
  width: 224px;
  max-height: min(70vh, 520px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  background: var(--nb-surface);
  border: 1px solid var(--nb-border);
  border-radius: 12px;
  box-shadow: var(--nb-shadow-lg);
  animation: nb-pop 120ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.nb-color-heading {
  padding: 8px 8px 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--nb-text);
}
.nb-color-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  color: var(--nb-text);
  font-size: 13px;
  text-align: left;
}
.nb-color-row:hover,
.nb-color-row[data-active="true"] { background: var(--nb-hover); }
.nb-color-a {
  display: grid;
  place-items: center;
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  color: var(--nb-text);
}
.nb-color-a[data-kind="background"] { border: 1px solid var(--nb-border); }
.nb-color-label { flex: 1; white-space: nowrap; }

.nb-align-popover {
  position: fixed;
  width: 168px;
  padding: 6px;
  background: var(--nb-surface);
  border: 1px solid var(--nb-border);
  border-radius: 12px;
  box-shadow: var(--nb-shadow-lg);
  animation: nb-pop 120ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.nb-turninto-popover {
  width: 220px;
  max-height: min(70vh, 480px);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.nb-align-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border-radius: 7px;
  color: var(--nb-text);
  font-size: 12.5px;
  text-align: left;
}
.nb-align-item:hover,
.nb-align-item[data-active="true"] { background: var(--nb-hover); }
.nb-align-item[aria-checked="true"] { color: var(--nb-accent); }
.nb-align-icon {
  display: grid;
  place-items: center;
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
}
.nb-align-icon svg { width: 20px; height: 20px; }
.nb-align-label { flex: 1; white-space: nowrap; }
.nb-align-check {
  display: grid;
  place-items: center;
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  opacity: 0;
}
.nb-align-check svg { width: 14px; height: 14px; }
.nb-align-item[aria-checked="true"] .nb-align-check { opacity: 1; }

.nb-link-popover {
  position: fixed;
  display: flex;
  gap: 6px;
  padding: 6px;
  background: var(--nb-surface);
  border: 1px solid var(--nb-border);
  border-radius: 10px;
  box-shadow: var(--nb-shadow-lg);
  animation: nb-pop 110ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.nb-link-input {
  width: 250px;
  height: 32px;
  padding: 0 9px;
  border: 1px solid var(--nb-border);
  border-radius: 6px;
  background: var(--nb-bg);
  color: var(--nb-text);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.nb-link-input:focus { border-color: var(--nb-accent); box-shadow: 0 0 0 3px var(--nb-accent-soft); }
.nb-link-apply {
  height: 32px;
  padding: 0 11px;
  border: 0;
  border-radius: 6px;
  background: var(--nb-accent);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
}
.nb-link-apply:hover { filter: brightness(1.06); }

/* ---------- drag ---------- */

.nb-drop-line {
  position: fixed;
  height: 2px;
  border-radius: 2px;
  background: var(--nb-accent);
  pointer-events: none;
  z-index: 2147483001;
  box-shadow: 0 0 0 2px var(--nb-accent-soft);
}
.nb-drop-line::before {
  content: "";
  position: absolute;
  left: -3px;
  top: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--nb-accent);
}
.nb-drop-child {
  border-radius: 8px;
  outline: 2px solid var(--nb-accent);
  outline-offset: -2px;
}
.nb-dragging { opacity: 0.45; }

@keyframes nb-pop {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (max-width: 380px) {
  .nb-toolbar { gap: 1px; padding: 3px 4px; }
  .nb-tool { width: 26px; height: 28px; }
  .nb-tool-dropdown { min-width: 31px; padding: 0 2px; }
  .nb-tool-group-start { margin-left: 3px; }
  .nb-color-popover { width: 216px; }
}

@media (max-width: 720px) {
  .nb-page { padding: 36px 24px 140px; }
  .nb-title { font-size: 31px; }
  .nb-gutter { left: -34px; }
  .nb-gutter-btn { width: 22px; height: 22px; }
  .nb-block[data-type="heading"][data-level="1"] > .nb-row > .nb-content > .nb-text { font-size: 26px; }
  .nb-block[data-type="database"] { width: 100%; margin-left: 0; margin-right: 0; }
}

@media (hover: none) {
  .nb-gutter { opacity: 1; left: -32px; }
  .nb-gutter-btn { width: 22px; height: 22px; }
  .nb-page { padding-left: 44px; }
  .nb-db-rowmenu { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
}

:host([readonly]) .nb-gutter,
:host([readonly]) .nb-empty-hint { display: none; }

@media print {
  :host { --nb-bg: #fff; }
  .nb-gutter, .nb-overlay, .nb-empty-hint { display: none !important; }
  .nb-page { max-width: none; padding: 0; }
}
`;
