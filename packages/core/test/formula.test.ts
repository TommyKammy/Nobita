import { expect, it } from 'vitest';
import {
  DatabaseEvalContext,
  duplicateDatabaseData,
  formulaNames,
  normalizeDatabaseData,
  storedDatabase,
} from '../src/index.js';
import { runFormula } from '../src/formula.js';
import type { DatabaseData } from '../src/types.js';

const now = Date.UTC(2025, 0, 2);
it.each([
  ['1+2*3==7 && !(3<=2) ? 8%3 : 0', 2],
  ['if(or(false,not(true)),1/0,and(true,empty("")))', true],
  [
    'sum(round(1.6),floor(2.8),ceil(2.1),abs(-2),min(2,3),max(1,4),avg(1,3),toNumber("3"))',
    20,
  ],
  ['concat(lower("A"),upper("b"),trim(" c "),format(4))', 'aBc4'],
  ['contains(replace("abcd","bc","XY"),slice("wXYz",1,3))', true],
  ['length(join(unique(pluck(prop("tasks"),"hours")),","))', 3],
  ['count(pluck(prop("tasks"),"hours"))', 3],
  ['dateBetween(dateAdd(today(),2,"days"),now(),"hours")', 48],
  ['formatDate(today(),"DD/MM/YYYY")', '02/01/2025'],
])('%s', (source, expected) => {
  expect(
    runFormula(
      String(source),
      () => 3,
      () => [1, 2, 2],
      () => {},
      now
    )
  ).toEqual(expected);
});

it.each([
  ['1 +', '#SYNTAX'],
  ['1 / 0', '#DIV0'],
  ['toNumber("bad")', '#TYPE'],
  ['prop("gone")', '#REF'],
  ['if(false,prop("f"),1)', '#CYCLE'],
  [' '.repeat(2001), '#LIMIT'],
  ['('.repeat(34) + '1' + ')'.repeat(34), '#LIMIT'],
  ['sum(' + Array(501).fill('1').join(',') + ')', '#LIMIT'],
])('classifies errors as %s %s', (expression, code) => {
  const data: DatabaseData = {
    variant: 'database',
    columns: [{ id: 'f', type: 'formula', name: 'F', formula: { expression } }],
    rows: [{ id: 'r', cells: {} }],
  };
  expect(new DatabaseEvalContext().project(data).rows[0]?.cells.f?.text).toBe(
    code
  );
});

it('stores canonical IDs and remaps self rollups on duplication', () => {
  const data = normalizeDatabaseData({
    columns: [
      { id: 'hours', name: 'Hours', type: 'number' },
      {
        id: 'r',
        name: 'Tasks',
        type: 'relation',
        relation: { databaseId: 'tasks', limit: 1, syncedColumnId: 'r' },
      },
      {
        id: 'f',
        name: 'Sum',
        type: 'formula',
        formula: { expression: 'sum(pluck(prop("r"),"hours"))' },
      },
    ],
    rows: [
      {
        id: 'a',
        cells: {
          hours: { text: '2' },
          r: { relations: [{ rowId: 'a' }, { rowId: 'a' }, { rowId: 'b' }] },
          f: { text: 'invalid' },
        },
      },
    ],
  });
  const resolve = () => data;
  expect(formulaNames('sum(pluck(prop("Tasks"),"Hours"))', data, resolve)).toBe(
    data.columns[2]!.formula!.expression
  );
  expect(data.rows[0]!.cells.r!.relations).toEqual([{ rowId: 'a' }]);
  expect(data.rows[0]!.cells.f).toBeUndefined();
  const view = new DatabaseEvalContext(resolve).project(data);
  expect(view.rows[0]!.cells.f!.text).toBe('2');
  expect(storedDatabase(view)).toEqual(data);
  const copy = duplicateDatabaseData(data, 'tasks', 'copy');
  expect(copy.columns[1]!.relation).toEqual({
    databaseId: 'copy',
    syncedColumnId: copy.columns[1]!.id,
    limit: 1,
  });
  expect(
    new DatabaseEvalContext(() => copy).project(copy).rows[0]!.cells[
      copy.columns[2]!.id
    ]?.text
  ).toBe('2');
});

it('uses projected values in search, grouping, stats, Markdown, plain text and HTML', async () => {
  const {
    blocksToMarkdown,
    blocksToPlainText,
    blocksToHtml,
    createBlock,
    createDoc,
    searchDatabaseRows,
    groupedDatabaseRows,
    databaseStatValue,
  } = await import('../src/index.js');
  const tasks = normalizeDatabaseData({
    columns: [{ id: 'hours', name: 'Hours', type: 'number' }],
    rows: [{ id: 'r', cells: { hours: { text: '23' } } }],
  });
  const projects = normalizeDatabaseData({
    columns: [
      {
        id: 'rel',
        name: 'Tasks',
        type: 'relation',
        relation: { databaseId: 'tasks' },
      },
      {
        id: 'f',
        name: 'Total',
        type: 'formula',
        formula: { expression: 'sum(pluck(prop("rel"),"hours"))*2' },
      },
    ],
    rows: [{ id: 'p', cells: { rel: { relations: [{ rowId: 'r' }] } } }],
  });
  const dbs = [
    createBlock('database', { id: 'projects', props: { database: projects } }),
    createBlock('database', { id: 'tasks', props: { database: tasks } }),
  ];
  const context = new DatabaseEvalContext(() => tasks);
  expect(
    searchDatabaseRows(projects, projects.rows, '46', context)
  ).toHaveLength(1);
  expect(
    groupedDatabaseRows(
      projects,
      { type: 'board', filters: [], groupBy: 'f' },
      context
    )[0]?.label
  ).toBe('46');
  expect(
    databaseStatValue(projects.rows, projects.columns[1]!, 'sum', context)
  ).toBe('46');
  expect(blocksToMarkdown(createDoc({ blocks: dbs }))).toContain('46');
  expect(blocksToPlainText(dbs)).toContain('46');
  expect(blocksToHtml(dbs)).toContain('<td>46</td>');
});

it('retains unrelated formula cells and invalidates transitive dependents on an edit', () => {
  const data: DatabaseData = {
    variant: 'database',
    columns: [
      {
        id: 'double',
        name: 'Double',
        type: 'formula',
        formula: { expression: 'prop("increment") * 2' },
      },
      {
        id: 'constant',
        name: 'Constant',
        type: 'formula',
        formula: { expression: '3' },
      },
      {
        id: 'increment',
        name: 'Increment',
        type: 'formula',
        formula: { expression: 'prop("n") + 1' },
      },
      { id: 'n', name: 'Number', type: 'number' },
    ],
    rows: [{ id: 'r', cells: { n: { text: '1' } } }],
  };
  const context = new DatabaseEvalContext();
  const initial = context.project(data).rows[0]!.cells;
  const updated = context.project({
    ...data,
    rows: [{ id: 'r', cells: { n: { text: '2' } } }],
  }).rows[0]!.cells;
  expect(updated.constant).toBe(initial.constant);
  expect(initial.double?.text).toBe('4');
  expect(updated.double?.text).toBe('6');
});
