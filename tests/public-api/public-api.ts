import {
  NobitaEditorElement,
  createEditor,
  defineNobitaEditor,
  htmlToBlocks,
  icon,
  plainTextToBlocks,
  readClipboardPayload,
  type CustomBlockRenderer,
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
  collectRestoreTargetIds,
  collectTrashTargetIds,
  createBlock,
  createDoc,
  createTableData,
  mergeTableCells,
  unmergeTableCell,
  unmergeTableRange,
  type TableRect,
  extractPageLinks,
  getBacklinks,
  getPageBreadcrumbs,
  isTrashedPage,
  markdownToBlocks,
  parseDoc,
  partitionTrashedPages,
  resolveRestoreParentId,
  searchWorkspacePages,
  type CustomBlockType,
  type Doc,
  type JsonValue,
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
    virtualize: { threshold: 300, overscanPx: 800 },
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
    databaseProvider: query => [{ databaseId: 'tasks', pageId: 'work', title: query }],
    resolveDatabase: (databaseId, pageId) => { void databaseId; void pageId; return null; },
    onRelationSync: change => { void change.linked; void change.targetRowId; },
    onOpenPage: pageId => void pageId,
    resolvePage: (pageId: string): PageInfo | null => ({ id: pageId, title: 'Page' }),
    pageProvider: {
      search: () => [{ id: 'p1', title: 'Page' }],
      create: title => ({ id: 'p2', title }),
    } satisfies PageProvider,
  };
  const editor = createEditor(host, options);
  const type: CustomBlockType = 'custom:issue';
  const data: JsonValue = { id: 42, tags: ['open'] };
  const card = createBlock(type, { props: { data } });
  const render: CustomBlockRenderer = block => JSON.stringify(block.props.data);
  editor.registerCustomBlock(type, render);
  editor.setDoc(createDoc({ blocks: [card] }));
  editor.registerCustomBlock(type, null);
  // @ts-expect-error - built-in renderers cannot be replaced by host registration
  editor.registerCustomBlock('paragraph', render);
  editor.scrollToBlock(doc.blocks[0]!.id);
  void editor.insertPageLink({ id: 'p1', title: 'Page' });
  void editor.insertInlinePageLink({ id: 'p1', title: 'Page' });
  editor.refreshPageLinks();
  editor.refreshDatabases();
  void extractPageLinks(doc);
  void buildBacklinkIndex([doc]);
  void getBacklinks([doc], 'p1');
  void buildPageTree([{ id: 'p1', title: 'Page', parentId: null }]);
  void getPageBreadcrumbs([{ id: 'p1', title: 'Page', parentId: null }], 'p1');
  void canReparentPage([{ id: 'p1', title: 'Page', parentId: null }], 'p1', null);
  void isTrashedPage({ deletedAt: null });
  void partitionTrashedPages([{ id: 'p1', title: 'Page', parentId: null, deletedAt: 1 }]);
  void collectTrashTargetIds([{ id: 'p1', title: 'Page', parentId: null }], 'p1');
  void resolveRestoreParentId([{ id: 'p1', title: 'Page', parentId: null, deletedAt: 1 }], 'p1');
  void collectRestoreTargetIds([{ id: 'p1', title: 'Page', parentId: null, deletedAt: 1 }], 'p1');
  void searchWorkspacePages([doc], 'Hello');
  const table: TableData = createTableData({ rows: 2, columns: 2 });
  const rect: TableRect = { rowStart: 0, rowEnd: 1, columnStart: 0, columnEnd: 1 };
  const merged = mergeTableCells(table, rect);
  void unmergeTableRange(merged, rect);
  void unmergeTableCell(merged, merged.rows[0]!.id, merged.columns[0]!.id);
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

export function connectPeer(host: NobitaEditorElement, adapter: import('@nobita/core').CollaborationAdapter) {
  const options: NobitaOptions = {collaboration:adapter};
  host.collaboration = options.collaboration;
  return host.editor?.setCollaboration(adapter);
}
