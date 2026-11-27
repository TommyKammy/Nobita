// Pass the URLs of the base and candidate production workspace demos.
import { chromium } from '@playwright/test';

const [base, candidate] = process.argv.slice(2);
if (!base || !candidate) throw new Error('Pass the base and candidate demo URLs');
const cases = [
  { name: 'Before', url: base },
  { name: 'After', url: candidate },
  { name: 'After with TOC', url: candidate, outline: true },
];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const browser = await chromium.launch();
try {
  for (let round = 0; round < 7; round++) {
    for (let offset = 0; offset < cases.length; offset++) {
      const sample = cases[(round + offset) % cases.length];
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.addInitScript(outline => {
        const blocks = Array.from({ length: 1000 }, (_, i) => ({
          id: 'b' + i,
          type: i === 0 && outline ? 'custom:table-of-contents' : i % 50 === 1 ? 'heading' : 'paragraph',
          props: {}, children: [], text: i ? [{ text: 'Item ' + i }] : [],
        }));
        const doc = { id: 'bench', version: 1, title: 'Bench', blocks };
        const record = { doc, parentId: null, favorite: false, updatedAt: 1 };
        localStorage.setItem('nobita.demo.v2', JSON.stringify({
          activeId: doc.id, pages: { bench: record }, theme: 'light',
        }));
      }, !!sample.outline);
      await page.goto(sample.url);
      await page.locator('.nb-body').waitFor();
      const result = await page.evaluate(async outline => {
        const editor = document.querySelector('#editor-host').__nobita;
        const body = editor.root.querySelector('.nb-body');
        const times = { paragraph: [], heading: [] };
        for (const [kind, index] of [['paragraph', 2], ['heading', 1]]) {
          editor.focus('b' + index, 0);
          for (let i = 0; i < 18; i++) {
            await new Promise(requestAnimationFrame);
            const start = performance.now();
            body.dispatchEvent(new InputEvent('beforeinput', {
              data: 'x', inputType: 'insertText', bubbles: true, cancelable: true,
            }));
            body.getBoundingClientRect();
            if (i >= 3) times[kind].push(performance.now() - start);
          }
          if (!editor.doc.blocks[index].text[0].text.startsWith('x'.repeat(18))) throw new Error('Missing input');
        }
        if (outline && !editor.root.querySelector('.nb-toc a')?.textContent.startsWith('x'.repeat(18))) {
          throw new Error('Expected a mounted and updated outline');
        }
        return times;
      }, !!sample.outline);
      for (const [kind, values] of Object.entries(result)) (sample[kind] ??= []).push(median(values));
      await page.close();
    }
  }
  for (const sample of cases) console.log(sample.name, {
    paragraph: median(sample.paragraph).toFixed(2), heading: median(sample.heading).toFixed(2),
  });
} finally {
  await browser.close();
}
