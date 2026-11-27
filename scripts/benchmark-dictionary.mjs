// Run against production browser fixtures serving the two revisions.
import { chromium } from '@playwright/test';

const [before, after] = process.argv.slice(2);
if (!before || !after) throw new Error('Usage: node scripts/benchmark-dictionary.mjs <before-url> <after-url>');
const configurations = [
  { name: 'Before', url: before },
  { name: 'After (English)', url: after },
  { name: 'After (Japanese)', url: after, japanese: true },
];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const results = new Map();
  for (let run = 0; run < 9; run++) {
    for (let offset = 0; offset < configurations.length; offset++) {
      const { name, url, japanese } = configurations[(run + offset) % configurations.length];
      await page.goto(url);
      await page.waitForFunction(() => window.__ready);
      const samples = await page.evaluate(async useJapanese => {
        const dictionary = useJapanese ? (await import('/dictionary.ts')).ja : undefined;
        window.__host.remove();
        const columns = Array.from({ length: 4 }, (_, i) => ({ id: 'c' + i, type: 'text', name: 'Property ' + i }));
        const rows = Array.from({ length: 40 }, (_, i) => ({ id: 'r' + i, cells: { c0: { text: 'Record ' + i } } }));
        const doc = { version: 1, id: 'speed', title: '', blocks: [{
          id: 'db', type: 'database', text: [], children: [], props: { database: { variant: 'database', columns, rows } },
        }] };
        const mount = [];
        const menu = [];
        for (let i = 0; i < 18; i++) {
          const host = document.createElement('nobita-editor');
          if (dictionary) host.dictionary = dictionary;
          host.doc = doc;
          const start = performance.now();
          document.body.append(host);
          host.getBoundingClientRect();
          const mounted = performance.now();
          host.editor.openBlockMenu('db', host.shadowRoot.querySelector('.nb-db-title'));
          host.shadowRoot.querySelector('.nb-menu').getBoundingClientRect();
          const opened = performance.now();
          host.remove();
          if (i >= 3) {
            mount.push(mounted - start);
            menu.push(opened - mounted);
          }
        }
        return { mount, menu };
      }, japanese);
      if (!results.has(name)) results.set(name, { mount: [], menu: [] });
      results.get(name).mount.push(median(samples.mount));
      results.get(name).menu.push(median(samples.menu));
    }
  }
  for (const [name, { mount, menu }] of results) {
    console.log(`${name}: database mount ${median(mount).toFixed(1)} ms, block menu ${median(menu).toFixed(1)} ms`);
  }
} finally {
  await browser.close();
}
