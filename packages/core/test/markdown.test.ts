import { describe, expect, it } from 'vitest';
import { blocksToMarkdown, markdownToBlocks, parseInlineMarkdown } from '../src/markdown.js';
import { createBlock, createDoc } from '../src/doc.js';

describe('inline markdown', () => {
  it('parses marks and links', () => {
    expect(parseInlineMarkdown('a **bold** and *it* ~~gone~~ `code` [site](https://a.b)')).toEqual([
      { text: 'a ' },
      { text: 'bold', marks: { bold: true } },
      { text: ' and ' },
      { text: 'it', marks: { italic: true } },
      { text: ' ' },
      { text: 'gone', marks: { strike: true } },
      { text: ' ' },
      { text: 'code', marks: { code: true } },
      { text: ' ' },
      { text: 'site', marks: { link: 'https://a.b' } },
    ]);
  });

  it('keeps unknown syntax literal', () => {
    expect(parseInlineMarkdown('a * b and [x]')).toEqual([{ text: 'a * b and [x]' }]);
  });

  it('parses nested bold+italic', () => {
    expect(parseInlineMarkdown('***wow***')).toEqual([
      { text: 'wow', marks: { bold: true, italic: true } },
    ]);
  });

  it('parses inline formatting and escapes inside link labels', () => {
    expect(
      parseInlineMarkdown('[**bold** and `code` \\[1\\]](https://example.com)')
    ).toEqual([
      { text: 'bold', marks: { bold: true, link: 'https://example.com' } },
      { text: ' and ', marks: { link: 'https://example.com' } },
      { text: 'code', marks: { code: true, link: 'https://example.com' } },
      { text: ' [1]', marks: { link: 'https://example.com' } },
    ]);
  });
});

describe('markdown documents', () => {
  const source = [
    '# Title',
    '',
    'Hello **world**',
    '',
    '## Section',
    '',
    '- one',
    '  - nested',
    '- two',
    '',
    '1. first',
    '2. second',
    '',
    '- [x] done',
    '- [ ] todo',
    '',
    '> a quote',
    '',
    '```ts',
    'const x = 1;',
    '```',
    '',
    '---',
  ].join('\n');

  it('builds a block tree with nested lists', () => {
    const parsed = markdownToBlocks(source, { extractTitle: true });
    expect(parsed.title).toBe('Title');
    const types = parsed.blocks.map(block => block.type);
    expect(types).toEqual([
      'paragraph',
      'heading',
      'bulleted',
      'bulleted',
      'numbered',
      'numbered',
      'todo',
      'todo',
      'quote',
      'code',
      'divider',
    ]);
    const firstList = parsed.blocks[2];
    expect(firstList?.children).toHaveLength(1);
    expect(firstList?.children[0]?.type).toBe('bulleted');
  });

  it('round-trips the important structure', () => {
    const parsed = markdownToBlocks(source, { extractTitle: true });
    const doc = createDoc({ title: parsed.title, blocks: parsed.blocks });
    const output = blocksToMarkdown(doc);
    expect(output).toContain('# Title');
    expect(output).toContain('- one');
    expect(output).toContain('  - nested');
    expect(output).toContain('1. first');
    expect(output).toContain('- [x] done');
    expect(output).toContain('> a quote');
    expect(output).toContain('const x = 1;');
    expect(output).toContain('---');
  });

  it('does not extract a title unless asked', () => {
    const parsed = markdownToBlocks('# Heading\n\nbody');
    expect(parsed.title).toBeUndefined();
    expect(parsed.blocks[0]?.type).toBe('heading');
  });

  it('handles images and callouts', () => {
    const parsed = markdownToBlocks('![alt](https://x.test/a.png)\n\n> note');
    expect(parsed.blocks[0]).toMatchObject({ type: 'image', props: { src: 'https://x.test/a.png' } });
    expect(parsed.blocks[1]).toMatchObject({ type: 'quote' });
  });
});

describe('markdown serialization edge cases', () => {
  it('escapes inline syntax in plain text', () => {
    const doc = createDoc({ blocks: [createBlock('paragraph', { text: 'a * b [c]' })] });
    expect(blocksToMarkdown(doc, { title: false })).toContain('a \\* b \\[c\\]');
  });

  it('supports headings 4 through 6', () => {
    const parsed = markdownToBlocks('#### Four\n\n##### Five\n\n###### Six');
    expect(parsed.blocks.map(block => block.props.level)).toEqual([4, 5, 6]);
    const output = blocksToMarkdown(createDoc({ blocks: parsed.blocks }), { title: false });
    expect(output).toContain('#### Four');
    expect(output).toContain('##### Five');
    expect(output).toContain('###### Six');
  });
});
