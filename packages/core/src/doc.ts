import { createDocId, createId } from './id.js';
import { createDatabaseData, duplicateDatabaseData } from './database.js';
import { createTableData, duplicateTableData } from './table.js';
import { normalizeRuns, plainText, runsLength, sliceRuns } from './text.js';
import type {
  Block,
  BlockLocation,
  BlockPosition,
  BlockProps,
  BlockType,
  Doc,
  HeadingLevel,
  InlineRun,
} from './types.js';

export function createBlock(
  type: BlockType,
  init?: { id?: string; text?: string | InlineRun[]; props?: BlockProps; children?: Block[] }
): Block {
  const text =
    init?.text === undefined
      ? []
      : typeof init.text === 'string'
        ? normalizeRuns([{ text: init.text }])
        : normalizeRuns(init.text);
  return {
    id: init?.id ?? createId(),
    type,
    text,
    props: init?.props ? { ...init.props } : defaultProps(type),
    children: init?.children ?? [],
  };
}

export function defaultProps(type: BlockType): BlockProps {
  switch (type) {
    case 'heading':
      return { level: 1 };
    case 'todo':
      return { checked: false };
    case 'code':
      return { language: 'ts' };
    case 'callout':
      return { tone: 'info' };
    case 'database':
      return { database: createDatabaseData({ variant: 'database' }) };
    case 'table':
      return { table: createTableData() };
    default:
      return {};
  }
}

export function createDoc(init?: { id?: string; title?: string; icon?: string; blocks?: Block[] }): Doc {
  return {
    version: 1,
    id: init?.id ?? createDocId(),
    title: init?.title ?? '',
    ...(init?.icon ? { icon: init.icon } : {}),
    blocks: init?.blocks ?? [createBlock('paragraph')],
  };
}

export function findBlock(blocks: readonly Block[], id: string): Block | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    const found = findBlock(block.children, id);
    if (found) return found;
  }
  return null;
}

export function locateBlock(
  blocks: readonly Block[],
  id: string,
  parent: Block | null = null,
  depth = 0
): BlockLocation | null {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.id === id) {
      return { block, parent, siblings: blocks as Block[], index, depth };
    }
    const found = locateBlock(block.children, id, block, depth + 1);
    if (found) return found;
  }
  return null;
}

export function getBlockPath(blocks: readonly Block[], id: string): Block[] {
  for (const block of blocks) {
    if (block.id === id) return [block];
    const childPath = getBlockPath(block.children, id);
    if (childPath.length > 0) return [block, ...childPath];
  }
  return [];
}

export function walkBlocks(
  blocks: readonly Block[],
  visit: (block: Block, parent: Block | null, depth: number) => void,
  parent: Block | null = null,
  depth = 0
): void {
  for (const block of blocks) {
    visit(block, parent, depth);
    walkBlocks(block.children, visit, block, depth + 1);
  }
}

export function flattenBlocks(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  walkBlocks(blocks, block => out.push(block));
  return out;
}

export function countBlocks(blocks: readonly Block[]): number {
  let count = 0;
  walkBlocks(blocks, () => {
    count += 1;
  });
  return count;
}

export function countWords(doc: Doc): number {
  let words = doc.title.trim() ? doc.title.trim().split(/\s+/u).length : 0;
  walkBlocks(doc.blocks, block => {
    const text = plainText(block.text).trim();
    if (text) words += text.split(/\s+/u).length;
    const database = block.props.database;
    if (database) {
      for (const row of database.rows) {
        for (const cell of Object.values(row.cells)) {
          const value = (cell.text ?? (cell.runs ? plainText(cell.runs) : '')).trim();
          if (value) words += value.split(/\s+/u).length;
        }
        if (row.page?.content) {
          const pageText = plainText(row.page.content).trim();
          if (pageText) words += pageText.split(/\s+/u).length;
        }
      }
    }
    const table = block.props.table;
    if (table) {
      for (const row of table.rows) {
        for (const cell of Object.values(row.cells)) {
          const value = (cell.text ?? (cell.runs ? plainText(cell.runs) : '')).trim();
          if (value) words += value.split(/\s+/u).length;
        }
      }
    }
  });
  return words;
}

/** Immutable update of one block subtree; untouched branches keep identity. */
export function updateBlocks(
  blocks: readonly Block[],
  id: string,
  updater: (block: Block) => Block
): Block[] {
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    if (block.id === id) {
      const updated = updater(block);
      if (updated === block) return blocks as Block[];
      const next = blocks.slice();
      next[i] = updated;
      return next;
    }
    if (block.children.length > 0) {
      const children = updateBlocks(block.children, id, updater);
      if (children !== block.children) {
        const next = blocks.slice();
        next[i] = { ...block, children };
        return next;
      }
    }
  }
  return blocks as Block[];
}

export function updateBlock(doc: Doc, id: string, updater: (block: Block) => Block): Doc {
  const blocks = updateBlocks(doc.blocks, id, updater);
  return blocks === doc.blocks ? doc : { ...doc, blocks };
}

export function updateBlockProps(doc: Doc, id: string, patch: Partial<BlockProps>): Doc {
  return updateBlock(doc, id, block => ({ ...block, props: { ...block.props, ...patch } }));
}

export function setBlockText(doc: Doc, id: string, text: InlineRun[]): Doc {
  return updateBlock(doc, id, block => ({ ...block, text: normalizeRuns(text) }));
}

interface ContainerResult {
  blocks: Block[];
  changed: boolean;
}

function modifyContainer(
  blocks: readonly Block[],
  parentId: string | null,
  modify: (siblings: Block[]) => Block[] | null
): ContainerResult {
  if (parentId === null) {
    const next = modify(blocks as Block[]);
    return next ? { blocks: next, changed: true } : { blocks: blocks as Block[], changed: false };
  }
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    if (block.id === parentId) {
      const modified = modify(block.children);
      if (!modified) return { blocks: blocks as Block[], changed: false };
      const next = blocks.slice();
      next[i] = { ...block, children: modified };
      return { blocks: next, changed: true };
    }
    if (block.children.length > 0) {
      const childResult = modifyContainer(block.children, parentId, modify);
      if (childResult.changed) {
        const next = blocks.slice();
        next[i] = { ...block, children: childResult.blocks };
        return { blocks: next, changed: true };
      }
    }
  }
  return { blocks: blocks as Block[], changed: false };
}

export function insertBlocksAfter(doc: Doc, afterId: string | null, blocks: Block[]): Doc {
  if (blocks.length === 0) return doc;
  if (afterId === null) {
    return { ...doc, blocks: [...blocks, ...doc.blocks] };
  }
  const location = locateBlock(doc.blocks, afterId);
  if (!location) return doc;
  const result = modifyContainer(doc.blocks, location.parent?.id ?? null, siblings => {
    const index = siblings.findIndex(block => block.id === afterId);
    if (index < 0) return null;
    const next = siblings.slice();
    next.splice(index + 1, 0, ...blocks);
    return next;
  });
  return result.changed ? { ...doc, blocks: result.blocks } : doc;
}

export function appendBlock(doc: Doc, parentId: string | null, block: Block): Doc {
  if (parentId === null) return { ...doc, blocks: [...doc.blocks, block] };
  const result = modifyContainer(doc.blocks, parentId, siblings => [...siblings, block]);
  return result.changed ? { ...doc, blocks: result.blocks } : doc;
}

export function removeBlock(doc: Doc, id: string): Doc {
  const result = removeBlockWithValue(doc, id);
  return result.doc;
}

export function removeBlockWithValue(doc: Doc, id: string): { doc: Doc; block: Block | null } {
  const location = locateBlock(doc.blocks, id);
  if (!location) return { doc, block: null };
  const parentId = location.parent?.id ?? null;
  const result = modifyContainer(doc.blocks, parentId, siblings => {
    const index = siblings.findIndex(block => block.id === id);
    if (index < 0) return null;
    const next = siblings.slice();
    next.splice(index, 1);
    return next;
  });
  return { doc: result.changed ? { ...doc, blocks: result.blocks } : doc, block: location.block };
}

export function insertBlockRelative(
  doc: Doc,
  targetId: string,
  block: Block,
  position: BlockPosition
): Doc {
  const location = locateBlock(doc.blocks, targetId);
  if (!location) return doc;
  if (position === 'child') {
    const result = modifyContainer(doc.blocks, targetId, siblings => [...siblings, block]);
    return result.changed ? { ...doc, blocks: result.blocks } : doc;
  }
  const parentId = location.parent?.id ?? null;
  const result = modifyContainer(doc.blocks, parentId, siblings => {
    const index = siblings.findIndex(item => item.id === targetId);
    if (index < 0) return null;
    const next = siblings.slice();
    next.splice(position === 'before' ? index : index + 1, 0, block);
    return next;
  });
  return result.changed ? { ...doc, blocks: result.blocks } : doc;
}

/** Move a block (with its subtree) before/after/into a target. */
export function moveBlock(doc: Doc, id: string, targetId: string, position: BlockPosition): Doc {
  if (id === targetId) return doc;
  const source = locateBlock(doc.blocks, id);
  if (!source) return doc;
  if (getBlockPath(doc.blocks, targetId).some(block => block.id === id)) return doc;
  const removed = removeBlockWithValue(doc, id);
  if (!removed.block) return doc;
  return insertBlockRelative(removed.doc, targetId, removed.block, position);
}

/** Indent a block under its previous sibling. */
export function indentBlock(doc: Doc, id: string): Doc {
  const location = locateBlock(doc.blocks, id);
  if (!location || location.index === 0) return doc;
  const previous = location.siblings[location.index - 1];
  if (!previous) return doc;
  return moveBlock(doc, id, previous.id, 'child');
}

/** Dedent a block so it becomes the next sibling of its parent. */
export function dedentBlock(doc: Doc, id: string): Doc {
  const location = locateBlock(doc.blocks, id);
  if (!location || !location.parent) return doc;
  return moveBlock(doc, id, location.parent.id, 'after');
}

export interface SplitResult {
  doc: Doc;
  newBlock: Block;
  caretOffset: number;
}

export function splitBlock(doc: Doc, id: string, offset: number, newId?: string): SplitResult {
  const block = findBlock(doc.blocks, id);
  if (!block) {
    const fallback = createBlock('paragraph');
    return { doc: appendBlock(doc, null, fallback), newBlock: fallback, caretOffset: 0 };
  }
  const length = runsLength(block.text);
  const at = Math.max(0, Math.min(offset, length));
  const before = sliceRuns(block.text, 0, at);
  const after = sliceRuns(block.text, at, length);
  const nextType = block.type;
  const nextProps: BlockProps =
    nextType === 'todo'
      ? { ...block.props, checked: false }
      : nextType === 'numbered'
        ? { ...block.props }
        : { ...block.props };
  const newBlock: Block = {
    id: newId ?? createId(),
    type: nextType,
    text: after,
    props: nextProps,
    children: [],
  };
  let nextDoc = setBlockText(doc, id, before);
  nextDoc = insertBlocksAfter(nextDoc, id, [newBlock]);
  return { doc: nextDoc, newBlock, caretOffset: 0 };
}

export interface MergeResult {
  doc: Doc;
  caretBlockId: string;
  caretOffset: number;
}

/** Merge a block into the end of its previous sibling. */
export function mergeBlockWithPrevious(doc: Doc, id: string): MergeResult | null {
  const location = locateBlock(doc.blocks, id);
  if (!location || location.index === 0) return null;
  const previous = location.siblings[location.index - 1];
  if (!previous) return null;
  const offset = runsLength(previous.text);
  const mergedText = normalizeRuns([...previous.text, ...location.block.text]);
  const mergedChildren = [...previous.children, ...location.block.children];
  let nextDoc = updateBlock(doc, previous.id, block => ({
    ...block,
    text: mergedText,
    children: mergedChildren,
  }));
  nextDoc = removeBlock(nextDoc, id);
  return { doc: nextDoc, caretBlockId: previous.id, caretOffset: offset };
}

/** Merge the next sibling into the end of a block. */
export function mergeBlockWithNext(doc: Doc, id: string): Doc | null {
  const location = locateBlock(doc.blocks, id);
  if (!location) return null;
  const next = location.siblings[location.index + 1];
  if (!next) return null;
  let nextDoc = updateBlock(doc, id, block => ({
    ...block,
    text: normalizeRuns([...block.text, ...next.text]),
    children: [...block.children, ...next.children],
  }));
  nextDoc = removeBlock(nextDoc, id === next.id ? id : next.id);
  return nextDoc;
}

export function duplicateBlockTree(block: Block): Block {  return {
    id: createId(),
    type: block.type,
    text: block.text.map(run => ({
      text: run.text,
      ...(run.marks ? { marks: { ...run.marks } } : {}),
    })),
    props: {
      ...block.props,
      ...(block.props.database
        ? { database: duplicateDatabaseData(block.props.database) }
        : {}),
      ...(block.props.table ? { table: duplicateTableData(block.props.table) } : {}),
    },
    children: block.children.map(duplicateBlockTree),
  };
}

function filterOutBlocks(blocks: readonly Block[], ids: ReadonlySet<string>): Block[] {
  if (ids.size === 0 || blocks.length === 0) return blocks as Block[];
  let changed = false;
  const out: Block[] = [];
  for (const block of blocks) {
    if (ids.has(block.id)) {
      changed = true;
      continue;
    }
    if (block.children.length > 0) {
      const nextChildren = filterOutBlocks(block.children, ids);
      if (nextChildren !== block.children) {
        changed = true;
        out.push({ ...block, children: nextChildren });
        continue;
      }
    }
    out.push(block);
  }
  return changed ? out : (blocks as Block[]);
}

/** Selected blocks in document order, collapsing descendants under selected ancestors. */
export function selectedTopLevelBlocks(blocks: readonly Block[], ids: ReadonlySet<string>): Block[] {
  if (ids.size === 0) return [];
  const out: Block[] = [];
  const visit = (list: readonly Block[]): void => {
    for (const block of list) {
      if (ids.has(block.id)) {
        out.push(block);
      } else if (block.children.length > 0) {
        visit(block.children);
      }
    }
  };
  visit(blocks);
  return out;
}

/** Remove a set of blocks (and their subtrees) and pick the nearest surviving focus block. */
export function removeBlocks(doc: Doc, ids: ReadonlySet<string>): { doc: Doc; focusBlockId: string } {
  if (ids.size === 0) {
    return { doc, focusBlockId: doc.blocks[0]?.id ?? '' };
  }
  const flat = flattenBlocks(doc.blocks);
  const topIds = new Set(selectedTopLevelBlocks(doc.blocks, ids).map(b => b.id));
  if (topIds.size === 0) {
    return { doc, focusBlockId: doc.blocks[0]?.id ?? '' };
  }
  const nextBlocks = filterOutBlocks(doc.blocks, topIds);
  if (nextBlocks.length === 0) {
    const fallback = createBlock('paragraph');
    return { doc: { ...doc, blocks: [fallback] }, focusBlockId: fallback.id };
  }
  const remainingFlat = flattenBlocks(nextBlocks);
  const remainingIds = new Set(remainingFlat.map(b => b.id));
  const firstRemovedIdx = flat.findIndex(b => !remainingIds.has(b.id));
  let focusBlockId = '';
  if (firstRemovedIdx >= 0) {
    for (let i = firstRemovedIdx - 1; i >= 0; i -= 1) {
      const candidate = flat[i];
      if (candidate && remainingIds.has(candidate.id)) {
        focusBlockId = candidate.id;
        break;
      }
    }
    if (!focusBlockId) {
      for (let i = firstRemovedIdx + 1; i < flat.length; i += 1) {
        const candidate = flat[i];
        if (candidate && remainingIds.has(candidate.id)) {
          focusBlockId = candidate.id;
          break;
        }
      }
    }
  }
  if (!focusBlockId) {
    focusBlockId = remainingFlat[0]!.id;
  }
  return { doc: { ...doc, blocks: nextBlocks }, focusBlockId };
}

/** Duplicate selected top-level blocks in document order right after the last selected block. */
export function duplicateBlocks(
  doc: Doc,
  ids: ReadonlySet<string>
): { doc: Doc; duplicatedIds: string[] } {
  const selected = selectedTopLevelBlocks(doc.blocks, ids);
  if (selected.length === 0) {
    return { doc, duplicatedIds: [] };
  }
  const copies = selected.map(duplicateBlockTree);
  const nextDoc = insertBlocksAfter(doc, selected[selected.length - 1]!.id, copies);
  return {
    doc: nextDoc,
    duplicatedIds: copies.map(block => block.id),
  };
}

/** Move selected top-level blocks (preserving document order) relative to a target block. */
export function moveBlocks(
  doc: Doc,
  ids: ReadonlySet<string>,
  targetId: string,
  position: BlockPosition
): Doc {
  const selected = selectedTopLevelBlocks(doc.blocks, ids);
  if (selected.length === 0) return doc;
  if (selected.some(block => findBlock([block], targetId) !== null)) return doc;
  if (!locateBlock(doc.blocks, targetId)) return doc;
  const selectedIds = new Set(selected.map(b => b.id));
  const stripped = filterOutBlocks(doc.blocks, selectedIds);
  const targetLoc = locateBlock(stripped, targetId);
  if (!targetLoc) return doc;
  const result =
    position === 'child'
      ? modifyContainer(stripped, targetId, siblings => [...siblings, ...selected])
      : modifyContainer(stripped, targetLoc.parent?.id ?? null, siblings => {
          const idx = siblings.findIndex(item => item.id === targetId);
          if (idx < 0) return null;
          const next = siblings.slice();
          next.splice(position === 'before' ? idx : idx + 1, 0, ...selected);
          return next;
        });
  return result.changed ? { ...doc, blocks: result.blocks } : doc;
}

/** Document-order previous block, skipping children. */
export function previousBlock(blocks: readonly Block[], id: string): Block | null {
  const order = flattenBlocks(blocks);
  const index = order.findIndex(block => block.id === id);
  if (index <= 0) return null;
  return order[index - 1] ?? null;
}

/** Document-order next block (enters children first). */
export function nextBlock(blocks: readonly Block[], id: string): Block | null {
  const order = flattenBlocks(blocks);
  const index = order.findIndex(block => block.id === id);
  if (index < 0 || index >= order.length - 1) return null;
  return order[index + 1] ?? null;
}

export function nextSibling(blocks: readonly Block[], id: string): Block | null {
  const location = locateBlock(blocks, id);
  if (!location) return null;
  return location.siblings[location.index + 1] ?? null;
}

export function previousSibling(blocks: readonly Block[], id: string): Block | null {
  const location = locateBlock(blocks, id);
  if (!location || location.index === 0) return null;
  return location.siblings[location.index - 1] ?? null;
}

export function numberingFor(blocks: readonly Block[], index: number): number {
  let count = 0;
  for (let cursor = 0; cursor <= index; cursor += 1) {
    const block = blocks[cursor];
    if (!block) continue;
    if (block.type === 'numbered') count += 1;
    else count = 0;
  }
  return Math.max(1, count);
}

export function headingLevel(block: Block): HeadingLevel {
  const level = block.props.level;
  if (level === 2 || level === 3 || level === 4 || level === 5 || level === 6) return level;
  return 1;
}

export function blockPlainText(block: Block): string {
  if (block.type === 'table') {
    return block.props.table?.rows
      .flatMap(row => Object.values(row.cells))
      .map(cell => cell.text ?? (cell.runs ? plainText(cell.runs) : ''))
      .filter(Boolean)
      .join(' ') ?? '';
  }
  return plainText(block.text);
}
