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
      tasks.columns.push(
        {
          id: 'foreign',
          name: 'Other DB',
          type: 'relation',
          relation: { databaseId: 'elsewhere' },
        },
        {
          id: 'taken',
          name: 'Already paired',
          type: 'relation',
          relation: { databaseId: 'projects', syncedColumnId: 'other' },
        },
        { id: 'unused', name: 'Unconfigured', type: 'relation' }
      );
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
  const reverse = page.getByLabel('Reverse property');
  await expect(reverse.locator('option')).toHaveText([
    'One-way',
    'Projects',
    'Unconfigured',
  ]);
  await reverse.selectOption('back');
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

for (const offline of [false, true])
  test(
    'notifies paired edits and undo for ' +
      (offline ? 'an unavailable unscoped target' : 'a resolved page target'),
    async ({ page }) => {
      await openFixture(page);
      const changes = await page.evaluate(
        ({ tasks, projects, offline }) => {
          const host = document.querySelector(
            'nobita-editor'
          ) as NobitaEditorElement;
          host.setTheme('light');
          const observed: string[] = [];
          host.onRelationSync = (change) =>
            observed.push('first:' + change.linked);
          host.resolveDatabase = () => (offline ? null : tasks);
          projects.columns[1]!.relation = {
            databaseId: 'tasks',
            ...(offline ? {} : { pageId: 'remote' }),
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
        { tasks, projects, offline }
      );
      expect(changes).toEqual(['first:false', 'second:true']);
    }
  );

for (const external of [false, true]) {
  test(
    'searches and selects computed titles in a ' +
      (external ? 'remote' : 'local') +
      ' database',
    async ({ page }) => {
      await openFixture(page);
      await page.evaluate(
        ({ tasks, projects, external }) => {
          const host = document.querySelector(
            'nobita-editor'
          ) as NobitaEditorElement;
          tasks.titleColumnId = 'label';
          tasks.columns.push({
            id: 'label',
            name: 'Label',
            type: 'formula',
            formula: { expression: 'concat("Task ",prop("hours"))' },
          });
          delete projects.view;
          projects.rows[0]!.cells = {};
          if (external) {
            projects.columns[1]!.relation!.pageId = 'remote';
            host.resolveDatabase = (id, pageId) =>
              id === 'tasks' && pageId === 'remote' ? tasks : null;
          }
          host.doc = {
            ...host.doc,
            blocks: (external ? [projects] : [projects, tasks]).map(
              (database) => ({
                id: database.title!.toLowerCase(),
                type: 'database',
                props: { database },
                children: [],
                text: [],
              })
            ),
          };
        },
        { tasks, projects, external }
      );
      const relation = page.locator(
        'td[data-row-id="p0"][data-column-id="tasks"] button'
      );
      await relation.click();
      const picker = page.locator('.nb-db-popover');
      await picker.getByRole('searchbox').fill('Task 3');
      await expect(picker.getByRole('button')).toHaveText(['Task 3']);
      await picker.getByRole('button', { name: 'Task 3', exact: true }).click();
      await expect(relation).toHaveText('Task 3');
      expect(
        await page.evaluate(
          () =>
            (
              document.querySelector('nobita-editor') as NobitaEditorElement
            ).editor!.resolveDatabase('projects')!.rows[0]!.cells.tasks
              ?.relations
        )
      ).toEqual([{ rowId: 't0', label: 'Task 3' }]);
    }
  );
}

for (const external of [false, true]) {
  test(
    'copies rollups from ' +
      (external ? 'an external' : 'an unselected local') +
      ' database',
    async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await openFixture(page);
      const copied = await page.evaluate(
        ({ tasks, projects, external }) => {
          const host = document.querySelector(
            'nobita-editor'
          ) as NobitaEditorElement;
          delete projects.view;
          if (external) {
            projects.columns[1]!.relation!.pageId = 'remote';
            host.resolveDatabase = (id, pageId) =>
              id === 'tasks' && pageId === 'remote' ? tasks : null;
          }
          host.doc = {
            ...host.doc,
            blocks: [
              {
                id: 'intro',
                type: 'paragraph',
                props: {},
                children: [],
                text: [{ text: 'Intro' }],
              },
              ...(external ? [projects] : [projects, tasks]).map(
                (database) => ({
                  id: database.title!.toLowerCase(),
                  type: 'database' as const,
                  props: { database },
                  children: [],
                  text: [],
                })
              ),
            ],
          };
          host.selectBlocks(['projects']);
          const data = new DataTransfer();
          host.shadowRoot!.querySelector('.nb-body')!.dispatchEvent(
            new ClipboardEvent('copy', {
              bubbles: true,
              cancelable: true,
              clipboardData: data,
            })
          );
          return {
            text: data.getData('text/plain'),
            html: data.getData('text/html'),
          };
        },
        { tasks, projects, external }
      );
      expect(copied.text).toContain('A | Task 0 | 3');
      expect(copied.html).toMatch(/>Task 0<.*?>3</s);
      await page.evaluate((multi) => {
        const host = document.querySelector(
          'nobita-editor'
        ) as NobitaEditorElement;
        if (multi) {
          host.selectBlocks(['intro', 'projects']);
          host
            .shadowRoot!.querySelector('[data-block-id="intro"]')!
            .dispatchEvent(
              new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
            );
        } else {
          host.editor!.openBlockMenu('projects', host);
        }
      }, external);
      await page.getByText('Copy as Markdown', { exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toContain('| A | Task 0 | 3 |');
    }
  );
}
