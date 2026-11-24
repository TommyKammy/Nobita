import { describe, expect, it } from 'vitest';
import { createBlock, createDoc, duplicateBlockTree } from '../src/doc.js';
import { blocksToMarkdown } from '../src/markdown.js';
import { blocksToHtml, parseDoc } from '../src/serialize.js';
import {
  createTableData,
  deleteTableColumn,
  deleteTableRow,
  duplicateTableData,
  insertTableColumn,
  insertTableRow,
  normalizeTableData,
  setTableCellText,
  tableCellText,
  tableToTsv,
} from '../src/table.js';

describe('simple table', () => {
  it('creates and normalizes a table grid', () => {
    const table = createTableData({ rows: 2, columns: 3 });
    expect(table.rows).toHaveLength(2);
    expect(table.columns).toHaveLength(3);
    const normalized = normalizeTableData({
      columns: [{ id: 'c1', width: 120 }, { id: 'c2' }],
      rows: [
        { id: 'r1', cells: { c1: { text: 'Hello' }, c2: { text: 'World' } } },
        { id: 'r2', cells: { missing: { text: 'drop' } } },
      ],
    });
    expect(normalized.columns).toHaveLength(2);
    expect(normalized.rows[0]?.cells.c1?.text).toBe('Hello');
    expect(normalized.rows[1]?.cells.missing).toBeUndefined();
  });

  it('edits cells, rows and columns immutably', () => {
    const table = createTableData({ rows: 1, columns: 2 });
    const rowId = table.rows[0]!.id;
    const first = table.columns[0]!.id;
    const second = table.columns[1]!.id;
    const edited = setTableCellText(table, rowId, first, 'A');
    expect(tableCellText(edited.rows[0], first)).toBe('A');

    const addedRow = insertTableRow(edited, rowId, 'after');
    expect(addedRow.data.rows).toHaveLength(2);
    expect(deleteTableRow(addedRow.data, addedRow.rowId).rows).toHaveLength(1);
    expect(deleteTableRow(edited, rowId)).toBe(edited);

    const addedColumn = insertTableColumn(edited, second, 'before');
    expect(addedColumn.data.columns).toHaveLength(3);
    expect(deleteTableColumn(addedColumn.data, addedColumn.columnId).columns).toHaveLength(2);
    expect(deleteTableColumn(edited, first).columns).toHaveLength(1);
  });

  it('duplicates with fresh ids and exports TSV', () => {
    const table = createTableData({ rows: 1, columns: 2 });
    const first = table.columns[0]!.id;
    const rowId = table.rows[0]!.id;
    const edited = setTableCellText(table, rowId, first, 'A\tB');
    const copy = duplicateTableData(edited);
    expect(copy.columns[0]?.id).not.toBe(first);
    expect(copy.rows[0]?.cells[copy.columns[0]!.id]?.text).toBe('A\tB');
    expect(tableToTsv(edited)).toContain('"A\tB"');
  });

  it('round-trips JSON and exports HTML and Markdown', () => {
    const table = createTableData({ rows: 2, columns: 2 });
    const [c1, c2] = table.columns;
    const [r1, r2] = table.rows;
    const edited = setTableCellText(
      setTableCellText(
        setTableCellText(
          setTableCellText(table, r1!.id, c1!.id, 'Name'),
          r1!.id,
          c2!.id,
          'Score'
        ),
        r2!.id,
        c1!.id,
        'Ada'
      ),
      r2!.id,
      c2!.id,
      '10'
    );
    const block = createBlock('table', { id: 't', props: { table: edited } });
    const parsed = parseDoc({ version: 1, id: 'd', title: '', blocks: [block] });
    expect(parsed.blocks[0]?.type).toBe('table');
    expect(parsed.blocks[0]?.props.table?.rows[1]?.cells[c1!.id]?.text).toBe('Ada');

    const html = blocksToHtml([parsed.blocks[0]!]);
    expect(html).toContain('<table');
    expect(html).toContain('Ada');
    const markdown = blocksToMarkdown(createDoc({ blocks: [parsed.blocks[0]!] }), {
      title: false,
    });
    expect(markdown).toContain('| Name | Score |');
    expect(markdown).toContain('| Ada | 10 |');
  });

  it('duplicates table block data with fresh ids', () => {
    const block = createBlock('table', { props: { table: createTableData() } });
    const copy = duplicateBlockTree(block);
    expect(copy.props.table?.rows[0]?.id).not.toBe(block.props.table?.rows[0]?.id);
    expect(copy.props.table?.columns[0]?.id).not.toBe(block.props.table?.columns[0]?.id);
  });
});
