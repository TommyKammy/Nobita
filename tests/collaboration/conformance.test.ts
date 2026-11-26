import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { YjsCollaborationAdapter } from '../../packages/collab-yjs/src/index';
import { AutomergeCollaborationAdapter } from '../../packages/collab-automerge/src/index';
import {
  diffDocs,
  insertTextAt,
  type InlineMark,
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
          ...(kind === 'body'
            ? {}
            : {
                rowId: 'row',
                columnId: 'col',
                pendingMarks: { bold: true as const },
              }),
        });
        edit(b, (d) => {
          if (kind === 'body') d.blocks[0]!.text = [{ text: 'Bab' }];
          else cell(d)!.text = 'Bab';
        });
        send();
        const u = a.commitComposition('日');
        expect(value(u.doc)).toBe('Ba日b');
        if (kind !== 'body')
          expect(cell(u.doc)?.runs).toContainEqual({
            text: '日',
            marks: { bold: true },
          });
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

for (const engine of ['automerge', 'yjs']) {
  it.each([false, true])(
    engine + ' remaps disjoint offline edits (single batch=%s)',
    (singleBatch) => {
      const { a, b, send } = pair(engine, seed);
      let offsets: number[] = [];
      a.subscribe((u) => {
        offsets = [0, 1, 2].map(
          (offset) => u.remapPoint!({ blockId: 'a', offset })!.offset
        );
      });
      if (!singleBatch)
        edit(b, (d) => {
          d.blocks[0]!.text = [{ text: 'Xab' }];
        });
      edit(b, (d) => {
        d.blocks[0]!.text = [{ text: 'XabY' }];
      });
      send();
      expect(offsets).toEqual([1, 2, 4]);
    }
  );
  it(engine + ' syncs a rotated ancestor chain', () => {
    const initial = structuredClone(seed),
      [a, b, c, d] = initial.blocks;
    initial.blocks = [a!];
    a!.children = [b!];
    b!.children = [c!];
    c!.children = [d!];
    const peers = pair(engine, initial);
    edit(peers.a, (doc) => {
      const a = doc.blocks[0]!,
        b = a.children[0]!,
        c = b.children[0]!,
        d = c.children[0]!;
      b.children = [];
      d.children = [a];
      doc.blocks = [c];
    });
    peers.send();
    expect(peers.b.getDoc()).toEqual(peers.a.getDoc());
    expect(
      peers.b.getDoc().blocks[0]?.children[0]?.children[0]?.children[0]?.id
    ).toBe('b');
  });
}
it('Automerge field undo preserves independent checks and later same-value writes', () => {
  const check = (adapter: CollaborationAdapter, value: boolean) =>
    edit(adapter, (d) => {
      d.blocks[0]!.props.checked = value;
    });
  const { a, b, send } = pair('automerge', seed);
  check(a, true);
  check(b, true);
  send();
  a.undo();
  send();
  expect(b.getDoc().blocks[0]!.props.checked).toBe(true);
  b.undo();
  send();
  expect(a.getDoc().blocks[0]!.props.checked).toBeUndefined();
  check(a, true);
  send();
  check(b, false);
  check(b, true);
  send();
  a.undo();
  send();
  expect(b.getDoc().blocks[0]!.props.checked).toBe(true);
});
it('keeps a third concurrent Automerge check through two independent undos', () => {
  const a = new AutomergeCollaborationAdapter(seed),
    b = new AutomergeCollaborationAdapter(a.save()),
    c = new AutomergeCollaborationAdapter(a.save());
  for (const peer of [a, b, c])
    edit(peer, (d) => {
      d.blocks[0]!.props.checked = true;
    });
  function sync() {
    const states = [a, b, c].map((p) => p.save());
    for (const p of [a, b, c]) for (const state of states) p.receive(state);
  }
  sync();
  a.undo();
  b.undo();
  sync();
  expect(c.getDoc().blocks[0]!.props.checked).toBe(true);
  c.undo();
  sync();
  expect(a.getDoc().blocks[0]!.props.checked).toBeUndefined();
  b.redo();
  sync();
  expect(c.getDoc().blocks[0]!.props.checked).toBe(true);
});

for (const engine of ['automerge', 'yjs']) {
  it.each([true, false])(
    engine + ' merges concurrent record-page edits (existing page=%s)',
    (existing) => {
      const initial = structuredClone(seed),
        row = {
          id: 'r',
          cells: {},
          ...(existing && { page: { content: [{ text: 'ab' }] } }),
        };
      initial.blocks[0]!.type = 'database';
      initial.blocks[0]!.props = {
        database: { variant: 'database', columns: [], rows: [row] },
      };
      const { a, b, send } = pair(engine, initial);
      const record = (d: Doc) => d.blocks[0]!.props.database!.rows[0]!;
      edit(a, (d) => {
        record(d).page = {
          content: [
            { text: 'A', marks: { bold: true } },
            ...(existing ? [{ text: 'ab' }] : []),
          ],
        };
      });
      edit(b, (d) => {
        record(d).page = {
          content: [
            ...(existing ? [{ text: 'ab' }] : []),
            { text: 'B', marks: { italic: true } },
          ],
        };
      });
      send();
      expect(a.getDoc()).toEqual(b.getDoc());
      const content = record(b.getDoc()).page!.content;
      expect(content.find((run) => run.text.includes('A'))?.marks?.bold).toBe(
        true
      );
      expect(content.find((run) => run.text.includes('B'))?.marks?.italic).toBe(
        true
      );
      if (existing) expect(content.map((r) => r.text).join('')).toBe('AabB');
      a.undo();
      send();
      expect(
        record(b.getDoc())
          .page?.content.map((r) => r.text)
          .join('')
      ).toBe(existing ? 'abB' : 'B');
    }
  );
}

it('preserves concurrent identical Automerge formatting across independent undo and redo', () => {
  const { a, b, send } = pair('automerge', seed);
  for (const peer of [a, b])
    edit(peer, (d) => {
      d.blocks[0]!.text = [{ text: 'a', marks: { bold: true } }, { text: 'b' }];
    });
  send();
  a.undo();
  send();
  expect(b.getDoc().blocks[0]!.text).toEqual([
    { text: 'a', marks: { bold: true } },
    { text: 'b' },
  ]);
  b.undo();
  send();
  expect(a.getDoc().blocks[0]!.text).toEqual([{ text: 'ab' }]);
  a.redo();
  send();
  expect(b.getDoc().blocks[0]!.text[0]?.marks?.bold).toBe(true);
});

for (const engine of ['automerge', 'yjs']) {
  it.each(['abX😀cd', 'aX😀d', 'aXd'])(
    engine + ' replaces only the original IME characters in %s',
    (remote) => {
      const doc = structuredClone(seed);
      doc.blocks[0]!.text = [{ text: 'ab😀cd' }];
      const { a, b, send } = pair(engine, doc);
      a.beginComposition({ blockId: 'a', from: 1, to: 5 });
      edit(b, (d) => {
        d.blocks[0]!.text = [{ text: remote }];
      });
      send();
      const update = a.commitComposition('日');
      const text = update.doc.blocks[0]!.text.map((r) => r.text).join('');
      expect([...text].sort()).toEqual([...'a日Xd'].sort());
      expect(update.remapPoint?.({ blockId: 'a', offset: 1 })?.offset).toBe(
        text.indexOf('日') + 1
      );
      send();
      expect(b.getDoc()).toEqual(a.getDoc());
      a.undo();
      send();
      expect(b.getDoc().blocks[0]!.text).toEqual([{ text: remote }]);
    }
  );
}

it('restores overlapping Automerge mark ranges independently after synchronization', () => {
  const { a, b, send } = pair('automerge', seed);
  edit(a, (d) => {
    d.blocks[0]!.text = [{ text: 'ab', marks: { bold: true } }];
  });
  edit(b, (d) => {
    d.blocks[0]!.text = [{ text: 'a' }, { text: 'b', marks: { bold: true } }];
  });
  send();
  expect(a.getDoc().blocks[0]!.text).toEqual([
    { text: 'ab', marks: { bold: true } },
  ]);
  a.undo();
  send();
  expect(b.getDoc().blocks[0]!.text).toEqual([
    { text: 'a' },
    { text: 'b', marks: { bold: true } },
  ]);
  // A later removal wins until its own author undoes it.
  edit(a, (d) => {
    d.blocks[0]!.text = [{ text: 'ab' }];
  });
  send();
  expect(b.getDoc().blocks[0]!.text).toEqual([{ text: 'ab' }]);
  a.undo();
  send();
  expect(b.getDoc().blocks[0]!.text).toEqual([
    { text: 'a' },
    { text: 'b', marks: { bold: true } },
  ]);
  b.undo();
  send();
  expect(a.getDoc().blocks[0]!.text).toEqual([{ text: 'ab' }]);
});

for (const engine of ['yjs', 'automerge']) {
  for (const reference of [
    { mention: { id: 'm', label: 'Ada' } },
    { page: { id: 'p', title: 'Ada' } },
  ]) {
    it.each([false, true])(
      engine +
        ' IME after ' +
        Object.keys(reference)[0] +
        ' leaves the reference intact (pending bold=%s)',
      (bold) => {
        const initial = structuredClone(seed);
        const chip = { text: 'Ada', marks: reference };
        initial.blocks[0]!.text = [chip];
        const { a, b, send } = pair(engine, initial);
        a.beginComposition({
          blockId: 'a',
          from: 3,
          to: 3,
          ...(bold && { pendingMarks: { bold: true } }),
        });
        a.commitComposition('日');
        send();
        expect(b.getDoc().blocks[0]!.text).toEqual([
          chip,
          { text: '日', ...(bold && { marks: { bold: true } }) },
        ]);
        a.undo();
        send();
        expect(b.getDoc().blocks[0]!.text).toEqual([chip]);
      }
    );
  }
}

for (const engine of ['automerge', 'yjs']) {
  it.each([0, 1, 2])(
    `${engine} IME inherits ordinary insertion marks at offset %i`,
    (offset) => {
      const doc = structuredClone(seed);
      const runs = (doc.blocks[0]!.text = [
        {
          text: 'ab',
          marks: { bold: true, link: 'https://example.com', color: 'blue' },
        },
        { text: 'c' },
      ]);
      const expected = insertTextAt(runs, offset, '日');
      const { a, b, send } = pair(engine, doc);
      a.beginComposition({ blockId: 'a', from: offset, to: offset });
      expect(a.commitComposition('日').doc.blocks[0]!.text).toEqual(expected);
      send();
      expect(b.getDoc().blocks[0]!.text).toEqual(expected);
      a.undo();
      send();
      expect(b.getDoc().blocks[0]!.text).toEqual(runs);
      a.redo();
      send();
      expect(b.getDoc().blocks[0]!.text).toEqual(expected);
    }
  );
  it.each([false, true])(
    `${engine} IME inherits non-atomic chip styling (toggle bold off=%s)`,
    (toggle) => {
      const doc = structuredClone(seed),
        styling: InlineMark = { bold: true, color: 'blue' };
      const chip = {
        text: 'Ada',
        marks: { ...styling, mention: { id: 'm', label: 'Ada' } },
      };
      doc.blocks[0]!.text = [chip];
      const { a, b, send } = pair(engine, doc);
      a.beginComposition({
        blockId: 'a',
        from: 3,
        to: 3,
        ...(toggle && { pendingMarks: {} }),
      });
      a.commitComposition('日');
      send();
      expect(b.getDoc().blocks[0]!.text).toEqual([
        chip,
        { text: '日', marks: toggle ? { color: 'blue' } : styling },
      ]);
    }
  );
}
