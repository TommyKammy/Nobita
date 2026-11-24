import {
  NobitaEditor,
  createEditor,
  icon,
  type NobitaTheme,
} from '@nobita/element';
import { demoIcon } from './icons';
import {
  blocksToMarkdown,
  cloneDoc,
  countWords,
  createBlock,
  createDoc,
  docToJSON,
  type Doc,
} from '@nobita/core';
import {
  createSeedState,
  duplicatePageRecord,
  loadState,
  saveState,
  type PageRecord,
} from './store';
import './styles.css';

const state = loadState();
if (Object.keys(state.pages).length === 0) Object.assign(state, createSeedState());

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root missing');

app.innerHTML = `
  <div class="app" id="shell">
    <div class="sidebar-scrim" id="scrim"></div>
    <aside class="sidebar" aria-label="Workspace">
      <div class="brand-row">
        <div class="logo" aria-hidden="true">N</div>
        <div class="brand-name">Nobita</div>
        <span class="brand-tag">beta</span>
      </div>
      <button class="search-trigger" id="search-trigger" aria-label="Search pages">
        ${demoIcon.search}<span>Search</span><kbd>⌘K</kbd>
      </button>
      <nav class="nav-list" aria-label="Views">
        <button class="nav-item" data-view="all" data-active="true">
          ${demoIcon.file}<span>All docs</span><span class="count" id="doc-count">0</span>
        </button>
        <button class="nav-item" data-view="favorites">
          ${demoIcon.star}<span>Favorites</span>
        </button>
      </nav>
      <div class="sidebar-scroll">
        <div class="section-head">
          <span id="section-label">Pages</span>
          <button id="new-page" title="New page (⌘N)" aria-label="New page">${icon.plus}</button>
        </div>
        <div id="page-tree"></div>
      </div>
      <div class="sidebar-foot">
        <button class="foot-btn" id="theme-toggle">${demoIcon.moon}<span>Dark mode</span></button>
        <span class="version">v0.1</span>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <button class="icon-btn mobile-only" id="menu-toggle" aria-label="Open sidebar">${icon.text}</button>
        <div class="crumbs" id="crumbs"></div>
        <span class="topbar-spacer"></span>
        <span class="save-status" id="save-status" data-state="saved">
          <span class="save-dot"></span><span id="save-text">Saved</span>
        </span>
        <button class="icon-btn" id="favorite" aria-label="Toggle favorite" title="Favorite">${demoIcon.star}</button>
        <button class="icon-btn" id="page-menu" aria-label="Page actions" title="Page actions">${icon.more}</button>
        <button class="share-btn" id="embed-btn" title="Embed this editor">${demoIcon.external}<span>Embed</span></button>
      </header>
      <div class="editor-scroll" id="editor-scroll">
        <div id="editor-host"></div>
        <div class="empty-state" id="empty-state" hidden>
          <div class="empty-icon">${demoIcon.file}</div>
          <h2>No page open</h2>
          <p>Choose a page from the sidebar, or start something new. Nobita keeps every document as plain JSON.</p>
          <button class="primary-btn" id="empty-new">New page</button>
        </div>
      </div>
    </main>
  </div>
  <div id="modal-root"></div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
`;

const $ = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const shell = $('#shell');
const pageTree = $('#page-tree') as HTMLDivElement;
const docCount = $('#doc-count') as HTMLElement;
const sectionLabel = $('#section-label') as HTMLElement;
const crumbs = $('#crumbs') as HTMLDivElement;
const favoriteButton = $('#favorite') as HTMLButtonElement;
const pageMenuButton = $('#page-menu') as HTMLButtonElement;
const saveStatus = $('#save-status') as HTMLElement;
const saveText = $('#save-text') as HTMLElement;
const editorHost = $('#editor-host') as HTMLDivElement;
const editorScroll = $('#editor-scroll') as HTMLDivElement;
const emptyState = $('#empty-state') as HTMLDivElement;
const modalRoot = $('#modal-root') as HTMLDivElement;
const toastElement = $('#toast') as HTMLDivElement;

let currentView: 'all' | 'favorites' = 'all';
let editor: NobitaEditor | null = null;
let saving = false;
let saveTimer = 0;
let toastTimer = 0;
const collapsed = new Set<string>();
let closePopup: (() => void) | null = null;
let closeModal: (() => void) | null = null;

const activeRecord = (): PageRecord | null =>
  state.activeId ? state.pages[state.activeId] ?? null : null;

const titleOf = (record: PageRecord): string => record.doc.title.trim() || 'Untitled';

function pagePath(id: string): string[] {
  const out: string[] = [];
  let cursor = state.pages[id]?.parentId ?? null;
  let guard = 0;
  while (cursor && state.pages[cursor] && guard < 32) {
    out.unshift(titleOf(state.pages[cursor]!));
    cursor = state.pages[cursor]!.parentId;
    guard += 1;
  }
  return out;
}

function childrenOf(parentId: string | null): [string, PageRecord][] {
  return Object.entries(state.pages)
    .filter(([, record]) => record.parentId === parentId)
    .sort((a, b) => {
      if (a[1].favorite !== b[1].favorite) return a[1].favorite ? -1 : 1;
      return a[1].updatedAt - b[1].updatedAt;
    });
}

function descendants(id: string): string[] {
  const out: string[] = [id];
  const seen = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;
    for (const [childId, record] of Object.entries(state.pages)) {
      if (record.parentId === current && !seen.has(childId)) {
        seen.add(childId);
        out.push(childId);
        queue.push(childId);
      }
    }
  }
  return out;
}

function iconFor(record: PageRecord): string {
  if (record.doc.icon) {
    const span = document.createElement('span');
    span.textContent = record.doc.icon;
    return span.outerHTML;
  }
  return demoIcon.file;
}

/* ---------------- editor ---------------- */

function mountEditor(): void {
  const record = activeRecord();
  if (!record) {
    editorHost.hidden = true;
    emptyState.hidden = false;
    crumbs.replaceChildren();
    favoriteButton.dataset.active = 'false';
    return;
  }
  editorHost.hidden = false;
  emptyState.hidden = true;

  if (!editor) {
    editor = createEditor(editorHost, {
      doc: record.doc,
      theme: state.theme,
      placeholder: "Type '/' for commands",
      autofocus: false,
      onChange: (doc, meta) => handleDocChange(doc, meta.source),
      onSelectionChange: () => updateStats(),
    });
    editor.setTheme(state.theme);
    (editorHost as HTMLElement & { __nobita?: NobitaEditor }).__nobita = editor;
  } else {
    editor.setDoc(record.doc);
  }
  editorScroll.scrollTop = 0;
}


function handleDocChange(doc: Doc, source: string): void {
  const id = state.activeId;
  if (!id) return;
  const record = state.pages[id];
  if (!record) return;
  const titleChanged = record.doc.title !== doc.title;
  record.doc = doc;
  if (source !== 'replace') record.updatedAt = Date.now();
  if (source !== 'replace' && source !== 'set-title') {
    scheduleSave();
    updateStats();
  }
  if (titleChanged) {
    const row = pageTree.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(id)}"]`);
    const title = row?.querySelector<HTMLElement>('.page-title');
    if (title) {
      title.textContent = titleOf(record);
      title.classList.toggle('is-empty', !doc.title.trim());
    }
    renderCrumbs();
    document.title = `${titleOf(record)} · Nobita`;
  }
}

function scheduleSave(): void {
  saving = true;
  updateStats();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveState(state);
    saving = false;
    updateStats();
  }, 420);
}

function updateStats(): void {
  const doc = editor?.getDoc() ?? activeRecord()?.doc;
  const words = doc ? countWords(doc) : 0;
  const label = words === 1 ? '1 word' : `${words} words`;
  saveStatus.dataset.state = saving ? 'saving' : 'saved';
  saveText.textContent = saving ? 'Saving…' : `Saved · ${label}`;
}

function openPage(id: string): void {
  if (!state.pages[id]) return;
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    saveState(state);
    saving = false;
  }
  state.activeId = id;
  collapsed.delete(id);
  saveState(state);
  if (editor) editor.setDoc(state.pages[id]!.doc);
  else mountEditor();
  editorHost.hidden = false;
  emptyState.hidden = true;
  renderTree();
  renderCrumbs();
  renderFavorite();
  updateStats();
  editorScroll.scrollTop = 0;
  if (window.innerWidth <= 880) shell.classList.remove('sidebar-open');
}

function newPage(parentId: string | null = null): void {
  const doc = createDoc({ title: '', blocks: [createBlock('paragraph')] });
  state.pages[doc.id] = {
    doc,
    parentId,
    favorite: false,
    updatedAt: Date.now(),
  };
  state.activeId = doc.id;
  saveState(state);
  mountEditor();
  renderTree();
  renderCrumbs();
  renderFavorite();
  updateStats();
  editor?.focusTitle();
}

/* ---------------- sidebar ---------------- */

function renderTree(): void {
  pageTree.replaceChildren();
  sectionLabel.textContent = currentView === 'favorites' ? 'Favorites' : 'Pages';
  docCount.textContent = String(Object.keys(state.pages).length);
  for (const button of document.querySelectorAll<HTMLElement>('.nav-item')) {
    button.dataset.active = String(button.dataset.view === currentView);
  }

  if (currentView === 'favorites') {
    const favorites = Object.entries(state.pages)
      .filter(([, record]) => record.favorite)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    if (favorites.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-empty';
      empty.textContent = 'No favorites yet. Star a page to keep it close.';
      pageTree.append(empty);
      return;
    }
    for (const [id, record] of favorites) pageTree.append(pageRow(id, record, 0, false));
    return;
  }

  const renderLevel = (parentId: string | null, depth: number): void => {
    const children = childrenOf(parentId);
    for (const [id, record] of children) {
      pageTree.append(pageRow(id, record, depth, true));
      if (!collapsed.has(id)) renderLevel(id, depth + 1);
    }
  };
  renderLevel(null, 0);

  if (pageTree.childElementCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = 'No pages yet. Press ⌘N or + to create one.';
    pageTree.append(empty);
  }
}

function pageRow(id: string, record: PageRecord, depth: number, showTree: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'page-row';
  row.dataset.active = String(state.activeId === id);
  row.dataset.pageId = id;
  row.style.paddingLeft = `${4 + depth * 13}px`;
  row.tabIndex = 0;
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-selected', String(state.activeId === id));

  const hasChildren = childrenOf(id).length > 0;
  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = `page-chevron${hasChildren ? '' : ' is-empty'}`;
  chevron.dataset.open = String(!collapsed.has(id));
  chevron.innerHTML = icon.chevron;
  chevron.setAttribute('aria-label', collapsed.has(id) ? 'Expand page' : 'Collapse page');
  if (!hasChildren) {
    chevron.style.visibility = 'hidden';
  } else {
    chevron.addEventListener('click', event => {
      event.stopPropagation();
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
      renderTree();
    });
  }

  const iconElement = document.createElement('span');
  iconElement.className = 'page-icon';
  iconElement.innerHTML = iconFor(record);

  const title = document.createElement('span');
  title.className = `page-title${record.doc.title.trim() ? '' : ' is-empty'}`;
  title.textContent = titleOf(record);

  const actions = document.createElement('span');
  actions.className = 'page-actions';
  if (showTree) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'page-action';
    add.title = 'Add nested page';
    add.setAttribute('aria-label', 'Add nested page');
    add.innerHTML = icon.plus;
    add.addEventListener('click', event => {
      event.stopPropagation();
      collapsed.delete(id);
      newPage(id);
    });
    actions.append(add);
  }
  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'page-action';
  menu.title = 'Page actions';
  menu.setAttribute('aria-label', 'Page actions');
  menu.innerHTML = icon.more;
  menu.addEventListener('click', event => {
    event.stopPropagation();
    openPageMenu(id, menu);
  });
  actions.append(menu);

  row.append(chevron, iconElement, title, actions);
  row.addEventListener('click', () => openPage(id));
  row.addEventListener('dblclick', () => {
    const next = window.prompt('Page title', record.doc.title);
    if (next === null) return;
    renamePage(id, next);
  });
  row.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPage(id);
    }
  });
  return row;
}

function renderCrumbs(): void {
  crumbs.replaceChildren();
  const record = activeRecord();
  if (!record || !state.activeId) return;
  const path = pagePath(state.activeId);
  const ancestors: [string, PageRecord][] = [];
  let cursor = record.parentId;
  let guard = 0;
  while (cursor && state.pages[cursor] && guard < 32) {
    ancestors.unshift([cursor, state.pages[cursor]!]);
    cursor = state.pages[cursor]!.parentId;
    guard += 1;
  }
  ancestors.forEach(([id, parent]) => {
    const button = document.createElement('button');
    button.className = 'crumb';
    button.textContent = titleOf(parent);
    button.addEventListener('click', () => openPage(id));
    crumbs.append(button, separator());
  });
  const current = document.createElement('span');
  current.className = 'crumb current';
  current.textContent = titleOf(record);
  crumbs.append(current);
  document.title = `${titleOf(record)} · Nobita`;
  void path;
}

function separator(): HTMLElement {
  const span = document.createElement('span');
  span.className = 'crumb-sep';
  span.textContent = '/';
  return span;
}

function renderFavorite(): void {
  const record = activeRecord();
  favoriteButton.dataset.active = String(Boolean(record?.favorite));
  favoriteButton.setAttribute('aria-pressed', String(Boolean(record?.favorite)));
}

function renamePage(id: string, title: string): void {
  const record = state.pages[id];
  if (!record) return;
  record.doc = { ...record.doc, title };
  record.updatedAt = Date.now();
  saveState(state);
  if (state.activeId === id) editor?.setTitle(title);
  renderTree();
  renderCrumbs();
  updateStats();
}

/* ---------------- popups ---------------- */

interface PopupItem {
  label?: string;
  icon?: string;
  danger?: boolean;
  action?: () => void;
  separator?: boolean;
}

function showPopup(anchor: HTMLElement, items: PopupItem[]): void {
  closePopup?.();
  const element = document.createElement('div');
  element.className = 'popup';
  element.setAttribute('role', 'menu');

  for (const item of items) {
    if (item.separator) {
      const line = document.createElement('div');
      line.className = 'popup-sep';
      element.append(line);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `popup-item${item.danger ? ' danger' : ''}`;
    button.setAttribute('role', 'menuitem');
    if (item.icon) {
      const iconElement = document.createElement('span');
      iconElement.innerHTML = item.icon;
      button.append(iconElement);
    }
    const label = document.createElement('span');
    label.textContent = item.label ?? '';
    button.append(label);
    button.addEventListener('click', () => {
      close();
      item.action?.();
    });
    element.append(button);
  }

  document.body.append(element);
  const rect = anchor.getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  let left = Math.min(rect.left, window.innerWidth - width - 10);
  left = Math.max(10, left);
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 10) top = Math.max(10, rect.top - height - 6);
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.composedPath().includes(element)) return;
    close();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  const onScroll = (): void => close();

  function close(): void {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onScroll, true);
    element.remove();
    if (closePopup === close) closePopup = null;
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onScroll, true);
  closePopup = close;
}

function openPageMenu(id: string, anchor: HTMLElement): void {
  const record = state.pages[id];
  if (!record) return;
  showPopup(anchor, [
    { label: 'Duplicate', icon: icon.duplicate, action: () => duplicatePage(id) },
    { label: 'Export Markdown', icon: icon.copy, action: () => exportMarkdown(id) },
    { label: 'Export JSON', icon: demoIcon.file, action: () => exportJSON(id) },
    { separator: true },
    { label: 'Delete', icon: icon.trash, danger: true, action: () => deletePage(id) },
  ]);
}

function topbarMenu(): void {
  const id = state.activeId;
  if (!id) return;
  const record = state.pages[id];
  if (!record) return;
  showPopup(pageMenuButton, [
    { label: 'Rename', icon: icon.text, action: () => {
      const next = window.prompt('Page title', record.doc.title);
      if (next !== null) renamePage(id, next);
    } },
    { label: 'Duplicate', icon: icon.duplicate, action: () => duplicatePage(id) },
    { label: 'Export Markdown', icon: icon.copy, action: () => exportMarkdown(id) },
    { label: 'Export JSON', icon: demoIcon.file, action: () => exportJSON(id) },
    { separator: true },
    { label: 'Delete page', icon: icon.trash, danger: true, action: () => deletePage(id) },
  ]);
}

/* ---------------- page operations ---------------- */

function duplicatePage(id: string): void {
  const record = state.pages[id];
  if (!record) return;
  const copy = duplicatePageRecord(record);
  state.pages[copy.doc.id] = copy;
  saveState(state);
  renderTree();
  openPage(copy.doc.id);
  showToast('Page duplicated');
}

function deletePage(id: string): void {
  const record = state.pages[id];
  if (!record) return;
  const label = titleOf(record);
  if (!window.confirm(`Delete “${label}” and its nested pages?`)) return;
  const ids = descendants(id);
  for (const childId of ids) delete state.pages[childId];
  if (state.activeId && ids.includes(state.activeId)) {
    state.activeId = Object.keys(state.pages)[0] ?? null;
  }
  saveState(state);
  renderTree();
  if (!state.activeId) {
    editor?.setDoc(createDoc());
    editorHost.hidden = true;
    emptyState.hidden = false;
    updateStats();
  } else {
    openPage(state.activeId);
  }
  renderFavorite();
  showToast('Page deleted');
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(title: string): string {
  return (title.trim() || 'untitled').replace(/[\\/:*?"<>|]+/gu, '-').slice(0, 80);
}

function exportMarkdown(id: string): void {
  const record = state.pages[id];
  if (!record) return;
  download(`${safeFilename(record.doc.title)}.md`, blocksToMarkdown(record.doc), 'text/markdown');
  showToast('Markdown exported');
}

function exportJSON(id: string): void {
  const record = state.pages[id];
  if (!record) return;
  download(`${safeFilename(record.doc.title)}.json`, docToJSON(record.doc, true), 'application/json');
  showToast('JSON exported');
}

/* ---------------- search palette ---------------- */

function openSearch(): void {
  closeModal?.();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="palette" role="dialog" aria-modal="true" aria-label="Search pages">
      <div class="palette-input-row">
        ${demoIcon.search}
        <input class="palette-input" placeholder="Search pages…" aria-label="Search pages" />
        <button class="icon-btn" data-close aria-label="Close">${icon.x}</button>
      </div>
      <div class="palette-list"></div>
      <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
    </div>
  `;
  const input = backdrop.querySelector<HTMLInputElement>('.palette-input');
  const list = backdrop.querySelector<HTMLDivElement>('.palette-list');
  if (!input || !list) return;

  let results: [string, PageRecord][] = [];
  let active = 0;

  const render = (): void => {
    list.replaceChildren();
    if (results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = 'No matching pages';
      list.append(empty);
      return;
    }
    const group = document.createElement('div');
    group.className = 'palette-group';
    group.textContent = 'Pages';
    list.append(group);
    results.forEach(([id, record], index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'palette-item';
      button.dataset.active = String(index === active);
      const iconElement = document.createElement('span');
      iconElement.className = 'p-icon';
      iconElement.innerHTML = iconFor(record);
      const title = document.createElement('span');
      title.className = 'p-title';
      title.textContent = titleOf(record);
      const path = document.createElement('span');
      path.className = 'p-path';
      path.textContent = pagePath(id).join(' / ');
      button.append(iconElement, title, path);
      button.addEventListener('click', () => {
        close();
        openPage(id);
      });
      list.append(button);
    });
    const activeElement = list.querySelector<HTMLElement>(`[data-active="true"]`);
    activeElement?.scrollIntoView({ block: 'nearest' });
  };

  const filter = (query: string): void => {
    const needle = query.trim().toLowerCase();
    results = Object.entries(state.pages)
      .filter(([, record]) => !needle || titleOf(record).toLowerCase().includes(needle))
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    active = 0;
    render();
  };

  input.addEventListener('input', () => filter(input.value));
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (results.length > 0) active = (active + 1) % results.length;
      render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length > 0) active = (active - 1 + results.length) % results.length;
      render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const id = results[active]?.[0];
      if (id) {
        close();
        openPage(id);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  const onBackdrop = (event: PointerEvent): void => {
    if (event.target === backdrop) close();
  };

  function close(): void {
    backdrop.remove();
    document.removeEventListener('keydown', onDocumentKey);
    closeModal = null;
  }

  const onDocumentKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  backdrop.addEventListener('pointerdown', onBackdrop);
  backdrop.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', close);
  modalRoot.append(backdrop);
  document.addEventListener('keydown', onDocumentKey);
  closeModal = close;
  filter('');
  input.focus();
}

/* ---------------- embed dialog ---------------- */

const EMBED_SNIPPET = [
  '<script type="module">',
  "  import '@nobita/element';",
  '',
  "  const editor = document.querySelector('nobita-editor');",
  "  editor.doc = await fetch('/nobita-doc.json').then(r => r.json());",
  '',
  "  editor.addEventListener('nobita-change', event => {",
  "    localStorage.setItem('nobita-doc', JSON.stringify(event.detail.doc));",
  '  });',
  '</script>',
  '',
  '<nobita-editor theme="auto" placeholder="Start writing…"></nobita-editor>',
].join('\n');

function openEmbed(): void {
  const record = activeRecord();
  if (!record) return;
  closeModal?.();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="embed-dialog" role="dialog" aria-modal="true" aria-label="Embed Nobita">
      <div class="dialog-head">
        <div>
          <h2>Embed Nobita</h2>
          <p>Drop the same editor into any page or product. Shadow DOM keeps styles isolated; JSON keeps the data yours.</p>
        </div>
        <button class="icon-btn dialog-close" data-close aria-label="Close">${icon.x}</button>
      </div>
      <div class="dialog-body">
        <div class="snippet-card">
          <div class="snippet-head"><span>HTML</span><button data-copy>${icon.copy}<span>Copy</span></button></div>
          <pre></pre>
        </div>
        <div class="preview-card">
          <div class="preview-head">Live preview · read only</div>
          <div class="preview-scroll"><div id="embed-preview"></div></div>
        </div>
      </div>
    </div>
  `;
  const pre = backdrop.querySelector('pre');
  if (pre) pre.textContent = EMBED_SNIPPET;
  const previewHost = backdrop.querySelector<HTMLDivElement>('#embed-preview');
  let preview: NobitaEditor | null = null;
  if (previewHost) {
    preview = createEditor(previewHost, {
      doc: cloneDoc(record.doc),
      readonly: true,
      theme: state.theme,
    });
  }

  backdrop.querySelector<HTMLElement>('[data-copy]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(EMBED_SNIPPET);
      showToast('Snippet copied');
    } catch {
      showToast('Copy failed — select the code manually');
    }
  });

  const onBackdrop = (event: PointerEvent): void => {
    if (event.target === backdrop) close();
  };

  function close(): void {
    preview?.destroy();
    preview = null;
    backdrop.remove();
    document.removeEventListener('keydown', onDocumentKey);
    closeModal = null;
  }

  const onDocumentKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  backdrop.addEventListener('pointerdown', onBackdrop);
  backdrop.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', close);
  modalRoot.append(backdrop);
  document.addEventListener('keydown', onDocumentKey);
  closeModal = close;
}

/* ---------------- chrome ---------------- */

function showToast(message: string): void {
  toastElement.textContent = message;
  toastElement.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastElement.classList.remove('show'), 1800);
}

function applyTheme(): void {
  document.documentElement.dataset.theme = state.theme;
  editor?.setTheme(state.theme);
  const button = document.querySelector<HTMLButtonElement>('#theme-toggle');
  if (button) {
    button.innerHTML =
      state.theme === 'dark'
        ? `${demoIcon.sun}<span>Light mode</span>`
        : `${demoIcon.moon}<span>Dark mode</span>`;
  }
}

function initEvents(): void {
  for (const button of document.querySelectorAll<HTMLElement>('.nav-item')) {
    button.addEventListener('click', () => {
      currentView = button.dataset.view === 'favorites' ? 'favorites' : 'all';
      renderTree();
      renderCrumbs();
    });
  }

  $('#search-trigger').addEventListener('click', openSearch);
  $('#new-page').addEventListener('click', () => newPage(null));
  $('#empty-new').addEventListener('click', () => newPage(null));
  $('#embed-btn').addEventListener('click', openEmbed);
  pageMenuButton.addEventListener('click', topbarMenu);
  favoriteButton.addEventListener('click', () => {
    const record = activeRecord();
    if (!record || !state.activeId) return;
    record.favorite = !record.favorite;
    record.updatedAt = Date.now();
    saveState(state);
    renderFavorite();
    renderTree();
  });

  $('#theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    saveState(state);
    applyTheme();
  });

  $('#menu-toggle').addEventListener('click', () => shell.classList.add('sidebar-open'));
  $('#scrim').addEventListener('click', () => shell.classList.remove('sidebar-open'));

  window.addEventListener('keydown', event => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'k') {
      const path = event.composedPath();
      const insideEditor = path.includes(editorHost);
      const selection = window.getSelection();
      const hasSelection = selection !== null && !selection.isCollapsed;
      if (insideEditor && hasSelection) return;
      event.preventDefault();
      openSearch();
      return;
    }
    if (mod && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      newPage(null);
      return;
    }
    if (event.key === 'Escape') {
      closePopup?.();
      closeModal?.();
      shell.classList.remove('sidebar-open');
    }
  });

  // Recompute the word count when the page becomes visible again.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateStats();
  });
}

/* ---------------- boot ---------------- */

if (!state.activeId && Object.keys(state.pages).length > 0) {
  state.activeId = Object.keys(state.pages)[0] ?? null;
}
applyTheme();
initEvents();
mountEditor();
renderTree();
renderCrumbs();
renderFavorite();
updateStats();
