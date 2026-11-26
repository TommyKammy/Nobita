import {
  NobitaEditor,
  createEditor,
  icon,
  type PageProvider,
} from '@nobita/element';
import { demoIcon } from './icons';
import {
  blocksToMarkdown,
  buildPageTree,
  canReparentPage,
  cloneDoc,
  countWords,
  createBlock,
  createDoc,
  docToJSON,
  flattenPageTree,
  getBacklinks,
  getPageBreadcrumbs,
  getPageDescendantIds,
  searchWorkspacePages,
  type Doc,
  type PageInfo,
  type PageSearchHit,
  type PageTreeInput,
  type PageTreeNode,
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
        <section class="backlinks" id="backlinks" aria-label="Backlinks" hidden></section>
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
const backlinksPanel = $('#backlinks') as HTMLElement;
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
let backlinksOpen = true;
let draggedPageId: string | null = null;
let closePopup: (() => void) | null = null;
let closeModal: (() => void) | null = null;

const activeRecord = (): PageRecord | null =>
  state.activeId ? state.pages[state.activeId] ?? null : null;

const titleOf = (record: PageRecord): string => record.doc.title.trim() || 'Untitled';

const allDocs = (): Doc[] => Object.values(state.pages).map(record => record.doc);

function treeInputs(): PageTreeInput[] {
  return Object.entries(state.pages).map(([id, record]) => ({
    id,
    title: titleOf(record),
    ...(record.doc.icon ? { icon: record.doc.icon } : {}),
    parentId: record.parentId,
    favorite: record.favorite,
    ...(record.order === undefined ? {} : { order: record.order }),
    updatedAt: record.updatedAt,
  }));
}

function pagePath(id: string): string[] {
  const crumbsPath = getPageBreadcrumbs(treeInputs(), id);
  return crumbsPath.slice(0, -1).map(item => item.title);
}

function descendants(id: string): string[] {
  return [id, ...getPageDescendantIds(treeInputs(), id)];
}

function resolvePageInfo(pageId: string): PageInfo | null {
  const record = state.pages[pageId];
  if (!record) return null;
  return {
    id: pageId,
    title: titleOf(record),
    ...(record.doc.icon ? { icon: record.doc.icon } : {}),
  };
}

function createWorkspacePage(title: string, parentId: string | null): PageInfo {
  const doc = createDoc({ title, blocks: [createBlock('paragraph')] });
  const siblings = Object.values(state.pages).filter(record => record.parentId === parentId);
  state.pages[doc.id] = {
    doc,
    parentId,
    favorite: false,
    order: siblings.length,
    updatedAt: Date.now(),
  };
  if (parentId) collapsed.delete(parentId);
  saveState(state);
  renderTree();
  return { id: doc.id, title: doc.title.trim() || 'Untitled' };
}

const pageProvider: PageProvider = {
  search(query: string): PageInfo[] {
    const needle = query.trim().toLowerCase();
    return Object.entries(state.pages)
      .filter(([, record]) => !needle || titleOf(record).toLowerCase().includes(needle))
      .sort((a, b) => {
        if (a[0] === state.activeId && b[0] !== state.activeId) return 1;
        if (b[0] === state.activeId && a[0] !== state.activeId) return -1;
        return b[1].updatedAt - a[1].updatedAt;
      })
      .map(([id, record]) => ({
        id,
        title: titleOf(record),
        ...(record.doc.icon ? { icon: record.doc.icon } : {}),
      }));
  },
  create(title: string): PageInfo {
    return createWorkspacePage(title, state.activeId);
  },
};

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
    backlinksPanel.hidden = true;
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
      placeholder: "Type '/' for commands, '[[' to link a page",
      autofocus: false,
      pageProvider,
      resolvePage: resolvePageInfo,
      onOpenPage: pageId => openPage(pageId),
      onChange: (doc, meta) => handleDocChange(doc, meta.source),
      onSelectionChange: () => updateStats(),
    });
    editor.setTheme(state.theme);
    (editorHost as HTMLElement & { __nobita?: NobitaEditor }).__nobita = editor;
  } else {
    editor.setDoc(record.doc);
  }
  editorScroll.scrollTop = 0;
  renderBacklinks();
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
    editor?.refreshPageLinks();
    document.title = `${titleOf(record)} · Nobita`;
  }
  if (source !== 'replace') renderBacklinks();
}

function renderBacklinks(): void {
  const activeId = state.activeId;
  if (!activeId || !state.pages[activeId]) {
    backlinksPanel.hidden = true;
    backlinksPanel.replaceChildren();
    return;
  }
  const links = getBacklinks(allDocs(), activeId);
  if (links.length === 0) {
    backlinksPanel.hidden = true;
    backlinksPanel.replaceChildren();
    return;
  }
  backlinksPanel.hidden = false;
  backlinksPanel.replaceChildren();

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'backlinks-head';
  header.setAttribute('aria-expanded', String(backlinksOpen));
  header.innerHTML = `<span class="backlinks-chevron" data-open="${String(backlinksOpen)}">${icon.chevron}</span><span>Backlinks</span><span class="backlinks-count">${links.length}</span>`;
  header.addEventListener('click', () => {
    backlinksOpen = !backlinksOpen;
    renderBacklinks();
  });
  backlinksPanel.append(header);

  if (!backlinksOpen) return;

  const list = document.createElement('div');
  list.className = 'backlinks-list';
  for (const item of links) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'backlink-card';
    const top = document.createElement('div');
    top.className = 'backlink-source';
    const iconEl = document.createElement('span');
    iconEl.className = 'backlink-icon';
    if (item.sourceIcon) iconEl.textContent = item.sourceIcon;
    else iconEl.innerHTML = demoIcon.file;
    const titleEl = document.createElement('span');
    titleEl.className = 'backlink-title';
    titleEl.textContent = item.sourceTitle;
    const kindEl = document.createElement('span');
    kindEl.className = 'backlink-kind';
    kindEl.textContent = item.kind === 'block' ? 'Page card' : 'Inline';
    top.append(iconEl, titleEl, kindEl);

    const snippet = document.createElement('div');
    snippet.className = 'backlink-snippet';
    snippet.textContent = item.snippet;

    card.append(top, snippet);
    card.addEventListener('click', () => openPage(item.sourceDocId, item.blockId));
    list.append(card);
  }
  backlinksPanel.append(list);
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

function openPage(id: string, focusBlockId?: string): void {
  if (!state.pages[id]) return;
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    saveState(state);
    saving = false;
  }
  state.activeId = id;
  for (const crumb of getPageBreadcrumbs(treeInputs(), id)) {
    collapsed.delete(crumb.id);
  }
  saveState(state);
  if (editor) editor.setDoc(state.pages[id]!.doc);
  else mountEditor();
  editorHost.hidden = false;
  emptyState.hidden = true;
  renderTree();
  renderCrumbs();
  renderFavorite();
  renderBacklinks();
  updateStats();
  if (focusBlockId) {
    editor?.focus(focusBlockId, 0);
  } else {
    editorScroll.scrollTop = 0;
  }
  if (window.innerWidth <= 880) shell.classList.remove('sidebar-open');
}

function newPage(parentId: string | null = null): void {
  const created = createWorkspacePage('', parentId);
  state.activeId = created.id;
  saveState(state);
  mountEditor();
  renderTree();
  renderCrumbs();
  renderFavorite();
  renderBacklinks();
  updateStats();
  editor?.focusTitle();
}

function movePageInTree(
  pageId: string,
  newParentId: string | null,
  anchorId?: string,
  position?: 'before' | 'after'
): void {
  const inputs = treeInputs();
  if (!canReparentPage(inputs, pageId, newParentId)) return;
  const record = state.pages[pageId];
  if (!record) return;
  record.parentId = newParentId;
  if (newParentId) collapsed.delete(newParentId);

  // Recompute sibling ordering deterministically.
  const tree = buildPageTree(treeInputs());
  const findSiblings = (nodes: readonly PageTreeNode[], targetParent: string | null): PageTreeNode[] => {
    if (targetParent === null) return [...nodes];
    for (const node of nodes) {
      if (node.id === targetParent) return [...node.children];
      const nested = findSiblings(node.children, targetParent);
      if (nested.length > 0 || node.children.some(c => c.id === targetParent)) return nested;
    }
    return [];
  };
  const siblingIds = findSiblings(tree, newParentId)
    .map(node => node.id)
    .filter(id => id !== pageId);
  if (anchorId && position) {
    const idx = siblingIds.indexOf(anchorId);
    if (idx >= 0) {
      siblingIds.splice(position === 'before' ? idx : idx + 1, 0, pageId);
    } else {
      siblingIds.push(pageId);
    }
  } else {
    siblingIds.push(pageId);
  }
  siblingIds.forEach((id, index) => {
    const target = state.pages[id];
    if (target) target.order = index;
  });

  saveState(state);
  renderTree();
  renderCrumbs();
  showToast('Page moved');
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
    for (const [id, record] of favorites) pageTree.append(pageRow(id, record, 0, false, false));
    return;
  }

  const tree = buildPageTree(treeInputs());
  const renderNodes = (nodes: readonly PageTreeNode[]): void => {
    for (const node of nodes) {
      const record = state.pages[node.id];
      if (!record) continue;
      pageTree.append(pageRow(node.id, record, node.depth, true, node.children.length > 0));
      if (!collapsed.has(node.id) && node.children.length > 0) renderNodes(node.children);
    }
  };
  renderNodes(tree);

  if (pageTree.childElementCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = 'No pages yet. Press ⌘N or + to create one.';
    pageTree.append(empty);
  }
}

function clearRowDropClasses(row: HTMLElement): void {
  row.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-inside');
}

function pageRow(
  id: string,
  record: PageRecord,
  depth: number,
  showTree: boolean,
  hasChildren: boolean
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'page-row';
  row.dataset.active = String(state.activeId === id);
  row.dataset.pageId = id;
  row.style.paddingLeft = `${4 + depth * 13}px`;
  row.tabIndex = 0;
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-selected', String(state.activeId === id));
  if (showTree) row.draggable = true;

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
  if (showTree) {
    row.addEventListener('dragstart', event => {
      draggedPageId = id;
      row.classList.add('is-dragging');
      event.dataTransfer?.setData('text/plain', id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      draggedPageId = null;
      row.classList.remove('is-dragging');
      for (const el of pageTree.querySelectorAll<HTMLElement>('.page-row')) {
        clearRowDropClasses(el);
      }
    });
    row.addEventListener('dragover', event => {
      if (!draggedPageId || draggedPageId === id) return;
      const rect = row.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
      const mode = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
      const targetParent = mode === 'inside' ? id : record.parentId;
      if (!canReparentPage(treeInputs(), draggedPageId, targetParent)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      clearRowDropClasses(row);
      row.classList.add(
        mode === 'before'
          ? 'is-drop-before'
          : mode === 'after'
            ? 'is-drop-after'
            : 'is-drop-inside'
      );
    });
    row.addEventListener('dragleave', () => {
      clearRowDropClasses(row);
    });
    row.addEventListener('drop', event => {
      const sourceId = draggedPageId;
      clearRowDropClasses(row);
      if (!sourceId || sourceId === id) return;
      const rect = row.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
      const mode = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
      const targetParent = mode === 'inside' ? id : record.parentId;
      if (!canReparentPage(treeInputs(), sourceId, targetParent)) return;
      event.preventDefault();
      event.stopPropagation();
      draggedPageId = null;
      if (mode === 'inside') movePageInTree(sourceId, id);
      else movePageInTree(sourceId, targetParent, id, mode);
    });
  }
  return row;
}

function renderCrumbs(): void {
  crumbs.replaceChildren();
  const record = activeRecord();
  if (!record || !state.activeId) return;
  const chain = getPageBreadcrumbs(treeInputs(), state.activeId);
  chain.slice(0, -1).forEach(ancestor => {
    const button = document.createElement('button');
    button.className = 'crumb';
    button.textContent = ancestor.title;
    button.addEventListener('click', () => openPage(ancestor.id));
    crumbs.append(button, separator());
  });
  const current = document.createElement('span');
  current.className = 'crumb current';
  current.textContent = titleOf(record);
  crumbs.append(current);
  document.title = `${titleOf(record)} · Nobita`;
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
  editor?.refreshPageLinks();
  renderTree();
  renderCrumbs();
  renderBacklinks();
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

function openMoveMenu(id: string, anchor: HTMLElement): void {
  const inputs = treeInputs();
  const flat = flattenPageTree(buildPageTree(inputs));
  const items: PopupItem[] = [
    {
      label: 'Workspace root',
      icon: demoIcon.file,
      action: () => movePageInTree(id, null),
    },
  ];
  for (const node of flat) {
    if (!canReparentPage(inputs, id, node.id)) continue;
    items.push({
      label: `${'  '.repeat(node.depth)}${node.title}`,
      action: () => movePageInTree(id, node.id),
    });
  }
  showPopup(anchor, items);
}

function openPageMenu(id: string, anchor: HTMLElement): void {
  const record = state.pages[id];
  if (!record) return;
  showPopup(anchor, [
    { label: 'Move to…', icon: icon.indent, action: () => openMoveMenu(id, anchor) },
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
    { label: 'Move to…', icon: icon.indent, action: () => openMoveMenu(id, pageMenuButton) },
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
    backlinksPanel.hidden = true;
    emptyState.hidden = false;
    updateStats();
  } else {
    openPage(state.activeId);
  }
  editor?.refreshPageLinks();
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

  let results: PageSearchHit[] = [];
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
    group.textContent = input.value.trim() ? 'Matches' : 'Pages';
    list.append(group);
    results.forEach((hit, index) => {
      const record = state.pages[hit.docId];
      if (!record) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'palette-item';
      button.dataset.active = String(index === active);
      const iconElement = document.createElement('span');
      iconElement.className = 'p-icon';
      iconElement.innerHTML = iconFor(record);
      const copy = document.createElement('span');
      copy.className = 'p-copy';
      const title = document.createElement('span');
      title.className = 'p-title';
      title.textContent = titleOf(record);
      copy.append(title);
      if (hit.snippet) {
        const snippet = document.createElement('span');
        snippet.className = 'p-snippet';
        snippet.textContent = hit.snippet;
        copy.append(snippet);
      }
      const path = document.createElement('span');
      path.className = 'p-path';
      path.textContent = pagePath(hit.docId).join(' / ');
      button.append(iconElement, copy, path);
      button.addEventListener('click', () => {
        close();
        openPage(hit.docId, hit.blockId);
      });
      list.append(button);
    });
    const activeElement = list.querySelector<HTMLElement>(`[data-active="true"]`);
    activeElement?.scrollIntoView({ block: 'nearest' });
  };

  const filter = (query: string): void => {
    const trimmed = query.trim();
    if (!trimmed) {
      results = Object.entries(state.pages)
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .map(([docId, record]) => ({
          docId,
          title: titleOf(record),
          ...(record.doc.icon ? { icon: record.doc.icon } : {}),
          matchType: 'title' as const,
          score: 1,
        }));
    } else {
      results = searchWorkspacePages(allDocs(), trimmed);
    }
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
      const hit = results[active];
      if (hit) {
        close();
        openPage(hit.docId, hit.blockId);
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

  const sidebarScroll = $<HTMLElement>('.sidebar-scroll');
  sidebarScroll.addEventListener('dragover', event => {
    if (!draggedPageId || currentView !== 'all') return;
    if ((event.target as Element | null)?.closest('.page-row')) return;
    if (!canReparentPage(treeInputs(), draggedPageId, null)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  });
  sidebarScroll.addEventListener('drop', event => {
    if (!draggedPageId || currentView !== 'all') return;
    if ((event.target as Element | null)?.closest('.page-row')) return;
    const sourceId = draggedPageId;
    draggedPageId = null;
    if (!canReparentPage(treeInputs(), sourceId, null)) return;
    event.preventDefault();
    movePageInTree(sourceId, null);
  });

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
