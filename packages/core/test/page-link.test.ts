import { describe, expect, it } from 'vitest';
import { blockSearchText, setBlockType } from '../src/commands.js';
import { createBlock, createDoc } from '../src/doc.js';
import { blocksToMarkdown } from '../src/markdown.js';
import { blocksToHtml, parseDoc } from '../src/serialize.js';
import {
  atomicRangeAt,
  cloneRuns,
  insertTextAt,
  markStateInRange,
  marksEqual,
  normalizeMark,
  normalizeRuns,
  pageRangeAt,
  runsToHtml,
} from '../src/text.js';
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

describe('inline page link mark', () => {
  it('normalizes, distinguishes, and preserves long host page ids', () => {
    const longId = 'p'.repeat(300);
    expect(normalizeMark({ page: { id: longId, title: 'Roadmap', icon: '🗺️' } })).toEqual({
      page: { id: longId, title: 'Roadmap', icon: '🗺️' },
    });
    expect(normalizeMark({ page: { id: '', title: 'Missing' } })).toBeUndefined();
    expect(normalizeMark({ page: { id: 'p1', title: '' } })).toEqual({
      page: { id: 'p1', title: 'Untitled page' },
    });
    expect(
      marksEqual(
        { page: { id: 'p1', title: 'A' } },
        { page: { id: 'p2', title: 'A' } }
      )
    ).toBe(false);
  });

  it('keeps inline page links atomic when typing, deleting, and normalizing', () => {
    const pageMark = { page: { id: 'p1', title: 'Roadmap', icon: '🗺️' } } as const;
    const runs = [
      { text: 'See ' },
      { text: 'Roadmap', marks: pageMark },
    ];
    expect(insertTextAt(runs, 11, '!')).toEqual([
      { text: 'See ' },
      { text: 'Roadmap', marks: pageMark },
      { text: '!' },
    ]);
    expect(pageRangeAt(runs, 4)).toEqual({ start: 4, end: 11 });
    expect(atomicRangeAt(runs, 10)).toEqual({ start: 4, end: 11 });
    expect(pageRangeAt(runs, 3)).toBeNull();
    expect(pageRangeAt(runs, 11)).toBeNull();

    // Adjacent identical page chips stay separate runs.
    expect(
      normalizeRuns([
        { text: 'Roadmap', marks: pageMark },
        { text: 'Roadmap', marks: pageMark },
      ])
    ).toHaveLength(2);

    // Deep clone does not share nested page objects.
    const cloned = cloneRuns(runs);
    expect(cloned[1]?.marks?.page).toEqual(pageMark.page);
    expect(cloned[1]?.marks?.page).not.toBe(runs[1]?.marks?.page);

    expect(markStateInRange(runs, 4, 11)).toEqual(pageMark);
  });

  it('exports inline page links to HTML and Markdown and round-trips JSON', () => {
    const doc = parseDoc({
      version: 1,
      id: 'inline-page',
      title: '',
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          text: [
            { text: 'Open ' },
            {
              text: 'Roadmap',
              marks: { page: { id: 'p(1)', title: 'Roadmap', icon: '🗺️' } },
            },
            { text: ' now' },
          ],
          props: {},
          children: [],
        },
      ],
    });
    expect(doc.blocks[0]?.text[1]?.marks?.page).toEqual({
      id: 'p(1)',
      title: 'Roadmap',
      icon: '🗺️',
    });

    const html = runsToHtml(doc.blocks[0]!.text, v => v);
    expect(html).toContain('class="nb-m-page"');
    expect(html).toContain('data-nb-page-id="p(1)"');
    expect(html).toContain('data-nb-page-title="Roadmap"');
    expect(html).toContain('data-nb-page-icon="🗺️"');
    expect(html).toContain('href="#page-p(1)"');

    const md = blocksToMarkdown(doc, { title: false });
    expect(md).toContain('Open [Roadmap](#page-p%281%29) now');
  });
});
