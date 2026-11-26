import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import {
  diffDocs,
  splitBlock,
  mergeBlockWithNext,
  moveBlock,
  type CollaborationAdapter,
  type Doc,
} from '../../packages/core/src/index';
import { block, seed, pair, edit } from './peers';
// Seeded sequences keep failures reproducible for both engines.
function randomIndex(seed: number) {
  return (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 4294967296) * limit);
  };
}
function applyDoc(peer: CollaborationAdapter, doc: Doc) {
  const previous = peer.getDoc();
  peer.applyLocalChange(
    { previous, doc, source: 'input', selection: null },
    diffDocs(previous, doc)
  );
  return doc;
}
function splitParagraph(
  peer: CollaborationAdapter,
  source: string,
  offset: number,
  id: string
) {
  return applyDoc(peer, splitBlock(peer.getDoc(), source, offset, id).doc);
}
function joinNext(peer: CollaborationAdapter, id: string) {
  return applyDoc(peer, mergeBlockWithNext(peer.getDoc(), id)!);
}
function setText(peer: CollaborationAdapter, index: number, text: string) {
  edit(peer, (doc) => {
    doc.blocks[index]!.text = text ? [{ text }] : [];
  });
}
describe.each(['automerge', 'yjs'])('%s paragraph boundaries', (engine) => {
  it('keeps both sides of a deleted split boundary independently editable', () => {
    const { a, b, send, observe } = pair(engine, {
      ...seed,
      blocks: [block('a', 'ab')],
    });
    splitParagraph(a, 'a', 1, 's');
    send();
    edit(b, (d) => {
      d.blocks[1]!.text = [];
    });
    send();
    setText(b, 0, 'aX');
    expect(b.getDoc().blocks.map((v) => v.text)).toEqual([
      [{ text: 'aX' }],
      [],
    ]);
    setText(a, 1, 'Y');
    send();
    expect(a.getDoc().blocks.map((v) => v.text)).toEqual([
      [{ text: 'aX' }],
      [{ text: 'Y' }],
    ]);
    expect(observe(true)).toEqual(a.getDoc());
  });
  it('restores a deleted boundary character to its original paragraph', () => {
    const { a, b, send } = pair(engine, {
      ...seed,
      blocks: [block('a', 'abc')],
    });
    splitParagraph(a, 'a', 1, 's');
    send();
    setText(b, 1, 'c');
    send();
    setText(a, 0, 'aX');
    send();
    b.undo();
    send();
    expect(a.getDoc().blocks.map((v) => v.text)).toEqual([
      [{ text: 'aX' }],
      [{ text: 'bc' }],
    ]);
    b.redo();
    send();
    expect(b.getDoc().blocks.map((v) => v.text)).toEqual([
      [{ text: 'aX' }],
      [{ text: 'c' }],
    ]);
  });
  it('can split inside a restored paragraph immediately after undo', () => {
    const { a, b, send } = pair(engine, {
      ...seed,
      blocks: [block('a', 'abcd')],
    });
    const split = (at: number, id: string) => {
      const doc = splitParagraph(a, 'a', at, id);
      expect(a.getDoc()).toEqual(doc);
    };
    split(2, 'z');
    a.undo();
    split(3, 'early');
    send();
    expect(b.getDoc().blocks.map((v) => v.text)).toEqual([
      [{ text: 'abc' }],
      [{ text: 'd' }],
    ]);
  });
  it('upgrades independently edited legacy split snapshots', () => {
    // Saved with the public adapters at 339a33e, before cuts had durable markers.
    const bytes = readFileSync(
      new URL('./fixtures/split-' + engine + '.bin', import.meta.url)
    );
    const { a, b, send, observe } = pair(engine, bytes);
    expect(a.getDoc().blocks.map((v) => v.text)).toEqual([
      [{ text: 'a' }],
      [{ text: 'bc' }],
    ]);
    setText(a, 0, 'aX');
    setText(b, 1, 'c');
    send();
    expect(b.getDoc().blocks.map((v) => v.text)).toEqual([
      [{ text: 'aX' }],
      [{ text: 'c' }],
    ]);
    b.undo();
    send();
    expect(a.getDoc().blocks.map((v) => v.text)).toEqual([
      [{ text: 'aX' }],
      [{ text: 'bc' }],
    ]);
    expect(observe(true)).toEqual(a.getDoc());
  });
  it('can reuse a split block ID after undo', () => {
    const { a, b, send } = pair(engine, {
      ...seed,
      blocks: [block('a', 'abcd')],
    });
    for (const at of [1, 3]) {
      const doc = splitParagraph(a, 'a', at, 'same');
      send();
      expect(b.getDoc()).toEqual(doc);
      a.undo();
      send();
    }
  });
  it('can restore a previously removed split block by ID', () => {
    const { a, b, send } = pair(engine, {
      ...seed,
      blocks: [block('a', 'abc')],
    });
    splitParagraph(a, 'a', 1, 's');
    edit(a, (d) => {
      d.blocks.pop();
    });
    edit(a, (d) => {
      d.blocks.push(block('s', 'new'));
    });
    send();
    expect(b.getDoc().blocks.map((v) => v.text)).toEqual([
      [{ text: 'a' }],
      [{ text: 'new' }],
    ]);
  });
  it('keeps the remaining paragraphs intact when a join is undone after a peer split', () => {
    const { a, b, send } = pair(engine, {
      ...seed,
      blocks: [block('a', 'ab'), block('b', 'cd')],
    });
    joinNext(a, 'a');
    send();
    const doc = splitParagraph(b, 'a', 3, 's');
    send();
    a.undo();
    send();
    expect(
      Object.fromEntries(b.getDoc().blocks.map((v) => [v.id, v.text]))
    ).toEqual({
      a: [{ text: 'ab' }],
      b: [{ text: 'c' }],
      s: [{ text: 'd' }],
    });
    a.redo();
    send();
    expect(a.getDoc()).toEqual(doc);
  });
  it('can restore a join source ID without changing the join recipient', () => {
    const { a, b, send } = pair(engine, {
      ...seed,
      blocks: [block('a', 'ab'), block('b', 'cd')],
    });
    const doc = joinNext(a, 'a');
    edit(a, (d) => {
      d.blocks.push(block('b', 'new'));
    });
    send();
    expect(b.getDoc().blocks.map((v) => v.text)).toEqual([
      [{ text: 'abcd' }],
      [{ text: 'new' }],
    ]);
    a.undo();
    send();
    expect(b.getDoc()).toEqual(doc);
  });
  it('retains peer typing on both sides when the split is undone', () => {
    const { a, b, send } = pair(engine, {
      ...seed,
      blocks: [block('a', 'ab')],
    });
    splitParagraph(a, 'a', 1, 's');
    send();
    edit(b, (d) => {
      d.blocks[0]!.text = [{ text: 'aX' }];
      d.blocks[1]!.text = [{ text: 'Yb' }];
    });
    send();
    a.undo();
    send();
    expect(b.getDoc().blocks.map((v) => v.text)).toEqual([[{ text: 'aXYb' }]]);
    a.redo();
    send();
    expect(b.getDoc().blocks.map((v) => v.text)).toEqual([
      [{ text: 'aX' }],
      [{ text: 'Yb' }],
    ]);
  });
  it('recovers one editable paragraph when offline peers join in opposite directions', () => {
    const initial = { ...seed, blocks: [block('a', 'a'), block('b', 'b')] };
    initial.blocks[0]!.type = 'heading';
    const { a, b, send, observe } = pair(engine, initial);
    joinNext(a, 'a');
    applyDoc(b, moveBlock(b.getDoc(), 'b', 'a', 'before'));
    joinNext(b, 'b');
    send();
    const joined = a.getDoc();
    expect(joined.blocks.map((v) => [v.id, v.type, v.text])).toEqual([
      ['a', 'heading', [{ text: 'ab' }]],
    ]);
    expect(observe(true)).toEqual(joined);
    setText(a, 0, 'aXb');
    send();
    expect(b.getDoc()).toEqual(a.getDoc());
    edit(b, (d) => {
      d.blocks = [];
    });
    send();
    expect(a.getDoc().blocks).toEqual([]);
    b.undo();
    send();
    expect(a.getDoc().blocks[0]!.text).toEqual([{ text: 'aXb' }]);
  });
  it('preserves native characters across overlapping offline structural changes', async () => {
    for (
      let trial = 1;
      trial <= Number(process.env.NOBITA_RACE_TRIALS ?? 2);
      trial++
    ) {
      if (trial % 16 === 0) await setImmediate();
      const choose = randomIndex(trial);
      const { a, b, send, observe } = pair(engine, {
        ...seed,
        blocks: [block('a', 'abc'), block('b', 'def'), block('c', 'ghi')],
      });
      for (let batch = 0; batch < 6; batch++) {
        for (const [name, peer] of [
          ['a', a],
          ['b', b],
        ] as const) {
          for (let step = 0; step < 2; step++) {
            const doc = peer.getDoc(),
              blocks = doc.blocks;
            const index = choose(blocks.length),
              source = blocks[index]!;
            const action = choose(3);
            if (action === 0 || blocks.length === 1) {
              const length = source.text.reduce((n, r) => n + r.text.length, 0);
              applyDoc(
                peer,
                splitBlock(
                  doc,
                  source.id,
                  choose(length + 1),
                  name + batch + '-' + step
                ).doc
              );
            } else if (action === 1)
              joinNext(peer, blocks[Math.min(index, blocks.length - 2)]!.id);
            else
              applyDoc(
                peer,
                moveBlock(
                  doc,
                  source.id,
                  blocks[(index + 1) % blocks.length]!.id,
                  'before'
                )
              );
          }
        }
        send(batch % 2 === 0);
        const result = a.getDoc(),
          all = result.blocks
            .flatMap((b) => b.text.map((r) => r.text))
            .join('');
        expect(
          all.split('').sort().join(''),
          JSON.stringify({ trial, batch })
        ).toBe('abcdefghi');
        expect(b.getDoc()).toEqual(result);
      }
      expect(observe(true)).toEqual(a.getDoc());
    }
  }, 120000);
  it('keeps the editor and replicas aligned through mixed paragraph operations', async () => {
    for (
      let trial = 1;
      trial <= Number(process.env.NOBITA_EDIT_TRIALS ?? 2);
      trial++
    ) {
      if (trial % 16 === 0) await setImmediate();
      const choose = randomIndex(trial);
      const { a, b, send, observe } = pair(engine, {
        ...seed,
        blocks: [block('a', 'abcd'), block('b', 'xyz')],
      });
      for (let step = 0; step < 45; step++) {
        const peer = choose(2) ? a : b,
          previous = peer.getDoc();
        const index = choose(previous.blocks.length),
          item = previous.blocks[index]!;
        const value = item.text.map((r) => r.text).join(''),
          offset = choose(value.length + 1);
        let doc = previous;
        const op = choose(6);
        if (op === 0 || (previous.blocks.length === 1 && op === 1))
          doc = splitBlock(previous, item.id, offset, 'new-' + step).doc;
        else if (op === 1)
          doc = mergeBlockWithNext(
            previous,
            previous.blocks[Math.min(index, previous.blocks.length - 2)]!.id
          )!;
        else if (op === 2 && previous.blocks.length > 1) {
          const other = previous.blocks[(index + 1) % previous.blocks.length]!;
          doc = moveBlock(
            previous,
            item.id,
            other.id,
            choose(2) ? 'before' : 'after'
          );
        } else {
          const count = op === 3 ? choose(value.length - offset + 1) : 0;
          const next =
            value.slice(0, offset) +
            (op === 3 ? '' : String.fromCharCode(65 + choose(26))) +
            value.slice(offset + count);
          doc = structuredClone(previous);
          doc.blocks[index]!.text = next ? [{ text: next }] : [];
        }
        peer.applyLocalChange(
          { previous, doc, source: 'input', selection: null },
          diffDocs(previous, doc)
        );
        const where = JSON.stringify({
          trial,
          step,
          op,
          index,
          offset,
          value,
        });
        expect(peer.getDoc(), where).toEqual(doc);
        if (
          JSON.stringify(previous) !== JSON.stringify(doc) &&
          step % 4 === 0
        ) {
          peer.undo();
          expect(peer.getDoc(), where + ' undo').toEqual(previous);
          peer.redo();
          expect(peer.getDoc(), where + ' redo').toEqual(doc);
        }
        send();
        expect(a.getDoc(), where).toEqual(b.getDoc());
      }
      const before = b.getDoc();
      const off = b.subscribe((update) => {
        if (!update.remapPoint) return;
        for (const block of before.blocks) {
          const length = block.text.reduce((n, r) => n + r.text.length, 0);
          for (let offset = 0; offset <= length; offset++) {
            const point = { blockId: block.id, offset };
            expect(
              update.remapPoint(point),
              JSON.stringify({ trial, point })
            ).toEqual(point);
          }
        }
      });
      edit(a, (d) => {
        d.title = 'new title';
      });
      send();
      off();
      expect(observe(true)).toEqual(a.getDoc());
    }
  }, 120000);
  it('keeps literal marker characters, rich text and emoji across a split and IME replacement', () => {
    const initial = { ...seed, blocks: [block('a')] };
    initial.blocks[0]!.text = [
      { text: 'a\uFFFC' },
      { text: '🌻b', marks: { bold: true } },
    ];
    const { a, b, send, observe } = pair(engine, initial);
    a.beginComposition({ blockId: 'a', from: 1, to: 4 });
    splitParagraph(b, 'a', 2, 's');
    send();
    a.commitComposition('文');
    send();
    expect(b.getDoc().blocks.map((v) => v.text)).toEqual([
      [{ text: 'a文' }],
      [{ text: 'b', marks: { bold: true } }],
    ]);
    expect(observe(false)).toEqual(a.getDoc());
  });
  it('keeps coincident offline splits editable and independently undoable', () => {
    const { a, b, send, observe } = pair(engine, {
      ...seed,
      blocks: [block('p', 'ab')],
    });
    splitParagraph(a, 'p', 1, 'first');
    splitParagraph(b, 'p', 1, 'second');
    send(true);
    expect(observe(false)).toEqual(a.getDoc());
    expect(
      a
        .getDoc()
        .blocks.map((v) => v.text.map((r) => r.text).join(''))
        .sort()
    ).toEqual(['', 'a', 'b']);
    a.undo();
    send();
    expect(b.getDoc().blocks.map((v) => [v.id, v.text])).toEqual([
      ['p', [{ text: 'a' }]],
      ['second', [{ text: 'b' }]],
    ]);
    setText(b, 1, '!b');
    send();
    a.redo();
    send();
    expect(
      a
        .getDoc()
        .blocks.flatMap((v) => v.text.map((r) => r.text))
        .join('')
        .replaceAll('!', '')
    ).toBe('ab');
    expect(
      a
        .getDoc()
        .blocks.flatMap((v) => v.text.map((r) => r.text))
        .join('')
    ).toContain('!');
    expect(b.getDoc()).toEqual(a.getDoc());
  });
});
