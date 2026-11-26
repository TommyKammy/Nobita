import type { DatabaseData, DatabaseRelationConfig, Doc } from './types.js';
import { documentDatabases } from './database-eval.js';
import { updateBlock } from './doc.js';

export interface RelationChange {
  sourceId: string;
  sourceRowId: string;
  columnId: string;
  target: DatabaseRelationConfig;
  targetRowId: string;
  linked: boolean;
}

function sameBinding(
  a: DatabaseRelationConfig | undefined,
  b: DatabaseRelationConfig
) {
  return (
    a?.databaseId === b.databaseId &&
    a.pageId === b.pageId &&
    a.syncedColumnId === b.syncedColumnId
  );
}

/** Include both old and new bindings when a paired column is removed or retargeted. */
export function relationChanges(
  sourceId: string,
  before?: DatabaseData,
  after?: DatabaseData
): RelationChange[] {
  const changes: RelationChange[] = [];
  const compare = (
    from: DatabaseData | undefined,
    to: DatabaseData | undefined,
    linked: boolean
  ) => {
    if (!from) return;
    const pairs = from.columns.filter(
      (c) => c.type === 'relation' && c.relation?.syncedColumnId
    );
    if (!pairs.length) return;
    const others = new Map(to?.rows.map((r) => [r.id, r]));
    for (const col of pairs) {
      const target = col.relation!;
      const other = to?.columns.find((c) => c.id === col.id)?.relation;
      const same = sameBinding(other, target);
      for (const row of from.rows) {
        const refs = row.cells[col.id]?.relations;
        if (!refs?.length) continue;
        const previous = same
          ? others.get(row.id)?.cells[col.id]?.relations
          : undefined;
        if (previous === refs) continue;
        const ids = new Set(previous?.map((r) => r.rowId));
        for (const ref of refs)
          if (!ids.has(ref.rowId))
            changes.push({
              sourceId,
              sourceRowId: row.id,
              columnId: col.id,
              target,
              targetRowId: ref.rowId,
              linked,
            });
      }
    }
  };
  compare(before, after, false);
  compare(after, before, true);
  return changes;
}

export function updateDatabaseRelations(
  doc: Doc,
  sourceId: string,
  before: DatabaseData,
  after: DatabaseData
): Doc {
  const updates = new Map([[sourceId, after]]);
  const changes = relationChanges(sourceId, before, after).filter(
    (c) => !c.target.pageId
  );
  if (changes.length || before.columns !== after.columns) {
    const local = documentDatabases(doc.blocks);
    const write = (
      id: string,
      rowId: string,
      columnId: string,
      ref: string,
      add: boolean
    ) => {
      const data = updates.get(id) ?? local.get(id);
      if (!data) return;
      const column = data.columns.find((c) => c.id === columnId);
      if (column?.type !== 'relation') return;
      const rows = data.rows.map((row) => {
        if (row.id !== rowId) return row;
        const refs = row.cells[columnId]?.relations ?? [];
        const next = refs.filter((r) => r.rowId !== ref);
        if (add) next.push({ rowId: ref });
        const cells = { ...row.cells };
        if (next.length) cells[columnId] = { relations: next };
        else delete cells[columnId];
        return { ...row, cells };
      });
      updates.set(id, { ...data, rows });
    };
    const bind = (
      rel: DatabaseRelationConfig,
      columnId: string,
      attach?: boolean
    ) => {
      const target = updates.get(rel.databaseId) ?? local.get(rel.databaseId);
      const reverse = target?.columns.find((c) => c.id === rel.syncedColumnId);
      if (!target || reverse?.type !== 'relation') return;
      const config = reverse.relation;
      if (
        config &&
        (config.databaseId !== sourceId ||
          config.pageId ||
          (config.syncedColumnId && config.syncedColumnId !== columnId))
      )
        return;
      if (attach !== undefined && Boolean(config?.syncedColumnId) !== attach) {
        const { syncedColumnId: _old, ...rest } = config ?? {
          databaseId: sourceId,
        };
        const relation = attach ? { ...rest, syncedColumnId: columnId } : rest;
        updates.set(rel.databaseId, {
          ...target,
          columns: target.columns.map((c) =>
            c === reverse ? { ...c, relation } : c
          ),
        });
      }
      return { target, reverse };
    };
    const apply = (change: RelationChange) => {
      const { databaseId, syncedColumnId } = change.target;
      const binding = bind(
        change.target,
        change.columnId,
        change.linked ? true : undefined
      );
      if (!binding || !syncedColumnId) return;
      const { target, reverse } = binding;
      if (change.linked && reverse.relation?.limit === 1) {
        const row = target.rows.find((r) => r.id === change.targetRowId);
        for (const old of row?.cells[syncedColumnId]?.relations ?? [])
          if (old.rowId !== change.sourceRowId) {
            write(
              databaseId,
              change.targetRowId,
              syncedColumnId,
              old.rowId,
              false
            );
            write(
              sourceId,
              old.rowId,
              change.columnId,
              change.targetRowId,
              false
            );
          }
      }
      write(
        databaseId,
        change.targetRowId,
        syncedColumnId,
        change.sourceRowId,
        change.linked
      );
    };
    for (const change of changes) if (!change.linked) apply(change);
    if (before.columns !== after.columns) {
      const configure = (
        from: DatabaseData,
        to: DatabaseData,
        attach: boolean
      ) => {
        for (const col of from.columns) {
          const rel = col.relation;
          if (
            rel?.syncedColumnId &&
            !rel.pageId &&
            !sameBinding(to.columns.find((c) => c.id === col.id)?.relation, rel)
          ) {
            bind(rel, col.id, attach);
          }
        }
      };
      configure(before, after, false);
      configure(after, before, true);
    }
    for (const change of changes) if (change.linked) apply(change);
  }
  for (const [id, database] of updates)
    doc = updateBlock(doc, id, (b) => ({
      ...b,
      props: { ...b.props, database },
    }));
  return doc;
}
