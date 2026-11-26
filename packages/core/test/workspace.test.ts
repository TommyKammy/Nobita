import { describe, expect, it } from 'vitest';
import {
  buildBacklinkIndex,
  buildPageTree,
  canReparentPage,
  createBlock,
  createDatabaseColumn,
  createDatabaseRow,
  createDoc,
  createTableData,
  extractPageLinks,
  flattenPageTree,
  getBacklinks,
  getPageBreadcrumbs,
  getPageDescendantIds,
  parseDoc,
  searchWorkspacePages,
  setTableCellRuns,
} from '../src/index.js';

describe('workspace page links and backlinks', () => {
  it('extracts block, inline, hash, table, and database page links', () => {
    const table = createTableData({ rows: 1, columns: 1 });
    const colId = table.columns[0]!.id;
    table.rows[0]!.cells[colId] = {
      text: 'See Spec',
      runs: [
        { text: 'See ' },
        { text: 'Spec', marks: { page: { id: 'p-spec', title: 'Spec', icon: '📐' } } },
      ],
    };

    const titleCol = createDatabaseColumn('Task');
    const row = createDatabaseRow({
      [titleCol.id]: {
        text: 'Read Guide',
        runs: [
          { text: 'Read ' },
          { text: 'Guide', marks: { page: { id: 'p-guide', title: 'Guide' } } },
        ],
      },
    });
    row.page = {
      content: [
        { text: 'Linked ' },
        { text: 'Notes', marks: { link: '#page-p-notes' } },
      ],
    };

    const doc = createDoc({
      id: 'home',
      title: 'Home',
      icon: '🏠',
      blocks: [
        createBlock('page', {
          id: 'blk-page',
          props: { pageId: 'p-roadmap', pageTitle: 'Roadmap', pageIcon: '🗺️' },
        }),
        createBlock('paragraph', {
          id: 'blk-inline',
          text: [
            { text: 'Check ' },
            { text: 'Roadmap', marks: { page: { id: 'p-roadmap', title: 'Roadmap' } } },
            { text: ' and ' },
            { text: 'Docs', marks: { link: '#page-p%20docs' } },
          ],
        }),
        createBlock('table', { id: 'blk-table', props: { table } }),
        createBlock('database', {
          id: 'blk-db',
          props: { database: { variant: 'database', columns: [titleCol], rows: [row] } },
        }),
      ],
    });

    const refs = extractPageLinks(doc);
    expect(refs.map(r => [r.pageId, r.blockId, r.kind])).toEqual([
      ['p-roadmap', 'blk-page', 'block'],
      ['p-roadmap', 'blk-inline', 'inline'],
      ['p docs', 'blk-inline', 'inline'],
      ['p-spec', 'blk-table', 'inline'],
      ['p-guide', 'blk-db', 'inline'],
      ['p-notes', 'blk-db', 'inline'],
    ]);
  });

  it('builds deduplicated backlinks and filters self-links by default', () => {
    const a = createDoc({
      id: 'a',
      title: 'Alpha',
      icon: '🅰️',
      blocks: [
        createBlock('paragraph', {
          id: 'a1',
          text: [
            { text: 'Ref ' },
            { text: 'Beta', marks: { page: { id: 'b', title: 'Beta' } } },
            { text: ' again ' },
            { text: 'Beta', marks: { page: { id: 'b', title: 'Beta' } } },
          ],
        }),
        createBlock('paragraph', {
          id: 'a2',
          text: [{ text: 'Self', marks: { page: { id: 'a', title: 'Alpha' } } }],
        }),
      ],
    });
    const b = createDoc({
      id: 'b',
      title: 'Beta',
      blocks: [createBlock('paragraph', { id: 'b1', text: 'Target' })],
    });
    const c = createDoc({
      id: 'c',
      title: 'Gamma',
      blocks: [
        createBlock('page', {
          id: 'c1',
          props: { pageId: 'b', pageTitle: 'Beta' },
        }),
      ],
    });

    const index = buildBacklinkIndex([a, b, c]);
    expect(index.get('b')).toEqual([
      {
        sourceDocId: 'a',
        sourceTitle: 'Alpha',
        sourceIcon: '🅰️',
        blockId: 'a1',
        kind: 'inline',
        snippet: 'Ref Beta again Beta',
      },
      {
        sourceDocId: 'c',
        sourceTitle: 'Gamma',
        blockId: 'c1',
        kind: 'block',
        snippet: 'Beta',
      },
    ]);
    expect(getBacklinks([a, b, c], 'a')).toEqual([]);
    expect(getBacklinks([a, b, c], 'a', { includeSelf: true })).toHaveLength(1);
  });

  it('handles malformed percent-encoding in #page- links safely', () => {
    const doc = createDoc({
      id: 'broken',
      blocks: [
        createBlock('paragraph', {
          id: 'b1',
          text: [{ text: 'Bad', marks: { link: '#page-%E0%A4%A' } }],
        }),
      ],
    });
    const refs = extractPageLinks(doc);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.pageId).toBe('%E0%A4%A');
  });

  it('preserves page-only runs in simple table cells through setTableCellRuns and parseDoc', () => {
    const table = createTableData({ rows: 1, columns: 1 });
    const rowId = table.rows[0]!.id;
    const colId = table.columns[0]!.id;
    const updated = setTableCellRuns(table, rowId, colId, [
      { text: 'See ' },
      { text: 'Spec', marks: { page: { id: 'p-spec', title: 'Spec', icon: '📐' } } },
    ]);
    expect(updated.rows[0]?.cells[colId]?.runs?.[1]?.marks?.page?.id).toBe('p-spec');

    const roundTripped = parseDoc(
      createDoc({
        id: 'tbl-doc',
        title: 'Table doc',
        blocks: [createBlock('table', { id: 't1', props: { table: updated } })],
      })
    );
    expect(extractPageLinks(roundTripped)).toEqual([
      {
        pageId: 'p-spec',
        blockId: 't1',
        kind: 'inline',
        snippet: 'See Spec',
        title: 'Spec',
        icon: '📐',
      },
    ]);
  });
});

describe('workspace page tree and search', () => {
  it('builds a sorted, cycle-safe page tree with breadcrumbs and reparent checks', () => {
    const pages = [
      { id: 'root', title: 'Root', parentId: null, order: 0 },
      { id: 'child', title: 'Child', parentId: 'root', order: 0 },
      { id: 'grand', title: 'Grand', parentId: 'child', order: 0 },
      { id: 'orphan', title: 'Orphan', parentId: 'missing', order: 1 },
      // Cycle pair: both must still appear in the tree without looping.
      { id: 'cyc1', title: 'Cycle 1', parentId: 'cyc2', order: 2 },
      { id: 'cyc2', title: 'Cycle 2', parentId: 'cyc1', order: 3 },
    ];

    const tree = buildPageTree(pages);
    const flat = flattenPageTree(tree);
    expect(flat.map(n => n.id)).toHaveLength(6);
    expect(new Set(flat.map(n => n.id))).toEqual(
      new Set(['root', 'child', 'grand', 'orphan', 'cyc1', 'cyc2'])
    );

    const rootNode = tree.find(n => n.id === 'root');
    expect(rootNode?.depth).toBe(0);
    expect(rootNode?.children[0]?.id).toBe('child');
    expect(rootNode?.children[0]?.depth).toBe(1);
    expect(rootNode?.children[0]?.children[0]?.id).toBe('grand');
    expect(rootNode?.children[0]?.children[0]?.depth).toBe(2);

    expect(getPageBreadcrumbs(pages, 'grand').map(p => p.id)).toEqual([
      'root',
      'child',
      'grand',
    ]);
    expect(getPageDescendantIds(pages, 'root')).toEqual(new Set(['child', 'grand']));

    expect(canReparentPage(pages, 'root', 'grand')).toBe(false);
    expect(canReparentPage(pages, 'root', 'root')).toBe(false);
    expect(canReparentPage(pages, 'root', 'nonexistent')).toBe(false);
    expect(canReparentPage(pages, 'grand', 'orphan')).toBe(true);
    expect(canReparentPage(pages, 'grand', null)).toBe(true);
  });

  it('searches workspace pages across titles and block body text', () => {
    const docs = [
      createDoc({
        id: 'd1',
        title: 'Roadmap',
        icon: '🗺️',
        blocks: [createBlock('paragraph', { id: 'p1', text: 'Ship Q4 milestones' })],
      }),
      createDoc({
        id: 'd2',
        title: 'Meeting notes',
        blocks: [createBlock('paragraph', { id: 'p2', text: 'Discussed the roadmap timeline' })],
      }),
    ];

    const hits = searchWorkspacePages(docs, 'roadmap');
    expect(hits.map(h => [h.docId, h.matchType])).toEqual([
      ['d1', 'title'],
      ['d2', 'block'],
    ]);
    expect(hits[1]?.blockId).toBe('p2');
    expect(hits[1]?.snippet).toContain('roadmap timeline');

    expect(searchWorkspacePages(docs, 'milestones')).toEqual([
      expect.objectContaining({
        docId: 'd1',
        matchType: 'block',
        blockId: 'p1',
      }),
    ]);
  });
});
