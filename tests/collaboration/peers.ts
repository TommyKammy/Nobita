import * as Y from 'yjs';
import { YjsCollaborationAdapter } from '../../packages/collab-yjs/src/index';
import { AutomergeCollaborationAdapter } from '../../packages/collab-automerge/src/index';
import {
  diffDocs,
  type Block,
  type Doc,
  type CollaborationAdapter,
} from '../../packages/core/src/index';
export const block = (id: string, text = ''): Block => ({
  id,
  type: 'paragraph',
  props: {},
  children: [],
  text: text ? [{ text }] : [],
});
export const seed: Doc = {
  id: 'doc',
  version: 1,
  title: 'Seed',
  blocks: [block('a', 'ab'), block('b'), block('c'), block('d')],
};
export function pair(engine: string, initial: Doc | Uint8Array) {
  if (engine === 'automerge') {
    const a = new AutomergeCollaborationAdapter(initial),
      b = new AutomergeCollaborationAdapter(a.save());
    return {
      a,
      b,
      observe: (reverse: boolean) => {
        const changes = [a.save(), b.save()];
        if (reverse) changes.reverse();
        const observer = new AutomergeCollaborationAdapter(changes[0]!);
        observer.receive(changes[1]!);
        return observer.getDoc();
      },
      send: (reverse = false) => {
        const x = a.save(),
          y = b.save();
        if (reverse) {
          a.receive(y);
          b.receive(x);
        } else {
          b.receive(x);
          a.receive(y);
        }
      },
    };
  }
  const x = new Y.Doc(),
    y = new Y.Doc();
  if (initial instanceof Uint8Array) Y.applyUpdate(x, initial);
  const a = new YjsCollaborationAdapter(
    x,
    initial instanceof Uint8Array ? undefined : initial
  );
  Y.applyUpdate(y, Y.encodeStateAsUpdate(x));
  const b = new YjsCollaborationAdapter(y);
  return {
    a,
    b,
    observe: (reverse: boolean) => {
      const doc = new Y.Doc(),
        updates = [Y.encodeStateAsUpdate(x), Y.encodeStateAsUpdate(y)];
      if (reverse) updates.reverse();
      for (const u of updates) Y.applyUpdate(doc, u);
      return new YjsCollaborationAdapter(doc).getDoc();
    },
    send: (reverse = false) => {
      const u = Y.encodeStateAsUpdate(x),
        v = Y.encodeStateAsUpdate(y);
      if (reverse) {
        Y.applyUpdate(x, v);
        Y.applyUpdate(y, u);
      } else {
        Y.applyUpdate(y, u);
        Y.applyUpdate(x, v);
      }
    },
  };
}
export function edit(adapter: CollaborationAdapter, fn: (doc: Doc) => void) {
  const previous = adapter.getDoc(),
    doc = structuredClone(previous);
  fn(doc);
  adapter.applyLocalChange(
    { doc, previous, source: 'input', selection: null },
    diffDocs(previous, doc)
  );
}
