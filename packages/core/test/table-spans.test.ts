import { describe, expect, it } from 'vitest';
import {
  clearTableColumn,
  clearTableRow,
  blocksToHtml,
  blocksToMarkdown,
  cloneTableData,
  createBlock,
  createDoc,
  createTableData,
  deleteTableColumn,
  deleteTableRow,
  duplicateTableColumn,
  duplicateTableData,
  duplicateTableRow,
  expandTableRange,
  insertTableColumn,
  insertTableRow,
  mergeTableCells,
  moveTableColumnTo,
  moveTableRowTo,
  normalizeTableData,
  setTableCellRuns,
  setTableCellText,
  setTableRangeText,
  tableToTsv,
  unmergeTableCell,
  unmergeTableRange,
} from '../src/index.js';

const square = { rowStart: 0, rowEnd: 1, columnStart: 0, columnEnd: 1 };
const data = () => createTableData({ rows: 3, columns: 3 });

describe('merged simple table cells', () => {
  it('keeps empty anchors, removes covered cells and clamps conflicting or invalid spans', () => {
    const t = normalizeTableData({
      columns: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      rows: [
        { cells: { b: { text: '', rowspan: 999 } } },
        {
          cells: {
            a: { text: 'A', colspan: 3 },
            b: { text: 'covered' },
            c: { text: 'C', colspan: 2.5 },
          },
        },
      ],
    });
    expect(t.rows[0]!.cells.b).toEqual({ text: '', rowspan: 2 });
    expect(t.rows[1]!.cells).toEqual({ a: { text: 'A' }, c: { text: 'C' } });
    expect(normalizeTableData(JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(cloneTableData(t)).toEqual(t);
    const copy = duplicateTableData(t);
    expect(copy.rows[0]!.cells[copy.columns[1]!.id]).toEqual({ text: '', rowspan: 2 });
  });

  it('checks UTF-16 length after closure, including separators, before writing', () => {
    const t = data();
    const [a, b] = t.columns;
    const [r, s] = t.rows;
    let d = setTableCellRuns(t, r!.id, a!.id, [{ text: '😀'.repeat(4999), marks: { bold: true } }]);
    d = mergeTableCells(d, { ...square, rowEnd: 0 });
    const last = { ...square, columnStart: 1 };
    const ok = setTableCellText(d, s!.id, b!.id, 'x');
    expect(expandTableRange(ok, last)).toEqual(square);
    const merged = mergeTableCells(ok, last);
    const anchor = merged.rows[0]!.cells[a!.id]!;
    expect(anchor.text.length).toBe(10000);
    expect(anchor.runs?.[0]?.marks?.bold).toBe(true);
    expect(normalizeTableData(JSON.parse(JSON.stringify(merged)))).toEqual(merged);
    const over = setTableCellText(d, s!.id, b!.id, 'xx');
    expect(mergeTableCells(over, last)).toBe(over);
  });

  it('routes single writes, skips covered paste values, and splits without moving text', () => {
    const t = data();
    const [a, b] = t.columns;
    const [r, s] = t.rows;
    let d = mergeTableCells(t, square);
    d = setTableCellRuns(d, s!.id, b!.id, [{ text: 'Bold', marks: { bold: true } }]);
    expect(d.rows[0]!.cells[a!.id]?.runs).toHaveLength(1);
    d = setTableCellText(d, s!.id, b!.id, '');
    expect(d.rows[0]!.cells[a!.id]).toEqual({ text: '', colspan: 2, rowspan: 2 });
    d = setTableRangeText(d, 0, 0, [
      ['A', 'skip'],
      ['skip', 'skip'],
    ]);
    expect(d.rows[1]).toBe(t.rows[1]);
    expect(tableToTsv(d).split('\n')[0]).toBe('A\t""\t""');
    for (const cleared of [clearTableRow(d, s!.id), clearTableColumn(d, b!.id)]) {
      expect(cleared.rows[0]!.cells[a!.id]).toEqual({ text: '', colspan: 2, rowspan: 2 });
      expect(cleared.rows[1]).toBe(d.rows[1]);
    }
    const block = createBlock('table', { props: { table: d } });
    expect(blocksToHtml([block]).match(/<td/g)).toHaveLength(6);
    expect(blocksToMarkdown(createDoc({ blocks: [block] }))).toContain('| A |  |  |');
    const split = unmergeTableCell(d, s!.id, b!.id);
    expect(split.rows[0]!.cells[a!.id]).toEqual({ text: 'A' });
    expect(unmergeTableRange(d, square)).toEqual(split);
    expect(r!.cells).toEqual({});
  });

  it('extends spans on insertion and duplication and promotes a deleted anchor', () => {
    const t = setTableRangeText(data(), 0, 0, [['A']]);
    const d = mergeTableCells(t, square);
    const [a, b] = d.columns;
    const [r] = d.rows;
    const anchor = (x: typeof t) => x.rows[0]!.cells[x.columns[0]!.id];
    for (const op of [insertTableRow, duplicateTableRow]) {
      const next = op(d, r!.id).data;
      expect(anchor(next)).toMatchObject({ text: 'A', rowspan: 3, colspan: 2 });
      expect(next.rows[1]!.cells).toEqual({});
    }
    for (const op of [insertTableColumn, duplicateTableColumn]) {
      const next = op(d, a!.id).data;
      expect(anchor(next)).toMatchObject({ colspan: 3, rowspan: 2 });
      expect(next.rows[0]!.cells[next.columns[1]!.id]).toBeUndefined();
    }
    expect(anchor(deleteTableRow(d, r!.id))).toEqual({ text: 'A', colspan: 2 });
    expect(anchor(deleteTableColumn(d, a!.id))).toEqual({ text: 'A', rowspan: 2 });
    expect(anchor(deleteTableColumn(d, b!.id))).toEqual({ text: 'A', rowspan: 2 });
    const inside = moveTableRowTo(d, r!.id, d.rows[1]!.id, 'after');
    expect(anchor(inside)).toEqual({ text: 'A', rowspan: 2, colspan: 2 });
    expect(inside.rows[1]!.cells[a!.id]).toBeUndefined();
    const moved = moveTableRowTo(d, r!.id, d.rows[2]!.id, 'after');
    expect(moved.rows[2]!.cells[a!.id]).toEqual({ text: 'A' });
    const reordered = moveTableColumnTo(d, b!.id, d.columns[2]!.id, 'after');
    expect(anchor(reordered)).toEqual({ text: 'A' });
  });
});
