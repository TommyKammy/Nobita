import {
  NobitaEditorElement,
  createEditor,
  defineNobitaEditor,
  htmlToBlocks,
  icon,
  plainTextToBlocks,
  readClipboardPayload,
  type NobitaChangeDetail,
  type NobitaOptions,
  type NobitaTheme,
} from '@nobita/element';
// @ts-expect-error - Menu is intentionally internal to @nobita/element
import { Menu } from '@nobita/element';
import {
  blocksToMarkdown,
  createBlock,
  createDoc,
  markdownToBlocks,
  parseDoc,
  type Doc,
  type EditorSelection,
} from '@nobita/core';

/**
 * Type-only integration fixture. It intentionally imports only package entry
 * points so internal modules cannot accidentally become part of the host
 * contract.
 */
export function publicApiFixture(host: HTMLElement): void {
  const doc: Doc = parseDoc(
    createDoc({
      id: 'public-api',
      title: 'Public API',
      blocks: [createBlock('paragraph', { text: 'Hello' })],
    })
  );
  const options: NobitaOptions = {
    doc,
    theme: 'light' satisfies NobitaTheme,
    readonly: false,
    placeholder: 'Type',
    onChange: (next, meta) => {
      void next;
      void meta.source;
    },
    onSelectionChange: (selection: EditorSelection | null) => {
      void selection;
    },
  };
  const editor = createEditor(host, options);
  const element = new NobitaEditorElement();
  defineNobitaEditor('public-api-editor');
  void element;
  void icon.plus;
  void htmlToBlocks('<p>Hello</p>');
  void plainTextToBlocks('Hello');
  void readClipboardPayload;
  void blocksToMarkdown(doc);
  void markdownToBlocks('Hello');
  void (null as NobitaChangeDetail | null);
  void (null as unknown as typeof Menu);
  void editor;
}
