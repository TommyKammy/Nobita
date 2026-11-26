import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = process.cwd();
const url = 'http://127.0.0.1:4174';
const baselinePath = join(root, 'benchmarks', 'perf-baseline.json');
const strict = process.argv.includes('--strict');
const write = process.argv.includes('--write');
const limits = { 200: 2.6, 1000: 10, 3000: 12, 10000: 15 };
const counts = Object.keys(limits).map(Number);
const samples = 5;
const threshold = 0.5;

async function reachable() {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

let server = null;
if (!(await reachable())) {
  server = spawn(
    'pnpm',
    ['exec', 'vite', '--config', 'tests/browser/vite.config.ts'],
    { cwd: root, stdio: 'inherit' }
  );
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await reachable()) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!(await reachable())) {
    server.kill();
    throw new Error('Vite fixture did not start');
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(url);
await page.waitForFunction(() => window.__ready === true);

const result = {};
for (const count of counts) {
  const values = [];
  for (let sample = 0; sample < samples; sample += 1) {
    values.push(
      await page.evaluate(n => window.__benchSetSize(n), count)
    );
  }
  values.sort((a, b) => a - b);
  result[count] = values[Math.floor(values.length / 2)] ?? 0;
  console.log(
    `setDoc+render ${String(count).padStart(4)} blocks: ${result[count].toFixed(1)} ms (median of ${samples})`
  );
}

// Time the browser work within a frame, including layout but excluding the wait for vsync.
const interaction = await page.evaluate(async () => {
  const host = window.__host;
  const body = host.shadowRoot.querySelector('.nb-body');
  const nextFrame = () => new Promise(requestAnimationFrame);
  const input = [], scroll = [];
  let mounted = 0;
  for (let i = 1; i <= 15; i++) {
    await nextFrame();
    let start;
    requestAnimationFrame(() => { start = performance.now(); });
    window.scrollTo(0, document.documentElement.scrollHeight * i / 16);
    window.dispatchEvent(new Event('scroll'));
    await nextFrame();
    const nodes = body.querySelectorAll(':scope > .nb-block');
    mounted = Math.max(mounted, nodes.length);
    body.getBoundingClientRect();
    scroll.push(performance.now() - start);
    const block = [...nodes].find(el => {
      const y = el.getBoundingClientRect().top;
      return y >= 0 && y < innerHeight;
    });
    if (!block) throw new Error('Viewport has no mounted block');
    host.editor.focus(block.dataset.blockId, 0);
    await nextFrame();
    start = performance.now();
    body.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertText', data: 'x', bubbles: true, cancelable: true,
    }));
    body.getBoundingClientRect();
    input.push(performance.now() - start);
    if (!block.querySelector('.nb-text').textContent.startsWith('x')) throw new Error('Input was not committed');
  }
  return { scroll, input, mounted };
});
const interactionMax = Math.max(...interaction.scroll, ...interaction.input);
console.log(`10k blocks, 15 frames: input max ${Math.max(...interaction.input).toFixed(2)} ms, scroll max ${Math.max(...interaction.scroll).toFixed(2)} ms, ${interaction.mounted} mounted blocks max`);

const formulas = [];
for (let i = 0; i < 15; i++) formulas.push(await page.evaluate(() => window.__benchFormulas()));
const formulaMedian = formulas.sort((a,b) => a-b)[7];
console.log(`100 rows × 5 formulas: ${formulaMedian.toFixed(2)} ms (median of 15 full evaluations)`);
await browser.close();
if (server) server.kill();

const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : {};
let failed = strict && (formulaMedian >= 2 || interactionMax > 16.6 || interaction.mounted >= 150);
if (formulaMedian >= 2) console.warn('  warning: formula evaluation reached the 2 ms limit');
for (const count of counts) {
  if (result[count] > limits[count]) {
    console.warn(`  warning: ${count} blocks exceeded ${limits[count]} ms`);
    if (strict) failed = true;
  }
  const before = baseline[count];
  if (before === undefined) continue;
  const delta = (result[count] - before) / before;
  const change = `${(delta * 100).toFixed(1)}%`;
  console.log(`  ${count} blocks vs baseline: ${change}`);
  if (delta > threshold) {
    console.warn(`  warning: more than ${threshold * 100}% slower`);
    if (strict) failed = true;
  }
}

if (write) {
  mkdirSync(join(root, 'benchmarks'), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`wrote ${baselinePath}`);
}
if (failed) process.exitCode = 1;
