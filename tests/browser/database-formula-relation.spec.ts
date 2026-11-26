import { expect, test } from '@playwright/test';
import { openFixture } from './helpers.js';
import type { DatabaseData } from '@nobita/core';
import type { NobitaEditorElement } from '@nobita/element';

const tasks: DatabaseData = {
  title: 'Tasks',
  variant: 'database',
  columns: [
    { id: 'name', name: 'Task', type: 'text' },
    { id: 'hours', name: 'Hours', type: 'number' },
    { id: 'back', name: 'Projects', type: 'relation' },
  ],
  rows: ['3', '6'].map((text, i) => ({
    id: 't' + i,
    cells: { name: { text: 'Task ' + i }, hours: { text } },
  })),
};
const projects: DatabaseData = {
  title: 'Projects',
  variant: 'database',
  columns: [
    { id: 'title', name: 'Title', type: 'text' },
    {
      id: 'tasks',
      name: 'Tasks',
      type: 'relation',
      relation: { databaseId: 'tasks' },
    },
    {
      id: 'total',
      name: 'Total',
      type: 'formula',
      formula: { expression: 'sum(pluck(prop("tasks"),"hours"))' },
    },
  ],
  rows: ['A', 'B'].map((text, i) => ({
    id: 'p' + i,
    cells: { title: { text }, tasks: { relations: [{ rowId: 't' + i }] } },
  })),
  view: {
    type: 'table',
    filters: [{ columnId: 'total', operator: 'greaterThan', value: '2' }],
    sorts: [{ columnId: 'total', direction: 'desc' }],
    stats: { total: 'sum' },
  },
};
for (const external of [false, true]) {
  test(
    'rollup updates values, sort, filter and footer after ' +
      (external ? 'host notification' : 'local edits'),
    async ({ page }) => {
      await openFixture(page);
      await page.evaluate(
        ({ tasks, projects, external }) => {
          const host = document.querySelector(
            'nobita-editor'
          ) as NobitaEditorElement;
          if (external) {
            projects.columns[1]!.relation!.pageId = 'remote';
            host.resolveDatabase = (id, page) =>
              id === 'tasks' && page === 'remote' ? tasks : null;
          }
          const blocks = (external ? [projects] : [projects, tasks]).map(
            (database) => ({
              id: database.title!.toLowerCase(),
              type: 'database' as const,
              props: { database },
              children: [],
              text: [],
            })
          );
          host.doc = { ...host.doc, blocks };
        },
        { tasks, projects, external }
      );
      const cells = page.locator('td[data-column-id="total"] button');
      const footer = page.locator('[data-stat-column="total"]');
      await expect(cells).toHaveText(['6', '3']);
      await expect(footer).toContainText('9');
      for (const [step, expected, sum] of [
        ['increase', ['10', '6'], '16'],
        ['rename', ['10', '6'], '16'],
        ['filter', ['6'], '6'],
        ['delete row', [], ''],
        ['delete column', ['#REF', '#REF'], ''],
      ] as const) {
        await page.evaluate(
          ({ step, external }) => {
            const host = document.querySelector(
              'nobita-editor'
            ) as NobitaEditorElement;
            const editor = host.editor!;
            const prev = editor.resolveDatabase(
              'tasks',
              external ? 'remote' : undefined
            )!;
            let next = { ...prev };
            if (step === 'increase' || step === 'filter')
              next.rows = prev.rows.map((r) =>
                r.id === 't0'
                  ? {
                      ...r,
                      cells: {
                        ...r.cells,
                        hours: { text: step === 'increase' ? '10' : '1' },
                      },
                    }
                  : r
              );
            if (step === 'rename')
              next.columns = prev.columns.map((c) =>
                c.id === 'hours' ? { ...c, name: 'Time' } : c
              );
            if (step === 'delete row')
              next.rows = prev.rows.filter((r) => r.id !== 't1');
            if (step === 'delete column') {
              next.columns = prev.columns.filter((c) => c.id !== 'hours');
              const p = editor.resolveDatabase('projects')!;
              editor.updateDatabase('projects', {
                ...p,
                views: p.views?.map((v) => ({
                  ...v,
                  filters: [],
                  filter: { type: 'group', op: 'and', conditions: [] },
                })),
                view: { type: 'table', filters: [] },
              });
            }
            if (external) {
              host.resolveDatabase = () => next;
              editor.refreshDatabases();
            } else editor.updateDatabase('tasks', next);
          },
          { step, external }
        );
        await expect(cells).toHaveText([...expected]);
        if (sum) await expect(footer).toContainText(sum);
      }
    }
  );
}

test('edit a formula, configure paired properties, link a row and undo both ends', async ({
  page,
}) => {
  await openFixture(page);
  await page.evaluate(
    ({ tasks, projects }) => {
      delete projects.view;
      tasks.columns = [tasks.columns[1]!, tasks.columns[0]!, tasks.columns[2]!];
      tasks.view = {
        type: 'table',
        filters: [],
        header: { titleColumnId: 'name' },
      };
      tasks.columns[2]!.relation = { databaseId: 'projects' };
      tasks.rows[0]!.cells.back = { relations: [{ rowId: 'p1' }] };
      delete projects.columns[1]!.relation;
      projects.rows.forEach((r) => delete r.cells.tasks);
      const host = document.querySelector(
        'nobita-editor'
      ) as NobitaEditorElement;
      host.doc = {
        ...host.doc,
        blocks: [projects, tasks].map((database) => ({
          id: database.title!.toLowerCase(),
          type: 'database',
          props: { database },
          text: [],
          children: [],
        })),
      };
    },
    { tasks, projects }
  );
  const formula = page.locator(
    'td[data-row-id="p0"][data-column-id="total"] button'
  );
  await formula.evaluate((button) => {
    button.dataset.identity = 'original';
  });
  await formula.click();
  await page.getByLabel('Formula expression').fill('1 + 2 * 3');
  await page.getByRole('button', { name: 'Save formula' }).click();
  await expect(formula).toHaveText('7');
  await expect(formula).toHaveAttribute('data-identity', 'original');
  const relation = page.locator(
    'td[data-row-id="p0"][data-column-id="tasks"] button'
  );
  await relation.click();
  await page.getByLabel('Target database').selectOption('tasks');
  await page.getByLabel('Reverse property').selectOption('back');
  await page.getByRole('button', { name: 'Save relation' }).click();
  const imported = page.locator(
    'td[data-row-id="p1"][data-column-id="tasks"] button'
  );
  await expect(imported).toHaveText('Task 0');
  await relation.click();
  await page
    .locator('.nb-db-popover')
    .getByRole('searchbox', { name: 'Search rows' })
    .fill('Task 1');
  await page.getByRole('button', { name: 'Task 1', exact: true }).click();
  await expect(relation).toHaveText('Task 1');
  const back = page.locator(
    'td[data-row-id="t1"][data-column-id="back"] button'
  );
  await expect(back).toHaveText('A');
  await page.evaluate(() =>
    (
      document.querySelector('nobita-editor') as NobitaEditorElement
    ).editor!.undoDatabase()
  );
  await expect(back).toHaveText('Select…');
  await expect(relation).toHaveText('Select…');
  await expect(imported).toHaveText('Task 0');
  await page.evaluate(() =>
    (
      document.querySelector('nobita-editor') as NobitaEditorElement
    ).editor!.undoDatabase()
  );
  await expect(imported).toHaveText('Select…');
  await expect(
    page.locator('td[data-row-id="t0"][data-column-id="back"] button')
  ).toHaveText('B');
});

test('notifies the external host of paired edits and undo', async ({
  page,
}) => {
  await openFixture(page);
  const changes = await page.evaluate(
    ({ tasks, projects }) => {
      const host = document.querySelector(
        'nobita-editor'
      ) as NobitaEditorElement;
      host.setTheme('light');
      const observed: string[] = [];
      host.onRelationSync = (change) => observed.push('first:' + change.linked);
      host.resolveDatabase = () => tasks;
      projects.columns[1]!.relation = {
        databaseId: 'tasks',
        pageId: 'remote',
        syncedColumnId: 'back',
      };
      host.doc = {
        ...host.doc,
        blocks: [
          {
            id: 'projects',
            type: 'database',
            props: { database: projects },
            text: [],
            children: [],
          },
        ],
      };
      const editor = host.editor!;
      const data = editor.resolveDatabase('projects')!;
      editor.updateDatabase('projects', {
        ...data,
        rows: data.rows.map((r, i) =>
          i ? r : { ...r, cells: { ...r.cells, tasks: { relations: [] } } }
        ),
      });
      editor.setTheme('dark');
      host.onRelationSync = (change) =>
        observed.push('second:' + change.linked);
      editor.undoDatabase();
      host.onRelationSync = undefined;
      editor.redoDatabase();
      return observed;
    },
    { tasks, projects }
  );
  expect(changes).toEqual(['first:false', 'second:true']);
});
