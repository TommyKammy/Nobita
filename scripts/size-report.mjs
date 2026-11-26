import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = process.cwd();
const baselinePath = join(root, 'benchmarks', 'size-baseline.json');
const strict = process.argv.includes('--strict');
const write = process.argv.includes('--write');
const threshold = 0.10;

function artifacts() {
  const entries = [
    { name: 'core', path: 'packages/core/dist/index.js' },
    { name: 'element', path: 'packages/element/dist/nobita.js' },
    { name: 'global', path: 'packages/element/dist/nobita.global.js' },
  ];
  const assets = join(root, 'apps/demo/dist/assets');
  if (existsSync(assets)) {
    const demo = readdirSync(assets)
      .filter(name => /^index-.*\.js$/u.test(name))
      .map(name => join(assets, name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    if (demo) entries.push({ name: 'demo', path: demo.slice(root.length + 1) });
  }
  return entries;
}

const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : {};
const next = {};
let failed = false;

for (const { name, path } of artifacts()) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    console.error(`missing artifact: ${path}`);
    failed = true;
    continue;
  }
  const raw = statSync(absolute).size;
  const gzip = gzipSync(readFileSync(absolute), { level: 9 }).length;
  const before = baseline[name];
  const gzipDelta = before ? (gzip - before.gzip) / before.gzip : 0;
  const rawDelta = before ? (raw - before.raw) / before.raw : 0;
  next[name] = { raw, gzip };
  const change = before
    ? `${(gzipDelta * 100).toFixed(1)}% gzip / ${(rawDelta * 100).toFixed(1)}% raw`
    : 'new';
  console.log(
    `${name.padEnd(12)} ${path.padEnd(38)} ${String(raw).padStart(8)} raw ${String(gzip).padStart(8)} gzip  ${change}`
  );
  if (name === 'element' && gzip > 106_747) {
    console.warn('  warning: standalone ESM exceeds the Phase 1 budget of 106,747 gzip bytes');
    if (strict) failed = true;
  }
  if (before && gzipDelta > threshold) {
    console.warn(`  warning: gzip grew more than ${threshold * 100}%`);
    if (strict) failed = true;
  }
}

if (write) {
  mkdirSync(join(root, 'benchmarks'), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`wrote ${baselinePath}`);
}

if (failed) process.exitCode = 1;
