import { describe, expect, it } from 'vitest';
import { createBlock, createDoc, updateBlock } from '../src/doc.js';
import { setBlockAlign } from '../src/commands.js';
import { EditorStore } from '../src/store.js';
import { matchBlockMarkdown, matchInlineMarkdown } from '../src/markdown-rules.js';

describe('store', () => {
  it('undoes and redoes a change', () => {
    const store = new EditorStore(createDoc({ blocks: [createBlock('paragraph', { id: 'a' })] }));
    store.update(doc =>
      updateBlock(doc, 'a', block => ({ ...block, text: [{ text: 'hello' }] }))
    );
    expect(store.doc.blocks[0]?.text).toEqual([{ text: 'hello' }]);
    expect(store.undo()).toBe(true);
    expect(store.doc.blocks[0]?.text).toEqual([]);
    expect(store.redo()).toBe(true);
    expect(store.doc.blocks[0]?.text).toEqual([{ text: 'hello' }]);
  });

  it('coalesces typing bursts into one undo step', () => {
    const store = new EditorStore(createDoc({ blocks: [createBlock('paragraph', { id: 'a' })] }));
    for (const text of ['h', 'he', 'hel']) {
      store.update(
        doc => updateBlock(doc, 'a', block => ({ ...block, text: [{ text }] })),
        { mergeKey: 'text:a' }
      );
    }
    expect(store.undo()).toBe(true);
    expect(store.doc.blocks[0]?.text).toEqual([]);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);
  });

  it('emits changes and selection updates', () => {
    const store = new EditorStore(createDoc());
    const sources: string[] = [];
    const selections: number[] = [];
    store.subscribe(change => sources.push(change.source));
    store.subscribeSelection(selection => selections.push(selection ? 1 : 0));
    store.update(doc => ({ ...doc, title: 'x' }), { source: 'title' });
    store.setSelection({ anchor: { blockId: 'a', offset: 0 }, focus: { blockId: 'a', offset: 0 } });
    expect(sources).toEqual(['title']);
    expect(selections).toEqual([1]);
  });

  it('clears history when replacing documents', () => {
    const store = new EditorStore(createDoc());
    store.update(doc => ({ ...doc, title: 'a' }));
    store.replaceDoc(createDoc({ title: 'b' }));
    expect(store.canUndo).toBe(false);
    expect(store.doc.title).toBe('b');
  });

  it('sets and clears block alignment', () => {
    const doc = createDoc({ blocks: [createBlock('paragraph', { id: 'a' })] });
    const centered = setBlockAlign(doc, 'a', 'center');
    expect(centered.blocks[0]?.props.align).toBe('center');
    const cleared = setBlockAlign(centered, 'a', undefined);
    expect(cleared.blocks[0]?.props.align).toBeUndefined();
  });
});

describe('markdown rules', () => {
  it('recognizes block shortcuts', () => {
    expect(matchBlockMarkdown('# ')).toMatchObject({ type: 'heading', props: { level: 1 } });
    expect(matchBlockMarkdown('## ')).toMatchObject({ type: 'heading', props: { level: 2 } });
    expect(matchBlockMarkdown('#### ')).toMatchObject({ type: 'heading', props: { level: 4 } });
    expect(matchBlockMarkdown('- ')).toMatchObject({ type: 'bulleted' });
    expect(matchBlockMarkdown('1. ')).toMatchObject({ type: 'numbered' });
    expect(matchBlockMarkdown('[] ')).toMatchObject({ type: 'todo', props: { checked: false } });
    expect(matchBlockMarkdown('[x] ')).toMatchObject({ type: 'todo', props: { checked: true } });
    expect(matchBlockMarkdown('> ')).toMatchObject({ type: 'quote' });
    expect(matchBlockMarkdown('```ts ')).toMatchObject({ type: 'code', props: { language: 'ts' } });
    expect(matchBlockMarkdown('--- ')).toMatchObject({ type: 'divider' });
    expect(matchBlockMarkdown('hello ')).toBeNull();
  });

  it('recognizes inline shortcuts at the caret', () => {
    expect(matchInlineMarkdown('a **bold**')).toEqual({
      start: 2,
      end: 10,
      text: 'bold',
      marks: { bold: true },
    });
    expect(matchInlineMarkdown('a [site](https://x.test)')).toMatchObject({
      text: 'site',
      marks: { link: 'https://x.test' },
    });
    expect(matchInlineMarkdown('a *b*')).toMatchObject({ text: 'b', marks: { italic: true } });
    expect(matchInlineMarkdown('a ** b')).toBeNull();
  });
});
