import { describe, expect, it } from 'vitest';
import { parseDoc } from '../src/serialize.js';
import {
  insertTextAt,
  markStateInRange,
  marksEqual,
  mentionRangeAt,
  normalizeMark,
  runsToHtml,
} from '../src/text.js';

describe('mention marks', () => {
  it('normalizes and distinguishes mention references', () => {
    expect(normalizeMark({ mention: { id: 'u1', label: 'Ada' } })).toEqual({
      mention: { id: 'u1', label: 'Ada' },
    });
    expect(
      normalizeMark({ mention: { id: '', label: 'Ada' } })
    ).toBeUndefined();
    expect(
      marksEqual(
        { mention: { id: 'u1', label: 'Ada' } },
        { mention: { id: 'u2', label: 'Ada' } }
      )
    ).toBe(false);
  });

  it('computes mention state for a range', () => {
    expect(
      markStateInRange(
        [
          { text: '@Ada', marks: { mention: { id: 'u1', label: 'Ada' } } },
          { text: ' hello' },
        ],
        0,
        4
      )
    ).toEqual({ mention: { id: 'u1', label: 'Ada' } });
  });

  it('keeps mentions atomic when typing and deleting', () => {
    const runs = [
      { text: 'Hi ' },
      { text: '@Ada', marks: { mention: { id: 'u1', label: 'Ada' } } as const },
    ];
    expect(insertTextAt(runs, 7, '!')).toEqual([
      { text: 'Hi ' },
      { text: '@Ada', marks: { mention: { id: 'u1', label: 'Ada' } } },
      { text: '!' },
    ]);
    expect(insertTextAt(runs, 0, '>')).toEqual([
      { text: '>Hi ' },
      { text: '@Ada', marks: { mention: { id: 'u1', label: 'Ada' } } },
    ]);
    expect(mentionRangeAt(runs, 3)).toEqual({ start: 3, end: 7 });
    expect(mentionRangeAt(runs, 2)).toBeNull();
    expect(mentionRangeAt(runs, 7)).toBeNull();
  });

  it('renders mention HTML metadata and round-trips JSON', () => {
    const html = runsToHtml(
      [{ text: '@Ada', marks: { mention: { id: 'u1', label: 'Ada' } } }],
      value => value
    );
    expect(html).toContain('data-nb-mention-id="u1"');
    expect(html).toContain('data-nb-mention-label="Ada"');

    const doc = parseDoc({
      version: 1,
      id: 'mention',
      title: '',
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          text: [{ text: '@Ada', marks: { mention: { id: 'u1', label: 'Ada' } } }],
          props: {},
          children: [],
        },
      ],
    });
    expect(doc.blocks[0]?.text[0]?.marks?.mention).toEqual({
      id: 'u1',
      label: 'Ada',
    });
  });
});
