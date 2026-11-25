import { describe, expect, it } from 'vitest';
import {
  createBlock,
  createDoc,
  dedentBlock,
  findBlock,
  flattenBlocks,
  indentBlock,
  locateBlock,
  mergeBlockWithPrevious,
  moveBlock,
  splitBlock,
} from '../src/doc.js';
import { cloneDoc } from '../src/serialize.js';

function doc() {
  return createDoc({
    blocks: [
      createBlock('paragraph', { id: 'a', text: 'A' }),
      createBlock('paragraph', { id: 'b', text: 'B' }),
      createBlock('paragraph', { id: 'c', text: 'C' }),
    ],
  });
}

describe('block tree', () => {
  it('finds blocks with parents', () => {
    const base = doc();
    const location = locateBlock(base.blocks, 'b');
    expect(location?.index).toBe(1);
    expect(location?.parent).toBeNull();
  });

  it('splits a block and keeps order', () => {
    const base = createDoc({ blocks: [createBlock('paragraph', { id: 'a', text: 'hello world' })] });
    const result = splitBlock(base, 'a', 5);
    expect(flattenBlocks(result.doc.blocks).map(block => block.text)).toEqual([
      [{ text: 'hello' }],
      [{ text: ' world' }],
    ]);
  });

  it('merges with the previous sibling', () => {
    const base = doc();
    const result = mergeBlockWithPrevious(base, 'b');
    expect(result).not.toBeNull();
    expect(result?.caretOffset).toBe(1);
    expect(findBlock(result!.doc.blocks, 'b')).toBeNull();
    expect(findBlock(result!.doc.blocks, 'a')?.text).toEqual([{ text: 'AB' }]);
  });

  it('indents under the previous sibling and dedents back', () => {
    const base = doc();
    const indented = indentBlock(base, 'b');
    expect(locateBlock(indented.blocks, 'b')?.parent?.id).toBe('a');
    const dedented = dedentBlock(indented, 'b');
    expect(locateBlock(dedented.blocks, 'b')?.parent).toBeNull();
    expect(flattenBlocks(dedented.blocks).map(block => block.id)).toEqual(['a', 'b', 'c']);
  });

  it('moves blocks without copying unchanged siblings', () => {
    const base = doc();
    const moved = moveBlock(base, 'c', 'a', 'before');
    expect(flattenBlocks(moved.blocks).map(block => block.id)).toEqual(['c', 'a', 'b']);
    expect(findBlock(moved.blocks, 'a')).toBe(findBlock(base.blocks, 'a'));
  });

  it('refuses to move a block into its own subtree', () => {
    const base = createDoc({
      blocks: [
        createBlock('paragraph', {
          id: 'a',
          text: 'A',
          children: [createBlock('paragraph', { id: 'b', text: 'B' })],
        }),
      ],
    });
    expect(moveBlock(base, 'a', 'b', 'child')).toBe(base);
  });

  it('deep-clones nested mention marks in cloneDoc', () => {
    const base = createDoc({
      blocks: [
        createBlock('paragraph', {
          id: 'a',
          text: [
            {
              text: '@Ada',
              marks: {
                mention: { id: 'u1', label: 'Ada', kind: 'person' },
              },
            },
          ],
        }),
      ],
    });
    const cloned = cloneDoc(base);
    cloned.blocks[0]!.text[0]!.marks!.mention!.label = 'Edited';
    expect(base.blocks[0]!.text[0]!.marks!.mention!.label).toBe('Ada');
  });
});
