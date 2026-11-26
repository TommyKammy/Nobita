import type { Backend } from './collab-runtime.js';

export type Split = {
  from: string;
  path: string;
  token: string;
  blockId?: string;
  marker?: boolean;
  slice?: string | null;
  clock: number;
  actor: string;
};

export function readSplits(store: Backend) {
  const legacySplits = store.read('splits') as Record<string, Split>;
  const enabled = store.read('activeSplits');
  const layoutOps = {
    ...store.read('splitLayout'),
    ...legacySplits,
  } as Record<string, Split>;
  // Offline replicas can independently upgrade the same legacy cut. Choose
  // one marker deterministically; the redundant markers have no text width
  // in the editor. Never insert migration data while merely reading a doc.
  const upgrades = store.read('splitUpgrades') as Record<
    string,
    { id: string; token: string }
  >;
  const redundant = new Map<string, string[]>();
  for (const name of Object.keys(upgrades).sort()) {
    const { id, token } = upgrades[name]!,
      op = layoutOps[id];
    if (!op) continue;
    if (!op.marker) layoutOps[id] = { ...op, token, marker: true };
    else {
      const tokens = redundant.get(op.path) ?? [];
      // Left-side appends precede the writer's marker; right-side
      // prepends live in the suffix block's own text. The rightmost
      // concurrent marker therefore includes every left-side append.
      if (
        store.resolveBoundary(op.path, token) >
        store.resolveBoundary(op.path, op.token)
      ) {
        tokens.push(op.token);
        layoutOps[id] = { ...op, token };
      } else tokens.push(token);
      redundant.set(op.path, tokens);
    }
  }
  const splits = Object.entries(layoutOps);
  const isActive = (id: string, opId: string, op: Split) =>
    op.blockId ? enabled[id] === opId : Object.hasOwn(legacySplits, id);
  return { splits, redundant, isActive };
}

export function upgradeSplits(store: Backend, legacy: [string, Split][]) {
  for (const [id, op] of legacy) {
    const at = store.resolveBoundary(op.path, op.token);
    const token = store.insertSplitMarker(op.path, at);
    store.field('splitLayout', id, op);
    store.field('splitUpgrades', JSON.stringify([id, store.actor]), {
      id,
      token,
    });
  }
  return legacy.length > 0;
}

export type Join = {
  into: string;
  clock: number;
  actor: string;
  keepsType?: boolean;
};
export function readJoins(store: Backend, visible: Set<string>) {
  const edges = store.read('joins') as Record<string, Join>;
  // Older joins removed the source type. Restoring such a block canceled the
  // join. New joins retain the type so a cycle has a recoverable paragraph.
  for (const [id, edge] of Object.entries(edges)) {
    if (!edge.keepsType && visible.has(id)) delete edges[id];
  }
  const done = new Set<string>();
  for (const id of Object.keys(edges)) {
    const chain = new Set<string>();
    let cur = id;
    while (Object.hasOwn(edges, cur) && !done.has(cur)) {
      if (chain.has(cur)) {
        const path = [...chain];
        const cycle = path.slice(path.indexOf(cur));
        // Keep the same recipient (and its original block type) on every replica.
        cycle.sort();
        const root = cycle.find((id) => edges[id]!.keepsType) ?? cycle[0]!;
        delete edges[root];
        break;
      }
      chain.add(cur);
      cur = edges[cur]!.into;
    }
    for (const source of chain) done.add(source);
  }
  for (const source of Object.keys(edges)) visible.delete(source);
  return edges;
}
