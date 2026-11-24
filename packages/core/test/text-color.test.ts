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
  setTextColorInRange,
} from '../src/text.js';
import type { TextColor } from '../src/types.js';

describe('text color marks', () => {
  it('keeps known palette colors and drops unknown values', () => {
    expect(normalizeMark({ color: 'blue' })).toEqual({ color: 'blue' });
    expect(
      normalizeMark({ color: 'chartreuse' as unknown as TextColor })
    ).toBeUndefined();
  });

  it('sets, changes and removes a text color in a range', () => {
    const base = [{ text: 'hello' }];
    const red = applyMarkPatch(base, 0, 5, { color: 'red' });
    expect(red).toEqual([{ text: 'hello', marks: { color: 'red' } }]);

    const blue = setTextColorInRange(red, 0, 5, 'blue');
    expect(blue).toEqual([{ text: 'hello', marks: { color: 'blue' } }]);

    expect(applyMarkPatch(blue, 0, 5, { color: null })).toEqual([
      { text: 'hello' },
    ]);
  });

  it('requires one color across the whole selected range', () => {
    const mixed = [
      { text: 'aa', marks: { color: 'red' as const } },
      { text: 'bb', marks: { color: 'blue' as const } },
    ];
    expect(markStateInRange(mixed, 0, 4)).toEqual({});

    const uniform = [
      { text: 'aa', marks: { color: 'purple' as const } },
      { text: 'bb', marks: { color: 'purple' as const } },
    ];
    expect(markStateInRange(uniform, 0, 4)).toEqual({ color: 'purple' });
  });

  it('keeps different text colors as different runs', () => {
    expect(marksEqual({ color: 'red' }, { color: 'blue' })).toBe(false);
    expect(
      normalizeRuns([
        { text: 'a', marks: { color: 'red' } },
        { text: 'b', marks: { color: 'red' } },
        { text: 'c', marks: { color: 'blue' } },
      ])
    ).toEqual([
      { text: 'ab', marks: { color: 'red' } },
      { text: 'c', marks: { color: 'blue' } },
    ]);
  });

  it('inherits the color when typing inside a run', () => {
    const runs = [{ text: 'x', marks: { color: 'teal' as const } }];
    expect(insertTextAt(runs, 1, 'y')).toEqual([
      { text: 'xy', marks: { color: 'teal' } },
    ]);
  });

  it('round-trips color through parsed JSON', () => {
    const parsed = parseDoc({
      version: 1,
      id: 'doc',
      title: '',
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          text: [{ text: 'hello', marks: { color: 'orange' } }],
          props: {},
          children: [],
        },
      ],
    });
    expect(parsed.blocks[0]?.text[0]?.marks).toEqual({ color: 'orange' });
  });

  it('renders HTML and intentionally drops color from Markdown', () => {
    const doc = createDoc({
      blocks: [
        createBlock('paragraph', {
          text: [
            {
              text: 'hello',
              marks: { color: 'green', highlight: 'yellow' },
            },
          ],
        }),
      ],
    });
    const html = blocksToHtml(doc.blocks);
    expect(html).toContain('<span data-nb-color="green"');
    expect(html).toContain('--nb-fg-green');
    expect(html).toContain('#15803d');
    expect(html).toContain('<mark data-nb-highlight="yellow"');
    expect(html.indexOf('data-nb-highlight')).toBeLessThan(
      html.indexOf('data-nb-color')
    );

    const markdown = blocksToMarkdown(doc, { title: false });
    expect(markdown).toContain('hello');
    expect(markdown).not.toContain('data-nb-color');
    expect(markdown).not.toContain('==');
  });
});
