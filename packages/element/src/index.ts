export { NobitaEditor } from './editor.js';
export type { NobitaOptions, NobitaTheme } from './editor.js';
export { NobitaEditorElement, createEditor, defineNobitaEditor } from './element.js';
export type { NobitaChangeDetail } from './element.js';
export { styles } from './styles.js';
export { icon } from './icons.js';
export { Menu } from './menu.js';
export type { MenuItem, MenuOptions } from './menu.js';
export { Toolbar } from './toolbar.js';
export type { ToolbarMark } from './toolbar.js';
export { htmlToBlocks, plainTextToBlocks, readClipboardPayload } from './clipboard.js';
export {
  blocksToHtml,
  blocksToMarkdown,
  createBlock,
  createDoc,
  docToJSON,
  markdownToBlocks,
  parseDoc,
} from '@nobita/core';
export type {
  Block,
  BlockProps,
  BlockType,
  Doc,
  DocChange,
  EditorSelection,
  InlineMark,
  InlineRun,
  Point,
} from '@nobita/core';

import { defineNobitaEditor } from './element.js';

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  defineNobitaEditor();
}
