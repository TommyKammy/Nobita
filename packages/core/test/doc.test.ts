import { describe, expect, it } from 'vitest';
import {
  createBlock,
  createDoc,
  dedentBlock,
  duplicateBlocks,
  findBlock,
  flattenBlocks,
  indentBlock,
  locateBlock,
  mergeBlockWithPrevious,
  moveBlock,
  moveBlocks,
  removeBlocks,
  selectedTopLevelBlocks,
  splitBlock,
} from '../src/doc.js';
import { cloneDoc, parseDoc } from '../src/serialize.js';

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
  it('preserves opaque custom data through parsing, cloning and duplication', () => {
    const input = createDoc({ blocks: [createBlock('custom:issue', {
      id: 'a', props: { data: { ids: [0, null, false] } },
    })] });
    const parsed = parseDoc(input);
    const clone = cloneDoc(parsed);
    const copy = duplicateBlocks(parsed, new Set(['a'])).doc.blocks[1]!;
    for (const block of [clone.blocks[0]!, copy]) {
      expect(block.type).toBe('custom:issue');
      expect(block.props).toEqual(input.blocks[0]!.props);
      expect(block.props.data).not.toBe(parsed.blocks[0]!.props.data);
    }
    expect(parsed.blocks[0]!.props.data).not.toBe(input.blocks[0]!.props.data);
  });

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

function nestedDoc() {
  return createDoc({
    blocks: [
      createBlock('paragraph', {
        id: 'a',
        text: 'A',
        children: [
          createBlock('paragraph', { id: 'a1', text: 'A1' }),
          createBlock('paragraph', { id: 'a2', text: 'A2' }),
        ],
      }),
      createBlock('paragraph', { id: 'b', text: 'B' }),
      createBlock('paragraph', {
        id: 'c',
        text: 'C',
        children: [createBlock('paragraph', { id: 'c1', text: 'C1' })],
      }),
      createBlock('paragraph', { id: 'd', text: 'D' }),
    ],
  });
}

describe('batch block operations', () => {
  it('selectedTopLevelBlocks preserves document order and collapses ancestor+descendant selections', () => {
    const base = nestedDoc();
    expect(selectedTopLevelBlocks(base.blocks, new Set()).length).toBe(0);
    // Out-of-order set with both parent ('a') and child ('a1') plus disjoint nested ('c1')
    const selected = selectedTopLevelBlocks(base.blocks, new Set(['c1', 'a1', 'a', 'd']));
    expect(selected.map(b => b.id)).toEqual(['a', 'c1', 'd']);
  });

  it('removeBlocks removes multiple blocks & nested subtrees and picks nearest surviving focus', () => {
    const base = nestedDoc();
    // No-op cases keep same doc reference
    expect(removeBlocks(base, new Set()).doc).toBe(base);
    expect(removeBlocks(base, new Set(['missing'])).doc).toBe(base);

    // Removing 'b' and 'c1' (nested under 'c'); nearest preceding surviving block before 'b' is 'a2'
    const res = removeBlocks(base, new Set(['b', 'c1']));
    expect(flattenBlocks(res.doc.blocks).map(b => b.id)).toEqual(['a', 'a1', 'a2', 'c', 'd']);
    expect(res.focusBlockId).toBe('a2');
    // Untouched branches preserve reference identity
    expect(findBlock(res.doc.blocks, 'a')).toBe(findBlock(base.blocks, 'a'));
    expect(findBlock(res.doc.blocks, 'd')).toBe(findBlock(base.blocks, 'd'));
  });

  it('removeBlocks selects following surviving block when first blocks are removed', () => {
    const base = nestedDoc();
    const res = removeBlocks(base, new Set(['a', 'a1']));
    expect(flattenBlocks(res.doc.blocks).map(b => b.id)).toEqual(['b', 'c', 'c1', 'd']);
    expect(res.focusBlockId).toBe('b');
    expect(findBlock(res.doc.blocks, 'c')).toBe(findBlock(base.blocks, 'c'));
  });

  it('removeBlocks leaves a fallback empty paragraph when all blocks are removed', () => {
    const base = nestedDoc();
    const res = removeBlocks(base, new Set(['a', 'b', 'c', 'd']));
    expect(res.doc.blocks).toHaveLength(1);
    expect(res.doc.blocks[0]?.type).toBe('paragraph');
    expect(res.doc.blocks[0]?.text).toEqual([]);
    expect(res.focusBlockId).toBe(res.doc.blocks[0]?.id);
  });

  it('duplicateBlocks duplicates multiple blocks including nested, database, and table blocks with fresh IDs', () => {
    const dbBlock = createBlock('database', { id: 'db1' });
    const tableBlock = createBlock('table', { id: 'tbl1' });
    const parentBlock = createBlock('paragraph', {
      id: 'p1',
      text: 'Parent',
      children: [createBlock('paragraph', { id: 'p1c', text: 'Child' })],
    });
    const tail = createBlock('paragraph', { id: 'tail', text: 'Tail' });
    const base = createDoc({ blocks: [parentBlock, dbBlock, tableBlock, tail] });

    // No-op when nothing matches
    const emptyRes = duplicateBlocks(base, new Set(['missing']));
    expect(emptyRes.doc).toBe(base);
    expect(emptyRes.duplicatedIds).toEqual([]);

    // Selecting both p1 and p1c must not duplicate p1c separately
    const res = duplicateBlocks(base, new Set(['p1', 'p1c', 'db1', 'tbl1']));
    expect(res.duplicatedIds).toHaveLength(3);
    expect(res.duplicatedIds.every(id => !['p1', 'p1c', 'db1', 'tbl1', 'tail'].includes(id))).toBe(true);

    // Inserted right after last selected block ('tbl1'), before 'tail'
    expect(res.doc.blocks.map(b => b.id)).toEqual([
      'p1',
      'db1',
      'tbl1',
      ...res.duplicatedIds,
      'tail',
    ]);

    const dupParent = res.doc.blocks[3]!;
    expect(dupParent.children).toHaveLength(1);
    expect(dupParent.children[0]!.id).not.toBe('p1c');
    expect(dupParent.children[0]!.text).toEqual([{ text: 'Child' }]);

    const dupDb = res.doc.blocks[4]!;
    expect(dupDb.props.database).toBeDefined();
    expect(dupDb.props.database!.rows[0]?.id).not.toBe(dbBlock.props.database!.rows[0]?.id);
    expect(dupDb.props.database!.columns[0]?.id).not.toBe(dbBlock.props.database!.columns[0]?.id);

    const dupTable = res.doc.blocks[5]!;
    expect(dupTable.props.table).toBeDefined();
    expect(dupTable.props.table!.rows[0]?.id).not.toBe(tableBlock.props.table!.rows[0]?.id);
    expect(dupTable.props.table!.columns[0]?.id).not.toBe(tableBlock.props.table!.columns[0]?.id);
  });

  it('moveBlocks moves disjoint and contiguous blocks before, after, and as child in document order', () => {
    const base = nestedDoc();

    // Move disjoint ('d', 'a') before 'c' -> document order is ['a', 'd']
    const movedBefore = moveBlocks(base, new Set(['d', 'a', 'a1']), 'c', 'before');
    expect(movedBefore.blocks.map(b => b.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(findBlock(movedBefore.blocks, 'a')?.children.map(b => b.id)).toEqual(['a1', 'a2']);
    expect(findBlock(movedBefore.blocks, 'c')).toBe(findBlock(base.blocks, 'c'));

    // Move contiguous ('a', 'b') after 'd'
    const movedAfter = moveBlocks(base, new Set(['b', 'a']), 'd', 'after');
    expect(movedAfter.blocks.map(b => b.id)).toEqual(['c', 'd', 'a', 'b']);

    // Move ('b', 'd') as children of 'c'
    const movedChild = moveBlocks(base, new Set(['d', 'b']), 'c', 'child');
    expect(movedChild.blocks.map(b => b.id)).toEqual(['a', 'c']);
    expect(findBlock(movedChild.blocks, 'c')?.children.map(b => b.id)).toEqual(['c1', 'b', 'd']);
  });

  it('moveBlocks refuses self-move, moving into selected subtree, or missing target', () => {
    const base = nestedDoc();
    expect(moveBlocks(base, new Set(['a']), 'a', 'before')).toBe(base);
    expect(moveBlocks(base, new Set(['a', 'b']), 'a1', 'child')).toBe(base);
    expect(moveBlocks(base, new Set(['a', 'b']), 'a2', 'after')).toBe(base);
    expect(moveBlocks(base, new Set(['a']), 'missing', 'before')).toBe(base);
    expect(moveBlocks(base, new Set(), 'b', 'before')).toBe(base);
  });
});
