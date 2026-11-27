import { registerTableOfContents } from '@nobita/element/table-of-contents';
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
  collectRestoreTargetIds,
  collectTrashTargetIds,
  countWords,
  createBlock,
  createDoc,
  docToJSON,
  flattenPageTree,
  getBacklinks,
  getPageBreadcrumbs,
  isTrashedPage,
  partitionTrashedPages,
  resolveRestoreParentId,
  searchWorkspacePages,
  type Doc,
  type PageInfo,
  type PageSearchHit,
  type PageTreeInput,
  type PageTreeNode,
} from '@nobita/core';
import {
  type DemoState,
  duplicatePageRecord,
  loadState,
  saveState,
  type PageRecord,
} from './store';
import './styles.css';

let state: DemoState;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root missing');

app.innerHTML = `
  <div class="app" id="shell" hidden>
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
        <button class="nav-item" data-view="trash">
          ${icon.trash}<span>Trash</span><span class="count" id="trash-count">0</span>
        </button>
      </nav>
      <div class="sidebar-scroll">
        <div class="section-head">
          <span id="section-label">Pages</span>
          <button id="new-page" title="New page (⌘N)" aria-label="New page">${icon.plus}</button>
          <button id="empty-trash" class="trash-empty-btn" title="Empty trash" hidden>Empty</button>
        </div>
        <div class="trash-filter" id="trash-filter" hidden>
          <input type="search" id="trash-search" placeholder="Filter trash…" aria-label="Filter trash" />
        </div>
        <search class="tag-filter" id="tag-filter" hidden>
          <label for="filter-tag">Tag</label>
          <select id="filter-tag"><option value="">All tags</option></select>
        </search>
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
        <div class="trash-banner" id="trash-banner" hidden>
          <span class="trash-banner-text">${icon.trash}<span>This page is in Trash.</span></span>
          <div class="trash-banner-actions">
            <button type="button" class="trash-btn" id="banner-restore">${demoIcon.restore}<span>Restore</span></button>
            <button type="button" class="trash-btn danger" id="banner-delete">${icon.trash}<span>Delete permanently</span></button>
          </div>
        </div>
        <div id="editor-host"></div>
        <section id="note-tags" class="note-tags" aria-label="Note tags" hidden>
          <span class="tags-label">Tags</span>
          <div id="tag-chips" class="tag-chips"></div>
        </section>
        <p id="page-dates" class="page-dates"></p>
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
const trashCount = $('#trash-count') as HTMLElement;
const sectionLabel = $('#section-label') as HTMLElement;
const newPageButton = $('#new-page') as HTMLButtonElement;
const emptyTrashButton = $('#empty-trash') as HTMLButtonElement;
const trashFilter = $('#trash-filter') as HTMLDivElement;
const trashSearch = $('#trash-search') as HTMLInputElement;
const filterTag = $<HTMLSelectElement>('#filter-tag');
const tagChips = $<HTMLElement>('#tag-chips');
const noteTags = $<HTMLElement>('#note-tags');
const tagFilter = $<HTMLElement>('#tag-filter');
const trashBanner = $('#trash-banner') as HTMLDivElement;
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

let currentView: 'all' | 'favorites' | 'trash' = 'all';
let trashQuery = '';
let editor: NobitaEditor | null = null;
const changedPages = new Map<PageRecord, Pick<PageRecord, 'doc' | 'tags'>>();
let saveFailed = false;
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

const isTrashed = (record: PageRecord): boolean => isTrashedPage(record);

const titleOf = (record: PageRecord): string => record.doc.title.trim() || 'Untitled';

const activeDocs = (): Doc[] =>
  Object.values(state.pages)
    .filter(record => !isTrashed(record))
    .map(record => record.doc);

function firstActivePageId(): string | null {
  for (const [id, record] of Object.entries(state.pages)) {
    if (!isTrashed(record)) return id;
  }
  return null;
}

function treeInputs(): PageTreeInput[] {
  return Object.entries(state.pages).map(([id, record]) => ({
    id,
    title: titleOf(record),
    ...(record.doc.icon ? { icon: record.doc.icon } : {}),
    parentId: record.parentId,
    favorite: record.favorite,
    ...(record.order === undefined ? {} : { order: record.order }),
    updatedAt: record.updatedAt,
    ...(record.deletedAt == null ? {} : { deletedAt: record.deletedAt }),
  }));
}

function pagePath(id: string): string[] {
  const crumbsPath = getPageBreadcrumbs(treeInputs(), id);
  return crumbsPath.slice(0, -1).map(item => item.title);
}

function resolvePageInfo(pageId: string): PageInfo | null {
  const record = state.pages[pageId];
  if (!record || isTrashed(record)) return null;
  return {
    id: pageId,
    title: titleOf(record),
    ...(record.doc.icon ? { icon: record.doc.icon } : {}),
  };
}

function createWorkspacePage(title: string, parentId: string | null): PageInfo {
  const doc = createDoc({ title, blocks: [createBlock('paragraph')] });
  const siblings = Object.values(state.pages).filter(
    record => !isTrashed(record) && record.parentId === parentId
  );
  const now = Date.now();
  state.pages[doc.id] = {
    doc,
    parentId,
    favorite: false,
    order: siblings.length,
    createdAt: now,
    updatedAt: now,
  };
  if (parentId) collapsed.delete(parentId);
  persist();
  renderTree();
  return { id: doc.id, title: doc.title.trim() || 'Untitled' };
}

const pageProvider: PageProvider = {
  search(query: string): PageInfo[] {
    const needle = query.trim().toLowerCase();
    return Object.entries(state.pages)
      .filter(([, record]) => !isTrashed(record) && (!needle || titleOf(record).toLowerCase().includes(needle)))
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
    const active = activeRecord();
    const parentId = active && !isTrashed(active) ? state.activeId : null;
    return createWorkspacePage(title, parentId);
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

function syncEditorReadonly(): void {
  displayTags();
  const record = activeRecord();
  const trashed = Boolean(record && isTrashed(record));
  trashBanner.hidden = !trashed;
  favoriteButton.hidden = trashed;
  editor?.setReadonly(trashed);
}

function mountEditor(): void {
  const record = activeRecord();
  if (!record) {
    editorHost.hidden = true;
    backlinksPanel.hidden = true;
    trashBanner.hidden = true;
    emptyState.hidden = false;
    crumbs.replaceChildren();
    favoriteButton.hidden = false;
    favoriteButton.dataset.active = 'false';
    return;
  }
  const trashed = isTrashed(record);
  editorHost.hidden = false;
  emptyState.hidden = true;

  if (!editor) {
    editor = createEditor(editorHost, {
      doc: record.doc,
      theme: state.theme,
      readonly: trashed,
      placeholder: "Type '/' for commands, '[[' to link a page",
      autofocus: false,
      pageProvider,
      resolvePage: resolvePageInfo,
      onOpenPage: pageId => openPage(pageId),
      onChange: (doc, meta) => handleDocChange(doc, meta.source),
      onSelectionChange: () => updateStats(),
    });
    registerTableOfContents(editor);
    editor.setTheme(state.theme);
    (editorHost as HTMLElement & { __nobita?: NobitaEditor }).__nobita = editor;
  } else {
    editor.setDoc(record.doc);
  }
  syncEditorReadonly();
  editorScroll.scrollTop = 0;
  renderBacklinks();
}


function handleDocChange(doc: Doc, source: string): void {
  const id = state.activeId;
  if (!id) return;
  const record = state.pages[id];
  if (!record || isTrashed(record)) return;
  const titleChanged = record.doc.title !== doc.title;
  const edited = source !== 'replace' && (source !== 'set-title' || titleChanged);
  if (edited) rememberContent(record);
  record.doc = doc;
  if (edited) scheduleSave();
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
  const record = activeId ? state.pages[activeId] : null;
  if (!activeId || !record || isTrashed(record)) {
    backlinksPanel.hidden = true;
    backlinksPanel.replaceChildren();
    return;
  }
  const links = getBacklinks(activeDocs(), activeId);
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

function renderDates(): void {
  const record = activeRecord();
  const dates = $<HTMLElement>('#page-dates');
  dates.textContent = record
    ? `Created ${formatDate(record.createdAt)} · Updated ${formatDate(record.updatedAt)}`
    : '';
  dates.hidden = !record;
}

function formatDate(value?: number): string {
  return value ? new Date(value).toLocaleString() : 'Unknown';
}

function rememberContent(record: PageRecord): void {
  if (!changedPages.has(record)) changedPages.set(record, { doc: record.doc, tags: record.tags });
}

function contentChanged(record: PageRecord, before: Pick<PageRecord, 'doc' | 'tags'>): boolean {
  if (record.doc.title !== before.doc.title) return true;
  if (record.tags !== before.tags) {
    const tags = record.tags ?? [];
    const prior = before.tags ?? [];
    if (tags.length !== prior.length || tags.some(tag => !prior.includes(tag))) return true;
  }
  const blocks = record.doc.blocks;
  const prior = before.doc.blocks;
  if (blocks === prior) return false;
  return blocks.length !== prior.length || blocks.some((block, i) =>
    block !== prior[i] && JSON.stringify(block) !== JSON.stringify(prior[i])
  );
}

function persist(): void {
  window.clearTimeout(saveTimer);
  const previous = new Map<PageRecord, number>();
  const now = Date.now();
  for (const [record, before] of changedPages) {
    if (!contentChanged(record, before)) continue;
    previous.set(record, record.updatedAt);
    record.updatedAt = now;
  }
  saveFailed = !saveState(state);
  if (saveFailed) {
    for (const [record, date] of previous) record.updatedAt = date;
  } else {
    changedPages.clear();
  }
  saving = false;
  renderDates();
  updateStats();
}

function scheduleSave(): void {
  saving = true;
  updateStats();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    persist();
  }, 420);
}

function updateStats(): void {
  const doc = editor?.getDoc() ?? activeRecord()?.doc;
  const words = doc ? countWords(doc) : 0;
  const label = words === 1 ? '1 word' : `${words} words`;
  saveStatus.dataset.state = saving ? 'saving' : saveFailed ? 'error' : 'saved';
  saveText.textContent = saving ? 'Saving…' : saveFailed ? 'Not saved' : `Saved · ${label}`;
}

function openPage(id: string, focusBlockId?: string): void {
  const record = state.pages[id];
  if (!record) return;
  window.clearTimeout(saveTimer);
  saveTimer = 0;
  state.activeId = id;
  if (!isTrashed(record)) {
    for (const crumb of getPageBreadcrumbs(treeInputs(), id)) {
      collapsed.delete(crumb.id);
    }
  }
  persist();
  if (editor) editor.setDoc(record.doc);
  else mountEditor();
  syncEditorReadonly();
  editorHost.hidden = false;
  emptyState.hidden = true;
  renderTree();
  renderCrumbs();
  renderFavorite();
  renderBacklinks();
  updateStats();
  if (focusBlockId && !isTrashed(record)) {
    editor?.focus(focusBlockId, 0);
  } else {
    editorScroll.scrollTop = 0;
  }
  if (window.innerWidth <= 880) shell.classList.remove('sidebar-open');
}

function newPage(parentId: string | null = null): void {
  if (filterTag.value) {
    filterTag.value = '';
    currentView = 'all';
  }
  if (currentView === 'trash') currentView = 'all';
  const created = createWorkspacePage('', parentId);
  state.activeId = created.id;
  persist();
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

  persist();
  renderTree();
  renderCrumbs();
  showToast('Page moved');
}

/* ---------------- sidebar ---------------- */

function displayTags(): void {
  const record = activeRecord();
  const tags = record?.tags ?? [];
  noteTags.hidden = !tags.length;
  tagChips.replaceChildren(...tags.map(tag => tagChip(tag)));
}

function tagChip(tag: string): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.textContent = tag;
  return chip;
}

function editTags(record: PageRecord, anchor: PopupAnchor): void {
  const draft = new Set(record.tags ?? []);
  const dialog = document.createElement('dialog');
  dialog.className = 'tag-dialog';
  dialog.setAttribute('aria-labelledby', 'edit-tags-title');
  dialog.innerHTML = `
    <h2 id="edit-tags-title">${demoIcon.tag} Edit tags</h2>
    <form class="tag-entry">
      <input aria-label="Tag name" placeholder="Tag name" autocomplete="off" autofocus>
      <button type="submit">Add</button>
    </form>
    <div class="tag-chips"></div>
    <footer><button type="button" data-cancel>Cancel</button>
      <button type="button" class="primary-btn" data-save>Save tags</button></footer>`;
  const input = dialog.querySelector('input')!;
  const chips = dialog.querySelector('.tag-chips')!;
  function render(): void {
    chips.replaceChildren(...Array.from(draft, tag => {
      const chip = tagChip(tag);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove tag ${tag}`);
      remove.onclick = () => {
        draft.delete(tag);
        render();
        input.focus();
      };
      chip.append(remove);
      return chip;
    }));
  }
  function add(): void {
    for (const tag of input.value.split(',').map(value => value.trim())) {
      if (tag) draft.add(tag);
    }
    input.value = '';
  }
  dialog.querySelector('form')!.onsubmit = event => {
    event.preventDefault();
    add();
    render();
    input.focus();
  };
  dialog.querySelector<HTMLButtonElement>('[data-save]')!.onclick = () => {
    add();
    saveTags(record, [...draft]);
    dialog.close();
  };
  dialog.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick = () => dialog.close();
  dialog.onkeydown = event => event.stopPropagation();
  dialog.onclose = () => {
    dialog.remove();
    if (anchor instanceof HTMLElement && anchor.isConnected) {
      anchor.focus();
      return;
    }
    const rowAction = pageTree.querySelector<HTMLButtonElement>(
      `[data-page-id="${CSS.escape(record.doc.id)}"] [aria-label="Page actions"]`
    );
    (rowAction ?? pageMenuButton).focus();
  };
  render();
  modalRoot.append(dialog);
  dialog.showModal();
}

function saveTags(record: PageRecord, values: string[]): void {
  if (isTrashed(record)) return;
  const tags = [...new Set(values.map(tag => tag.trim()).filter(Boolean))];
  const current = record.tags ?? [];
  if (tags.length === current.length && tags.every(tag => current.includes(tag))) return;
  rememberContent(record);
  record.tags = tags;
  persist();
  if (record === activeRecord()) displayTags();
  renderTree();
}

function renderTree(): void {
  pageTree.replaceChildren();
  const inputs = treeInputs();
  const { active, trashed } = partitionTrashedPages(inputs);
  sectionLabel.textContent =
    currentView === 'favorites' ? 'Favorites' : currentView === 'trash' ? 'Trash' : 'Pages';
  docCount.textContent = String(active.length);
  trashCount.textContent = String(trashed.length);
  newPageButton.hidden = currentView === 'trash';
  emptyTrashButton.hidden = currentView !== 'trash' || trashed.length === 0;
  trashFilter.hidden = currentView !== 'trash';
  for (const button of document.querySelectorAll<HTMLElement>('.nav-item')) {
    button.dataset.active = String(button.dataset.view === currentView);
  }

  tagFilter.hidden = currentView === 'trash';
  if (currentView === 'trash') {
    const needle = trashQuery.trim().toLowerCase();
    const items = trashed
      .map(item => [item.id, state.pages[item.id]] as const)
      .filter(
        (entry): entry is readonly [string, PageRecord] =>
          Boolean(entry[1]) && (!needle || titleOf(entry[1]!).toLowerCase().includes(needle))
      );
    if (items.length === 0) {
      showEmptyTree(
        trashed.length === 0
          ? 'Trash is empty. Deleted pages appear here until you restore or remove them.'
          : 'No matching pages in Trash.'
      );
      return;
    }
    for (const [id, record] of items) pageTree.append(trashedPageRow(id, record));
    return;
  }

  const selected = filterTag.value;
  const choices = new Set(active.flatMap(item => state.pages[item.id]?.tags ?? []));
  if (selected) choices.add(selected);
  filterTag.replaceChildren(new Option('All tags', ''));
  for (const tag of [...choices].sort((a, b) => a.localeCompare(b))) {
    filterTag.add(new Option(tag, tag));
  }
  filterTag.value = selected;
  if (currentView === 'favorites' || selected) {
    const matches = Object.entries(state.pages)
      .filter(([, record]) => !isTrashed(record) &&
        (currentView !== 'favorites' || record.favorite) &&
        (!selected || record.tags?.includes(selected)))
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    if (matches.length === 0) {
      showEmptyTree(selected ? 'No pages with this tag.' : 'No favorites yet. Star a page to keep it close.');
      return;
    }
    for (const [id, record] of matches) pageTree.append(pageRow(id, record, 0, false, false));
    return;
  }

  const tree = buildPageTree(inputs);
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
    showEmptyTree('No pages yet. Press ⌘N or + to create one.');
  }
}

function showEmptyTree(message: string): void {
  const empty = document.createElement('div');
  empty.className = 'sidebar-empty';
  empty.textContent = message;
  pageTree.append(empty);
}

function pageRowContent(record: PageRecord) {
  const iconElement = document.createElement('span');
  iconElement.className = 'page-icon';
  iconElement.innerHTML = iconFor(record);

  const title = document.createElement('span');
  title.className = `page-title${record.doc.title.trim() ? '' : ' is-empty'}`;
  title.textContent = titleOf(record);

  const actions = document.createElement('span');
  actions.className = 'page-actions';
  return { iconElement, title, actions };
}

function pageAction(label: string, markup: string, activate: (button: HTMLButtonElement) => void, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = danger ? 'page-action danger' : 'page-action';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = markup;
  button.addEventListener('click', event => {
    event.stopPropagation();
    activate(button);
  });
  return button;
}

function treeRow(id: string, padding: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'page-row';
  row.dataset.active = String(state.activeId === id);
  row.dataset.pageId = id;
  row.style.paddingLeft = padding;
  row.tabIndex = 0;
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-selected', String(state.activeId === id));

  return row;
}

function trashedPageRow(id: string, record: PageRecord): HTMLElement {
  const row = treeRow(id, '8px');
  row.classList.add('is-trashed');
  const { iconElement, title, actions } = pageRowContent(record);

  actions.append(
    pageAction('Restore page', demoIcon.restore, () => restoreFromTrash(id)),
    pageAction('Delete permanently', icon.trash, () => deletePermanently(id), true)
  );
  row.append(iconElement, title, actions);
  row.addEventListener('click', () => openPage(id));
  row.addEventListener('keydown', event => {
    if (event.target !== row) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPage(id);
    }
  });
  return row;
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
  const row = treeRow(id, `${4 + depth * 13}px`);
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

  const { iconElement, title, actions } = pageRowContent(record);
  if (showTree) {
    actions.append(pageAction('Add nested page', icon.plus, () => {
      collapsed.delete(id);
      newPage(id);
    }));
  }
  actions.append(pageAction('Page actions', icon.more, button => openPageMenu(id, button)));

  row.append(chevron, iconElement, title, actions);
  row.addEventListener('click', () => openPage(id));
  row.addEventListener('dblclick', () => {
    const next = window.prompt('Page title', record.doc.title);
    if (next === null) return;
    renamePage(id, next);
  });
  row.addEventListener('keydown', event => {
    if (event.target !== row) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPage(id);
    }
  });
  if (showTree) {
    const dropMode = (event: DragEvent) => {
      const rect = row.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
      return ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
    };
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
      const mode = dropMode(event);
      const targetParent = mode === 'inside' ? id : record.parentId;
      if (!canReparentPage(treeInputs(), draggedPageId, targetParent)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      clearRowDropClasses(row);
      row.classList.add(`is-drop-${mode}`);
    });
    row.addEventListener('dragleave', () => {
      clearRowDropClasses(row);
    });
    row.addEventListener('drop', event => {
      const sourceId = draggedPageId;
      clearRowDropClasses(row);
      if (!sourceId || sourceId === id) return;
      const mode = dropMode(event);
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
  if (isTrashed(record)) {
    const trashCrumb = document.createElement('button');
    trashCrumb.className = 'crumb';
    trashCrumb.textContent = 'Trash';
    trashCrumb.addEventListener('click', () => {
      currentView = 'trash';
      renderTree();
    });
    crumbs.append(trashCrumb, separator());
  } else {
    const chain = getPageBreadcrumbs(treeInputs(), state.activeId);
    chain.slice(0, -1).forEach(ancestor => {
      const button = document.createElement('button');
      button.className = 'crumb';
      button.textContent = ancestor.title;
      button.addEventListener('click', () => openPage(ancestor.id));
      crumbs.append(button, separator());
    });
  }
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
  renderDates();
  const record = activeRecord();
  favoriteButton.dataset.active = String(Boolean(record?.favorite));
  favoriteButton.setAttribute('aria-pressed', String(Boolean(record?.favorite)));
}

function renamePage(id: string, title: string): void {
  const record = state.pages[id];
  if (!record) return;
  if (record.doc.title === title) return;
  rememberContent(record);
  record.doc = { ...record.doc, title };
  persist();
  if (state.activeId === id) editor?.setTitle(title);
  editor?.refreshPageLinks();
  renderTree();
  renderCrumbs();
  renderBacklinks();
  updateStats();
}

/* ---------------- popups ---------------- */

interface PopupRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type PopupAnchor = HTMLElement | PopupRect;

function pointAnchor(x: number, y: number): PopupRect {
  return { left: x, top: y, right: x, bottom: y };
}

interface PopupItem {
  label?: string;
  icon?: string;
  danger?: boolean;
  action?: () => void;
  separator?: boolean;
}

function showPopup(anchor: PopupAnchor, items: PopupItem[]): void {
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
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
  const gap = anchor instanceof Element ? 6 : 2;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  let left = Math.min(rect.left, window.innerWidth - width - 10);
  left = Math.max(10, left);
  let top = rect.bottom + gap;
  if (top + height > window.innerHeight - 10) top = Math.max(10, rect.top - height - gap);
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

function openMoveMenu(id: string, anchor: PopupAnchor): void {
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

function openTrashedPageMenu(id: string, anchor: PopupAnchor): void {
  const record = state.pages[id];
  if (!record || !isTrashed(record)) return;
  showPopup(anchor, [
    { label: 'Restore', icon: demoIcon.restore, action: () => restoreFromTrash(id) },
    { separator: true },
    {
      label: 'Delete permanently',
      icon: icon.trash,
      danger: true,
      action: () => deletePermanently(id),
    },
  ]);
}

function openPageMenu(id: string, anchor: PopupAnchor): void {
  const record = state.pages[id];
  if (!record) return;
  if (isTrashed(record)) {
    openTrashedPageMenu(id, anchor);
    return;
  }
  showPopup(anchor, [
    {
      label: 'Rename',
      icon: icon.text,
      action: () => {
        const next = window.prompt('Page title', record.doc.title);
        if (next !== null) renamePage(id, next);
      },
    },
    {
      label: 'Add nested page',
      icon: icon.plus,
      action: () => {
        collapsed.delete(id);
        newPage(id);
      },
    },
    {
      label: record.favorite ? 'Remove favorite' : 'Add to favorites',
      icon: demoIcon.star,
      action: () => toggleFavorite(id),
    },
    { label: 'Move to…', icon: icon.indent, action: () => openMoveMenu(id, anchor) },
    {
      label: 'Edit tags',
      icon: demoIcon.tag,
      action: () => editTags(record, anchor),
    },
    { label: 'Duplicate', icon: icon.duplicate, action: () => duplicatePage(id) },
    { label: 'Export Markdown', icon: icon.copy, action: () => exportMarkdown(id) },
    { label: 'Export JSON', icon: demoIcon.file, action: () => exportJSON(id) },
    { separator: true },
    { label: 'Move to Trash', icon: icon.trash, danger: true, action: () => moveToTrash(id) },
  ]);
}

function topbarMenu(): void {
  const id = state.activeId;
  if (!id) return;
  openPageMenu(id, pageMenuButton);
}

/* ---------------- page operations ---------------- */

function toggleFavorite(id: string): void {
  const record = state.pages[id];
  if (!record || isTrashed(record)) return;
  record.favorite = !record.favorite;
  persist();
  renderFavorite();
  renderTree();
}

function duplicatePage(id: string): void {
  const record = state.pages[id];
  if (!record || isTrashed(record)) return;
  const copy = duplicatePageRecord(record);
  state.pages[copy.doc.id] = copy;
  persist();
  renderTree();
  openPage(copy.doc.id);
  showToast('Page duplicated');
}

function showEmptyWorkspace(): void {
  displayTags();
  editor?.setDoc(createDoc());
  editorHost.hidden = true;
  backlinksPanel.hidden = true;
  trashBanner.hidden = true;
  emptyState.hidden = false;
  crumbs.replaceChildren();
  favoriteButton.hidden = false;
  favoriteButton.dataset.active = 'false';
  document.title = 'Nobita';
  updateStats();
}

function moveToTrash(id: string): void {
  const record = state.pages[id];
  if (!record || isTrashed(record)) return;
  const label = titleOf(record);
  const ids = collectTrashTargetIds(treeInputs(), id);
  if (ids.size === 0) return;
  const now = Date.now();
  for (const targetId of ids) {
    const target = state.pages[targetId];
    if (target) target.deletedAt = now;
  }
  if (state.activeId && ids.has(state.activeId)) {
    state.activeId = firstActivePageId();
  }
  persist();
  renderTree();
  if (!state.activeId) {
    showEmptyWorkspace();
  } else {
    openPage(state.activeId);
  }
  editor?.refreshPageLinks();
  renderFavorite();
  const message =
    ids.size > 1
      ? `Moved “${label}” and ${ids.size - 1} nested to Trash`
      : `Moved “${label}” to Trash`;
  showToast(message, { label: 'Undo', action: () => restoreFromTrash(id) });
}

function restoreFromTrash(id: string): void {
  const record = state.pages[id];
  if (!record || !isTrashed(record)) return;
  const inputs = treeInputs();
  const targetParentId = resolveRestoreParentId(inputs, id);
  const ids = collectRestoreTargetIds(inputs, id);
  if (ids.size === 0) return;
  for (const targetId of ids) {
    const target = state.pages[targetId];
    if (!target) continue;
    delete target.deletedAt;
  }
  record.parentId = targetParentId;
  if (targetParentId) collapsed.delete(targetParentId);
  if (currentView === 'trash') currentView = 'all';
  persist();
  openPage(id);
  editor?.refreshPageLinks();
  const label = titleOf(record);
  showToast(
    ids.size > 1
      ? `Restored “${label}” and ${ids.size - 1} nested`
      : `Restored “${label}”`
  );
}

function deletePermanently(id: string): void {
  const record = state.pages[id];
  if (!record) return;
  const label = titleOf(record);
  const ids = isTrashed(record)
    ? collectRestoreTargetIds(treeInputs(), id, { includeAllDescendants: true })
    : collectTrashTargetIds(treeInputs(), id);
  const removeIds = ids.size > 0 ? ids : new Set([id]);
  const nestedCount = removeIds.size - 1;
  const confirmMessage =
    nestedCount > 0
      ? `Delete “${label}” and ${nestedCount} nested ${nestedCount === 1 ? 'page' : 'pages'} permanently? This cannot be undone.`
      : `Delete “${label}” permanently? This cannot be undone.`;
  if (!window.confirm(confirmMessage)) return;
  for (const targetId of removeIds) delete state.pages[targetId];
  if (state.activeId && removeIds.has(state.activeId)) {
    if (currentView === 'trash') {
      const nextTrashed = partitionTrashedPages(treeInputs()).trashed[0]?.id ?? null;
      state.activeId = nextTrashed ?? firstActivePageId();
    } else {
      state.activeId = firstActivePageId();
    }
  }
  persist();
  renderTree();
  if (!state.activeId) {
    showEmptyWorkspace();
  } else {
    openPage(state.activeId);
  }
  editor?.refreshPageLinks();
  renderFavorite();
  showToast('Deleted permanently');
}

function emptyTrash(): void {
  const { trashed } = partitionTrashedPages(treeInputs());
  if (trashed.length === 0) return;
  const count = trashed.length;
  if (
    !window.confirm(
      `Permanently delete ${count} ${count === 1 ? 'page' : 'pages'} in Trash? This cannot be undone.`
    )
  ) {
    return;
  }
  for (const item of trashed) delete state.pages[item.id];
  if (state.activeId && !state.pages[state.activeId]) {
    state.activeId = firstActivePageId();
  }
  persist();
  renderTree();
  if (!state.activeId) {
    showEmptyWorkspace();
  } else {
    openPage(state.activeId);
  }
  editor?.refreshPageLinks();
  renderFavorite();
  showToast('Trash emptied');
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
        .filter(([, record]) => !isTrashed(record))
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .map(([docId, record]) => ({
          docId,
          title: titleOf(record),
          ...(record.doc.icon ? { icon: record.doc.icon } : {}),
          matchType: 'title' as const,
          score: 1,
        }));
    } else {
      results = searchWorkspacePages(activeDocs(), trimmed);
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
  "  import { registerTableOfContents } from '@nobita/element/table-of-contents';",
  '',
  "  const editor = document.querySelector('nobita-editor');",
  "  registerTableOfContents(editor.editor);",
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
    registerTableOfContents(preview);
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

function showToast(message: string, action?: { label: string; action: () => void }): void {
  toastElement.replaceChildren();
  const text = document.createElement('span');
  text.textContent = message;
  toastElement.append(text);
  toastElement.classList.toggle('has-action', Boolean(action));
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      window.clearTimeout(toastTimer);
      toastElement.classList.remove('show', 'has-action');
      action.action();
    });
    toastElement.append(button);
  }
  toastElement.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => toastElement.classList.remove('show', 'has-action'),
    action ? 5000 : 1800
  );
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
  filterTag.addEventListener('change', renderTree);
  for (const button of document.querySelectorAll<HTMLElement>('.nav-item')) {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      currentView = view === 'favorites' ? 'favorites' : view === 'trash' ? 'trash' : 'all';
      renderTree();
      renderCrumbs();
    });
  }

  $('#search-trigger').addEventListener('click', openSearch);
  newPageButton.addEventListener('click', () => newPage(null));
  emptyTrashButton.addEventListener('click', emptyTrash);
  trashSearch.addEventListener('input', () => {
    trashQuery = trashSearch.value;
    renderTree();
  });
  $('#banner-restore').addEventListener('click', () => {
    if (state.activeId) restoreFromTrash(state.activeId);
  });
  $('#banner-delete').addEventListener('click', () => {
    if (state.activeId) deletePermanently(state.activeId);
  });
  $('#empty-new').addEventListener('click', () => newPage(null));
  $('#embed-btn').addEventListener('click', openEmbed);
  pageMenuButton.addEventListener('click', topbarMenu);
  favoriteButton.addEventListener('click', () => {
    if (state.activeId) toggleFavorite(state.activeId);
  });

  pageTree.addEventListener('contextmenu', event => {
    if (event.shiftKey) return;
    const row = (event.target as Element | null)?.closest<HTMLElement>('.page-row');
    const pageId = row?.dataset.pageId;
    if (!pageId) return;
    const record = state.pages[pageId];
    if (!record) return;
    event.preventDefault();
    const anchor = pointAnchor(event.clientX, event.clientY);
    if (isTrashed(record)) openTrashedPageMenu(pageId, anchor);
    else openPageMenu(pageId, anchor);
  });

  $('#theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    persist();
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

  window.addEventListener('pagehide', () => { if (changedPages.size) persist(); });
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

async function start(): Promise<void> {
  const loaded = await loadState();
  state = loaded.state;
  saveFailed = !loaded.saved;
  if (!state.activeId) {
    state.activeId = firstActivePageId();
  }
  applyTheme();
  initEvents();
  shell.removeAttribute('hidden');
  mountEditor();
  renderTree();
  renderCrumbs();
  renderFavorite();
  updateStats();
}

void start();
