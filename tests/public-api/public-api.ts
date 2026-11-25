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
  type NobitaPageOpenDetail,
  type NobitaTheme,
  type PageProvider,
} from '@nobita/element';
// @ts-expect-error - Menu is intentionally internal to @nobita/element
import { Menu } from '@nobita/element';
import {
  blocksToMarkdown,
  buildBacklinkIndex,
  buildPageTree,
  canReparentPage,
  createBlock,
  createDoc,
  createTableData,
  extractPageLinks,
  getBacklinks,
  getPageBreadcrumbs,
  markdownToBlocks,
  parseDoc,
  searchWorkspacePages,
  type Doc,
  type EditorSelection,
  type PageInfo,
  type TableData,
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
    onOpenPage: pageId => void pageId,
    resolvePage: (pageId: string): PageInfo | null => ({ id: pageId, title: 'Page' }),
    pageProvider: {
      search: () => [{ id: 'p1', title: 'Page' }],
      create: title => ({ id: 'p2', title }),
    } satisfies PageProvider,
  };
  const editor = createEditor(host, options);
  void editor.insertPageLink({ id: 'p1', title: 'Page' });
  void editor.insertInlinePageLink({ id: 'p1', title: 'Page' });
  editor.refreshPageLinks();
  void extractPageLinks(doc);
  void buildBacklinkIndex([doc]);
  void getBacklinks([doc], 'p1');
  void buildPageTree([{ id: 'p1', title: 'Page', parentId: null }]);
  void getPageBreadcrumbs([{ id: 'p1', title: 'Page', parentId: null }], 'p1');
  void canReparentPage([{ id: 'p1', title: 'Page', parentId: null }], 'p1', null);
  void searchWorkspacePages([doc], 'Hello');
  const table: TableData = createTableData({ rows: 2, columns: 2 });
  void table;
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
  void (null as NobitaPageOpenDetail | null);
  void (null as unknown as typeof Menu);
  void editor;
}
