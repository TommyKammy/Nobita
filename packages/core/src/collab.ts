import { textTransferFor } from './block-merge.js';
import type {
  Block,
  BlockProps,
  BlockType,
  DatabaseData,
  Doc,
  DocChange,
  EditorSelection,
  InlineMark,
  InlineRun,
  Point,
  TableData,
} from './types.js';

export type DocPatch =
  | { type: 'setTitle'; title: string }
  | { type: 'setIcon'; icon?: string }
  | {
      type: 'insertBlock';
      parentId: string | null;
      index: number;
      block: Block;
      split?: { from: string; offset: number };
    }
  | { type: 'deleteBlock'; blockId: string }
  | {
      type: 'moveBlock';
      blockId: string;
      parentId: string | null;
      index: number;
    }
  | {
      type: 'setBlockType';
      blockId: string;
      blockType: BlockType;
      props: BlockProps;
    }
  | { type: 'updateBlockProps'; blockId: string; patch: Partial<BlockProps> }
  | {
      type: 'replaceBlockText';
      mergedFrom?: string;
      splitSuffix?: boolean;
      blockId: string;
      previous: InlineRun[];
      next: InlineRun[];
    }
  | {
      type: 'updateTable';
      blockId: string;
      previous?: TableData;
      next?: TableData;
    }
  | {
      type: 'updateDatabase';
      blockId: string;
      previous?: DatabaseData;
      next?: DatabaseData;
    };

export interface RemoteDocUpdate {
  /** Set only for a history operation initiated by this replica. */
  history?: 'undo' | 'redo';
  doc: Doc;
  remapCellOffset?: (
    blockId: string,
    rowId: string,
    columnId: string,
    offset: number
  ) => number | null;
  remapPoint?: (point: Point) => Point | null;
}
export interface PeerPresence {
  clientId: string;
  user: { id?: string; name: string; color: string };
  selection: EditorSelection | null;
  focusedBlockId?: string | null;
}
/** A row without a column addresses the database record page body. */
export type CompositionTarget = {
  pendingMarks?: InlineMark;
  blockId: string;
  from: number;
  to: number;
} & (
  { rowId?: never; columnId?: never } | { rowId: string; columnId?: string }
);
export interface CollaborationAdapter {
  getDoc(): Doc;
  beginComposition(target: CompositionTarget): void;
  commitComposition(insertedText: string): RemoteDocUpdate;
  cancelComposition(): RemoteDocUpdate;
  applyLocalChange(change: DocChange, patches: readonly DocPatch[]): void;
  subscribe(listener: (update: RemoteDocUpdate) => void): () => void;
  undo?(): boolean;
  redo?(): boolean;
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  setLocalPresence?(presence: Omit<PeerPresence, 'clientId'> | null): void;
  subscribePresence?(
    listener: (peers: readonly PeerPresence[]) => void
  ): () => void;
  destroy?(): void;
}

/** Only index changed sibling lists. Shared subtrees are already identical. */
export function diffDocs(previous: Doc, next: Doc): DocPatch[] {
  const patches: DocPatch[] = [];
  const transfer = textTransferFor(previous, next);
  if (previous.title !== next.title)
    patches.push({ type: 'setTitle', title: next.title });
  if (previous.icon !== next.icon)
    patches.push({
      type: 'setIcon',
      ...(next.icon !== undefined && { icon: next.icon }),
    });
  type Entry = { block: Block; parentId: string | null; index: number };
  const old = new Map<string, Entry>(),
    current = new Map<string, Entry>();
  function scan(a: Block[], b: Block[], parentId: string | null) {
    if (a === b) return;
    a.forEach((block, index) => old.set(block.id, { block, parentId, index }));
    b.forEach((block, index) =>
      current.set(block.id, { block, parentId, index })
    );
    const left = new Map(a.map((block) => [block.id, block]));
    const right = new Map(b.map((block) => [block.id, block]));
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const before = left.get(id)?.children,
        after = right.get(id)?.children;
      if (before?.length || after?.length) scan(before ?? [], after ?? [], id);
    }
  }
  scan(previous.blocks, next.blocks, null);
  for (const id of old.keys())
    if (!current.has(id)) patches.push({ type: 'deleteBlock', blockId: id });
  const last = new Map<string | null, number>();
  for (const [blockId, { block, parentId, index }] of current) {
    const prev = old.get(blockId);
    if (!prev) {
      patches.push({
        type: 'insertBlock',
        parentId,
        index,
        block: { ...block, children: [] },
        ...(transfer?.into === blockId &&
          transfer.offset !== undefined && {
            split: { from: transfer.from, offset: transfer.offset },
          }),
      });
      continue;
    }
    if (prev.parentId !== parentId || prev.index < (last.get(parentId) ?? -1))
      patches.push({ type: 'moveBlock', blockId, parentId, index });
    else last.set(parentId, prev.index);
    const before = prev.block;
    if (before === block) continue;
    if (before.text !== block.text)
      patches.push({
        type: 'replaceBlockText',
        blockId,
        ...(transfer?.into === blockId &&
          transfer.offset === undefined && { mergedFrom: transfer.from }),
        ...(transfer?.from === blockId &&
          transfer.offset !== undefined && { splitSuffix: true }),
        previous: before.text,
        next: block.text,
      });
    if (before.type !== block.type)
      patches.push({
        type: 'setBlockType',
        blockId,
        blockType: block.type,
        props: block.props,
      });
    else if (before.props !== block.props) {
      const patch: Record<string, unknown> = {};
      for (const key of new Set([
        ...Object.keys(before.props),
        ...Object.keys(block.props),
      ]) as Set<keyof BlockProps>) {
        if (before.props[key] === block.props[key]) continue;
        if (key === 'table' || key === 'database') {
          if (key === 'table')
            patches.push({
              type: 'updateTable',
              blockId,
              ...(before.props.table && { previous: before.props.table }),
              ...(block.props.table && { next: block.props.table }),
            });
          else
            patches.push({
              type: 'updateDatabase',
              blockId,
              ...(before.props.database && { previous: before.props.database }),
              ...(block.props.database && { next: block.props.database }),
            });
        } else patch[key] = block.props[key];
      }
      if (Object.keys(patch).length)
        patches.push({ type: 'updateBlockProps', blockId, patch });
    }
  }
  return patches;
}
