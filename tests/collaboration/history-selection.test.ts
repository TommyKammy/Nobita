import { describe, expect, it } from 'vitest';
import {
  diffDocs,
  splitBlock,
  type EditorSelection,
} from '../../packages/core/src/index';
import { block, edit, pair, seed } from './peers';

const caret = (blockId: string, offset: number) => ({
  anchor: { blockId, offset },
  focus: { blockId, offset },
});
describe.each(['automerge', 'yjs'])('%s history selections', (engine) => {
  it('restores both ends of history through edits made by a peer', () => {
    const { a, b, send } = pair(engine, {
      ...seed,
      blocks: [block('p', 'ab')],
    });
    const previous = a.getDoc(),
      { doc } = splitBlock(previous, 'p', 2, 'suffix');
    a.applyLocalChange(
      {
        previous,
        doc,
        source: 'input',
        previousSelection: caret('p', 2),
        selection: caret('suffix', 0),
      },
      diffDocs(previous, doc)
    );
    send();
    edit(b, (d) => {
      d.blocks[0]!.text = [{ text: 'Xab' }];
      d.blocks[1]!.text = [{ text: 'Z' }];
    });
    send();
    const selections: (EditorSelection | null | undefined)[] = [];
    a.subscribe((u) => {
      if (u.history) selections.push(u.historySelection);
    });
    a.undo();
    a.redo();
    a.undo();
    expect(selections).toEqual([
      caret('p', 3),
      caret('suffix', 1),
      caret('p', 3),
    ]);
  });
  it('restores the direction of an IME replacement after a remote prefix edit', () => {
    const { a, b, send } = pair(engine, {
      ...seed,
      blocks: [block('p', 'abcd')],
    });
    a.beginComposition({ blockId: 'p', from: 1, to: 3, backward: true });
    a.commitComposition('日');
    send();
    edit(b, (d) => {
      d.blocks[0]!.text = [{ text: 'Xa日d' }];
    });
    send();
    const selections: (EditorSelection | null | undefined)[] = [];
    a.subscribe((u) => {
      if (u.history) selections.push(u.historySelection);
    });
    a.undo();
    expect(a.getDoc().blocks[0]!.text).toEqual([{ text: 'Xabcd' }]);
    a.redo();
    expect(selections).toEqual([
      {
        anchor: { blockId: 'p', offset: 4 },
        focus: { blockId: 'p', offset: 2 },
      },
      caret('p', 3),
    ]);
  });
});
