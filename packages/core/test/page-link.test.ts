import { describe, expect, it } from 'vitest';
import { blockSearchText, setBlockType } from '../src/commands.js';
import { createBlock, createDoc } from '../src/doc.js';
import { blocksToMarkdown } from '../src/markdown.js';
import { blocksToHtml, parseDoc } from '../src/serialize.js';
import { isTextualBlock } from '../src/types.js';

const pageBlock = () =>
  createBlock('page', {
    id: 'page',
    props: {
      pageId: 'p1',
      pageTitle: 'Roadmap',
      pageIcon: '🗺️',
    },
  });

describe('page link block', () => {
  it('round-trips page metadata through JSON', () => {
    const doc = parseDoc(
      createDoc({ blocks: [pageBlock()] })
    );
    expect(doc.blocks[0]).toMatchObject({
      id: 'page',
      type: 'page',
      props: { pageId: 'p1', pageTitle: 'Roadmap', pageIcon: '🗺️' },
    });
    expect(isTextualBlock(doc.blocks[0]!)).toBe(false);
    expect(blockSearchText(doc.blocks[0]!)).toBe('Roadmap');
  });

  it('preserves long host page ids through parsing', () => {
    const id = 'p'.repeat(300);
    const doc = parseDoc({
      version: 1,
      id: 'long-id',
      title: '',
      blocks: [
        {
          id: 'page',
          type: 'page',
          text: [],
          props: { pageId: id, pageTitle: 'Long' },
          children: [],
        },
      ],
    });
    expect(doc.blocks[0]?.props.pageId).toBe(id);
  });

  it('encodes parentheses in Markdown page destinations', () => {
    const doc = createDoc({
      blocks: [
        createBlock('page', {
          id: 'page',
          props: { pageId: 'p(1)', pageTitle: 'Parens' },
        }),
      ],
    });
    expect(blocksToMarkdown(doc, { title: false })).toContain(
      '[Parens](#page-p%281%29)'
    );
  });

  it('keeps page block children in HTML exports', () => {
    const doc = createDoc({
      blocks: [
        createBlock('page', {
          id: 'page',
          props: { pageId: 'p1', pageTitle: 'Roadmap' },
          children: [createBlock('paragraph', { id: 'child', text: 'Child note' })],
        }),
      ],
    });
    expect(blocksToHtml(doc.blocks)).toContain('Child note');
  });

  it('exports the page id to HTML and Markdown', () => {
    const doc = createDoc({ blocks: [pageBlock()] });
    const html = blocksToHtml(doc.blocks);
    expect(html).toContain('data-page-id="p1"');
    expect(html).toContain('data-page-title="Roadmap"');
    expect(html).toContain('href="#page-p1"');

    const markdown = blocksToMarkdown(doc, { title: false });
    expect(markdown).toContain('[Roadmap](#page-p1)');
  });

  it('keeps page props when converting a block to a page', () => {
    const doc = createDoc({ blocks: [createBlock('paragraph', { id: 'a', text: 'Hello' })] });
    const next = setBlockType(doc, 'a', 'page', {
      pageId: 'p2',
      pageTitle: 'Notes',
    });
    const block = next.blocks[0]!;
    expect(block.type).toBe('page');
    expect(block.text).toEqual([]);
    expect(block.props.pageId).toBe('p2');
    expect(block.props.pageTitle).toBe('Notes');
  });
});
