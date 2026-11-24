import { describe, expect, it } from 'vitest';
import {
  createDatabaseColumn,
  createDatabaseData,
  createDatabaseRow,
  databaseView,
  duplicateDatabaseData,
  filteredDatabaseRows,
  groupedDatabaseRows,
  normalizeDatabaseData,
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
    });
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
    expect(block.type).toBe('database');
    expect(block.props.database?.columns.map(column => column.name)).toEqual(['Task', 'Owner']);
    expect(block.props.database?.rows).toHaveLength(2);
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
