import { describe, expect, it } from 'vitest';
import { createBlock, createDoc, duplicateBlockTree } from '../src/doc.js';
import { blocksToMarkdown, markdownToBlocks } from '../src/markdown.js';
import { blocksToHtml, cloneDoc, parseDoc } from '../src/serialize.js';
import {
  clearTableColumn,
  clearTableRow,
  createTableData,
  deleteTableColumn,
  deleteTableRow,
  duplicateTableColumn,
  duplicateTableData,
  duplicateTableRow,
  insertTableColumn,
  insertTableRow,
  normalizeTableData,
  moveTableColumn,
  moveTableRow,
  setTableCellText,
  setTableColumnColor,
  setTableRowColor,
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

  it('keeps table insertion inside the normalization limits', () => {
    const wide = createTableData({ rows: 1, columns: 100 });
    const columnInsert = insertTableColumn(wide, wide.columns[0]!.id);
    expect(columnInsert.data).toBe(wide);
    expect(columnInsert.columnId).toBe('');
    expect(duplicateTableColumn(wide, wide.columns[0]!.id).data).toBe(wide);

    const tall = createTableData({ rows: 1000, columns: 1 });
    const rowInsert = insertTableRow(tall, tall.rows[0]!.id);
    expect(rowInsert.data).toBe(tall);
    expect(rowInsert.rowId).toBe('');
    expect(duplicateTableRow(tall, tall.rows[0]!.id).data).toBe(tall);
  });

  it('deep-clones table data with the document', () => {
    const table = createTableData({ rows: 1, columns: 2 });
    const block = createBlock('table', { id: 't', props: { table } });
    const doc = createDoc({ blocks: [block] });
    const clone = cloneDoc(doc);
    const clonedTable = clone.blocks[0]?.props.table;
    expect(clonedTable).not.toBe(table);
    if (clonedTable) {
      clonedTable.columns[0]!.width = 200;
      clonedTable.rows[0]!.cells[clonedTable.columns[0]!.id] = { text: 'Changed' };
    }
    expect(table.columns[0]?.width).toBeUndefined();
    expect(table.rows[0]?.cells[table.columns[0]!.id]).toBeUndefined();
  });

  it('exports empty first-row cells without fabricated headers', () => {
    const table = createTableData({ rows: 2, columns: 2 });
    const c2 = table.columns[1]!;
    const edited = setTableCellText(table, table.rows[1]!.id, c2.id, 'Value');
    const block = createBlock('table', { id: 't', props: { table: edited } });
    const markdown = blocksToMarkdown(createDoc({ blocks: [block] }), { title: false });
    expect(markdown).toContain('|  |  |');
    expect(markdown).not.toContain('Column 1');
    expect(markdown).not.toContain('Column 2');
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

  it('round-trips multiline and literal HTML-like table cells through Markdown', () => {
    const table = createTableData({ rows: 2, columns: 2 });
    const c1 = table.columns[0]!;
    const r1 = table.rows[0]!;
    const multiline = setTableCellText(table, r1.id, c1.id, 'first\nsecond');
    const block = createBlock('table', { id: 't', props: { table: multiline } });
    const markdown = blocksToMarkdown(createDoc({ blocks: [block] }), { title: false });
    expect(markdown).toContain('first<br>second');
    const imported = markdownToBlocks(markdown, { extractTitle: false }).blocks.find(
      item => item.type === 'table'
    );
    expect(
      imported?.props.table?.rows[0]?.cells[imported.props.table.columns[0]!.id]?.text
    ).toBe('first\nsecond');

    const literal = setTableCellText(table, r1.id, c1.id, 'a <br> b');
    const literalBlock = createBlock('table', { id: 't', props: { table: literal } });
    const literalMarkdown = blocksToMarkdown(createDoc({ blocks: [literalBlock] }), {
      title: false,
    });
    expect(literalMarkdown).toContain('a \\<br\\> b');
    const literalImport = markdownToBlocks(literalMarkdown, {
      extractTitle: false,
    }).blocks.find(item => item.type === 'table');
    expect(
      literalImport?.props.table?.rows[0]?.cells[
        literalImport.props.table.columns[0]!.id
      ]?.text
    ).toBe('a <br> b');

    const codeImport = markdownToBlocks('| Code |\n| --- |\n| `<br>` |', {
      extractTitle: false,
    }).blocks.find(item => item.type === 'table');
    expect(
      codeImport?.props.table?.rows[1]?.cells[
        codeImport.props.table.columns[0]!.id
      ]?.text
    ).toBe('<br>');

    const escapedBreak = setTableCellText(table, r1.id, c1.id, '\\\nnext');
    const escapedBlock = createBlock('table', {
      id: 't',
      props: { table: escapedBreak },
    });
    const escapedMarkdown = blocksToMarkdown(createDoc({ blocks: [escapedBlock] }), {
      title: false,
    });
    const escapedImport = markdownToBlocks(escapedMarkdown, {
      extractTitle: false,
    }).blocks.find(item => item.type === 'table');
    expect(
      escapedImport?.props.table?.rows[0]?.cells[
        escapedImport.props.table.columns[0]!.id
      ]?.text
    ).toBe('\\\nnext');
  });

  it('duplicates, moves, clears and colors rows and columns', () => {
    const table = createTableData({ rows: 2, columns: 2 });
    const [r1, r2] = table.rows;
    const [c1, c2] = table.columns;
    let edited = setTableCellText(table, r1!.id, c1!.id, 'A');
    edited = setTableCellText(edited, r1!.id, c2!.id, 'B');
    const rowCopy = duplicateTableRow(edited, r1!.id);
    expect(rowCopy.data.rows).toHaveLength(3);
    expect(rowCopy.data.rows[1]?.cells[c1!.id]?.text).toBe('A');
    expect(rowCopy.data.rows[1]?.id).not.toBe(r1!.id);

    const columnCopy = duplicateTableColumn(edited, c1!.id);
    expect(columnCopy.data.columns).toHaveLength(3);
    expect(columnCopy.data.rows[0]?.cells[columnCopy.columnId]?.text).toBe('A');

    const moved = moveTableRow(edited, r2!.id, -1);
    expect(moved.rows[0]?.id).toBe(r2!.id);
    const movedColumn = moveTableColumn(edited, c2!.id, -1);
    expect(movedColumn.columns[0]?.id).toBe(c2!.id);

    expect(clearTableRow(edited, r1!.id).rows[0]?.cells).toEqual({});
    expect(clearTableColumn(edited, c1!.id).rows[0]?.cells[c1!.id]).toBeUndefined();
    expect(setTableRowColor(edited, r1!.id, '#fff').rows[0]?.backgroundColor).toBe('#fff');
    expect(setTableColumnColor(edited, c1!.id, '#eee').columns[0]?.backgroundColor).toBe('#eee');
  });

  it('duplicates table block data with fresh ids', () => {
    const block = createBlock('table', { props: { table: createTableData() } });
    const copy = duplicateBlockTree(block);
    expect(copy.props.table?.rows[0]?.id).not.toBe(block.props.table?.rows[0]?.id);
    expect(copy.props.table?.columns[0]?.id).not.toBe(block.props.table?.columns[0]?.id);
  });
});
