import { expect, test, type Page } from '@playwright/test';
import { blockById, focusBlock, getDoc, openFixture } from './helpers';

const textDoc = (text = 'Hello') => ({
  version: 1,
  id: 'phase2',
  title: '',
  blocks: [
    { id: 'b1', type: 'paragraph', text: [{ text }], props: {}, children: [] },
    { id: 'b2', type: 'paragraph', text: [{ text: 'Target' }], props: {}, children: [] },
    {
      id: 'code',
      type: 'code',
      text: [{ text: 'const x = 1;' }],
      props: { language: 'text' },
      children: [],
    },
    {
      id: 'callout',
      type: 'callout',
      text: [{ text: 'Note' }],
      props: { tone: 'info' },
      children: [],
    },
  ],
});

async function setDoc(page: Page, doc: unknown): Promise<void> {
  await page.evaluate(value => {
    const editor = (window as unknown as {
      __editor?: {
        setDoc(value: string): void;
        setMentionProvider(provider: unknown): void;
        setUploadImage(handler: unknown): void;
        getBlockLink(blockId: string): string | null;
        getSelection(): unknown;
      };
    }).__editor;
    editor?.setDoc(JSON.stringify(value));
  }, doc);
  await page.waitForTimeout(100);
}

test('inserts a mention from the provider', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, textDoc('Hi '));
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setMentionProvider(provider: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setMentionProvider({
      search: () => [{ id: 'u1', label: 'Ada' }],
    });
    editor?.focus('b1', 3);
  });
  await page.keyboard.type('@');
  await expect(page.locator('.nb-menu')).toBeVisible();
  await page.locator('.nb-menu-item', { hasText: 'Ada' }).click();

  let doc = await getDoc(page);
  let runs = blockById(doc, 'b1')?.runs ?? [];
  expect(runs.some(run => run.marks?.mention)).toBe(true);
  expect(blockById(doc, 'b1')?.text).toContain('@Ada');

  await page.keyboard.type('!');
  doc = await getDoc(page);
  runs = blockById(doc, 'b1')?.runs ?? [];
  expect(runs.some(run => run.text === '!' && !run.marks?.mention)).toBe(true);
  expect(runs.some(run => run.marks?.mention && run.text === '@Ada')).toBe(true);
});

test('uploads a pasted image through the adapter', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, textDoc('Image target'));
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setUploadImage(handler: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setUploadImage(async (file: File) => ({
      src: `https://example.com/${file.name}`,
      alt: file.name,
    }));
    editor?.focus('b1', 0);
  });
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', {
      type: 'image/png',
    }));
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-text')
      ?.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          clipboardData: data,
        })
      );
  });
  await expect
    .poll(async () => {
      const doc = await getDoc(page);
      return doc.blocks.some(block => block.type === 'image');
    })
    .toBe(true);
  const doc = await getDoc(page);
  const image = doc.blocks.find(block => block.type === 'image');
  expect(image?.props.src).toBe('https://example.com/photo.png');
  expect(image?.props.alt).toBe('photo.png');
});

test('changes code language and callout tone', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, textDoc());
  await page.locator('.nb-code-lang').selectOption('typescript');
  await page.locator('.nb-callout-tone').selectOption('success');

  const doc = await getDoc(page);
  expect(blockById(doc, 'code')?.props.language).toBe('typescript');
  expect(blockById(doc, 'callout')?.props.tone).toBe('success');
});

test('navigates to a block through a block link', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    ...textDoc('Jump'),
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        text: [{ text: 'Jump', marks: { link: '#block-b2' } }],
        props: {},
        children: [],
      },
      { id: 'b2', type: 'paragraph', text: [{ text: 'Target' }], props: {}, children: [] },
    ],
  });
  const link = await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { getBlockLink(blockId: string): string | null };
    }).__editor;
    return editor?.getBlockLink('b2');
  });
  expect(link).toBe('#block-b2');
  await page.locator('.nb-m-link').click();
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const editor = (window as unknown as {
          __editor?: { getSelection(): { focus?: { blockId?: string } } | null };
        }).__editor;
        return editor?.getSelection() ?? null;
      });
    })
    .toMatchObject({ focus: { blockId: 'b2' } });
});

test('keeps a mention mark through HTML export', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setDoc(value: string): void;
        setMentionProvider(provider: unknown): void;
        focus(blockId: string, offset?: number): void;
        getHTML(): string;
      };
    }).__editor;
    editor?.setDoc(
      JSON.stringify({
        version: 1,
        id: 'html-mention',
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
      })
    );
    void editor?.getHTML();
  });
  const html = await page.evaluate(() =>
    (window as unknown as { __editor?: { getHTML(): string } }).__editor?.getHTML()
  );
  expect(html).toContain('data-nb-mention-id="u1"');
  expect(html).toContain('data-nb-mention-label="Ada"');
});

test('keeps mentions atomic while typing and deleting', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'mention-atomic',
    title: '',
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        text: [
          { text: 'Hi ' },
          { text: '@Ada', marks: { mention: { id: 'u1', label: 'Ada' } } },
        ],
        props: {},
        children: [],
      },
    ],
  });
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { focus(blockId: string, offset?: number): void };
    }).__editor;
    editor?.focus('b1', 7);
  });
  await page.keyboard.type('!');

  let runs = (await getDoc(page)).blocks[0]?.runs ?? [];
  expect(runs.some(run => run.text === '!' && !run.marks?.mention)).toBe(true);
  expect(runs.some(run => run.marks?.mention && run.text === '@Ada')).toBe(true);

  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  runs = (await getDoc(page)).blocks[0]?.runs ?? [];
  expect(runs.some(run => run.marks?.mention)).toBe(false);
  expect(runs.map(run => run.text).join('')).toBe('Hi ');
});

test('preserves mentions when pasting exported HTML', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, textDoc('Paste target'));
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      'text/html',
      '<p>Hello <span data-nb-mention-id="u1" data-nb-mention-label="Ada">@Ada</span></p><p>Other</p>'
    );
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('.nb-text')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, clipboardData: data })
      );
  });
  await expect
    .poll(async () => (await getDoc(page)).blocks.length)
    .toBeGreaterThan(1);
  const doc = await getDoc(page);
  const pasted = doc.blocks.find(block =>
    block.runs.some(run => run.text.includes('@Ada'))
  );
  expect(pasted?.runs.some(run => run.marks?.mention)).toBe(true);
});

test('filters mention candidates after an async provider resolves', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, textDoc(''));
  await page.evaluate(() => {
    const queries: string[] = [];
    (window as unknown as { __mentionQueries: string[] }).__mentionQueries = queries;
    const editor = (window as unknown as {
      __editor?: {
        setMentionProvider(provider: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setMentionProvider({
      search: async (query: string) => {
        queries.push(query);
        await new Promise(resolve => setTimeout(resolve, 80));
        return query === 'b' ? [{ id: 'u2', label: 'Bob' }] : [];
      },
    });
    editor?.focus('b1', 0);
  });
  await page.keyboard.type('@b');
  await expect(page.locator('.nb-menu-item', { hasText: 'Bob' })).toBeVisible();
  await expect(page.locator('.nb-menu-item', { hasText: 'Ada' })).toHaveCount(0);
  const queries = await page.evaluate(
    () => (window as unknown as { __mentionQueries: string[] }).__mentionQueries
  );
  expect(queries).toContain('b');

  await page.locator('.nb-menu-item', { hasText: 'Bob' }).click();
  const runs = blockById(await getDoc(page), 'b1')?.runs ?? [];
  expect(runs.some(run => run.marks?.mention)).toBe(true);
});

test('closes the mention picker when the trigger is deleted', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, textDoc(''));
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setMentionProvider(provider: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setMentionProvider({
      search: () => [{ id: 'u1', label: 'Ada' }],
    });
    editor?.focus('b1', 0);
  });
  await page.keyboard.type('@');
  await expect(page.locator('.nb-menu')).toBeVisible();
  await page.keyboard.press('Backspace');
  await expect(page.locator('.nb-menu')).toHaveCount(0);
  expect(blockById(await getDoc(page), 'b1')?.text).toBe('');
});

test('does not open the mention picker inside code blocks', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, textDoc());
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setMentionProvider(provider: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setMentionProvider({
      search: () => [{ id: 'u1', label: 'Ada' }],
    });
    editor?.focus('code', 0);
  });
  await page.keyboard.type('@');
  await expect(page.locator('.nb-menu')).toHaveCount(0);
  expect(blockById(await getDoc(page), 'code')?.text).toContain('@');
});

test('keeps the mention range correct after deleting query text', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, textDoc('Hello'));
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setMentionProvider(provider: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    editor?.setMentionProvider({
      search: () => [{ id: 'u1', label: 'Ada' }],
    });
    editor?.focus('b1', 0);
  });
  await page.keyboard.type('@a');
  await expect(page.locator('.nb-menu')).toBeVisible();
  await page.keyboard.press('Backspace');
  await expect(page.locator('.nb-menu')).toBeVisible();
  await page.locator('.nb-menu-item', { hasText: 'Ada' }).click();

  const block = blockById(await getDoc(page), 'b1');
  expect(block?.text).toBe('@AdaHello');
  expect(block?.runs.some(run => run.marks?.mention)).toBe(true);
});

test('does not extend a mention when formatting is pending', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'mention-format',
    title: '',
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        text: [
          { text: 'Hi ' },
          { text: '@Ada', marks: { mention: { id: 'u1', label: 'Ada' } } },
        ],
        props: {},
        children: [],
      },
    ],
  });
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { focus(blockId: string, offset?: number): void };
    }).__editor;
    editor?.focus('b1', 7);
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('[data-block-id="b1"] .nb-text')
      ?.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'formatBold',
        })
      );
  });
  await page.keyboard.type('!');

  const runs = blockById(await getDoc(page), 'b1')?.runs ?? [];
  const typed = runs.find(run => run.text === '!');
  expect(typed?.marks?.bold).toBe(true);
  expect(typed?.marks?.mention).toBeUndefined();
});

test('keeps adjacent identical mentions as separate atomic references', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, {
    version: 1,
    id: 'mention-adjacent',
    title: '',
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        text: [
          { text: 'Hi ' },
          { text: '@Ada', marks: { mention: { id: 'u1', label: 'Ada' } } },
          { text: ' ' },
          { text: '@Ada', marks: { mention: { id: 'u1', label: 'Ada' } } },
        ],
        props: {},
        children: [],
      },
    ],
  });
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { focus(blockId: string, offset?: number): void };
    }).__editor;
    editor?.focus('b1', 8);
  });
  const mentionCount = async (): Promise<number> =>
    ((await getDoc(page)).blocks[0]?.runs ?? []).filter(run => run.marks?.mention).length;

  await page.keyboard.press('Backspace');
  await expect.poll(mentionCount).toBe(2);
  await page.keyboard.press('Backspace');
  await expect.poll(mentionCount).toBe(1);
  expect((await getDoc(page)).blocks[0]?.text).toBe('Hi @Ada');
});

test('enables code and callout pickers when readonly is turned off', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, textDoc());
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { setReadonly(value: boolean): void };
    }).__editor;
    editor?.setReadonly(true);
  });
  await expect(page.locator('.nb-code-lang')).toBeDisabled();
  await expect(page.locator('.nb-callout-tone')).toBeDisabled();
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { setReadonly(value: boolean): void };
    }).__editor;
    editor?.setReadonly(false);
  });
  await expect(page.locator('.nb-code-lang')).toBeEnabled();
  await expect(page.locator('.nb-callout-tone')).toBeEnabled();
});

test('accepts image file drags and ignores drops while readonly', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, textDoc('Drop target'));
  const setup = await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setUploadImage(handler: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    const calls: string[] = [];
    (window as unknown as { __uploadCalls: string[] }).__uploadCalls = calls;
    editor?.setUploadImage(async (file: File) => {
      calls.push(file.name);
      return { src: `https://example.com/${file.name}`, alt: file.name };
    });
    editor?.focus('b1', 0);
    const target = document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('[data-block-id="b1"] .nb-text');
    if (!target) return false;
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], 'drop.png', { type: 'image/png' })
    );
    const over = new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer: data,
    });
    target.dispatchEvent(over);
    target.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      })
    );
    return over.defaultPrevented;
  });
  expect(setup).toBe(true);
  await expect
    .poll(async () => {
      const doc = await getDoc(page);
      return doc.blocks.filter(block => block.type === 'image').length;
    })
    .toBe(1);

  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { setReadonly(value: boolean): void };
    }).__editor;
    editor?.setReadonly(true);
    const target = document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('[data-block-id="b1"] .nb-text');
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], 'readonly.png', {
        type: 'image/png',
      })
    );
    target?.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      })
    );
  });
  await page.waitForTimeout(100);
  expect(
    await page.evaluate(
      () => (window as unknown as { __uploadCalls: string[] }).__uploadCalls
    )
  ).toEqual(['drop.png']);
  expect((await getDoc(page)).blocks.filter(block => block.type === 'image')).toHaveLength(1);
});

test('does not insert an upload that finishes after readonly', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, textDoc('Late upload'));
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setUploadImage(handler: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    (window as unknown as { __uploadStarted: boolean }).__uploadStarted = false;
    editor?.setUploadImage(
      () =>
        new Promise(resolve => {
          (window as unknown as { __uploadStarted: boolean }).__uploadStarted = true;
          (window as unknown as { __finishUpload: () => void }).__finishUpload = () =>
            resolve({ src: 'https://example.com/late.png' });
        })
    );
    editor?.focus('b1', 0);
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], 'late.png', { type: 'image/png' })
    );
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('[data-block-id="b1"] .nb-text')
      ?.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          clipboardData: data,
        })
      );
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __uploadStarted: boolean }).__uploadStarted
      )
    )
    .toBe(true);
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { setReadonly(value: boolean): void };
    }).__editor;
    editor?.setReadonly(true);
    (window as unknown as { __finishUpload: () => void }).__finishUpload();
  });
  await page.waitForTimeout(100);
  expect((await getDoc(page)).blocks.some(block => block.type === 'image')).toBe(false);
});

test('does not apply a pending upload to a replaced document', async ({ page }) => {
  await openFixture(page);
  await setDoc(page, textDoc('Original'));
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: {
        setUploadImage(handler: unknown): void;
        focus(blockId: string, offset?: number): void;
      };
    }).__editor;
    (window as unknown as { __uploadStarted: boolean }).__uploadStarted = false;
    editor?.setUploadImage(
      () =>
        new Promise(resolve => {
          (window as unknown as { __uploadStarted: boolean }).__uploadStarted = true;
          (window as unknown as { __finishUpload: () => void }).__finishUpload = () =>
            resolve({ src: 'https://example.com/replaced.png' });
        })
    );
    editor?.focus('b1', 0);
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], 'replaced.png', {
        type: 'image/png',
      })
    );
    document
      .querySelector('nobita-editor')
      ?.shadowRoot?.querySelector('[data-block-id="b1"] .nb-text')
      ?.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          clipboardData: data,
        })
      );
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __uploadStarted: boolean }).__uploadStarted
      )
    )
    .toBe(true);
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __editor?: { setDoc(value: string): void };
    }).__editor;
    editor?.setDoc(
      JSON.stringify({
        version: 1,
        id: 'replacement',
        title: '',
        blocks: [
          {
            id: 'b1',
            type: 'paragraph',
            text: [{ text: 'Replaced' }],
            props: {},
            children: [],
          },
        ],
      })
    );
    (window as unknown as { __finishUpload: () => void }).__finishUpload();
  });
  await page.waitForTimeout(100);
  const doc = await getDoc(page);
  expect(doc.blocks.some(block => block.type === 'image')).toBe(false);
  expect(blockById(doc, 'b1')?.text).toBe('Replaced');
});
