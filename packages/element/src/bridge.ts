import type { CalloutTone, DatabaseData } from '@nobita/core';
import type { BlockView } from './block-view.js';

/** Surface the block view needs from the editor. Implemented by NobitaEditor. */
export interface BlockHost {
  readonly readonly: boolean;
  registerView(view: BlockView): void;
  unregisterView(blockId: string): void;
  focusBlock(blockId: string, offset?: number): void;
  toggleTodo(blockId: string): void;
  setImage(blockId: string, patch: { src?: string; alt?: string; caption?: string }): void;
  setCodeLanguage(blockId: string, language: string): void;
  setCalloutTone(blockId: string, tone: CalloutTone): void;
  openBlockMenu(blockId: string, anchor: HTMLElement): void;
  addBlockAfter(blockId: string): void;
  beginDrag(blockId: string, event: PointerEvent, handle: HTMLElement): void;
  updateDatabase(blockId: string, data: DatabaseData, options?: { mergeKey?: string }): void;
  undoDatabase(): void;
  redoDatabase(): void;
  focusAfterBlock(blockId: string): void;
}
