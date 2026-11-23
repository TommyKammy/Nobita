import { describe, expect, it } from 'vitest';
import { safeHref, safeImageSrc } from '../src/url.js';
import { runsToHtml } from '../src/text.js';
import { blocksToHtml } from '../src/serialize.js';
import { createBlock } from '../src/doc.js';
import { blocksToMarkdown } from '../src/markdown.js';

describe('url safety', () => {
  it('allows web, mail, fragment and relative links', () => {
    for (const href of [
      'https://example.com/a?b=1',
      'http://example.com',
      'mailto:hi@example.com',
      '#section',
      '/docs/intro',
      './local',
      '../up',
    ]) {
      expect(safeHref(href), href).toBe(href);
    }
  });

  it('rejects executable schemes', () => {
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'chrome://settings',
    ]) {
      expect(safeHref(href), href).toBeNull();
    }
  });

  it('allows only image-like sources', () => {
    expect(safeImageSrc('https://example.com/x.png')).toBe('https://example.com/x.png');
    expect(safeImageSrc('/img/x.png')).toBe('/img/x.png');
    expect(safeImageSrc('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    expect(safeImageSrc('javascript:alert(1)')).toBeNull();
    expect(safeImageSrc('data:text/html,hello')).toBeNull();
  });
});

describe('sanitized rendering', () => {
  it('does not emit anchors for unsafe links', () => {
    const html = runsToHtml(
      [{ text: 'click', marks: { link: 'javascript:alert(1)' } }],
      text => text
    );
    expect(html).toBe('click');
  });

  it('does not emit unsafe image sources', () => {
    const html = blocksToHtml([
      createBlock('image', { props: { src: 'javascript:alert(1)', alt: 'x' } }),
    ]);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('src=""');
  });

  it('does not emit unsafe markdown links or images', () => {
    const markdown = blocksToMarkdown(
      {
        version: 1,
        id: 'd',
        title: '',
        blocks: [
          createBlock('paragraph', { text: [{ text: 'x', marks: { link: 'javascript:alert(1)' } }] }),
          createBlock('image', { props: { src: 'javascript:alert(1)', alt: 'pic' } }),
        ],
      },
      { title: false }
    );
    expect(markdown).not.toContain('javascript:');
    expect(markdown).toContain('pic');
  });
});
