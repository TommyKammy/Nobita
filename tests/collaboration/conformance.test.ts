import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { YjsCollaborationAdapter } from '../../packages/collab-yjs/src/index';
import { AutomergeCollaborationAdapter } from '../../packages/collab-automerge/src/index';
import {
  diffDocs,
  type Block,
  type Doc,
  type CollaborationAdapter,
} from '../../packages/core/src/index';
const block = (id: string, text = ''): Block => ({
  id,
  type: 'paragraph',
  props: {},
  children: [],
  text: text ? [{ text }] : [],
});
const seed: Doc = {
  id: 'doc',
  version: 1,
  title: 'Seed',
  blocks: [block('a', 'ab'), block('b'), block('c'), block('d')],
};
function pair(engine: string, initial: Doc) {
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
    y = new Y.Doc(),
    a = new YjsCollaborationAdapter(x, initial);
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
function edit(adapter: CollaborationAdapter, fn: (doc: Doc) => void) {
  const previous = adapter.getDoc(),
    doc = structuredClone(previous);
  fn(doc);
  adapter.applyLocalChange(
    { doc, previous, source: 'input', selection: null },
    diffDocs(previous, doc)
  );
}
for (const engine of ['automerge', 'yjs'])
  describe(engine, () => {
    it.each([true, false])(
      'resolves concurrent moves once (reverse=%s)',
      (reverse) => {
        const initial = structuredClone(seed);
        initial.blocks[1]!.children = [block('left'), block('right')];
        initial.blocks[2]!.children = [block('first'), block('last')];
        const { a, b, send, observe } = pair(engine, initial);
        const move = (d: Doc, i: number) => {
          const child = d.blocks.shift()!;
          d.blocks[i]!.children.splice(1, 0, child);
        };
        edit(a, (d) => move(d, 0));
        edit(b, (d) => move(d, 1));
        expect(observe(true)).toEqual(observe(false));
        send(reverse);
        expect(a.getDoc()).toEqual(b.getDoc());
        const children = a
          .getDoc()
          .blocks.map((x) => x.children.map((c) => c.id));
        expect(children.flat().filter((id) => id === 'a')).toHaveLength(1);
        expect(children.find((ids) => ids.includes('a'))?.indexOf('a')).toBe(1);
      }
    );
    it.each(['body', 'table', 'database'])(
      'preserves peer text through IME and local undo/redo in %s',
      (kind) => {
        const initial = structuredClone(seed),
          target = initial.blocks[0]!;
        if (kind !== 'body') {
          const grid = {
            columns: [{ id: 'col', name: 'Title', type: 'text' as const }],
            rows: [
              {
                id: 'row',
                cells: {
                  col: { text: 'ab', ...(kind === 'table' && { colspan: 2 }) },
                },
              },
            ],
          };
          target.type = kind as 'table' | 'database';
          target.props =
            kind === 'table'
              ? {
                  table: {
                    ...grid,
                    columns: [...grid.columns, { id: 'covered' }],
                  },
                }
              : { database: { ...grid, variant: 'database' } };
        }
        const cell = (d: Doc) => {
          const props = d.blocks[0]!.props;
          return (props.table ?? props.database)?.rows[0]!.cells.col;
        };
        const value = (d: Doc) =>
          cell(d)?.text ?? d.blocks[0]!.text.map((x) => x.text).join('');
        const { a, b, send } = pair(engine, initial);
        a.beginComposition({
          blockId: 'a',
          from: 1,
          to: 1,
          ...(kind === 'body' ? {} : { rowId: 'row', columnId: 'col' }),
        });
        edit(b, (d) => {
          if (kind === 'body') d.blocks[0]!.text = [{ text: 'Bab' }];
          else cell(d)!.text = 'Bab';
        });
        send();
        const u = a.commitComposition('日');
        expect(value(u.doc)).toBe('Ba日b');
        expect(u.remapPoint?.({ blockId: 'a', offset: 1 })?.offset).toBe(3);
        send();
        expect(a.getDoc()).toEqual(b.getDoc());
        expect(a.undo()).toBe(true);
        send();
        expect(value(b.getDoc())).toBe('Bab');
        expect(a.redo()).toBe(true);
        send();
        expect(value(b.getDoc())).toBe('Ba日b');
      }
    );
    it('undoes only local characters around a peer insertion and cancels composition', () => {
      const { a, b, send } = pair(engine, seed);
      edit(a, (d) => {
        d.blocks[0]!.text = [{ text: 'aXYb' }];
      });
      send();
      edit(b, (d) => {
        d.blocks[0]!.text = [{ text: 'aX他Yb' }];
      });
      send();
      a.beginComposition({ blockId: 'a', from: 1, to: 2 });
      expect(a.cancelComposition().doc).toEqual(b.getDoc());
      a.undo();
      send();
      expect(a.getDoc().blocks[0]?.text).toEqual([{ text: 'a他b' }]);
      a.redo();
      send();
      expect(b.getDoc().blocks[0]?.text).toEqual([{ text: 'aX他Yb' }]);
    });
    it('merges a split and mark with offline concurrent typing', () => {
      const { a, b, send } = pair(engine, seed);
      edit(a, (d) => {
        d.blocks[0]!.text = [{ text: 'a', marks: { bold: true } }];
        d.blocks.splice(1, 0, block('split', 'b'));
      });
      edit(b, (d) => {
        d.blocks[0]!.text = [{ text: 'Xab' }];
      });
      send();
      expect(a.getDoc()).toEqual(b.getDoc());
      expect(a.getDoc().blocks[1]?.id).toBe('split');
      const runs = a.getDoc().blocks[0]!.text;
      expect(runs.map((r) => r.text).join('')).toBe('Xa');
      expect(runs.at(-1)?.marks?.bold).toBe(true);
    });
  });
