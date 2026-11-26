import { databaseCellText, databaseTitleColumn } from './database.js';
import {
  mapFormulaReferences,
  runFormula,
  type FormulaValue,
} from './formula.js';
import type {
  Block,
  DatabaseCell,
  DatabaseColumn,
  DatabaseData,
  DatabaseResolver,
  DatabaseRow,
} from './types.js';

const projectedRows = new WeakMap<
  DatabaseRow,
  { row: DatabaseRow; columns: DatabaseColumn[] }
>();
const projections = new WeakSet<DatabaseData>();
const displays = new WeakMap<DatabaseCell, string>();

export const computedDisplay = (cell: DatabaseCell) => displays.get(cell);
const error = (code: string): never => {
  throw new Error(code);
};
export function documentEvaluation(
  blocks: readonly Block[],
  external?: DatabaseResolver
) {
  let local: Map<string, DatabaseData> | undefined;
  return new DatabaseEvalContext(
    (id, page) =>
      (!page && (local ??= documentDatabases(blocks)).get(id)) ||
      external?.(id, page)
  );
}

interface EvaluationPlan {
  cycles: Set<string>;
  inputs: Map<DatabaseColumn, string[]>;
  order: DatabaseColumn[];
}
const planCache = new WeakMap<DatabaseColumn[], EvaluationPlan>();
function planFor(data: DatabaseData) {
  const cached = planCache.get(data.columns);
  if (cached) return cached;
  const pending = new Set<string>(),
    done = new Set<string>(),
    cycles = new Set<string>();
  const inputs = new Map<DatabaseColumn, string[]>();
  const order: DatabaseColumn[] = [];
  const visit = (col: DatabaseColumn) => {
    if (pending.has(col.id)) {
      const path = [...pending];
      for (const id of path.slice(path.indexOf(col.id))) cycles.add(id);
      return;
    }
    if (done.has(col.id)) return;
    pending.add(col.id);
    const refs: string[] = [];
    if (col.formula)
      mapFormulaReferences(col.formula.expression, (id, relation) => {
        const dependency =
          relation === undefined && index(data).columns.get(id);
        if (relation === undefined) refs.push(id);
        if (
          dependency &&
          (dependency.type === 'formula' || dependency.type === 'relation')
        )
          visit(dependency);
        return id;
      });
    pending.delete(col.id);
    done.add(col.id);
    inputs.set(col, refs);
    order.push(col);
  };
  for (const col of data.columns)
    if (col.type === 'formula' || col.type === 'relation') visit(col);
  const plan = { cycles, inputs, order };
  planCache.set(data.columns, plan);
  return plan;
}
const indices = new WeakMap<
  DatabaseData,
  { columns: Map<string, DatabaseColumn>; rows: Map<string, DatabaseRow> }
>();
function index(db: DatabaseData) {
  let cached = indices.get(db);
  if (!cached) {
    cached = {
      columns: new Map(db.columns.map((c) => [c.id, c])),
      rows: new Map(db.rows.map((r) => [r.id, r])),
    };
    indices.set(db, cached);
  }
  return cached;
}
export function formulaNames(
  source: string,
  data: DatabaseData,
  resolve: DatabaseResolver,
  display = false
) {
  const find = (db: DatabaseData | null | undefined, key: string) =>
    db?.columns.find((c) => c.id === key) ??
    db?.columns.find((c) => c.name === key);
  return mapFormulaReferences(source, (key, relation) => {
    const config =
      relation === undefined ? undefined : find(data, relation)?.relation;
    const db =
      relation === undefined
        ? data
        : config && resolve(config.databaseId, config.pageId);
    const col = find(db, key);
    if (!col) return key;
    // Display a label only when parsing it identifies this exact column.
    return display &&
      !db?.columns.some((c) => c !== col && (c.id === col.name || c.name === col.name))
      ? col.name
      : col.id;
  });
}

export function documentDatabases(
  blocks: readonly Block[]
): Map<string, DatabaseData> {
  const result = new Map<string, DatabaseData>();
  const walk = (items: readonly Block[]) => {
    for (const b of items) {
      if (b.type === 'database' && b.props.database)
        result.set(b.id, b.props.database);
      if (b.children.length) walk(b.children);
    }
  };
  walk(blocks);
  return result;
}

function scalar(
  cell: DatabaseCell | undefined,
  column: DatabaseColumn
): FormulaValue {
  if (column.type === 'checkbox') return Boolean(cell?.checked);
  if (column.type === 'multi-select') return cell?.values ?? [];
  if (column.type === 'people') return cell?.people?.map((p) => p.label) ?? [];
  if (column.type === 'files') return cell?.files?.map((f) => f.name) ?? [];
  const text = databaseCellText(cell, column.type === 'progress' ? 'progress' : 'text');
  if (column.type === 'number' || column.type === 'progress')
    return text && Number.isFinite(Number(text)) ? Number(text) : null;
  return text;
}

/** One context per consumer. All computed cells live in its transient query projection. */
export class DatabaseEvalContext {
  #clock: number | undefined;
  #source?: DatabaseData;
  #result?: DatabaseData;
  #deps = new Map<
    NonNullable<DatabaseColumn['relation']>,
    DatabaseData | null | undefined
  >();
  #rows = new WeakMap<DatabaseRow, DatabaseRow>();
  constructor(readonly resolve: DatabaseResolver = () => null) {}

  /** Get the evaluated row after projecting its containing database. */
  row(row: DatabaseRow) {
    return this.#rows.get(row) ?? row;
  }

  project(data: DatabaseData): DatabaseData {
    if (projections.has(data)) return data;
    const now = Date.now();
    const stable =
      (this.#clock === undefined || this.#clock === now) &&
      [...this.#deps].every(
        ([r, target]) => this.resolve(r.databaseId, r.pageId) === target
      );
    if (stable && this.#source === data) return this.#result!;
    const { order: derived, inputs } = planFor(data);
    const previous =
      derived.length &&
      stable &&
      this.#source?.columns === data.columns &&
      this.#result
        ? index(this.#result).rows
        : undefined;
    if (!stable || this.#source?.columns !== data.columns) {
      this.#rows = new WeakMap();
      this.#deps.clear();
      this.#clock = undefined;
    }
    this.#source = data;
    if (!derived.length) return (this.#result = data);
    const targetFor = (col: DatabaseColumn) => {
      const rel = col.relation;
      if (!rel) return null;
      if (!this.#deps.has(rel))
        this.#deps.set(rel, this.resolve(rel.databaseId, rel.pageId));
      return this.#deps.get(rel);
    };
    let timestamp: string;
    const clock = () =>
      (timestamp ??= new Date((this.#clock = now)).toISOString());
    const active = new Map<DatabaseRow, Set<DatabaseColumn>>();
    const memo = new Map<DatabaseRow, Map<DatabaseColumn, FormulaValue>>();
    let steps = 0;
    const tick = () => {
      if (++steps > 500) error('#LIMIT');
    };
    const read = (
      db: DatabaseData,
      row: DatabaseRow,
      col: DatabaseColumn
    ): FormulaValue => {
      const cell = row.cells[col.id];
      if (col.type !== 'formula' && col.type !== 'relation')
        return scalar(cell, col);
      const saved = memo.get(row);
      if (saved?.has(col)) return saved.get(col)!;
      let path = active.get(row);
      if (!path) active.set(row, (path = new Set()));
      if (
        path.has(col) ||
        (col.type === 'formula' && planFor(db).cycles.has(col.id))
      )
        return error('#CYCLE');
      path.add(col);
      const column = (key: string) =>
        index(db).columns.get(key) ?? error('#REF');
      try {
        let value: FormulaValue;
        if (col.type === 'relation') {
          const target = targetFor(col);
          const title = target && databaseTitleColumn(target);
          value = (cell?.relations ?? []).flatMap((ref) => {
            tick();
            if (!target) return [ref.label ?? ref.rowId];
            const linked = index(target).rows.get(ref.rowId);
            return linked
              ? [
                  String(title ? (read(target, linked, title) ?? '') : '') ||
                    ref.label ||
                    ref.rowId,
                ]
              : [];
          });
        } else {
          value = runFormula(
            col.formula?.expression ?? '',
            (key) => read(db, row, column(key)),
            (rel, key) => {
              const source = column(rel);
              if (source.type !== 'relation') return error('#TYPE');
              const target = targetFor(source);
              if (!target) return error('#REF');
              const dest = index(target).columns.get(key) ?? error('#REF');
              const values: FormulaValue[] = [];
              for (const ref of row.cells[rel]?.relations ?? []) {
                tick();
                const linked = index(target).rows.get(ref.rowId);
                if (linked) values.push(read(target, linked, dest));
              }
              return values;
            },
            tick,
            clock
          );
        }
        if (Array.isArray(value)) {
          // Bound nested rollups before coercion (array-to-string also visits every descendant).
          let length = 0;
          const measure = (items: FormulaValue[]) => {
            for (const item of items) {
              tick();
              if (Array.isArray(item)) measure(item);
              else length += String(item ?? '').length + 1;
              if (length > 32000) error('#LIMIT');
            }
          };
          measure(value);
        }
        let values = memo.get(row);
        if (!values) memo.set(row, (values = new Map()));
        values.set(col, value);
        return value;
      } finally {
        path.delete(col);
      }
    };
    const rows = data.rows.map((row) => {
      const cached = this.#rows.get(row);
      if (cached) return cached;
      const cells = { ...row.cells };
      const old = previous?.get(row.id);
      for (const col of derived) {
        const prior = old?.cells[col.id];
        if (
          prior &&
          (col.type === 'relation'
            ? prior.relations === cells[col.id]?.relations
            : inputs.get(col)!.every((id) => old!.cells[id] === cells[id]))
        ) {
          cells[col.id] = prior;
          continue;
        }
        steps = 0;
        try {
          const value = read(data, row, col);
          const text = Array.isArray(value)
            ? value.join(', ')
            : String(value ?? '');
          const cell = {
            ...cells[col.id],
            text,
            ...(col.type === 'relation' && Array.isArray(value)
              ? { values: value.map(String) }
              : {}),
          };
          cells[col.id] = cell;
          const format = col.formula?.format;
          if (typeof value === 'number' && format) {
            const style =
              format.numberFormat === 'number'
                ? 'decimal'
                : format.numberFormat;
            displays.set(
              cell,
              new Intl.NumberFormat(undefined, {
                style: style ?? 'decimal',
                currency: format.currency ?? 'USD',
                ...(format.decimals === undefined
                  ? {}
                  : {
                      minimumFractionDigits: format.decimals,
                      maximumFractionDigits: format.decimals,
                    }),
              }).format(value)
            );
          }
        } catch (e) {
          cells[col.id] = {
            ...row.cells[col.id],
            text:
              e instanceof Error &&
              /^#(SYNTAX|REF|CYCLE|TYPE|DIV0|LIMIT)$/.test(e.message)
                ? e.message
                : '#SYNTAX',
          };
        }
      }
      const result = { ...row, cells };
      projectedRows.set(result, { row, columns: data.columns });
      this.#rows.set(row, result);
      return result;
    });
    this.#result = { ...data, rows };
    projections.add(this.#result);
    return this.#result;
  }
}

/** Remove transient values before committing an edit made against the query projection. */
export function storedDatabase(data: DatabaseData): DatabaseData {
  const columns = data.columns.filter(
    (c) => c.type === 'formula' || c.type === 'relation'
  );
  if (!columns.length && !data.rows.some((r) => projectedRows.has(r)))
    return data;
  return {
    ...data,
    rows: data.rows.map((row) => {
      const raw = projectedRows.get(row);
      if (raw?.columns === data.columns) return raw.row;
      const cells = { ...(raw?.row ?? row).cells };
      for (const col of columns) {
        const refs = cells[col.id]?.relations;
        if (col.type === 'relation' && refs?.length)
          cells[col.id] = {
            relations: col.relation?.limit === 1 ? refs.slice(0, 1) : refs,
          };
        else delete cells[col.id];
      }
      return { ...row, cells };
    }),
  };
}
