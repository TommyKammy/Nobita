import type {
  DatabaseData,
  DatabaseRelationConfig,
  DatabaseRow,
  Doc,
} from './types.js';
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

function rowLinks(row: DatabaseRow | undefined, columnId: string) {
  return row?.cells[columnId]?.relations ?? [];
}

export function compatibleReverse(
  config: DatabaseRelationConfig | undefined,
  sourceId: string,
  columnId: string,
  pageId?: string
) {
  return (
    !config ||
    (config.databaseId === sourceId &&
      (!config.pageId || config.pageId === pageId) &&
      (!config.syncedColumnId || config.syncedColumnId === columnId))
  );
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
        const refs = rowLinks(row, col.id);
        if (!refs.length) continue;
        const previous = same
          ? rowLinks(others.get(row.id), col.id)
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
        const refs = rowLinks(row, columnId);
        const next =
          add && column.relation?.limit === 1
            ? []
            : refs.filter((r) => r.rowId !== ref);
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
      if (!compatibleReverse(config, sourceId, columnId)) return;
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
    const apply = ({target: relation, sourceRowId, columnId, targetRowId, linked}: RelationChange) => {
      const { databaseId, syncedColumnId } = relation;
      const binding = bind(relation, columnId, linked || undefined);
      if (!binding || !syncedColumnId) return;
      if (linked && binding.reverse.relation?.limit === 1) {
        const links = (db: DatabaseData, id: string, key: string) =>
          rowLinks(db.rows.find(row => row.id === id), key);
        // An earlier displacement may have deleted this queued forward edge.
        if (!links(updates.get(sourceId)!, sourceRowId, columnId).some(ref => ref.rowId === targetRowId)) return;
        for (const old of links(binding.target, targetRowId, syncedColumnId))
          if (old.rowId !== sourceRowId) write(sourceId, old.rowId, columnId, targetRowId, false);
      }
      write(databaseId, targetRowId, syncedColumnId, sourceRowId, linked);
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
            const binding = bind(rel, col.id, attach);
            if (!attach || !binding) continue;
            // Preserve forward choices for a single-value property. Otherwise import
            // reverse-only edges in target row order before applying forward deltas.
            const links = new Map(
              from.rows.map(
                (row) =>
                  [
                    row.id,
                    new Set(rowLinks(row, col.id).map((ref) => ref.rowId)),
                  ] as const
              )
            );
            for (const row of binding.target.rows) {
              for (const ref of rowLinks(row, rel.syncedColumnId)) {
                const existing = links.get(ref.rowId);
                if (!existing || existing.has(row.id)) continue;
                if (rel.limit && existing.size) {
                  write(
                    rel.databaseId,
                    row.id,
                    rel.syncedColumnId,
                    ref.rowId,
                    false
                  );
                } else {
                  write(sourceId, ref.rowId, col.id, row.id, true);
                  existing.add(row.id);
                }
              }
            }
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
