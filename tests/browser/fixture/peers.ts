import * as Y from 'yjs';
import { YjsCollaborationAdapter } from '../../../packages/collab-yjs/src/index';
import {
  createBlock,
  createDoc,
  type CollaborationAdapter,
  type PeerPresence,
} from '@nobita/core';
import { type NobitaEditorElement } from '@nobita/element';
export async function setupPeers(history = true) {
  const one = document.querySelector<NobitaEditorElement>('#editor')!,
    two = document.createElement('nobita-editor') as NobitaEditorElement;
  two.id = 'peer';
  document.body.append(two);
  const a = new Y.Doc(),
    b = new Y.Doc();
  const columns = [{ id: 'c', name: 'Name', type: 'text' as const }],
    rows = [{ id: 'r', cells: { c: { text: 'ab' } } }];
  const doc = createDoc({
    blocks: [
      createBlock('paragraph', { id: 'p', text: 'ab' }),
      createBlock('table', { id: 't', props: { table: { columns, rows } } }),
      createBlock('database', {
        id: 'd',
        props: { database: { variant: 'database', columns, rows } },
      }),
    ],
  });
  let render: (p: readonly PeerPresence[]) => void = () => {};
  const first = new YjsCollaborationAdapter(a, doc, {
    publish: (p) => render(p ? [{ ...p, clientId: 'first' }] : []),
    subscribe: () => () => {},
  });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const second = new YjsCollaborationAdapter(b, undefined, {
    publish: () => {},
    subscribe: (f) => {
      render = f;
      return () => {};
    },
  });
  a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u));
  b.on('update', (u: Uint8Array) => Y.applyUpdate(a, u));
  const withoutHistory: CollaborationAdapter = {
    getDoc: () => first.getDoc(),
    applyLocalChange: (c, p) => first.applyLocalChange(c, p),
    subscribe: (f) => first.subscribe(f),
    beginComposition: (t) => first.beginComposition(t),
    commitComposition: (s) => first.commitComposition(s),
    cancelComposition: () => first.cancelComposition(),
  };
  await Promise.all([
    one.editor!.setCollaboration(history ? first : withoutHistory),
    two.editor!.setCollaboration(second),
  ]);
}
