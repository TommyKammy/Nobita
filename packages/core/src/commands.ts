import {
  createBlock,
  findBlock,
  insertBlocksAfter,
  locateBlock,
  removeBlock,
  updateBlock,
} from './doc.js';
import { createDatabaseData } from './database.js';
import type { Block, BlockProps, BlockType, Doc, HeadingLevel, InlineRun } from './types.js';
import { normalizeRuns, plainText } from './text.js';
import { createId } from './id.js';

function propsForType(type: BlockType, current: BlockProps, extra: Partial<BlockProps> = {}): BlockProps {
  const next: BlockProps = {};
  if (current.align) next.align = current.align;
  switch (type) {
    case 'heading':
      next.level = (extra.level ?? current.level ?? 1) as HeadingLevel;
      break;
    case 'todo':
      next.checked = extra.checked ?? false;
      break;
    case 'code':
      next.language = extra.language ?? current.language ?? 'ts';
      break;
    case 'callout':
      next.tone = extra.tone ?? current.tone ?? 'info';
      break;
    case 'image': {
      const src = extra.src ?? current.src;
      const alt = extra.alt ?? current.alt;
      const caption = extra.caption ?? current.caption;
      if (src) next.src = src;
      if (alt) next.alt = alt;
      if (caption) next.caption = caption;
      break;
    }
    case 'database':
      next.database =
        extra.database ?? current.database ?? createDatabaseData({ variant: 'database' });
      break;
    default:
      break;
  }
  return next;
}

export function setBlockType(
  doc: Doc,
  id: string,
  type: BlockType,
  extra: Partial<BlockProps> = {}
): Doc {
  return updateBlock(doc, id, block => {
    if (block.type === type) {
      const sameLevel = type !== 'heading' || (extra.level ?? block.props.level) === block.props.level;
      if (sameLevel && Object.keys(extra).length === 0) return block;
    }
    const text =
      type === 'code'
        ? normalizeRuns(block.text.map(run => ({ text: run.text })))
        : type === 'divider' || type === 'image' || type === 'database'
          ? []
          : block.text;
    return {
      ...block,
      type,
      text,
      props: propsForType(type, block.props, extra),
    };
  });
}

export function setHeadingLevel(doc: Doc, id: string, level: HeadingLevel): Doc {
  return setBlockType(doc, id, 'heading', { level });
}

export function toggleChecked(doc: Doc, id: string): Doc {
  return updateBlock(doc, id, block => ({
    ...block,
    props: { ...block.props, checked: !block.props.checked },
  }));
}

export function toggleCollapsed(doc: Doc, id: string): Doc {
  return updateBlock(doc, id, block => ({
    ...block,
    props: { ...block.props, collapsed: !block.props.collapsed },
  }));
}

export function setBlockAlign(doc: Doc, id: string, align: 'left' | 'center' | 'right' | undefined): Doc {
  return updateBlock(doc, id, block => {
    const props = { ...block.props };
    if (align) props.align = align;
    else delete props.align;
    return { ...block, props };
  });
}

export function setCodeLanguage(doc: Doc, id: string, language: string): Doc {
  return updateBlock(doc, id, block => ({
    ...block,
    props: { ...block.props, language },
  }));
}

export function setImageProps(
  doc: Doc,
  id: string,
  patch: { src?: string; alt?: string; caption?: string }
): Doc {
  return updateBlock(doc, id, block => ({
    ...block,
    props: { ...block.props, ...patch },
  }));
}

export function appendParagraph(doc: Doc, parentId: string | null = null, text = ''): { doc: Doc; block: Block } {
  const block = createBlock('paragraph', { text });
  if (parentId === null) {
    return { doc: { ...doc, blocks: [...doc.blocks, block] }, block };
  }
  return {
    doc: updateBlock(doc, parentId, parent => ({
      ...parent,
      children: [...parent.children, block],
    })),
    block,
  };
}

export function insertParagraphAfter(doc: Doc, afterId: string | null, text = ''): { doc: Doc; block: Block } {
  const block = createBlock('paragraph', { text });
  return { doc: insertBlocksAfter(doc, afterId, [block]), block };
}

export function insertBlockAfter(
  doc: Doc,
  afterId: string | null,
  type: BlockType,
  init: { text?: string; props?: BlockProps; id?: string } = {}
): { doc: Doc; block: Block } {
  const block = createBlock(type, {
    ...(init.id ? { id: init.id } : {}),
    ...(init.text !== undefined ? { text: init.text } : {}),
    ...(init.props ? { props: init.props } : {}),
  });
  return { doc: insertBlocksAfter(doc, afterId, [block]), block };
}

export function deleteBlock(doc: Doc, id: string): Doc {
  return removeBlock(doc, id);
}

export function setBlockText(doc: Doc, id: string, text: string | InlineRun[]): Doc {
  const runs = typeof text === 'string' ? normalizeRuns([{ text }]) : normalizeRuns(text);
  return updateBlock(doc, id, block => ({ ...block, text: runs }));
}

/** Blocks that make sense to "turn into" from the block menu. */
export const TURN_INTO_TYPES: readonly { type: BlockType; level?: HeadingLevel; label: string }[] = [
  { type: 'paragraph', label: 'Text' },
  { type: 'heading', level: 1, label: 'Heading 1' },
  { type: 'heading', level: 2, label: 'Heading 2' },
  { type: 'heading', level: 3, label: 'Heading 3' },
  { type: 'heading', level: 4, label: 'Heading 4' },
  { type: 'heading', level: 5, label: 'Heading 5' },
  { type: 'heading', level: 6, label: 'Heading 6' },
  { type: 'bulleted', label: 'Bulleted list' },
  { type: 'numbered', label: 'Numbered list' },
  { type: 'todo', label: 'To-do list' },
  { type: 'quote', label: 'Quote' },
  { type: 'callout', label: 'Callout' },
  { type: 'code', label: 'Code block' },
];

/** Placeholder hint per block type, used by both renderer and menu previews. */
export function blockPlaceholder(block: Block, isFirst: boolean): string {
  if (!isFirst) return '';
  switch (block.type) {
    case 'heading':
      return `Heading ${block.props.level ?? 1}`;
    case 'bulleted':
    case 'numbered':
    case 'todo':
      return 'List';
    case 'quote':
      return 'Quote';
    case 'code':
      return 'Code';
    case 'callout':
      return 'Callout';
    case 'image':
      return 'Image';
    case 'database':
      return '';
    default:
      return "Write something, or press '/' for commands";
  }
}

export function blockSearchText(block: Block): string {
  return plainText(block.text);
}

export function blockExists(doc: Doc, id: string): boolean {
  return findBlock(doc.blocks, id) !== null;
}

export function blockDepth(doc: Doc, id: string): number {
  return locateBlock(doc.blocks, id)?.depth ?? 0;
}

export function newBlockId(): string {
  return createId();
}
