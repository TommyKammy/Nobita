import type { Doc } from './types.js';

// The command and diff can come from separate bundles. Carry the operation on
// its result without persisting it in JSON or retaining old document snapshots.
const mergeKey = Symbol.for('@nobita/core/blockMerge');
type Merge = { previous: WeakRef<Doc>; from: string; into: string };
export function recordBlockMerge(
  previous: Doc,
  next: Doc,
  from: string,
  into: string
) {
  Object.defineProperty(next, mergeKey, {
    value: { previous: new WeakRef(previous), from, into },
  });
}
export function blockMergeFor(previous: Doc, next: Doc) {
  const merge = (next as Doc & { [mergeKey]?: Merge })[mergeKey];
  return merge?.previous.deref() === previous ? merge : undefined;
}
