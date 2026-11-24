import { describe, expect, it } from 'vitest';
import {
  createDatabaseColumn,
  createDatabaseData,
  createDatabaseRow,
  databaseStatValue,
  databaseView,
  databaseViewColumnStates,
  databaseVisibleColumns,
  duplicateDatabaseData,
  filteredDatabaseRows,
  groupedDatabaseRows,
  normalizeDatabaseData,
  searchDatabaseRows,
  sortedDatabaseRows,
} from '../src/database.js';
import { createBlock, createDoc, duplicateBlockTree } from '../src/doc.js';
import { blocksToHtml, parseDoc } from '../src/serialize.js';
import { blocksToMarkdown, markdownToBlocks } from '../src/markdown.js';
import { countWords } from '../src/doc.js';
import type { DatabaseData } from '../src/types.js';

describe('database model', () => {
  it('creates table and database variants', () => {
    const table = createDatabaseData({ variant: 'table' });
    expect(table.variant).toBe('table');
    expect(table.columns).toHaveLength(3);
    expect(table.rows.length).toBeGreaterThan(0);

    const database = createDatabaseData({ variant: 'database' });
    expect(database.columns.map(column => column.type)).toEqual([
      'text',
      'select',
      'date',
      'checkbox',
    ]);
  });

  it('normalizes malformed data and repairs ids', () => {
    const normalized = normalizeDatabaseData({
      variant: 'weird',
      columns: [
        { id: 'x', name: 'Name', type: 'text' },
        { id: 'x', name: '', type: 'nope' },
      ],
      rows: [
        { id: 'r', cells: { x: { text: 'hello' }, missing: { text: 'ignored' } } },
        { id: 'r', cells: 'bad' },
      ],
      sort: { columnId: 'nope', direction: 'sideways' },
    });
    expect(normalized.variant).toBe('database');
    expect(normalized.columns).toHaveLength(2);
    expect(new Set(normalized.columns.map(column => column.id)).size).toBe(2);
    expect(new Set(normalized.rows.map(row => row.id)).size).toBe(normalized.rows.length);
    expect(normalized.rows[0]?.cells[normalized.columns[0]!.id]?.text).toBe('hello');
    expect(normalized.rows[0]?.cells.missing).toBeUndefined();
    expect(normalized.sort).toBeUndefined();
  });

  it('duplicates with fresh row and column ids and remapped cells', () => {
    const data = createDatabaseData({
      variant: 'table',
      columns: [createDatabaseColumn('A'), createDatabaseColumn('B')],
      rows: [createDatabaseRow({})],
    });
    const first = data.columns[0]!;
    const second = data.columns[1]!;
    data.rows[0]!.cells[first.id] = { text: 'one' };
    data.rows[0]!.cells[second.id] = { text: 'two' };
    const copy = duplicateDatabaseData(data);
    expect(copy.columns[0]?.id).not.toBe(first.id);
    expect(copy.rows[0]?.id).not.toBe(data.rows[0]?.id);
    expect(copy.rows[0]?.cells[copy.columns[0]!.id]?.text).toBe('one');
    expect(copy.rows[0]?.cells[copy.columns[1]!.id]?.text).toBe('two');
    // The original is untouched.
    expect(data.rows[0]?.cells[first.id]?.text).toBe('one');
  });

  it('sorts by typed values with empty values last', () => {
    const columns = [
      createDatabaseColumn('Name'),
      createDatabaseColumn('Score', 'number'),
    ];
    const name = columns[0]!;
    const score = columns[1]!;
    const data = {
      variant: 'table' as const,
      columns,
      rows: [
        createDatabaseRow({ [name.id]: { text: 'b' }, [score.id]: { text: '2' } }),
        createDatabaseRow({ [name.id]: { text: 'a' }, [score.id]: { text: '10' } }),
        createDatabaseRow({ [name.id]: { text: 'c' } }),
      ],
      sort: { columnId: score.id, direction: 'asc' as const },
    };
    expect(sortedDatabaseRows(data).map(row => row.cells[name.id]?.text)).toEqual(['b', 'a', 'c']);
    data.sort = { columnId: score.id, direction: 'desc' };
    expect(sortedDatabaseRows(data).map(row => row.cells[name.id]?.text)).toEqual(['a', 'b', 'c']);
  });


  it('normalizes new property values, widths, filters and board views', () => {
    const data = normalizeDatabaseData({
      variant: 'database',
      columns: [
        { id: 'name', name: 'Name', type: 'text', width: 240 },
        { id: 'tags', name: 'Tags', type: 'multi-select', options: ['A', 'B'] },
        { id: 'files', name: 'Files', type: 'files' },
        { id: 'people', name: 'People', type: 'people' },
      ],
      rows: [
        {
          id: 'r1',
          cells: {
            name: { text: 'One' },
            tags: { values: ['A', 'A', ' B ', ''] },
            files: { files: [{ name: 'Spec', url: 'https://example.com/spec.pdf', size: 12 }] },
            people: { people: [{ id: 'u1', label: 'Ada' }] },
          },
        },
      ],
      view: {
        type: 'board',
        groupBy: 'tags',
        filters: [{ columnId: 'name', operator: 'contains', value: 'on' }],
        sort: { columnId: 'name', direction: 'asc' },
      },
    });
    expect(data.columns[0]?.width).toBe(240);
    expect(data.rows[0]?.cells.tags?.values).toEqual(['A', 'B']);
    expect(data.rows[0]?.cells.files?.files?.[0]?.name).toBe('Spec');
    expect(data.rows[0]?.cells.people?.people?.[0]?.label).toBe('Ada');
    expect(data.view).toMatchObject({
      type: 'board',
      groupBy: 'tags',
      filters: [{ columnId: 'name', operator: 'contains', value: 'on' }],
      filter: {
        type: 'group',
        op: 'and',
        conditions: [{ columnId: 'name', operator: 'contains', value: 'on' }],
      },
    });
    expect(data.view?.columns?.map(column => column.id)).toEqual([
      'name',
      'tags',
      'files',
      'people',
    ]);
  });

  it('supports view columns, nested filters, group settings and title columns', () => {
    const data = normalizeDatabaseData({
      variant: 'database',
      titleColumnId: 'name',
      columns: [
        { id: 'name', name: 'Name', type: 'text' },
        { id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Done'] },
        { id: 'score', name: 'Score', type: 'number' },
      ],
      rows: [
        { id: 'r1', cells: { name: { text: 'One' }, status: { text: 'Todo' }, score: { text: '1' } } },
        { id: 'r2', cells: { name: { text: 'Two' }, status: { text: 'Done' }, score: { text: '2' } } },
        { id: 'r3', cells: { name: { text: 'Three' }, status: { text: 'Todo' }, score: { text: '3' } } },
      ],
      views: [
        {
          id: 'v1',
          name: 'Table',
          type: 'table',
          filters: [],
          columns: [
            { id: 'status', width: 240 },
            { id: 'name', width: 120, hide: true },
            { id: 'score', width: 180 },
          ],
          filter: {
            type: 'group',
            op: 'and',
            conditions: [
              {
                type: 'group',
                op: 'or',
                conditions: [
                  { columnId: 'status', operator: 'is', value: 'Todo' },
                  { columnId: 'score', operator: 'greaterThan', value: '2' },
                ],
              },
            ],
          },
          groupBy: 'status',
          groupProperties: [
            { key: 'Done', hide: true, collapsed: true },
            { key: 'Todo', manuallyCardSort: ['r3', 'r1'] },
          ],
        },
      ],
      activeViewId: 'v1',
    });
    expect(data.titleColumnId).toBe('name');
    const view = databaseView(data);
    expect(databaseVisibleColumns(data, view).map(column => column.id)).toEqual([
      'status',
      'score',
    ]);
    expect(databaseViewColumnStates(data, view).map(item => item.width)).toEqual([
      240, 120, 180,
    ]);
    expect(filteredDatabaseRows(data, view).map(row => row.id)).toEqual(['r1', 'r3']);
    const groups = groupedDatabaseRows(data, view);
    expect(groups.map(group => group.key)).toEqual(['Done', 'Todo']);
    expect(groups[0]?.hidden).toBe(true);
    expect(groups[0]?.collapsed).toBe(true);
    expect(groups[1]?.rows.map(row => row.id)).toEqual(['r3', 'r1']);
    expect(databaseStatValue(data.rows, data.columns[2]!, 'countUnique')).toBe('3');
    expect(databaseStatValue(data.rows, data.columns[2]!, 'range')).toBe('2');
  });

  it('filters, sorts and groups rows for table and board views', () => {
    const status = createDatabaseColumn('Status', 'select', ['Todo', 'Done']);
    const name = createDatabaseColumn('Name');
    const data: DatabaseData = {
      variant: 'database',
      columns: [name, status],
      rows: [
        createDatabaseRow({ [name.id]: { text: 'B' }, [status.id]: { text: 'Todo' } }),
        createDatabaseRow({ [name.id]: { text: 'A' }, [status.id]: { text: 'Done' } }),
        createDatabaseRow({ [name.id]: { text: 'C' }, [status.id]: { text: 'Todo' } }),
        createDatabaseRow({ [name.id]: { text: 'D' } }),
      ],
      view: {
        type: 'board',
        groupBy: status.id,
        filters: [{ columnId: status.id, operator: 'is', value: 'Todo' }],
        sort: { columnId: name.id, direction: 'asc' },
      },
    };
    expect(databaseView(data).type).toBe('board');
    expect(filteredDatabaseRows(data).map(row => row.cells[name.id]?.text)).toEqual(['B', 'C']);
    const groups = groupedDatabaseRows(data);
    expect(groups.map(group => [group.label, group.rows.length])).toEqual([
      ['Todo', 2],
      ['Done', 0],
    ]);
  });

  it('keeps empty board group keys distinct from the No value label', () => {
    const name = createDatabaseColumn('Name');
    const data: DatabaseData = {
      variant: 'database',
      columns: [name],
      rows: [
        createDatabaseRow({ [name.id]: { text: 'No value' } }),
        createDatabaseRow({}),
      ],
      view: { type: 'board', groupBy: name.id, filters: [] },
    };
    const groups = groupedDatabaseRows(data);
    expect(groups.map(group => group.key)).toEqual(['No value', '']);
    expect(groups.map(group => group.label)).toEqual(['No value', 'No value']);
    expect(groups.map(group => group.rows.length)).toEqual([1, 1]);
  });

  it('preserves board groups beyond fifty distinct values', () => {
    const name = createDatabaseColumn('Name');
    const data: DatabaseData = {
      variant: 'database',
      columns: [name],
      rows: Array.from({ length: 51 }, (_, index) =>
        createDatabaseRow({ [name.id]: { text: `Item ${index}` } })
      ),
      view: { type: 'board', groupBy: name.id, filters: [] },
    };
    expect(groupedDatabaseRows(data)).toHaveLength(51);
  });

  it('duplicates view column references and deep-clones rich cells', () => {
    const tags = createDatabaseColumn('Tags', 'multi-select', ['A']);
    const data: DatabaseData = {
      variant: 'table',
      columns: [tags],
      rows: [createDatabaseRow({ [tags.id]: { values: ['A'] } })],
      view: {
        type: 'board',
        groupBy: tags.id,
        filters: [{ columnId: tags.id, operator: 'contains', value: 'A' }],
      },
    };
    const copy = duplicateDatabaseData(data);
    const copiedColumnId = copy.columns[0]!.id;
    expect(copiedColumnId).not.toBe(tags.id);
    expect(copy.view?.groupBy).toBe(copiedColumnId);
    expect(copy.view?.filters[0]?.columnId).toBe(copiedColumnId);
    expect(copy.rows[0]?.cells[copiedColumnId]?.values).toEqual(['A']);
    expect(copy.rows[0]?.cells[copiedColumnId]?.values).not.toBe(
      data.rows[0]?.cells[tags.id]?.values
    );
  });

  it('duplicates database blocks with fresh table ids', () => {
    const block = createBlock('database', { props: { database: createDatabaseData() } });
    const copy = duplicateBlockTree(block);
    expect(copy.props.database?.columns[0]?.id).not.toBe(block.props.database?.columns[0]?.id);
  });
});

describe('database serialization', () => {
  it('round-trips a markdown table', () => {
    const markdown = ['| Task | Owner |', '| --- | --- |', '| Ship | Ada |', '| Test | Lin |'].join(
      '\n'
    );
    const parsed = markdownToBlocks(markdown);
    expect(parsed.blocks).toHaveLength(1);
    const block = parsed.blocks[0]!;
    expect(block.type).toBe('table');
    const table = block.props.table!;
    expect(table.columns).toHaveLength(2);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[1]?.cells[table.columns[0]!.id]?.text).toBe('Ship');
    expect(table.rows[1]?.cells[table.columns[1]!.id]?.text).toBe('Ada');
    const output = blocksToMarkdown(createDoc({ blocks: [block] }), { title: false });
    expect(output).toContain('| Task | Owner |');
    expect(output).toContain('| Ship | Ada |');
  });

  it('exports html tables and counts database words', () => {
    const data = createDatabaseData({
      variant: 'table',
      columns: [createDatabaseColumn('Name')],
      rows: [createDatabaseRow({})],
    });
    data.rows[0]!.cells[data.columns[0]!.id] = { text: 'hello world' };
    const doc = createDoc({ blocks: [createBlock('database', { props: { database: data } })] });
    const html = blocksToHtml(doc.blocks);
    expect(html).toContain('<table');
    expect(html).toContain('hello world');
    expect(countWords(doc)).toBe(2);
  });

  it('normalizes database props through parseDoc', () => {
    const doc = parseDoc({
      version: 1,
      id: 'd',
      title: '',
      blocks: [
        {
          id: 'b',
          type: 'database',
          text: [],
          props: {
            database: {
              variant: 'database',
              columns: [{ id: 'c', name: 'Name', type: 'text' }],
              rows: [{ id: 'r', cells: { c: { text: 'kept' } } }],
            },
          },
          children: [],
        },
      ],
    });
    expect(doc.blocks[0]?.props.database?.rows[0]?.cells.c?.text).toBe('kept');
  });

  it('fills a missing column type with text', () => {
    const doc = parseDoc({
      version: 1,
      id: 'd',
      title: '',
      blocks: [
        {
          id: 'b',
          type: 'database',
          text: [],
          props: {
            database: {
              variant: 'table',
              columns: [{ id: 'c', name: 'Name' }],
              rows: [{ id: 'r', cells: { c: { text: 'value' } } }],
            },
          },
          children: [],
        },
      ],
    });
    expect(doc.blocks[0]?.props.database?.columns[0]?.type).toBe('text');
  });
});


describe('database P1 queries', () => {
  const name = createDatabaseColumn('Name');
  const score = createDatabaseColumn('Score', 'number');
  const due = createDatabaseColumn('Due', 'date');
  const status = createDatabaseColumn('Status', 'select', ['Todo', 'Done']);
  const tags = createDatabaseColumn('Tags', 'multi-select', ['A', 'B']);
  const done = createDatabaseColumn('Done', 'checkbox');
  const data: DatabaseData = {
    variant: 'database',
    columns: [name, score, due, status, tags, done],
    rows: [
      createDatabaseRow({
        [name.id]: { text: 'Alpha' },
        [score.id]: { text: '10' },
        [due.id]: { text: '2026-01-01' },
        [status.id]: { text: 'Todo' },
        [tags.id]: { values: ['A', 'B'] },
        [done.id]: { checked: true },
      }),
      createDatabaseRow({
        [name.id]: { text: 'Beta' },
        [score.id]: { text: '5' },
        [due.id]: { text: '2026-02-01' },
        [status.id]: { text: 'Done' },
        [tags.id]: { values: ['B'] },
        [done.id]: { checked: false },
      }),
      createDatabaseRow({
        [name.id]: { text: 'Gamma' },
        [score.id]: { text: '20' },
        [due.id]: { text: '2026-03-01' },
        [status.id]: { text: 'Todo' },
        [tags.id]: { values: ['A'] },
        [done.id]: { checked: false },
      }),
    ],
    views: [
      {
        id: 'v1',
        name: 'Main',
        type: 'table',
        filters: [],
      },
    ],
    activeViewId: 'v1',
  };

  const names = (rows: readonly { cells: Record<string, { text?: string }> }[]) =>
    rows.map(row => row.cells[name.id]?.text);

  it('applies multiple sort keys', () => {
    data.views = [
      {
        id: 'v1',
        name: 'Main',
        type: 'table',
        filters: [],
        sorts: [
          { columnId: status.id, direction: 'asc' },
          { columnId: score.id, direction: 'desc' },
        ],
      },
    ];
    expect(names(sortedDatabaseRows(data))).toEqual(['Beta', 'Gamma', 'Alpha']);
  });

  it('filters by type-aware operators and or mode', () => {
    data.views = [
      {
        id: 'v1',
        name: 'Main',
        type: 'table',
        filters: [
          { columnId: score.id, operator: 'greaterThan', value: '8' },
          { columnId: status.id, operator: 'is', value: 'Done' },
        ],
        filterMode: 'or',
      },
    ];
    expect(filteredDatabaseRows(data).map(row => row.cells[name.id]?.text)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);

    data.views = [
      {
        id: 'v1',
        name: 'Main',
        type: 'table',
        filters: [
          { columnId: score.id, operator: 'greaterThan', value: '8' },
          { columnId: due.id, operator: 'before', value: '2026-02-15' },
        ],
      },
    ];
    expect(filteredDatabaseRows(data).map(row => row.cells[name.id]?.text)).toEqual(['Alpha']);

    data.views = [
      {
        id: 'v1',
        name: 'Main',
        type: 'table',
        filters: [
          { columnId: tags.id, operator: 'containsAll', value: 'A, B' },
        ],
      },
    ];
    expect(filteredDatabaseRows(data).map(row => row.cells[name.id]?.text)).toEqual(['Alpha']);
  });

  it('computes search and footer statistics', () => {
    expect(searchDatabaseRows(data, data.rows, 'amm').map(row => row.cells[name.id]?.text)).toEqual([
      'Gamma',
    ]);
    expect(databaseStatValue(data.rows, score, 'sum')).toBe('35');
    expect(databaseStatValue(data.rows, score, 'average')).toBe('11.67');
    expect(databaseStatValue(data.rows, score, 'count')).toBe('3');
  });

  it('ignores filters for deleted columns instead of passing all rows', () => {
    data.views = [
      {
        id: 'v1',
        name: 'Main',
        type: 'table',
        filters: [
          { columnId: 'deleted', operator: 'is', value: 'anything' },
          { columnId: status.id, operator: 'is', value: 'Done' },
        ],
        filterMode: 'or',
      },
    ];
    expect(filteredDatabaseRows(data).map(row => row.cells[name.id]?.text)).toEqual(['Beta']);
  });

  it('preserves more than twenty named views', () => {
    const parsed = parseDoc({
      version: 1,
      id: 'many-views',
      title: '',
      blocks: [
        {
          id: 'db',
          type: 'database',
          text: [],
          props: {
            database: {
              variant: 'database',
              title: 'Roadmap',
              columns: [{ id: 'name', name: 'Name', type: 'text' }],
              rows: [],
              views: Array.from({ length: 21 }, (_, index) => ({
                id: `v${index}`,
                name: `View ${index}`,
                type: 'table',
                filters: [],
              })),
              activeViewId: 'v20',
            },
          },
          children: [],
        },
      ],
    });
    expect(parsed.blocks[0]?.props.database?.views).toHaveLength(21);
    expect(parsed.blocks[0]?.props.database?.title).toBe('Roadmap');
  });

  it('normalizes multiple views and view-specific settings', () => {
    const parsed = parseDoc({
      version: 1,
      id: 'views',
      title: '',
      blocks: [
        {
          id: 'db',
          type: 'database',
          text: [],
          props: {
            database: {
              variant: 'database',
              columns: [
                { id: 'name', name: 'Name', type: 'text' },
                { id: 'score', name: 'Score', type: 'number' },
              ],
              rows: [],
              views: [
                {
                  id: 'v1',
                  name: 'Table',
                  type: 'table',
                  filters: [],
                  hiddenColumns: ['score'],
                  stats: { score: 'sum' },
                },
                { id: 'v2', name: 'Board', type: 'board', filters: [], groupBy: 'name' },
              ],
              activeViewId: 'v2',
            },
          },
          children: [],
        },
      ],
    });
    const database = parsed.blocks[0]?.props.database;
    expect(database?.views).toHaveLength(2);
    expect(database?.activeViewId).toBe('v2');
    expect(database?.views?.[0]?.hiddenColumns).toEqual(['score']);
    expect(database?.views?.[0]?.stats?.score).toBe('sum');
  });
});
