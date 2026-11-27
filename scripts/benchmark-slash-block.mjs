// Start production browser fixtures from the base and candidate revisions before running.
import { chromium } from '@playwright/test';

const [before, after] = process.argv.slice(2);
if (!before || !after) throw new Error('Pass the base and candidate fixture URLs');
const cases = [
  { name: 'Before', url: before },
  { name: 'After', url: after },
  { name: 'After with one command', url: after, register: true },
];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  for (let round = 0; round < 7; round++) {
    for (let offset = 0; offset < cases.length; offset++) {
      const sample = cases[(round + offset) % cases.length];
      await page.goto(sample.url);
      await page.waitForFunction(() => window.__ready);
      const times = await page.evaluate(register => {
        const editor = window.__editor;
        const paragraph = { ...editor.doc.blocks[0], text: [] };
        const doc = { ...editor.doc, blocks: [paragraph] };
        if (register) editor.registerSlashBlock({
          id: 'ticket', label: 'Ticket', create: () => ({ ...paragraph, id: 'ticket', type: 'custom:ticket' }),
        });
        const body = editor.root.querySelector('.nb-body');
        const input = data => body.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertText', bubbles: true, cancelable: true, data,
        }));
        const open = [], filter = [], insert = [];
        for (let i = 0; i < 23; i++) {
          editor.setDoc(doc);
          editor.focus(paragraph.id, 0);
          const start = performance.now();
          input('/');
          const menu = editor.root.querySelector('.nb-menu');
          menu.getBoundingClientRect();
          const opened = performance.now();
          input('h1');
          menu.getBoundingClientRect();
          const filtered = performance.now();
          if (!menu.textContent.includes('Heading 1')) throw new Error('Filter failed');
          if (i >= 3) {
            open.push(opened - start);
            filter.push(filtered - opened);
          }
          if (register) {
            editor.setDoc(doc);
            editor.focus(paragraph.id, 0);
            input('/');
            input('ticket');
            const row = editor.root.querySelector('.nb-menu-item');
            const at = performance.now();
            row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            body.getBoundingClientRect();
            const elapsed = performance.now() - at;
            if (editor.doc.blocks[0].type !== 'custom:ticket') throw new Error('Insertion failed');
            if (i >= 3) insert.push(elapsed);
          }
        }
        return { open, filter, insert };
      }, !!sample.register);
      for (const [key, values] of Object.entries(times)) {
        if (values.length) (sample[key] ??= []).push(median(values));
      }
    }
  }
  for (const sample of cases) {
    console.log(sample.name, Object.fromEntries(['open', 'filter', 'insert']
      .filter(key => sample[key]).map(key => [key, median(sample[key]).toFixed(2) + ' ms'])));
  }
} finally {
  await browser.close();
}
