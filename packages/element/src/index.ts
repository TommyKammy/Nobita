/**
 * Public API for the embeddable editor.
 *
 * Core document types and commands live in `@nobita/core`. Internal editor
 * modules (menus, toolbar, block views, popovers) are intentionally not
 * re-exported here.
 */
export { NobitaEditor } from './editor.js';
export type { NobitaOptions, NobitaTheme } from './editor.js';

export {
  NobitaEditorElement,
  createEditor,
  defineNobitaEditor,
} from './element.js';
export type { NobitaChangeDetail } from './element.js';

/** Clipboard/HTML conversion helpers for hosts importing existing content. */
export { htmlToBlocks, plainTextToBlocks, readClipboardPayload } from './clipboard.js';

/** UI icon strings for host toolbars and shells. */
export { icon } from './icons.js';

import { defineNobitaEditor } from './element.js';

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  defineNobitaEditor();
}
