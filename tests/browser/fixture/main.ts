import {
  defineNobitaEditor,
  type NobitaEditor,
  type NobitaEditorElement,
  type NobitaChangeDetail,
} from '@nobita/element';
import { DatabaseEvalContext, type DatabaseData, createBlock, createDoc, type Doc } from '@nobita/core';

declare global {
  interface Window {
    __ready: boolean;
    __changes: NobitaChangeDetail[];
    __editor: NobitaEditor | null;
    __host: NobitaEditorElement;
    __setDoc: (doc?: Doc) => void;
    __benchFormulas: () => number;
    __benchSetSize: (count: number) => number;
  }
}

const seed = (): Doc =>
  createDoc({
    id: 'browser-fixture',
    title: '',
    blocks: [
      createBlock('paragraph', { id: 'b1', text: 'Alpha' }),
      createBlock('paragraph', { id: 'b2', text: 'Beta' }),
      createBlock('paragraph', { id: 'b3', text: 'Gamma' }),
    ],
  });

const sizedDoc = (count: number): Doc =>
  createDoc({
    id: 'browser-bench',
    title: '',
    blocks: Array.from({ length: count }, (_, index) =>
      createBlock('paragraph', {
        id: `bench-${index}`,
        text: `Block ${index}`,
      })
    ),
  });

const host = document.querySelector<NobitaEditorElement>('#editor');
if (!host) throw new Error('Missing fixture host');

defineNobitaEditor();
window.__host = host;
window.__changes = [];
window.__setDoc = (doc = seed()) => {
  host.doc = doc;
  window.__changes = [];
};
window.__benchSetSize = (count: number) => {
  const doc = sizedDoc(count);
  const start = performance.now();
  host.doc = doc;
  return performance.now() - start;
};

host.addEventListener('nobita-change', event => {
  window.__changes.push((event as CustomEvent<NobitaChangeDetail>).detail);
});

host.doc = seed();
window.__editor = host.editor;
window.__ready = true;

window.__benchFormulas = () => {
  const data: DatabaseData = {
    variant: 'database',
    columns: [
      { id: 'hours', name: 'Hours', type: 'number' },
      ...Array.from({ length: 5 }, (_, i) => ({
        id: 'f' + i, name: 'Formula ' + i, type: 'formula' as const,
        formula: { expression: 'round(prop("hours") * ' + (i+1) + ')' },
      })),
    ],
    rows: Array.from({ length: 100 }, (_, i) => ({ id: String(i), cells: { hours: { text: String(i) } } })),
  };
  const context = new DatabaseEvalContext();
  const start = performance.now();
  const projected = context.project(data);
  const elapsed = performance.now() - start;
  if (projected.rows[99]?.cells.f4?.text !== '495') throw new Error('Incomplete formula benchmark');
  return elapsed;
};
