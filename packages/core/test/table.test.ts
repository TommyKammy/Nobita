import { describe, expect, it } from 'vitest';
import { countWords, createBlock, createDoc, duplicateBlockTree } from '../src/doc.js';
import { blocksToMarkdown, markdownToBlocks } from '../src/markdown.js';
import { blocksToHtml, cloneDoc, parseDoc } from '../src/serialize.js';
import {
  clearTableColumn,
  clearTableRow,
  cloneTableData,
  createTableData,
  deleteTableColumn,
  deleteTableRow,
  duplicateTableColumn,
  duplicateTableData,
  duplicateTableRow,
  insertTableColumn,
  insertTableRow,
  moveTableColumn,
  moveTableColumnTo,
  moveTableRow,
  moveTableRowTo,
  normalizeTableData,
  setTableCellRuns,
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

  it('sets rich-text cell runs, omits runs for plain text, deletes empty cells, and keeps no-op identity', () => {
    const table = createTableData({ rows: 1, columns: 2 });
    const r1 = table.rows[0]!.id;
    const c1 = table.columns[0]!.id;

    const rich = setTableCellRuns(table, r1, c1, [
      { text: 'He', marks: { bold: true } },
      { text: 'llo', marks: { bold: true } },
      { text: ' world' },
    ]);
    expect(rich.rows[0]?.cells[c1]).toEqual({
      text: 'Hello world',
      runs: [{ text: 'Hello', marks: { bold: true } }, { text: ' world' }],
    });
    expect(tableCellText(rich.rows[0], c1)).toBe('Hello world');

    // No-op returns exact same table reference.
    expect(
      setTableCellRuns(rich, r1, c1, [
        { text: 'Hello', marks: { bold: true } },
        { text: ' world' },
      ])
    ).toBe(rich);
    expect(setTableCellRuns(rich, 'missing', c1, [{ text: 'x' }])).toBe(rich);

    // Setting plain runs omits `runs`.
    const plain = setTableCellRuns(rich, r1, c1, [{ text: 'Plain' }]);
    expect(plain.rows[0]?.cells[c1]).toEqual({ text: 'Plain' });
    expect('runs' in (plain.rows[0]?.cells[c1] ?? {})).toBe(false);
    expect(setTableCellRuns(plain, r1, c1, [{ text: 'Plain' }])).toBe(plain);

    // Overwriting a rich-text cell with setTableCellText strips runs even when text matches.
    const stripped = setTableCellText(rich, r1, c1, 'Hello world');
    expect(stripped.rows[0]?.cells[c1]).toEqual({ text: 'Hello world' });
    expect('runs' in (stripped.rows[0]?.cells[c1] ?? {})).toBe(false);
    expect(setTableCellText(stripped, r1, c1, 'Hello world')).toBe(stripped);

    // Empty runs delete the cell; deleting an already empty cell is a no-op.
    const cleared = setTableCellRuns(rich, r1, c1, [{ text: '' }]);
    expect(cleared.rows[0]?.cells[c1]).toBeUndefined();
    expect(setTableCellRuns(cleared, r1, c1, [])).toBe(cleared);

    // Clamps to 10,000 characters.
    const longTable = setTableCellRuns(table, r1, c1, [
      { text: 'a'.repeat(9995), marks: { bold: true } },
      { text: 'b'.repeat(20), marks: { italic: true } },
    ]);
    expect(longTable.rows[0]?.cells[c1]?.text).toHaveLength(10000);
    expect(longTable.rows[0]?.cells[c1]?.runs?.[1]?.text).toBe('bbbbb');
  });

  it('normalizes rich-text cells, syncs plain text projection, and omits plain runs', () => {
    const normalized = normalizeTableData({
      columns: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
      rows: [
        {
          id: 'r1',
          cells: {
            c1: {
              text: 'stale',
              runs: [
                { text: 'Bo', marks: { bold: true } },
                { text: 'ld', marks: { bold: true } },
                { text: '!' },
              ],
            },
            c2: {
              text: 'plain',
              runs: [{ text: 'plain' }],
            },
            c3: {
              runs: [{ text: 'runs-only', marks: { code: true } }],
            },
          },
        },
        {
          id: 'r2',
          cells: {
            c1: { runs: [{ text: 'only-plain-runs' }] },
            c2: { runs: [] },
          },
        },
      ],
    });

    expect(normalized.rows[0]?.cells.c1).toEqual({
      text: 'Bold!',
      runs: [{ text: 'Bold', marks: { bold: true } }, { text: '!' }],
    });
    expect(normalized.rows[0]?.cells.c2).toEqual({ text: 'plain' });
    expect('runs' in (normalized.rows[0]?.cells.c2 ?? {})).toBe(false);
    expect(normalized.rows[0]?.cells.c3).toEqual({
      text: 'runs-only',
      runs: [{ text: 'runs-only', marks: { code: true } }],
    });
    expect(normalized.rows[1]?.cells.c1).toEqual({ text: 'only-plain-runs' });
    expect('runs' in (normalized.rows[1]?.cells.c1 ?? {})).toBe(false);
    expect(normalized.rows[1]?.cells.c2).toBeUndefined();

    const doc = createDoc({
      blocks: [createBlock('table', { id: 't', props: { table: normalized } })],
    });
    expect(countWords(doc)).toBe(4);
  });

  it('deep-clones cell runs across cloneTableData and duplicate helpers', () => {
    const base = createTableData({ rows: 2, columns: 2 });
    const [r1] = base.rows;
    const [c1] = base.columns;
    const table = setTableCellRuns(base, r1!.id, c1!.id, [
      { text: '@Ada', marks: { bold: true, mention: { id: 'u1', label: 'Ada', kind: 'user' } } },
    ]);

    const cloned = cloneTableData(table);
    cloned.rows[0]!.cells[c1!.id]!.runs![0]!.text = 'Mutated';
    cloned.rows[0]!.cells[c1!.id]!.runs![0]!.marks!.mention!.label = 'Mutated';

    const dupTable = duplicateTableData(table);
    const dupColId = dupTable.columns[0]!.id;
    dupTable.rows[0]!.cells[dupColId]!.runs![0]!.text = 'DupTable';

    const dupRow = duplicateTableRow(table, r1!.id);
    dupRow.data.rows[1]!.cells[c1!.id]!.runs![0]!.marks!.bold = undefined;

    const dupCol = duplicateTableColumn(table, c1!.id);
    dupCol.data.rows[0]!.cells[dupCol.columnId]!.runs![0]!.text = 'DupCol';

    expect(table.rows[0]?.cells[c1!.id]?.runs).toEqual([
      { text: '@Ada', marks: { bold: true, mention: { id: 'u1', label: 'Ada', kind: 'user' } } },
    ]);
  });

  it('moves rows and columns to target before/after positions immutably', () => {
    const table = createTableData({ rows: 4, columns: 4 });
    const [r0, r1, r2, r3] = table.rows.map(r => r.id);
    const [c0, c1, c2, c3] = table.columns.map(c => c.id);

    // Forward moves
    expect(moveTableRowTo(table, r0!, r2!, 'before').rows.map(r => r.id)).toEqual([r1, r0, r2, r3]);
    expect(moveTableRowTo(table, r0!, r2!, 'after').rows.map(r => r.id)).toEqual([r1, r2, r0, r3]);
    expect(moveTableColumnTo(table, c0!, c3!, 'after').columns.map(c => c.id)).toEqual([
      c1,
      c2,
      c3,
      c0,
    ]);

    // Backward moves
    expect(moveTableRowTo(table, r3!, r1!, 'before').rows.map(r => r.id)).toEqual([r0, r3, r1, r2]);
    expect(moveTableRowTo(table, r3!, r0!, 'after').rows.map(r => r.id)).toEqual([r0, r3, r1, r2]);
    expect(moveTableColumnTo(table, c2!, c0!, 'before').columns.map(c => c.id)).toEqual([
      c2,
      c0,
      c1,
      c3,
    ]);

    // No-ops keep exact reference
    expect(moveTableRowTo(table, r1!, r1!, 'before')).toBe(table);
    expect(moveTableRowTo(table, r0!, r1!, 'before')).toBe(table);
    expect(moveTableRowTo(table, r1!, r0!, 'after')).toBe(table);
    expect(moveTableRowTo(table, 'missing', r1!, 'before')).toBe(table);
    expect(moveTableRowTo(table, r1!, 'missing', 'after')).toBe(table);

    expect(moveTableColumnTo(table, c1!, c1!, 'after')).toBe(table);
    expect(moveTableColumnTo(table, c0!, c1!, 'before')).toBe(table);
    expect(moveTableColumnTo(table, c1!, c0!, 'after')).toBe(table);
    expect(moveTableColumnTo(table, 'missing', c1!, 'before')).toBe(table);
    expect(moveTableColumnTo(table, c1!, 'missing', 'after')).toBe(table);
  });

  it('exports rich-text table cells to HTML and round-trips through Markdown', () => {
    const base = createTableData({ rows: 2, columns: 2 });
    const [c1, c2] = base.columns;
    const [r1, r2] = base.rows;

    let edited = setTableCellRuns(base, r1!.id, c1!.id, [{ text: 'Task', marks: { bold: true } }]);
    edited = setTableCellText(edited, r1!.id, c2!.id, 'Notes');
    edited = setTableCellRuns(edited, r2!.id, c1!.id, [
      { text: 'Check ' },
      { text: 'spec', marks: { link: 'https://example.com' } },
      { text: ' & ' },
      { text: 'code', marks: { code: true } },
    ]);
    edited = setTableCellRuns(edited, r2!.id, c2!.id, [
      { text: 'old', marks: { strike: true } },
      { text: ' ' },
      { text: 'new\nline', marks: { italic: true } },
    ]);

    const block = createBlock('table', { id: 't', props: { table: edited } });
    const html = blocksToHtml([block]);
    expect(html).toContain('<strong>Task</strong>');
    expect(html).toContain('<td>Notes</td>');
    expect(html).toContain('<a href="https://example.com" rel="noopener noreferrer nofollow">spec</a>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<s>old</s> <em>new<br>line</em>');

    const markdown = blocksToMarkdown(createDoc({ blocks: [block] }), { title: false });
    expect(markdown).toContain('| **Task** | Notes |');
    expect(markdown).toContain(
      '| Check [spec](https://example.com) & `code` | ~~old~~ *new<br>line* |'
    );

    const imported = markdownToBlocks(markdown, { extractTitle: false }).blocks.find(
      item => item.type === 'table'
    );
    const impTable = imported?.props.table;
    expect(impTable).toBeDefined();
    const [ic1, ic2] = impTable!.columns;
    const [ir1, ir2] = impTable!.rows;
    expect(ir1?.cells[ic1!.id]).toEqual({
      text: 'Task',
      runs: [{ text: 'Task', marks: { bold: true } }],
    });
    expect(ir1?.cells[ic2!.id]).toEqual({ text: 'Notes' });
    expect('runs' in (ir1?.cells[ic2!.id] ?? {})).toBe(false);
    expect(ir2?.cells[ic1!.id]).toEqual({
      text: 'Check spec & code',
      runs: [
        { text: 'Check ' },
        { text: 'spec', marks: { link: 'https://example.com' } },
        { text: ' & ' },
        { text: 'code', marks: { code: true } },
      ],
    });
    expect(ir2?.cells[ic2!.id]).toEqual({
      text: 'old new\nline',
      runs: [
        { text: 'old', marks: { strike: true } },
        { text: ' ' },
        { text: 'new\nline', marks: { italic: true } },
      ],
    });
  });

  it('distinguishes real newlines from literal <br> inside code-marked table cells in Markdown', () => {
    const table = createTableData({ rows: 2, columns: 2 });
    const [c1, c2] = table.columns;
    const [r1, r2] = table.rows;
    let edited = setTableCellRuns(table, r1!.id, c1!.id, [
      { text: 'one\ntwo', marks: { code: true } },
    ]);
    edited = setTableCellRuns(edited, r1!.id, c2!.id, [
      { text: 'one<br>two', marks: { code: true } },
    ]);
    edited = setTableCellRuns(edited, r2!.id, c1!.id, [
      { text: 'top\nbottom', marks: { bold: true, code: true } },
    ]);
    edited = setTableCellRuns(edited, r2!.id, c2!.id, [
      { text: 'trail\n', marks: { code: true } },
    ]);

    const block = createBlock('table', { id: 't', props: { table: edited } });
    const markdown = blocksToMarkdown(createDoc({ blocks: [block] }), { title: false });
    expect(markdown).toContain('| `one`<br>`two` | `one<br>two` |');
    expect(markdown).toContain('| **`top`**<br>**`bottom`** | `trail`<br> |');

    const imported = markdownToBlocks(markdown, { extractTitle: false }).blocks.find(
      item => item.type === 'table'
    );
    const impTable = imported?.props.table!;
    const [ic1, ic2] = impTable.columns;
    const [ir1, ir2] = impTable.rows;

    expect(ir1?.cells[ic1!.id]).toEqual({
      text: 'one\ntwo',
      runs: [
        { text: 'one', marks: { code: true } },
        { text: '\n' },
        { text: 'two', marks: { code: true } },
      ],
    });
    expect(ir1?.cells[ic2!.id]).toEqual({
      text: 'one<br>two',
      runs: [{ text: 'one<br>two', marks: { code: true } }],
    });
    expect(ir2?.cells[ic1!.id]).toEqual({
      text: 'top\nbottom',
      runs: [
        { text: 'top', marks: { bold: true, code: true } },
        { text: '\n' },
        { text: 'bottom', marks: { bold: true, code: true } },
      ],
    });
    expect(ir2?.cells[ic2!.id]).toEqual({
      text: 'trail\n',
      runs: [
        { text: 'trail', marks: { code: true } },
        { text: '\n' },
      ],
    });
  });
});
