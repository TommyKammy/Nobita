import {
  duplicateBlockTree,
  flattenBlocks,
  runsLength,
  sliceRuns,
} from '@nobita/core';
import type { Block, EditorSelection, Point } from '@nobita/core';
import { compareTextPositions } from './dom.js';

export interface OrderedRange {
  flat: Block[];
  start: Point;
  end: Point;
}

export interface BlockRange extends OrderedRange {
  startIndex: number;
  endIndex: number;
}

/** Normalize a selection into document order and flatten the tree once. */
export function orderedRange(
  blocks: readonly Block[],
  selection: EditorSelection
): OrderedRange {
  const flat = flattenBlocks(blocks);
  const order = flat.map(block => block.id);
  const forward =
    compareTextPositions(order, selection.anchor, selection.focus) <= 0;
  return {
    flat,
    start: forward ? selection.anchor : selection.focus,
    end: forward ? selection.focus : selection.anchor,
  };
}

/** Resolve the start and end block indexes for a non-empty selection. */
export function blockRange(
  blocks: readonly Block[],
  selection: EditorSelection
): BlockRange | null {
  const range = orderedRange(blocks, selection);
  const startIndex = range.flat.findIndex(
    block => block.id === range.start.blockId
  );
  const endIndex = range.flat.findIndex(
    block => block.id === range.end.blockId
  );
  if (startIndex < 0 || endIndex < 0) return null;
  return { ...range, startIndex, endIndex };
}

/** Slice a selection into clipboard-ready blocks, keeping partial first/last runs. */
export function selectionBlocks(
  blocks: readonly Block[],
  selection: EditorSelection
): Block[] {
  const range = blockRange(blocks, selection);
  if (!range) return [];
  const { flat, start, end, startIndex, endIndex } = range;
  const partial = (block: Block, from: number, to: number): Block => {
    const copy = duplicateBlockTree(block);
    return { ...copy, text: sliceRuns(block.text, from, to), children: [] };
  };
  if (startIndex === endIndex) {
    const block = flat[startIndex];
    return block ? [partial(block, start.offset, end.offset)] : [];
  }
  const out: Block[] = [];
  const first = flat[startIndex];
  if (first) out.push(partial(first, start.offset, runsLength(first.text)));
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const block = flat[index];
    if (block) out.push(duplicateBlockTree(block));
  }
  const last = flat[endIndex];
  if (last) out.push(partial(last, 0, end.offset));
  return out;
}
