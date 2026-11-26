import { expect, it, vi } from 'vitest';
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
      () => new Date(now).toISOString()
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

it('refreshes clock-dependent values and their dependents across midnight', () => {
  const time = vi.spyOn(Date, 'now');
  try {
    const data = normalizeDatabaseData({
      columns: [
        {
          id: 'day',
          name: 'Day',
          type: 'formula',
          formula: { expression: 'today()' },
        },
        {
          id: 'instant',
          name: 'Instant',
          type: 'formula',
          formula: { expression: 'now()' },
        },
        {
          id: 'copy',
          name: 'Copy',
          type: 'formula',
          formula: { expression: 'prop("day")' },
        },
      ],
      rows: [{ id: 'r', cells: {} }],
    });
    const context = new DatabaseEvalContext();
    time.mockReturnValue(Date.parse('2025-01-01T23:59:59Z'));
    expect(context.project(data).rows[0]?.cells.copy?.text).toBe('2025-01-01');
    time.mockReturnValue(Date.parse('2025-01-02T00:00:01Z'));
    const cells = context.project(data).rows[0]!.cells;
    expect(cells.copy?.text).toBe('2025-01-02');
    expect(cells.instant?.text).toBe('2025-01-02T00:00:01.000Z');
    time.mockReturnValue(Date.parse('2025-01-03T00:00:01Z'));
    const edited = { ...data, rows: data.rows.map(row => ({ ...row })) };
    expect(context.project(edited).rows[0]?.cells.copy?.text).toBe('2025-01-03');
  } finally {
    time.mockRestore();
  }
});

it('keeps the forward single-value choice when pairing existing asymmetric links', async () => {
  const { createDoc, createBlock, updateDatabaseRelations, documentDatabases } =
    await import('../src/index.js');
  const forward = normalizeDatabaseData({
    columns: [
      {
        id: 'dest',
        name: 'Tasks',
        type: 'relation',
        relation: { databaseId: 'b', limit: 1 },
      },
    ],
    rows: [
      { id: 'a1', cells: { dest: { relations: [{ rowId: 'b1' }] } } },
      { id: 'a2', cells: {} },
    ],
  });
  const reverse = normalizeDatabaseData({
    columns: [
      {
        id: 'src',
        name: 'Projects',
        type: 'relation',
        relation: { databaseId: 'a' },
      },
    ],
    rows: [
      { id: 'b1', cells: {} },
      {
        id: 'b2',
        cells: { src: { relations: [{ rowId: 'a1' }, { rowId: 'a2' }] } },
      },
    ],
  });
  const doc = createDoc({
    blocks: [
      createBlock('database', { id: 'a', props: { database: forward } }),
      createBlock('database', { id: 'b', props: { database: reverse } }),
    ],
  });
  const paired = {
    ...forward,
    columns: forward.columns.map((col) => ({
      ...col,
      relation: { ...col.relation!, syncedColumnId: 'src' },
    })),
  };
  const result = documentDatabases(
    updateDatabaseRelations(doc, 'a', forward, paired).blocks
  );
  expect(result.get('a')!.rows.map((r) => r.cells.dest?.relations)).toEqual([
    [{ rowId: 'b1' }],
    [{ rowId: 'b2' }],
  ]);
  expect(result.get('b')!.rows.map((r) => r.cells.src?.relations)).toEqual([
    [{ rowId: 'a1' }],
    [{ rowId: 'a2' }],
  ]);
});

it('keeps a self-paired single relation symmetric after resolving a chain', async () => {
  const { createDoc, createBlock, updateDatabaseRelations, documentDatabases } =
    await import('../src/index.js');
  const before = normalizeDatabaseData({
    columns: [
      {
        id: 'peer',
        name: 'Peer',
        type: 'relation',
        relation: { databaseId: 'self', limit: 1 },
      },
    ],
    rows: ['a', 'b', 'c'].map((id, i) => ({
      id,
      cells:
        i === 2
          ? {}
          : { peer: { relations: [{ rowId: i === 0 ? 'b' : 'c' }] } },
    })),
  });
  const after = {
    ...before,
    columns: before.columns.map((c) => ({
      ...c,
      relation: { ...c.relation!, syncedColumnId: 'peer' },
    })),
  };
  const doc = createDoc({
    blocks: [
      createBlock('database', { id: 'self', props: { database: before } }),
    ],
  });
  const rows = documentDatabases(
    updateDatabaseRelations(doc, 'self', before, after).blocks
  ).get('self')!.rows;
  expect(rows.filter((r) => r.cells.peer?.relations?.length)).toHaveLength(2);
  for (const row of rows)
    for (const ref of row.cells.peer?.relations ?? []) {
      expect(
        rows.find((r) => r.id === ref.rowId)?.cells.peer?.relations
      ).toEqual([{ rowId: row.id }]);
    }
});

it('skips a pending forward link displaced by a preceding single-value reverse update', async () => {
  const { createDoc, createBlock, updateDatabaseRelations, documentDatabases } =
    await import('../src/index.js');
  const source = normalizeDatabaseData({
    columns: [
      {
        id: 'tasks',
        name: 'Tasks',
        type: 'relation',
        relation: { databaseId: 'b' },
      },
    ],
    rows: ['a1', 'a2'].map((id) => ({
      id,
      cells: { tasks: { relations: [{ rowId: 'b1' }] } },
    })),
  });
  const target = normalizeDatabaseData({
    columns: [
      {
        id: 'owners',
        name: 'Owner',
        type: 'relation',
        relation: { databaseId: 'a', limit: 1 },
      },
    ],
    rows: [{ id: 'b1', cells: { owners: { relations: [{ rowId: 'a2' }] } } }],
  });
  const doc = createDoc({
    blocks: [
      createBlock('database', { id: 'a', props: { database: source } }),
      createBlock('database', { id: 'b', props: { database: target } }),
    ],
  });
  const paired = {
    ...source,
    columns: source.columns.map((c) => ({
      ...c,
      relation: { ...c.relation!, syncedColumnId: 'owners' },
    })),
  };
  const dbs = documentDatabases(
    updateDatabaseRelations(doc, 'a', source, paired).blocks
  );
  const owners = dbs
    .get('a')!
    .rows.filter((r) =>
      r.cells.tasks?.relations?.some((ref) => ref.rowId === 'b1')
    );
  expect(owners).toHaveLength(1);
  expect(dbs.get('b')!.rows[0]!.cells.owners!.relations).toEqual([
    { rowId: owners[0]!.id },
  ]);
});

it('round-trips duplicate labels and name/ID collisions in local and pluck references', () => {
  const cols = [
    { id: 'n1', name: 'Hours', type: 'number' },
    { id: 'n2', name: 'Hours', type: 'number' },
    { id: 'n3', name: 'n1', type: 'number' },
    { id: 'n4', name: 'Cost', type: 'number' },
  ];
  const target = normalizeDatabaseData({ columns: cols, rows: [] });
  const source = normalizeDatabaseData({
    columns: [
      ...cols,
      {
        id: 'rel',
        name: 'Tasks',
        type: 'relation',
        relation: { databaseId: 'target' },
      },
    ],
    rows: [],
  });
  const canonical =
    'prop("n2")+prop("n3")+sum(pluck(prop("rel"),"n2"))+prop("n4")';
  const display = formulaNames(canonical, source, () => target, true);
  expect(display).toBe(
    'prop("n2")+prop("n3")+sum(pluck(prop("Tasks"),"n2"))+prop("Cost")'
  );
  expect(formulaNames(display, source, () => target)).toBe(canonical);
});

it('reads run-only text in unnormalized host snapshots for relation labels and rollups', () => {
  const target: DatabaseData = {
    variant: 'database',
    columns: [{ id: 'name', name: 'Name', type: 'text' }],
    rows: [
      {
        id: 't',
        cells: {
          name: {
            runs: [{ text: 'Task ' }, { text: 'one', marks: { bold: true } }],
          },
        },
      },
    ],
  };
  const source = normalizeDatabaseData({
    columns: [
      {
        id: 'rel',
        name: 'Tasks',
        type: 'relation',
        relation: { databaseId: 'external' },
      },
      {
        id: 'f',
        name: 'Names',
        type: 'formula',
        formula: { expression: 'join(pluck(prop("rel"),"name"),",")' },
      },
    ],
    rows: [{ id: 'p', cells: { rel: { relations: [{ rowId: 't' }] } } }],
  });
  const cells = new DatabaseEvalContext(() => target).project(source).rows[0]!
    .cells;
  expect(cells.rel?.text).toBe('Task one');
  expect(cells.f?.text).toBe('Task one');
});

it('uses displayed progress values in rollups over unnormalized snapshots', () => {
  const target = normalizeDatabaseData({
    columns: [{ id: 'pct', name: 'Progress', type: 'progress' }],
  });
  target.rows = ['75%', '32.6%', '120%', '-3%', ''].map((text, i) => ({
    id: String(i),
    cells: { pct: { text } },
  }));
  const source = normalizeDatabaseData({
    columns: [
      {
        id: 'rel',
        name: 'Tasks',
        type: 'relation',
        relation: { databaseId: 'tasks' },
      },
      {
        id: 'total',
        name: 'Total',
        type: 'formula',
        formula: { expression: 'sum(pluck(prop("rel"),"pct"))' },
      },
    ],
    rows: [
      {
        id: 'p',
        cells: {
          rel: { relations: target.rows.map((r) => ({ rowId: r.id })) },
        },
      },
    ],
  });
  expect(
    new DatabaseEvalContext(() => target).project(source).rows[0]!.cells.total
      ?.text
  ).toBe('208');
});
