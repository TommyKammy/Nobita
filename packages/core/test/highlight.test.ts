import { describe, expect, it } from 'vitest';
import { createBlock, createDoc } from '../src/doc.js';
import { blocksToMarkdown } from '../src/markdown.js';
import { blocksToHtml, parseDoc } from '../src/serialize.js';
import {
  applyMarkPatch,
  insertTextAt,
  markStateInRange,
  marksEqual,
  normalizeMark,
  normalizeRuns,
  setHighlightInRange,
} from '../src/text.js';
import type { HighlightColor } from '../src/types.js';

describe('highlight marks', () => {
  it('keeps known palette colors and drops unknown values', () => {
    expect(normalizeMark({ highlight: 'yellow' })).toEqual({
      highlight: 'yellow',
    });
    expect(
      normalizeMark({ highlight: 'chartreuse' as unknown as HighlightColor })
    ).toBeUndefined();
  });

  it('sets, changes and removes a highlight in a range', () => {
    const base = [{ text: 'hello' }];
    const yellow = applyMarkPatch(base, 0, 5, { highlight: 'yellow' });
    expect(yellow).toEqual([{ text: 'hello', marks: { highlight: 'yellow' } }]);

    const green = setHighlightInRange(yellow, 0, 5, 'green');
    expect(green).toEqual([{ text: 'hello', marks: { highlight: 'green' } }]);

    expect(applyMarkPatch(green, 0, 5, { highlight: null })).toEqual([
      { text: 'hello' },
    ]);
  });

  it('requires one color across the whole selected range', () => {
    const mixed = [
      { text: 'aa', marks: { highlight: 'yellow' as const } },
      { text: 'bb', marks: { highlight: 'green' as const } },
    ];
    expect(markStateInRange(mixed, 0, 4)).toEqual({});

    const uniform = [
      { text: 'aa', marks: { highlight: 'blue' as const } },
      { text: 'bb', marks: { highlight: 'blue' as const } },
    ];
    expect(markStateInRange(uniform, 0, 4)).toEqual({ highlight: 'blue' });
  });

  it('keeps different colors as different runs', () => {
    expect(
      marksEqual({ highlight: 'yellow' }, { highlight: 'green' })
    ).toBe(false);
    expect(
      normalizeRuns([
        { text: 'a', marks: { highlight: 'yellow' } },
        { text: 'b', marks: { highlight: 'yellow' } },
        { text: 'c', marks: { highlight: 'green' } },
      ])
    ).toEqual([
      { text: 'ab', marks: { highlight: 'yellow' } },
      { text: 'c', marks: { highlight: 'green' } },
    ]);
  });

  it('inherits the highlight when typing inside a run', () => {
    const runs = [{ text: 'x', marks: { highlight: 'purple' as const } }];
    expect(insertTextAt(runs, 1, 'y')).toEqual([
      { text: 'xy', marks: { highlight: 'purple' } },
    ]);
  });

  it('round-trips highlight through parsed JSON', () => {
    const parsed = parseDoc({
      version: 1,
      id: 'doc',
      title: '',
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          text: [{ text: 'hello', marks: { highlight: 'teal' } }],
          props: {},
          children: [],
        },
      ],
    });
    expect(parsed.blocks[0]?.text[0]?.marks).toEqual({ highlight: 'teal' });

    const invalid = parseDoc({
      version: 1,
      id: 'doc',
      title: '',
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          text: [{ text: 'hello', marks: { highlight: 'chartreuse' } }],
          props: {},
          children: [],
        },
      ],
    });
    expect(invalid.blocks[0]?.text[0]?.marks).toBeUndefined();
  });

  it('renders HTML and intentionally drops color from Markdown', () => {
    const doc = createDoc({
      blocks: [
        createBlock('paragraph', {
          text: [{ text: 'hello', marks: { highlight: 'yellow' } }],
        }),
      ],
    });
    const html = blocksToHtml(doc.blocks);
    expect(html).toContain('<mark data-nb-highlight="yellow"');
    expect(html).toContain('--nb-hl-yellow');
    expect(html).toContain('#fef3c7');

    const markdown = blocksToMarkdown(doc, { title: false });
    expect(markdown).toContain('hello');
    expect(markdown).not.toContain('<mark');
    expect(markdown).not.toContain('==');
  });
});
