import {
  createBlock,
  createDatabaseColumn,
  createDatabaseRow,
  createDatabaseView,
  createDoc,
  createTableData,
  parseDoc,
  parseInlineMarkdown,
  createId,
  duplicateBlockTree,
  type Block,
  type CalloutTone,
  type DatabaseView,
  type Doc,
  type HeadingLevel,
} from '@nobita/core';

export interface PageRecord {
  doc: Doc;
  parentId: string | null;
  favorite: boolean;
  order?: number;
  updatedAt: number;
}

export interface DemoState {
  pages: Record<string, PageRecord>;
  activeId: string | null;
  theme: 'light' | 'dark';
}

const STORAGE_KEY = 'nobita.demo.v2';

const paragraph = (markdown: string): Block =>
  createBlock('paragraph', { text: parseInlineMarkdown(markdown) });

const heading = (level: HeadingLevel, markdown: string): Block =>
  createBlock('heading', { text: parseInlineMarkdown(markdown), props: { level } });

const bulleted = (markdown: string, children: Block[] = []): Block =>
  createBlock('bulleted', { text: parseInlineMarkdown(markdown), children });

const numbered = (markdown: string, children: Block[] = []): Block =>
  createBlock('numbered', { text: parseInlineMarkdown(markdown), children });

const todo = (markdown: string, checked = false): Block =>
  createBlock('todo', { text: parseInlineMarkdown(markdown), props: { checked } });

const quote = (markdown: string): Block =>
  createBlock('quote', { text: parseInlineMarkdown(markdown) });

const callout = (markdown: string, tone: CalloutTone = 'info'): Block =>
  createBlock('callout', { text: parseInlineMarkdown(markdown), props: { tone } });

const code = (text: string, language = 'ts'): Block =>
  createBlock('code', { text, props: { language } });

const divider = (): Block => createBlock('divider');

const pageCard = (pageId: string, pageTitle: string, pageIcon?: string): Block =>
  createBlock('page', {
    props: {
      pageId,
      pageTitle,
      ...(pageIcon ? { pageIcon } : {}),
    },
  });

const database = (
  _variant: 'table' | 'database',
  columns: ReturnType<typeof createDatabaseColumn>[],
  rows: ReturnType<typeof createDatabaseRow>[],
  views?: DatabaseView[],
  activeViewId?: string,
  title?: string
): Block =>
  createBlock('database', {
    props: {
      database: {
        variant: 'database',
        ...(title ? { title } : {}),
        columns,
        rows,
        ...(views ? { views } : {}),
        ...(activeViewId ? { activeViewId } : {}),
      },
    },
  });

const simpleTable = (rows: string[][]): Block => {
  const table = createTableData({ rows: rows.length, columns: rows[0]?.length ?? 1 });
  rows.forEach((values, rowIndex) => {
    const row = table.rows[rowIndex];
    if (!row) return;
    values.forEach((text, columnIndex) => {
      const column = table.columns[columnIndex];
      if (column && text) row.cells[column.id] = { text };
    });
  });
  return createBlock('table', { props: { table } });
};

function page(
  id: string,
  title: string,
  icon: string,
  parentId: string | null,
  blocks: Block[],
  favorite = false
): PageRecord {
  return {
    doc: createDoc({ id, title, icon, blocks }),
    parentId,
    favorite,
    updatedAt: Date.now(),
  };
}

export function createSeedState(): DemoState {
  const pages: Record<string, PageRecord> = {};

  pages['getting-started'] = page(
    'getting-started',
    'Getting started',
    '👋',
    null,
    [
      callout(
        '**Welcome to Nobita.** A fast, lightweight, Notion-like editor that drops into any web app. Everything on this page is a block, and the whole document is plain JSON you own.',
        'info'
      ),
      heading(2, 'A canvas that feels instant'),
      paragraph(
        'Nobita renders each block directly, keeps a **zero-dependency core**, and ships as a `<nobita-editor>` web component with a shadow root and themeable CSS variables.'
      ),
      bulleted('**Local-first by default** — persist JSON wherever you like.', [
        bulleted('`localStorage`, IndexedDB, your API, a file…'),
        bulleted('Undo history is structural and cheap.'),
      ]),
      bulleted('**Framework agnostic** — plain DOM, no Lit, React, or ProseMirror.'),
      bulleted('**Small surface** — 13 block types, one dependency-free package.'),
      heading(3, 'Try the controls'),
      todo('Type `/` anywhere to open the block menu', false),
      todo('Type `[[` to link another page or create a new one', false),
      todo('Drag the handle in the left gutter to reorder blocks', false),
      todo('Select text to reveal the formatting toolbar', false),
      todo('Press `⌘K` to search pages and content, `⌘N` for a new page', true),
      createBlock('todo', {
        text: [
          { text: 'Open ' },
          {
            text: 'Data views',
            marks: { page: { id: 'data-views', title: 'Data views', icon: '📊' } },
          },
          { text: ' to inspect typed tables and databases' },
        ],
        props: { checked: false },
      }),
      quote('The best editor is the one that disappears while you write.'),
      code(
        `const doc = editor.getDoc();

// Persist it anywhere. No vendor lock-in.
await fetch('/api/docs/' + doc.id, {
  method: 'PUT',
  body: JSON.stringify(doc),
});`,
        'ts'
      ),
      divider(),
      heading(3, 'Explore this workspace'),
      createBlock('paragraph', {
        text: [
          { text: 'Jump to ' },
          {
            text: 'Design principles',
            marks: { page: { id: 'design-principles', title: 'Design principles', icon: '🎨' } },
          },
          { text: ' or ' },
          {
            text: 'Keyboard shortcuts',
            marks: { page: { id: 'shortcuts', title: 'Keyboard shortcuts', icon: '⌨️' } },
          },
          { text: ' — linked pages automatically track backlinks at the bottom of each page.' },
        ],
      }),
      pageCard('embedding-guide', 'Embedding guide', '🧩'),
      pageCard('data-views', 'Data views', '📊'),
      callout(
        'Next: open **Embedding guide** above or in the sidebar to see how little code it takes to put Nobita inside your own product.',
        'success'
      ),    ],
    true
  );

  pages['embedding-guide'] = page(
    'embedding-guide',
    'Embedding guide',
    '🧩',
    'getting-started',
    [
      heading(2, 'Install'),
      paragraph('Nobita is a workspace package in this repository. In your app:'),
      code('pnpm add @nobita/element @nobita/core', 'bash'),
      heading(2, 'Use the web component'),
      code(
        `import '@nobita/element';

const editor = document.querySelector('nobita-editor');
editor.doc = await (await fetch('/doc.json')).json();

editor.addEventListener('nobita-change', event => {
  save(event.detail.doc);
});`,
        'ts'
      ),
      heading(2, 'Or create it imperatively'),
      code(
        `import { createEditor } from '@nobita/element';

const editor = createEditor(document.querySelector('#editor'), {
  doc: await fetch('/doc.json').then(r => r.json()),
  theme: 'auto',
  placeholder: 'Start writing…',
  onChange(doc) {
    localStorage.setItem('doc', JSON.stringify(doc));
  },
});`,
        'ts'
      ),
      heading(2, 'Theme it'),
      paragraph(
        'Every colour, radius and font is a CSS custom property. Override them on the host element; the shadow DOM keeps your app styles out and Nobita styles in.'
      ),
      code(
        `nobita-editor {
  --nb-accent: #0f766e;
  --nb-font: 'Newsreader', serif;
  --nb-page-width: 760px;
}`,
        'css'
      ),
      callout(
        'Nobita uses no global styles. The only thing it adds to your page is the custom element itself.',
        'info'
      ),
    ]
  );

  pages['shortcuts'] = page(
    'shortcuts',
    'Keyboard shortcuts',
    '⌨️',
    'getting-started',
    [
      heading(2, 'Block editing'),
      bulleted('`Enter` — new block, `Shift+Enter` — soft line break'),
      bulleted('`Backspace` at the start — merge or convert to text'),
      bulleted('`Tab` / `Shift+Tab` — indent / outdent'),
      bulleted('`⌘Backspace` — outdent all the way to the root'),
      bulleted('`⌘⌥↑` / `⌘⌥↓` — move the block'),
      bulleted('`⌘Enter` — insert a block below'),
      heading(2, 'Formatting'),
      bulleted('`⌘B` bold, `⌘I` italic, `⌘U` underline'),
      bulleted('`⌘⇧S` strikethrough, `⌘E` inline code'),
      bulleted('`⌘K` link'),
      bulleted('`⌘⇧L` / `⌘⇧E` / `⌘⇧R` — align left / center / right'),
      bulleted('`⌘Z` / `⌘⇧Z` undo / redo'),
      heading(2, 'Block types'),
      bulleted('`⌘⌥0..6` — text, heading 1–6'),
      bulleted('`⌘⌥8` — bulleted list, `⌘⌥9` — numbered list'),
      bulleted('`⌘⌥C` — code block'),
      bulleted('`/today`, `/tomorrow`, `/yesterday`, `/now` — insert a date or time'),
      heading(2, 'Markdown'),
      paragraph(
        'Type `# `, `## `, `- `, `1. `, `[] `, `> `, ` ``` `, or `--- ` at the start of a line. Inline `**bold**`, `*italic*`, `` `code` ``, `~~strike~~` and `[links](https://example.com)` convert when you close them.'
      ),
      quote('Muscle memory is a feature. Nobita keeps the shortcuts you already know.'),
    ]
  );

  pages['design-principles'] = page(
    'design-principles',
    'Design principles',
    '🎨',
    null,
    [
      heading(2, 'Fast is a design choice'),
      paragraph(
        'Nobita does not ship a virtual DOM, a component framework, or a CRDT in the base build. Each block owns a small DOM subtree, and updates copy only the path that changed.'
      ),
      bulleted('**Predictable input** — `beforeinput` is intercepted; the browser never owns the document.'),
      bulleted('**Cheap snapshots** — immutable path copies make undo a pointer swap.'),
      bulleted('**Shadow DOM** — host styles cannot leak in; Nobita styles cannot leak out.'),
      heading(2, 'Quiet by default'),
      paragraph(
        'The chrome appears when you need it: gutters on hover, a toolbar on selection, a slash menu when you ask. The writing surface stays still.'
      ),
      heading(2, 'Own your data'),
      paragraph(
        'A Nobita document is JSON with stable block ids, inline runs and plain props. There is no proprietary binary format and no required service.'
      ),
      callout(
        'Collaboration is an adapter boundary, not a dependency. Wire the document into Yjs, Automerge, or your own socket protocol when you need it.',
        'warning'
      ),
    ],
    true
  );

  const task = { ...createDatabaseColumn('Task'), width: 186 };
  const status = {
    ...createDatabaseColumn('Status', 'select', ['Todo', 'In progress', 'Done']),
    width: 130,
  };
  const owner = { ...createDatabaseColumn('Owner'), width: 120 };
  const due = { ...createDatabaseColumn('Due', 'date'), width: 120 };
  const done = { ...createDatabaseColumn('Done', 'checkbox'), width: 86 };
  const columns = [
    { id: task.id, width: 186 },
    { id: status.id, width: 130 },
    { id: owner.id, width: 120 },
    { id: due.id, width: 120 },
    { id: done.id, width: 86 },
  ];
  const tableView = createDatabaseView('table', 'Table');
  tableView.columns = columns;
  const boardView = createDatabaseView('board', 'Board');
  boardView.groupBy = status.id;
  boardView.columns = columns;

  const rows = [
    createDatabaseRow({
      [task.id]: { text: 'Ship the data view' },
      [status.id]: { text: 'In progress' },
      [owner.id]: { text: 'Ada' },
      [due.id]: { text: '2026-12-01' },
    }),
    createDatabaseRow({
      [task.id]: { text: 'Write markdown round-trip' },
      [status.id]: { text: 'Done' },
      [owner.id]: { text: 'Lin' },
      [due.id]: { text: '2026-11-28' },
      [done.id]: { checked: true },
    }),
    createDatabaseRow({
      [task.id]: { text: 'Board view' },
      [status.id]: { text: 'Todo' },
      [owner.id]: { text: 'You' },
    }),
    createDatabaseRow({
      [task.id]: { text: 'Filter and group' },
      [status.id]: { text: 'Todo' },
      [owner.id]: { text: 'Unassigned' },
    }),
  ];
  rows[0]!.cells[task.id] = {
    text: 'Ship the data view',
    runs: parseInlineMarkdown('**Ship** the data view'),
  };
  rows[1]!.cells[task.id] = {
    text: 'Write markdown round-trip',
    runs: parseInlineMarkdown('Write `markdown` round-trip'),
  };
  rows[0]!.page = {
    content: [
      { text: 'Launch checklist\n', marks: { bold: true } },
      { text: 'Review the table, then open the board view.' },
    ],
  };

  pages['data-views'] = page(
    'data-views',
    'Data views',
    '📊',
    null,
    [
      paragraph(
        'Simple tables and typed databases are separate blocks. Databases add table and board views, rich-text cells and editable record pages — all stored as plain JSON.'
      ),
      heading(2, 'Roadmap database'),
      database(
        'database',
        [task, status, owner, due, done],
        rows,
        [tableView, boardView],
        tableView.id,
        'Roadmap'
      ),
      heading(2, 'Simple table'),
      simpleTable([
        ['Slash menu', '/', 'Insert any block'],
        ['Block menu', 'Click ⠿', 'Turn into, duplicate, delete'],
        ['Move block', '⌘⌥↑ / ↓', 'Reorder without dragging'],
      ]),
      paragraph(
        'Hover simple table edges to add rows or columns. The database above supports table and board views, rich-text cells, record pages, filters, multi-sort, search, grouping and statistics.'
      ),
    ],
    true
  );

  return { pages, activeId: 'getting-started', theme: 'light' };
}

export function loadState(): DemoState {
  if (typeof localStorage === 'undefined') return createSeedState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedState();
    const parsed = JSON.parse(raw) as {
      pages?: Record<
        string,
        { doc?: unknown; parentId?: string | null; favorite?: boolean; order?: number; updatedAt?: number }
      >;
      activeId?: string | null;
      theme?: string;
    };
    const pages: Record<string, PageRecord> = {};
    for (const [id, record] of Object.entries(parsed.pages ?? {})) {
      if (!record || typeof record !== 'object') continue;
      const doc = parseDoc(record.doc);
      pages[id] = {
        doc: { ...doc, id },
        parentId: typeof record.parentId === 'string' ? record.parentId : null,
        favorite: Boolean(record.favorite),
        ...(typeof record.order === 'number' && Number.isFinite(record.order)
          ? { order: record.order }
          : {}),
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
      };
    }
    if (Object.keys(pages).length === 0) return createSeedState();
    const activeId =
      typeof parsed.activeId === 'string' && pages[parsed.activeId]
        ? parsed.activeId
        : (Object.keys(pages)[0] ?? null);
    return {
      pages,
      activeId,
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
    };
  } catch {
    return createSeedState();
  }
}

export function saveState(state: DemoState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full quota should not break editing.
  }
}

export function duplicatePageRecord(record: PageRecord, parentId = record.parentId): PageRecord {
  const doc: Doc = {
    ...record.doc,
    id: createId('d'),
    title: record.doc.title ? `${record.doc.title} copy` : 'Untitled',
    blocks: record.doc.blocks.map(duplicateBlockTree),
  };
  return {
    doc,
    parentId,
    favorite: false,
    updatedAt: Date.now(),
  };
}
