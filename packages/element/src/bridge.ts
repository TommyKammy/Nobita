import type { Translate } from './dictionary.js';
import type { CalloutTone, DatabaseData, DatabaseResolver, DatabaseTarget, PageInfo, TableData } from '@nobita/core';
import type { BlockView } from './block-view.js';

/** Surface the block view needs from the editor. Implemented by NobitaEditor. */
export interface BlockHost {
  readonly t: Translate;
  readonly doc: { id: string };
  readonly readonly: boolean;
  readonly uploadImage?:
    | ((file: File) => string | { src: string } | Promise<string | { src: string }>)
    | undefined;
  registerView(view: BlockView): void;
  unregisterView(blockId: string): void;
  focusBlock(blockId: string, offset?: number): void;
  setFocusedBlock(blockId: string): void;
  toggleTodo(blockId: string): void;
  setImage(blockId: string, patch: { src?: string; alt?: string; caption?: string }): void;
  updateTable(blockId: string, data: TableData, options?: { mergeKey?: string }): void;
  setCodeLanguage(blockId: string, language: string): void;
  setCalloutTone(blockId: string, tone: CalloutTone): void;
  pageInfo(pageId: string): PageInfo | null;
  openPage(pageId: string): void;
  openBlockMenu(blockId: string, anchor: HTMLElement): void;
  addBlockAfter(blockId: string): void;
  beginDrag(blockId: string, event: PointerEvent, handle: HTMLElement): void;
  resolveDatabase: DatabaseResolver;
  databaseTargets(query: string): Promise<readonly DatabaseTarget[]>;
  observeDatabases(fn: () => void): () => void;
  updateDatabase(blockId: string, data: DatabaseData, options?: { mergeKey?: string }): void;
  undoDatabase(): void;
  redoDatabase(): void;
  undoTable(): void;
  redoTable(): void;
  focusAfterTableHistory(blockId: string): void;
  focusAfterBlock(blockId: string): void;
}
