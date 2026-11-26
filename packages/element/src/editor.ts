import type { CollaborationAdapter } from '@nobita/core';
import { icon } from './icons.js';
import { styles } from './styles.js';
import { Virtualizer } from './virtualizer.js';
import {
  EditorStore,
  DatabaseEvalContext,
  documentDatabases,
  storedDatabase,
  relationChanges,
  updateDatabaseRelations,
  type DatabaseResolver,
  type DatabaseTarget,
  type RelationChange,
  applyMarkPatch,
  atomicRangeAt,
  blocksToHtml,
  blocksToMarkdown,
  createBlock,
  createDoc,
  dedentBlock,
  deleteTextRange,
  docToJSON,
  duplicateBlockTree,
  duplicateBlocks,
  findBlock,
  flattenBlocks,
  indentBlock,
  insertBlockRelative,
  insertBlocksAfter,
  insertTextAt,
  isTextualBlock,
  locateBlock,
  markdownToBlocks,
  markStateInRange,
  marksAt,
  matchBlockMarkdown,
  matchInlineMarkdown,
  mergeBlockWithNext,
  mergeBlockWithPrevious,
  moveBlock,
  moveBlocks,
  normalizeRuns,
  parseDoc,
  plainText,
  removeBlocks,
  runsLength,
  safeHref,
  selectedTopLevelBlocks,
  setBlockAlign,
  setBlockType,
  setHighlightInRange,
  setCalloutTone,
  setCodeLanguage,
  setImageProps,
  setTextColorInRange,
  sliceRuns,
  splitBlock,
  toggleChecked,
  toggleMarkInRange,
  updateBlock,
  type Block,
  type BlockProps,
  type BlockType,
  type CalloutTone,
  type DatabaseData,
  type Doc,
  type EditorSelection,
  type HeadingLevel,
  type HighlightColor,
  type InlineMark,
  type PageInfo,
  type TableData,
  type Point,
  type TextAlign,
  type TextColor,
} from '@nobita/core';
import { BlockView, type BlockDisplayState } from './block-view.js';
import type { BlockHost } from './bridge.js';
import {
  readClipboardPayload,
  serializeBlocksForClipboard,
} from './clipboard.js';
import {
  caretRect,
  closestElement,
  domPointToOffset,
  handleHistoryKey,
  isNodeInside,
  nativeSelection,
  offsetToDomPoint,
  selectionRect,
} from './dom.js';
import { pointAnchor, type FloatingAnchor } from './floating.js';
import { blockRange, orderedRange, selectionBlocks } from './selection.js';
import { readRunsFromDom, refreshInlinePageChips } from './inline-dom.js';
import { Menu, type MenuItem } from './menu.js';
import {
  buildBlockMenuItems,
  buildMultiBlockMenuItems,
  buildSlashMenuItems,
} from './menu-items.js';
import { LinkPopover, Toolbar, type ToolbarMark } from './toolbar.js';

export type NobitaTheme = 'light' | 'dark' | 'auto';

export interface MentionItem {
  id: string;
  label: string;
  kind?: string;
  keywords?: readonly string[];
}

export interface MentionProvider {
  search(query: string): readonly MentionItem[] | Promise<readonly MentionItem[]>;
}

export interface PageProvider {
  /** Search workspace pages matching `query` (used by `[[` and `/page`). */
  search(query: string): readonly PageInfo[] | Promise<readonly PageInfo[]>;
  /** Optional host callback to create a new page from `[[` or `/new-page`. */
  create?(title: string): PageInfo | Promise<PageInfo>;
}

export interface ImageUploadResult {
  src: string;
  alt?: string;
  caption?: string;
}

export type ImageUploadHandler = (
  file: File
) => ImageUploadResult | string | Promise<ImageUploadResult | string>;

export interface NobitaOptions {
  collaboration?: CollaborationAdapter | null;
  virtualize?: boolean | { threshold?: number; overscanPx?: number };
  doc?: Doc | string;
  readonly?: boolean;
  theme?: NobitaTheme;
  placeholder?: string;
  autofocus?: boolean;
  spellcheck?: boolean;
  historyLimit?: number;
  onChange?: (doc: Doc, meta: { source: string }) => void;
  onSelectionChange?: (selection: EditorSelection | null) => void;
  /** Optional host-provided mention directory. */
  mentionProvider?: MentionProvider;
  /** Optional host-provided page directory used by `[[` and `/page`. */
  pageProvider?: PageProvider;
  /** Optional host-provided image uploader used by paste and drop. */
  uploadImage?: ImageUploadHandler;
  /** Navigate to a page reference. The host owns loading and routing. */
  onOpenPage?: (pageId: string) => void;
  /** Optional cached metadata used to refresh page reference titles/icons. */
  databaseProvider?: (query: string) => readonly DatabaseTarget[] | Promise<readonly DatabaseTarget[]>;
  resolveDatabase?: DatabaseResolver;
  onRelationSync?: ((change: RelationChange) => void) | undefined;
  resolvePage?: (pageId: string) => PageInfo | null;
}

interface SlashState {
  blockId: string;
  start: number;
  end: number;
}

interface MentionState {
  blockId: string;
  start: number;
  end: number;
  query: string;
}

interface PageLinkState {
  blockId: string;
  start: number;
  end: number;
  query: string;
  triggerLength: number;
  mode: 'inline' | 'block';
  items: readonly PageInfo[];
}

interface DragState {
  blockId: string;
  startX: number;
  startY: number;
  moved: boolean;
  pointerId: number;
  handle: HTMLElement;
  targetId: string | null;
  position: 'before' | 'after' | 'child' | null;
  line: HTMLElement;
  targetElement: HTMLElement | null;
}

type ClipboardPayload = ReturnType<typeof serializeBlocksForClipboard>;

function writeClipboardData(data: DataTransfer | null, payload: ClipboardPayload): void {
  if (!data) return;
  data.setData('text/plain', payload.text);
  data.setData('text/html', payload.html);
  data.setData('application/x-nobita+json', payload.json);
}


function normalizeLink(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed) || trimmed.startsWith('#') || trimmed.startsWith('/')) {
    return safeHref(trimmed) ?? '';
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmed)) return `mailto:${trimmed}`;
  return safeHref(`https://${trimmed}`) ?? '';
}

function rectAnchor(rect: DOMRect): {
  x: number;
  y: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  return {
    x: rect.left,
    y: rect.top,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
  };
}

export class NobitaEditor implements BlockHost {
  readonly root: ShadowRoot;
  readonly store: EditorStore;
  #placeholderValue: string;
  readonly #hostElement: HTMLElement;
  #options: { [K in keyof NobitaOptions]: NobitaOptions[K] | undefined };
  #readonly: boolean;
  #page!: HTMLElement;
  #title!: HTMLElement;
  #body!: HTMLElement;
  #tail!: HTMLElement;
  #overlay!: HTMLElement;
  #display: BlockDisplayState = { databases: new Map(), revealed: new WeakSet() };
  #printing = false;
  #views = new Map<string, BlockView>();
  #viewIndex = new Map<string, BlockView>();
  #virtual: Virtualizer | undefined;
  #layout: number[] = [];
  #gaps: HTMLElement[] = [];
  #syncedBlocks: readonly Block[] | null = null;
  #placeholderBlockId: string | null = null;
  #menu: Menu;
  #toolbar: Toolbar;
  #linkPopover: LinkPopover;
  #unsubscribe: () => void;
  #unsubscribeSelection: () => void;
  #focusedBlockId: string | null = null;
  #pendingMarks: InlineMark | undefined;
  #lastSelection: EditorSelection | null = null;
  #lastSelectionKey = '';
  #slash: SlashState | null = null;
  #mention: MentionState | null = null;
  #mentionQueryToken = 0;
  #mentionSyncQueued = false;
  #pageLink: PageLinkState | null = null;
  #pageLinkQueryToken = 0;
  #pageLinkSyncQueued = false;
  #drag: DragState | null = null;
  #savedSelection: EditorSelection | null = null;
  #selectedBlockIds = new Set<string>();
  #blockAnchorId: string | null = null;
  #blockFocusId: string | null = null;
  #selectedBlockEls = new Set<HTMLElement>();
  #toolbarDismissedKey: string | null = null;
  #destroyed = false;
  #docEpoch = 0;
  #bodyEvents = new AbortController();
  #composing = false;
  #compositionBlockId: string | null = null;
  #ready = false;
  #onDocumentSelection = (): void => {
    this.#handleSelectionChange();
  };
  #onImmediateSelection = (): void => {
    this.#handleSelectionChange();
  };
  #onScroll = (): void => {
    this.#toolbar.hide();
    this.#linkPopover.hide();
  };
  #onResize = (): void => {
    this.#toolbar.hide();
    this.#linkPopover.hide();
  };
  #onWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    const hadOverlay =
      this.#mention !== null ||
      this.#pageLink !== null ||
      this.#menu.isOpen ||
      this.#toolbar.isVisible ||
      this.#linkPopover.element.parentNode !== null;
    if (!hadOverlay) return;
    if (this.#toolbar.isVisible) {
      const sel = this.#currentSelection();
      this.#toolbarDismissedKey = sel ? this.#selectionKey(sel) : null;
    }
    this.#mention = null;
    this.#pageLink = null;
    this.#menu.close();
    this.#toolbar.hide();
    this.#linkPopover.hide();
    event.preventDefault();
    event.stopPropagation();
  };

  constructor(host: HTMLElement, options: NobitaOptions = {}) {
    this.#hostElement = host;
    this.#options = { ...options };
    this.#placeholderValue = options.placeholder ?? "Type '/' for commands";
    this.#readonly = options.readonly ?? false;
    const doc =
      options.doc === undefined
        ? createDoc()
        : parseDoc(options.doc);
    this.store = new EditorStore(doc, {
      ...(options.historyLimit === undefined ? {} : { historyLimit: options.historyLimit }),
    });

    this.root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    this.root.replaceChildren();
    const theme = options.theme ?? 'light';
    this.#hostElement.dataset.theme = theme;
    const style = document.createElement('style');
    style.textContent = styles;
    const rootElement = document.createElement('div');
    rootElement.className = 'nb-root';
    rootElement.dataset.theme = theme;
    this.#page = document.createElement('div');
    this.#page.className = 'nb-page';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'nb-title-wrap';
    this.#title = document.createElement('div');
    this.#title.className = 'nb-title';
    this.#title.contentEditable = this.#readonly ? 'false' : 'true';
    this.#title.spellcheck = options.spellcheck ?? true;
    this.#title.setAttribute('role', 'textbox');
    this.#title.setAttribute('aria-label', 'Document title');
    this.#title.dataset.placeholder = 'Untitled';
    titleWrap.append(this.#title);
    this.#body = document.createElement('div');
    this.#body.className = 'nb-body';
    this.#body.tabIndex = -1;
    this.#body.contentEditable = this.#readonly ? 'false' : 'true';
    this.#body.spellcheck = options.spellcheck ?? true;
    this.#body.setAttribute('role', 'textbox');
    this.#body.setAttribute('aria-multiline', 'true');
    this.#body.setAttribute('aria-label', 'Document body');
    this.#tail = document.createElement('div');
    this.#tail.className = 'nb-tail';
    this.#page.append(titleWrap, this.#body, this.#tail);
    const scroll = document.createElement('div');
    scroll.className = 'nb-scroll';
    scroll.append(this.#page);
    rootElement.append(scroll);
    this.#overlay = document.createElement('div');
    this.#overlay.className = 'nb-overlay';
    rootElement.append(this.#overlay);
    this.root.append(style, rootElement);

    this.#menu = new Menu(this.root, this.#overlay);
    this.#toolbar = new Toolbar(
      this.#overlay,
      key => this.#toggleMark(key),
      () => this.#toggleLink(),
      align => this.#applyAlignment(align),
      (type, level) => this.#applyTurnInto(type, level),
      color => this.#applyHighlight(color),
      color => this.#applyTextColor(color)
    );
    this.#linkPopover = new LinkPopover(this.#overlay);

    this.#bindTitle();
    this.#bindBody();
    const print = (enabled: boolean) => {
      this.#printing = enabled;
      this.#layout = [];
      this.#syncBody(this.doc.blocks, []);
    };
    window.addEventListener('beforeprint', () => print(true), { signal: this.#bodyEvents.signal });
    window.addEventListener('afterprint', () => print(false), { signal: this.#bodyEvents.signal });
    this.#bindChrome();
    this.#syncBody(this.store.doc.blocks);
    this.#syncTitle();

    this.#unsubscribe = this.store.subscribe(change => this.#onStoreChange(change));
    this.#unsubscribeSelection = this.store.subscribeSelection(selection => {
      this.#lastSelection = selection;
    });

    this.#ready = true;
    if (options.collaboration) this.setCollaboration(options.collaboration);
    if (options.autofocus) this.focus();
  }

  #disconnect: (() => void) | undefined;
  #connectionVersion = 0;
  collaborationReady: Promise<void> = Promise.resolve();

  setCollaboration(adapter: CollaborationAdapter | null): Promise<void> {
    const version = ++this.#connectionVersion;
    this.#disconnect?.();
    this.#disconnect = undefined;
    this.#page.inert = !!adapter;
    this.collaborationReady = adapter ? import('./collaboration.js').then(({connect}) => {
      if (version !== this.#connectionVersion) return;
      const disconnect = connect(adapter, this.store, this.root, this.#overlay, () => this.#restoreSelection(this.store.selection, true));
      if (version === this.#connectionVersion) this.#disconnect = disconnect;
      else disconnect();
    }).finally(() => {
      if (version === this.#connectionVersion) this.#page.inert = false;
    }) : Promise.resolve();
    return this.collaborationReady;
  }

  get doc(): Doc {
    return this.store.doc;
  }

  get readonly(): boolean {
    return this.#readonly;
  }

  get isReady(): boolean {
    return this.#ready && !this.#page.inert;
  }

  get focusedBlockId(): string | null {
    return this.#focusedBlockId;
  }

  get placeholder(): string {
    return this.#placeholderValue;
  }

  setPlaceholder(value: string): void {
    this.#placeholderValue = value;
    this.#syncPlaceholders();
  }

  get mentionProvider(): MentionProvider | undefined {
    return this.#options.mentionProvider;
  }

  set mentionProvider(provider: MentionProvider | undefined) {
    this.setMentionProvider(provider);
  }

  setMentionProvider(provider: MentionProvider | undefined): void {
    this.#options.mentionProvider = provider;
  }

  get pageProvider(): PageProvider | undefined {
    return this.#options.pageProvider;
  }

  set pageProvider(provider: PageProvider | undefined) {
    this.setPageProvider(provider);
  }

  setPageProvider(provider: PageProvider | undefined): void {
    this.#options.pageProvider = provider;
  }

  get uploadImage(): ImageUploadHandler | undefined {
    return this.#options.uploadImage;
  }

  set uploadImage(handler: ImageUploadHandler | undefined) {
    this.setUploadImage(handler);
  }

  setUploadImage(handler: ImageUploadHandler | undefined): void {
    this.#options.uploadImage = handler;
  }

  getSelection(): EditorSelection | null {
    return this.#currentSelection();
  }

  getSelectedBlockIds(): string[] {
    if (this.#selectedBlockIds.size === 0) return [];
    return flattenBlocks(this.store.doc.blocks)
      .filter(b => this.#selectedBlockIds.has(b.id))
      .map(b => b.id);
  }

  selectBlocks(ids: readonly string[]): void {
    const valid = ids.filter(id => findBlock(this.store.doc.blocks, id) !== null);
    if (valid.length === 0) {
      this.clearBlockSelection();
      return;
    }
    this.#setBlockSelection(valid, valid[0]!, valid[valid.length - 1]!, true);
  }

  clearBlockSelection(): void {
    if (
      this.#selectedBlockIds.size === 0 &&
      this.#selectedBlockEls.size === 0 &&
      this.#blockAnchorId === null &&
      this.#blockFocusId === null
    ) {
      return;
    }
    this.#selectedBlockIds.clear();
    this.#blockAnchorId = null;
    this.#blockFocusId = null;
    this.#syncBlockSelection();
    this.#syncPlaceholders();
  }

  /** ---- public API ---- */

  getDoc(): Doc {
    return this.store.doc;
  }

  getJSON(pretty = false): string {
    return docToJSON(this.store.doc, pretty);
  }

  getMarkdown(): string {
    return blocksToMarkdown(this.store.doc, {
      resolveDatabase: this.#resolveDatabase,
    });
  }

  getHTML(): string {
    return blocksToHtml(
      this.store.doc.blocks,
      new DatabaseEvalContext(this.#resolveDatabase)
    );
  }

  /** Stable fragment for linking to a block inside the host page. */
  getBlockLink(blockId: string): string | null {
    return this.#viewIndex.has(blockId) || findBlock(this.store.doc.blocks, blockId)
      ? `#block-${encodeURIComponent(blockId)}`
      : null;
  }

  /**
   * Insert a reference to a page owned by the host. The editor stores only a
   * snapshot of the page metadata and never loads or embeds page content.
   */
  insertPageLink(page: PageInfo, options: { afterBlockId?: string } = {}): string | null {
    if (this.#readonly) return null;
    const pageId = page.id.trim();
    if (!pageId) return null;
    const pageTitle = page.title.trim() || 'Untitled page';
    const pageIcon = page.icon?.trim();
    const block = createBlock('page', {
      props: {
        pageId,
        pageTitle,
        ...(pageIcon ? { pageIcon } : {}),
      },
    });
    const afterId =
      options.afterBlockId ??
      this.#focusedBlockId ??
      this.store.selection?.focus.blockId ??
      this.store.doc.blocks[this.store.doc.blocks.length - 1]?.id ??
      null;
    let next = afterId
      ? insertBlockRelative(this.store.doc, afterId, block, 'after')
      : this.store.doc;
    if (next === this.store.doc) {
      next = { ...this.store.doc, blocks: [...this.store.doc.blocks, block] };
    }
    this.#commit(next, this.store.selection);
    return block.id;
  }

  /** Re-render page reference cards and inline page chips after host metadata changes. */
  refreshPageLinks(): void {
    for (const view of this.#viewIndex.values()) view.refreshPageLink();
    const resolve = (pageId: string): PageInfo | null => this.pageInfo(pageId);
    refreshInlinePageChips(this.#body, resolve);
    refreshInlinePageChips(this.#overlay, resolve);
  }

  /** Insert an inline page link chip at the current text selection. */
  insertInlinePageLink(page: PageInfo): boolean {
    if (this.#readonly) return false;
    const pageId = page.id.trim();
    if (!pageId) return false;
    const pageTitle = page.title.trim() || 'Untitled page';
    const pageIcon = page.icon?.trim();
    const selection = this.#currentSelection() ?? this.#lastSelection;
    let doc = this.store.doc;
    let point: Point | null = null;
    if (selection) {
      if (!this.#isCollapsed(selection)) {
        const deleted = this.#applyDeletion(doc, selection);
        doc = deleted.doc;
        point = deleted.caret;
      } else {
        point = selection.focus;
      }
    } else if (this.#focusedBlockId) {
      const focused = findBlock(doc.blocks, this.#focusedBlockId);
      if (focused && isTextualBlock(focused)) {
        point = { blockId: focused.id, offset: runsLength(focused.text) };
      }
    }
    if (!point) return false;
    const block = findBlock(doc.blocks, point.blockId);
    if (!block || !isTextualBlock(block) || block.type === 'code') return false;
    const nextRuns = insertTextAt(block.text, point.offset, pageTitle, {
      page: {
        id: pageId,
        title: pageTitle,
        ...(pageIcon ? { icon: pageIcon } : {}),
      },
    });
    const next = replaceBlockText(doc, block.id, nextRuns);
    const caret: Point = { blockId: block.id, offset: point.offset + pageTitle.length };
    this.#commit(next, { anchor: caret, focus: caret });
    this.#focusBlock(block.id, caret.offset);
    return true;
  }

  get onOpenPage(): ((pageId: string) => void) | undefined {
    return this.#options.onOpenPage;
  }

  set onOpenPage(handler: ((pageId: string) => void) | undefined) {
    this.#options.onOpenPage = handler;
  }

  get resolvePage(): ((pageId: string) => PageInfo | null) | undefined {
    return this.#options.resolvePage;
  }

  set resolvePage(handler: ((pageId: string) => PageInfo | null) | undefined) {
    this.#options.resolvePage = handler;
    this.refreshPageLinks();
  }

  setDoc(doc: Doc | string, options: { history?: boolean } = {}): void {
    const parsed = parseDoc(doc);
    this.clearBlockSelection();
    this.#toolbarDismissedKey = null;
    this.#menu.close();
    this.#toolbar.hide();
    this.#slash = null;
    this.#mention = null;
    this.#pageLink = null;
    this.#title.blur();
    this.store.replaceDoc(parsed, options);
    this.#syncBody(this.store.doc.blocks);
    this.#syncTitle();
  }

  focus(blockId?: string, offset?: number): void {
    if (blockId) {
      this.#focusBlock(blockId, offset ?? 0);
      return;
    }
    const first = this.store.doc.blocks[0];
    if (first) {
      const length = runsLength(first.text);
      this.#focusBlock(first.id, offset ?? length);
    } else {
      this.#title.focus();
    }
  }

  blur(): void {
    (document.activeElement as HTMLElement | null)?.blur();
  }

  focusTitle(): void {
    this.#title.focus();
    const selection = nativeSelection(this.root);
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(this.#title);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  setReadonly(readonly: boolean): void {
    if (this.#readonly === readonly) return;
    this.#readonly = readonly;
    if (!readonly) for (const state of this.#display.databases.values()) {
      state.view = null;
      state.groups.clear();
    }
    this.#hostElement.toggleAttribute('readonly', readonly);
    this.#title.contentEditable = readonly ? 'false' : 'true';
    this.#body.contentEditable = readonly ? 'false' : 'true';
    if (readonly) {
      this.#menu.close();
      this.#slash = null;
      this.#mention = null;
      this.#pageLink = null;
      this.#toolbar.hide();
      this.#linkPopover.hide();
    }
    for (const view of this.#views.values()) view.setReadonly(readonly);
    this.#syncPlaceholders();
  }

  setRelationSync(onRelationSync: NobitaOptions['onRelationSync']): void {
    this.#options.onRelationSync = onRelationSync;
  }

  setTheme(theme: NobitaTheme): void {
    this.#options.theme = theme;
    this.#hostElement.dataset.theme = theme;
    const root = this.root.querySelector<HTMLElement>('.nb-root');
    if (root) root.dataset.theme = theme;
  }

  setTitle(title: string): void {
    this.store.update(doc => (doc.title === title ? doc : { ...doc, title }), {
      history: false,
      source: 'set-title',
    });
    this.#syncTitle();
  }
  undo(): boolean {
    const titleFocused = this.root.activeElement === this.#title;
    const changed = this.store.undo();
    if (changed) {
      if (titleFocused) this.focusTitle();
      else this.#restoreHistorySelection();
    }
    return changed;
  }

  redo(): boolean {
    const titleFocused = this.root.activeElement === this.#title;
    const changed = this.store.redo();
    if (changed) {
      if (titleFocused) this.focusTitle();
      else this.#restoreHistorySelection();
    }
    return changed;
  }

  #restoreHistorySelection(): void {
    const selection = this.store.selection;
    if (!selection) return;
    const anchorBlock = findBlock(this.store.doc.blocks, selection.anchor.blockId);
    const focusBlock = findBlock(this.store.doc.blocks, selection.focus.blockId);
    if (!focusBlock) return;
    if (focusBlock.type === 'table' && selection.anchor.blockId === selection.focus.blockId) {
      this.#focusBlock(focusBlock.id, 0);
      return;
    }
    if (!isTextualBlock(focusBlock) || (anchorBlock && !isTextualBlock(anchorBlock))) {
      this.#selectBlockRange(anchorBlock?.id ?? focusBlock.id, focusBlock.id);
      return;
    }
    this.#restoreSelection(selection, false);
  }

  insertMarkdown(markdown: string): void {
    const result = markdownToBlocks(markdown);
    this.#insertBlocks(result.blocks);
  }

  destroy(): void {
    this.setCollaboration(null);
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#virtual?.destroy();
    this.#bodyEvents.abort();
    this.#unsubscribe();
    this.#unsubscribeSelection();
    document.removeEventListener('selectionchange', this.#onDocumentSelection);
    this.root.removeEventListener('pointerup', this.#onImmediateSelection, true);
    this.root.removeEventListener('keyup', this.#onImmediateSelection, true);
    window.removeEventListener('scroll', this.#onScroll, true);
    window.removeEventListener('resize', this.#onResize);
    window.removeEventListener('keydown', this.#onWindowKeyDown, true);
    this.#menu.close(false);
    this.#mention = null;
    this.#pageLink = null;
    this.#toolbar.hide();
    this.#linkPopover.hide();
    this.#endDrag();
    this.clearBlockSelection();
    this.#selectedBlockEls.clear();
    for (const view of this.#views.values()) view.destroy();
    this.#views.clear();
    this.#viewIndex.clear();
    this.#syncedBlocks = null;
    this.#placeholderBlockId = null;
    this.store.destroy();
    this.root.replaceChildren();
  }

  /** ---- BlockHost ---- */

  setFocusedBlock(blockId: string): void {
    this.#focusedBlockId = blockId;
  }

  registerView(view: BlockView): void {
    this.#viewIndex.set(view.id, view);
  }

  unregisterView(blockId: string): void {
    this.#viewIndex.delete(blockId);
  }

  focusBlock(blockId: string, offset = 0): void {
    this.#focusBlock(blockId, offset);
  }

  beforeInput(blockId: string, event: InputEvent): void {
    if (this.#readonly) {
      event.preventDefault();
      return;
    }
    if (event.isComposing) return;
    const type = event.inputType;
    switch (type) {
      case 'insertText':
        event.preventDefault();
        this.#insertText(blockId, event.data ?? '');
        return;
      case 'insertParagraph':
        event.preventDefault();
        this.#onEnter(blockId);
        return;
      case 'insertLineBreak':
        event.preventDefault();
        this.#insertText(blockId, '\n');
        return;
      case 'deleteContentBackward':
      case 'deleteWordBackward':
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward':
        event.preventDefault();
        this.#onBackspace(blockId);
        return;
      case 'deleteContentForward':
      case 'deleteWordForward':
      case 'deleteSoftLineForward':
      case 'deleteHardLineForward':
        event.preventDefault();
        this.#onDelete(blockId);
        return;
      case 'formatBold':
        event.preventDefault();
        this.#toggleMark('bold');
        return;
      case 'formatItalic':
        event.preventDefault();
        this.#toggleMark('italic');
        return;
      case 'formatUnderline':
        event.preventDefault();
        this.#toggleMark('underline');
        return;
      case 'formatStrikeThrough':
        event.preventDefault();
        this.#toggleMark('strike');
        return;
      case 'historyUndo':
        event.preventDefault();
        this.undo();
        return;
      case 'historyRedo':
        event.preventDefault();
        this.redo();
        return;
      case 'insertFromDrop':
        event.preventDefault();
        return;
      default:
        return;
    }
  }

  domInput(blockId: string): void {
    if (this.#readonly) return;
    const view = this.#findView(blockId);
    if (!view) return;
    const textElement = view.textElement;
    if (!textElement) return;
    const runs = readRunsFromDom(textElement);
    if (plainText(runs) === plainText(view.block.text)) return;
    const selection = nativeSelection(this.root);
    let offset = runsLength(runs);
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (textElement.contains(range.startContainer)) {
        offset = domPointToOffset(textElement, range.startContainer, range.startOffset);
      }
    }
    const caret: Point = { blockId, offset };
    const next = replaceBlockText(this.store.doc, blockId, runs);
    this.#commit(next, { anchor: caret, focus: caret }, { mergeKey: `text:${blockId}` });
  }

  keyDown(blockId: string, event: KeyboardEvent): void {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.#setBlockSelection([blockId], blockId, blockId);
      return;
    }
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.#selectAllInBlock(blockId);
      return;
    }
    if (this.#virtual && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      this.#syncBody(this.doc.blocks, [blockId]);
    }
    if (this.#readonly) return;
    const selection = this.#currentSelection();
    const block = this.#findView(blockId)?.block ?? findBlock(this.store.doc.blocks, blockId);
    const offset = selection ? this.#offsetInSelection(blockId, selection) : 0;
    const length = block ? runsLength(block.text) : 0;

    if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.undo();
      return;
    }
    if ((mod && event.key.toLowerCase() === 'z' && event.shiftKey) || (mod && event.key.toLowerCase() === 'y')) {
      event.preventDefault();
      this.redo();
      return;
    }
    if (mod && event.shiftKey) {
      const key = event.key.toLowerCase();
      const alignment: Record<string, TextAlign> = {
        l: 'left',
        e: 'center',
        r: 'right',
      };
      const target = alignment[key];
      if (target) {
        event.preventDefault();
        this.#applyAlignment(target);
        return;
      }
    }
    if (mod && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'i' || key === 'u' || key === 'e') {
        event.preventDefault();
        const mark: ToolbarMark = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : 'code';
        this.#toggleMark(mark);
        return;
      }
      if (key === 'k') {
        event.preventDefault();
        this.#toggleLink();
        return;
      }
      if (event.shiftKey && key === 's') {
        event.preventDefault();
        this.#toggleMark('strike');
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        this.#insertParagraphAfter(blockId);
        return;
      }
      if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        this.#moveBlockVertically(blockId, event.key === 'ArrowUp' ? 'before' : 'after');
        return;
      }
    }

    if (mod && event.altKey) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.#moveBlockVertically(blockId, event.key === 'ArrowUp' ? 'before' : 'after');
        return;
      }
      const key = event.key;
      const map: Record<string, { type: BlockType; level?: HeadingLevel }> = {
        '0': { type: 'paragraph' },
        '1': { type: 'heading', level: 1 },
        '2': { type: 'heading', level: 2 },
        '3': { type: 'heading', level: 3 },
        '4': { type: 'heading', level: 4 },
        '5': { type: 'heading', level: 5 },
        '6': { type: 'heading', level: 6 },
        '8': { type: 'bulleted' },
        '9': { type: 'numbered' },
        c: { type: 'code' },
      };
      const target = map[key.toLowerCase()];
      if (target) {
        event.preventDefault();
        this.#convertBlock(blockId, target.type, target.level ? { level: target.level } : {});
        return;
      }
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      if (block?.type === 'code') {
        if (!event.shiftKey) this.#insertText(blockId, '  ');
        return;
      }
      if (event.shiftKey) this.#dedent(blockId);
      else this.#indent(blockId);
      return;
    }

    if (mod && event.key === 'Backspace') {
      event.preventDefault();
      this.#dedentToRoot(blockId);
      return;
    }

    if (event.key === 'Backspace' && !mod) {
      if (selection && !this.#isCollapsed(selection)) {
        event.preventDefault();
        this.#deleteSelection();
        return;
      }
      if (offset === 0) {
        event.preventDefault();
        this.#onBackspace(blockId);
      }
      return;
    }

    if (event.key === 'Delete' && !mod) {
      if (selection && !this.#isCollapsed(selection)) {
        event.preventDefault();
        this.#deleteSelection();
        return;
      }
      if (offset >= length) {
        event.preventDefault();
        this.#onDelete(blockId);
      }
      return;
    }

    if (event.key === 'ArrowUp' && !event.shiftKey && offset === 0) {
      const previous = this.#adjacentTextBlock(blockId, -1);
      if (previous) {
        event.preventDefault();
        this.#focusBlock(previous.id, runsLength(previous.text));
      }
      return;
    }

    if (event.key === 'ArrowDown' && !event.shiftKey && offset >= length) {
      const next = this.#adjacentTextBlock(blockId, 1);
      if (next) {
        event.preventDefault();
        this.#focusBlock(next.id, 0);
      }
      return;
    }
  }

  paste(blockId: string, event: ClipboardEvent): void {
    if (this.#readonly) return;
    const image = Array.from(event.clipboardData?.files ?? []).find(file =>
      file.type.startsWith('image/')
    );
    if (image) {
      // Never let the browser insert a native <img> the model cannot see.
      event.preventDefault();
      if (this.#options.uploadImage) void this.#uploadImage(blockId, image);
      return;
    }
    event.preventDefault();
    const payload = readClipboardPayload(event);
    if (!payload) return;
    if (payload.inline && payload.blocks.length === 1 && payload.blocks[0]?.type === 'paragraph') {
      const text = plainText(payload.blocks[0].text);
      this.#insertText(blockId, text);
      return;
    }
    this.#insertBlocks(payload.blocks);
  }

  copy(event: ClipboardEvent, cut: boolean): void {
    const selection = this.#currentSelection();
    if (!selection) return;
    if (this.#isCollapsed(selection)) return;
    const blocks = selectionBlocks(this.store.doc.blocks, selection);
    if (blocks.length === 0) return;
    event.preventDefault();
    this.#copyBlocksToEvent(event, blocks);
    if (cut) {
      this.#deleteSelection();
    }
  }

  toggleTodo(blockId: string): void {
    if (this.#readonly) return;
    this.#commit(toggleChecked(this.store.doc, blockId), this.store.selection);
  }

  #databaseListeners = new Set<() => void>();
  #databaseBlocks?: readonly Block[];
  #databaseIndex = new Map<string, DatabaseData>();
  #localDatabases(blocks = this.doc.blocks) {
    if (this.#databaseBlocks !== blocks) {
      this.#databaseBlocks = blocks;
      this.#databaseIndex = documentDatabases(blocks);
    }
    return this.#databaseIndex;
  }
  #resolveDatabase = this.resolveDatabase.bind(this);
  resolveDatabase(id: string, pageId?: string) {
    return (
      (!pageId ? this.#localDatabases().get(id) : undefined) ??
      this.#options.resolveDatabase?.(id, pageId)
    );
  }
  async databaseTargets(query: string): Promise<readonly DatabaseTarget[]> {
    const local: DatabaseTarget[] = [...this.#localDatabases()].map(
      ([databaseId, data]) => ({ databaseId, title: data.title || databaseId })
    );
    const matches = local.filter(t =>
      t.title.toLowerCase().includes(query.toLowerCase())
    );
    try {
      return [
        ...matches,
        ...((await this.#options.databaseProvider?.(query)) ?? []),
      ];
    } catch {
      return matches;
    }
  }
  observeDatabases(fn: () => void) {
    this.#databaseListeners.add(fn);
    return () => {
      this.#databaseListeners.delete(fn);
    };
  }
  /** Call after the host replaces a resolved external database snapshot. */
  refreshDatabases(): void {
    for (const fn of this.#databaseListeners) fn();
  }

  updateDatabase(
    blockId: string,
    data: DatabaseData,
    options: { mergeKey?: string } = {}
  ): void {
    if (this.#readonly) return;
    const before = this.#localDatabases().get(blockId);
    if (!before) return;
    const next = updateDatabaseRelations(
      this.doc,
      blockId,
      before,
      storedDatabase(data)
    );
    this.store.update(() => next, {
      ...(options.mergeKey ? { mergeKey: options.mergeKey } : {}),
      source: 'database',
    });
  }

  undoDatabase(): void {
    this.store.undo();
  }

  redoDatabase(): void {
    this.store.redo();
  }

  undoTable(): void {
    this.store.undo();
  }

  redoTable(): void {
    this.store.redo();
  }

  focusAfterTableHistory(blockId: string): void {
    if (findBlock(this.store.doc.blocks, blockId)) {
      this.#focusBlock(blockId, 0);
    } else {
      this.#restoreSelection(this.store.selection, false);
    }
  }

  focusAfterBlock(blockId: string): void {
    const next = this.#adjacentTextBlock(blockId, 1);
    if (next) {
      this.#focusBlock(next.id, 0);
      return;
    }
    const { doc, block } = appendParagraphAfter(this.store.doc, blockId);
    const caret: Point = { blockId: block.id, offset: 0 };
    this.#commit(doc, { anchor: caret, focus: caret });
    this.#focusBlock(block.id, 0);
  }

  updateTable(blockId: string, data: TableData, options: { mergeKey?: string } = {}): void {
    if (this.#readonly) return;
    const next = updateBlock(this.store.doc, blockId, block => ({
      ...block,
      props: { ...block.props, table: data },
    }));
    this.store.update(() => next, {
      ...(options.mergeKey ? { mergeKey: options.mergeKey } : {}),
      source: 'table',
    });
  }

  setImage(blockId: string, patch: { src?: string; alt?: string; caption?: string }): void {
    if (this.#readonly) return;
    const next = setImageProps(this.store.doc, blockId, patch);
    this.#commit(next, this.store.selection);
    if (patch.src) {
      const view = this.#views.get(blockId);
      view?.focusImageCaption();
    }
  }

  async #uploadImage(
    blockId: string,
    file: File,
    replaceIds?: ReadonlySet<string>
  ): Promise<void> {
    const upload = this.#options.uploadImage;
    if (!upload || this.#readonly) return;
    const epoch = this.#docEpoch;
    try {
      const result = await upload(file);
      if (this.#destroyed || this.#readonly || epoch !== this.#docEpoch) return;
      if (!findBlock(this.store.doc.blocks, blockId)) return;
      const src = typeof result === 'string' ? result : result.src;
      if (!src) return;
      const alt = typeof result === 'string' ? undefined : result.alt;
      const caption = typeof result === 'string' ? undefined : result.caption;
      const block = createBlock('image', {
        props: {
          src,
          ...(alt ? { alt } : {}),
          ...(caption ? { caption } : {}),
        },
      });
      let next = insertBlockRelative(this.store.doc, blockId, block, 'after');
      if (replaceIds && replaceIds.size > 0) {
        next = removeBlocks(next, replaceIds).doc;
        this.clearBlockSelection();
        const point: Point = { blockId: block.id, offset: 0 };
        this.#commit(next, { anchor: point, focus: point }, { restore: false });
      } else {
        this.#commit(next, this.store.selection);
      }
      this.#findView(block.id)?.focusImageCaption();
    } catch {
      // Host upload failures leave the document untouched.
    }
  }

  pageInfo(pageId: string): PageInfo | null {
    return this.#options.resolvePage?.(pageId) ?? null;
  }

  openPage(pageId: string): void {
    if (pageId) this.#options.onOpenPage?.(pageId);
  }

  setCodeLanguage(blockId: string, language: string): void {
    if (this.#readonly) return;
    this.#commit(setCodeLanguage(this.store.doc, blockId, language), this.store.selection);
  }

  setCalloutTone(blockId: string, tone: CalloutTone): void {
    if (this.#readonly) return;
    this.#commit(setCalloutTone(this.store.doc, blockId, tone), this.store.selection);
  }

  openBlockMenu(blockId: string, anchor: HTMLElement | FloatingAnchor): void {
    const block = findBlock(this.store.doc.blocks, blockId);
    if (!block) return;
    const items = buildBlockMenuItems({
      block,
      getDoc: () => this.store.doc,
      pointFromCaret: () => this.#pointFromCaret(blockId),
      commit: (next, caret) => this.#commit(next, caret),
      focusBlock: (id, offset) => this.#focusBlock(id, offset),
      copyBlock: offset => this.#copyBlockToClipboard(blockId, offset),
      copyMarkdown: () => this.#copyMarkdown([block]),
      copyLink: () => this.#copyBlockLink(blockId),
      deleteBlock: () => this.#deleteBlock(blockId),
    });
    const rect =
      anchor instanceof Element
        ? rectAnchor(anchor.getBoundingClientRect())
        : { x: anchor.left, y: anchor.top, ...anchor };
    this.#menu.open({
      items,
      anchor: rect,
      width: 300,
    });
  }

  #openMultiBlockMenu(anchor: FloatingAnchor): void {
    const blocks = selectedTopLevelBlocks(this.store.doc.blocks, this.#selectedBlockIds);
    if (blocks.length === 0) return;
    const items = buildMultiBlockMenuItems({
      count: blocks.length,
      copyBlocks: () => this.#writeBlocksToClipboard(blocks),
      copyMarkdown: () => this.#copyMarkdown(blocks),
      duplicateBlocks: () => this.#duplicateSelectedBlocks(),
      deleteBlocks: () => this.#deleteSelectedBlocks(),
    });
    this.#menu.open({
      items,
      anchor: { x: anchor.left, y: anchor.top, ...anchor },
      width: 260,
    });
  }

  addBlockAfter(blockId: string): void {
    if (this.#readonly) return;
    const { doc, block } = appendParagraphAfter(this.store.doc, blockId);
    this.#commit(doc, { anchor: { blockId: block.id, offset: 0 }, focus: { blockId: block.id, offset: 0 } });
    this.#focusBlock(block.id, 0);
  }

  beginDrag(blockId: string, event: PointerEvent, handle: HTMLElement): void {
    if (this.#readonly) return;
    if (this.#drag) this.#endDrag();
    const line = document.createElement('div');
    line.className = 'nb-drop-line';
    this.#drag = {
      blockId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      pointerId: event.pointerId,
      handle,
      targetId: null,
      position: null,
      line,
      targetElement: null,
    };
    window.addEventListener('pointermove', this.#onDragMove, true);
    window.addEventListener('pointerup', this.#onDragEnd, true);
    window.addEventListener('pointercancel', this.#onDragCancel, true);
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic or already-released pointers are fine without capture.
    }
  }

  selectionChanged(): void {
    this.#handleSelectionChange();
  }

  /** ---- internals ---- */

  #isNestedField(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    const element = target.nodeType === Node.ELEMENT_NODE ? (target as Element) : target.parentElement;
    return Boolean(element?.closest('.nb-caption, .nb-db, .nb-image-placeholder, .nb-page-link, .nb-table, input, textarea, select'));
  }

  #activeBlockId(target: EventTarget | null): string | null {
    const selection = this.#currentSelection();
    if (selection) return selection.focus.blockId;
    const element = target instanceof Node ? closestElement(target, '.nb-block') : null;
    return element?.dataset.blockId ?? this.#focusedBlockId;
  }

  #blockIdFromTarget(target: EventTarget | null): string | null {
    const element = target instanceof Node ? closestElement(target, '.nb-block') : null;
    return element?.dataset.blockId ?? null;
  }

  #nearestBlock(clientY: number): string | null {
    let bestId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [id, view] of this.#views) {
      const rect = view.element.getBoundingClientRect();
      const distance =
        clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = id;
      }
    }
    return bestId;
  }

  #bindBody(): void {
    const body = this.#body;
    const signal = this.#bodyEvents.signal;

    body.addEventListener(
      'keydown',
      event => {
        if (event.key === 'Escape' && event.target instanceof Element && event.target.closest('.nb-page-link')) {
          const blockId = this.#blockIdFromTarget(event.target);
          if (blockId) {
            event.preventDefault();
            this.#setBlockSelection([blockId], blockId, blockId);
          }
          return;
        }
        if (this.#isNestedField(event.target)) return;
        if (this.#virtual && !event.altKey && !event.isComposing && (event.ctrlKey || event.metaKey) &&
            (event.key === 'Home' || event.key === 'End')) {
          const blocks = this.#visibleBlocks();
          const end = event.key === 'End';
          const target = end ? blocks.at(-1) : blocks[0];
          if (!target) return;
          event.preventDefault();
          const anchor = event.shiftKey ? this.#currentSelection()?.anchor : undefined;
          if (this.#selectedBlockIds.size || !isTextualBlock(target)) {
            this.#selectBlockRange((event.shiftKey && (this.#blockAnchorId ?? anchor?.blockId)) || target.id, target.id);
          } else {
            const focus = { blockId: target.id, offset: end ? runsLength(target.text) : 0 };
            this.#restoreSelection({ anchor: anchor ?? focus, focus });
          }
          return;
        }
        if (this.#selectedBlockIds.size > 0) {
          this.#onBlockSelectionKeyDown(event);
          return;
        }
        const blockId = this.#activeBlockId(event.target);
        if (blockId) this.keyDown(blockId, event);
      },
      { signal }
    );

    body.addEventListener(
      'beforeinput',
      event => {
        if (this.#isNestedField(event.target)) return;
        if (this.#selectedBlockIds.size > 0) {
          event.preventDefault();
          return;
        }
        const blockId = this.#activeBlockId(event.target);
        if (blockId) this.beforeInput(blockId, event as InputEvent);
      },
      { signal }
    );

    body.addEventListener(
      'input',
      event => {
        if (this.#isNestedField(event.target) || this.#composing) return;
        const blockId = this.#activeBlockId(event.target);
        if (blockId) this.domInput(blockId);
      },
      { signal }
    );

    body.addEventListener(
      'compositionstart',
      event => {
        if (this.#isNestedField(event.target)) return;
        this.#composing = true;
        this.#compositionBlockId = this.#activeBlockId(null);
        this.#syncPlaceholders();
      },
      { signal }
    );

    body.addEventListener(
      'compositionend',
      event => {
        if (this.#isNestedField(event.target)) return;
        this.#composing = false;
        const blockId = this.#compositionBlockId ?? this.#activeBlockId(null);
        this.#compositionBlockId = null;
        if (blockId) this.domInput(blockId);
        this.#syncPlaceholders();
      },
      { signal }
    );

    body.addEventListener(
      'focusout',
      () => {
        queueMicrotask(() => this.#syncPlaceholders());
      },
      { signal }
    );

    body.addEventListener(
      'paste',
      event => {
        if (this.#isNestedField(event.target)) return;
        if (this.#selectedBlockIds.size > 0) {
          this.#pasteInBlockSelection(event);
          return;
        }
        const blockId = this.#activeBlockId(event.target);
        if (blockId) this.paste(blockId, event);
      },
      { signal }
    );

    body.addEventListener(
      'copy',
      event => {
        if (this.#isNestedField(event.target)) return;
        if (this.#selectedBlockIds.size > 0) {
          this.#copySelectedBlocks(event, false);
          return;
        }
        const selection = this.#currentSelection();
        const blockId = selection ? this.#ordered(selection).start.blockId : null;
        if (blockId) this.copy(event, false);
      },
      { signal }
    );

    body.addEventListener(
      'cut',
      event => {
        if (this.#isNestedField(event.target)) return;
        if (this.#selectedBlockIds.size > 0) {
          this.#copySelectedBlocks(event, true);
          return;
        }
        const selection = this.#currentSelection();
        const blockId = selection ? this.#ordered(selection).start.blockId : null;
        if (blockId) this.copy(event, true);
      },
      { signal }
    );

    body.addEventListener(
      'focusin',
      event => {
        const target = event.target instanceof Node ? event.target : null;
        const pageLink = target ? closestElement(target, '.nb-page-link') : null;
        if (this.#selectedBlockIds.size > 0 && (pageLink || this.#isNestedField(event.target))) {
          this.clearBlockSelection();
        }
        if (pageLink) {
          const pageBlock = closestElement(pageLink, '.nb-block');
          if (pageBlock?.dataset.blockId) this.setFocusedBlock(pageBlock.dataset.blockId);
          return;
        }
        if (this.#isNestedField(event.target)) return;
        const element = closestElement(event.target as Node, '.nb-block');
        const blockId = element?.dataset.blockId;
        if (blockId) this.setFocusedBlock(blockId);
        this.selectionChanged();
      },
      { signal }
    );

    body.addEventListener(
      'click',
      event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const add = target.closest<HTMLElement>('.nb-add');
        if (add) {
          const blockId = add.closest<HTMLElement>('.nb-block')?.dataset.blockId;
          if (blockId) {
            event.preventDefault();
            event.stopPropagation();
            this.addBlockAfter(blockId);
          }
          return;
        }
        if (this.#handleInlineNavClick(target, event)) return;
        const link = target.closest<HTMLElement>('[data-link]');
        if (link && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          const href = safeHref(link.dataset.link);
          if (href) window.open(href, '_blank', 'noopener,noreferrer');
        }
        if (target.closest('.nb-text')) {
          this.clearBlockSelection();
          return;
        }
        const row = target.closest<HTMLElement>('.nb-row');
        if (!row) return;
        if (target.closest('button, input, select, .nb-text, .nb-caption, .nb-db, .nb-table')) {
          return;
        }
        const blockId = row.closest<HTMLElement>('.nb-block')?.dataset.blockId;
        if (!blockId) return;
        const block = this.#findView(blockId)?.block;
        if (block?.type === 'divider' || (block?.type === 'image' && Boolean(block.props.src))) {
          if (event.shiftKey) {
            const anchor = this.#blockAnchorId ?? this.#focusedBlockId ?? blockId;
            this.#selectBlockRange(anchor, blockId);
          } else if (event.metaKey || event.ctrlKey) {
            this.#toggleBlockInSelection(blockId);
          } else {
            this.#setBlockSelection([blockId], blockId, blockId);
          }
          return;
        }
        this.clearBlockSelection();
        this.focusBlock(blockId, 0);
      },
      { signal }
    );

    body.addEventListener(
      'pointerdown',
      event => {
        if (event.button === 2) return;
        const target = event.target instanceof Element ? event.target : null;
        const drag = target?.closest<HTMLElement>('.nb-drag');
        if (drag) {
          const blockId = drag.closest<HTMLElement>('.nb-block')?.dataset.blockId;
          if (blockId) {
            if (event.shiftKey) {
              event.preventDefault();
              const anchor = this.#blockAnchorId ?? this.#focusedBlockId ?? blockId;
              this.#selectBlockRange(anchor, blockId);
              return;
            }
            if (event.metaKey || event.ctrlKey) {
              event.preventDefault();
              this.#toggleBlockInSelection(blockId);
              return;
            }
            if (!this.#readonly) {
              event.preventDefault();
              this.beginDrag(blockId, event, drag);
            }
          }
          return;
        }
        if (target?.closest('.nb-text')) {
          this.clearBlockSelection();
        }
        if (this.#isNestedField(event.target)) return;
        if (closestElement(event.target as Node, '.nb-block')) return;
        const nearest = this.#nearestBlock(event.clientY);
        if (nearest) {
          event.preventDefault();
          this.#focusBlock(nearest, 0);
        }
      },
      { signal }
    );

    body.addEventListener(
      'contextmenu',
      event => {
        if (this.#readonly || event.shiftKey) return;
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        if (target.closest('.nb-table, .nb-db, .nb-caption, .nb-image-placeholder, input, textarea, select')) {
          return;
        }
        const blockId = target.closest<HTMLElement>('.nb-block')?.dataset.blockId;
        if (!blockId) return;
        event.preventDefault();
        this.#toolbar.hide();
        this.#linkPopover.hide();
        const anchor = pointAnchor(event.clientX, event.clientY);
        if (this.#selectedBlockIds.size > 1 && this.#selectedBlockIds.has(blockId)) {
          this.#openMultiBlockMenu(anchor);
          return;
        }
        this.#setBlockSelection([blockId], blockId, blockId, false);
        this.openBlockMenu(blockId, anchor);
      },
      { signal }
    );

    body.addEventListener(
      'dragstart',
      event => {
        if (this.#isNestedField(event.target)) return;
        event.preventDefault();
      },
      { signal }
    );

    body.addEventListener(
      'dragover',
      event => {
        const types = Array.from(event.dataTransfer?.types ?? []);
        if (!types.includes('Files')) return;
        event.preventDefault();
        if (
          !this.#readonly &&
          this.#options.uploadImage &&
          event.dataTransfer
        ) {
          event.dataTransfer.dropEffect = 'copy';
        }
      },
      { signal }
    );

    body.addEventListener(
      'drop',
      event => {
        const file = Array.from(event.dataTransfer?.files ?? []).find(item =>
          item.type.startsWith('image/')
        );
        if (file) {
          event.preventDefault();
          if (this.#readonly || !this.#options.uploadImage) return;
          const blockId =
            this.#blockIdFromTarget(event.target) ??
            this.#nearestBlock(event.clientY) ??
            this.#activeBlockId(null);
          if (blockId) void this.#uploadImage(blockId, file);
          return;
        }
        event.preventDefault();
      },
      { signal }
    );
  }

  #bindTitle(): void {
    const title = this.#title;
    title.addEventListener('input', () => {
      if (this.#readonly) return;
      const value = (title.textContent ?? '').replace(/\r?\n/gu, ' ');
      this.store.update(doc => (doc.title === value ? doc : { ...doc, title: value }), {
        mergeKey: 'title',
        source: 'title',
      });
    });
    title.addEventListener('keydown', event => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        this.redo();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        this.focus();
      } else if (event.key === 'ArrowDown') {
        const selection = nativeSelection(this.root);
        if (selection?.anchorNode && title.contains(selection.anchorNode)) {
          const text = title.textContent ?? '';
          const offset = domPointToOffset(title, selection.anchorNode, selection.anchorOffset);
          if (offset >= text.length) {
            event.preventDefault();
            this.focus();
          }
        }
      }
    });
    title.addEventListener('paste', event => {
      event.preventDefault();
      const text = event.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, text.replace(/\r?\n/gu, ' '));
    });
    title.addEventListener('focus', () => {
      this.clearBlockSelection();
      this.#focusedBlockId = null;
      this.#toolbar.hide();
      this.#syncPlaceholders();
    });
  }

  #handleInlineNavClick(target: Element, event: MouseEvent): boolean {
    const inlinePage = target.closest<HTMLElement>('.nb-m-page');
    if (inlinePage) {
      const pageId = inlinePage.dataset.pageId;
      if (pageId) {
        event.preventDefault();
        event.stopPropagation();
        this.openPage(pageId);
      }
      return true;
    }
    const link = target.closest<HTMLElement>('[data-link]');
    if (!link) return false;
    const href = safeHref(link.dataset.link);
    if (href?.startsWith('#block-')) {
      event.preventDefault();
      event.stopPropagation();
      const blockId = decodeURIComponent(href.slice('#block-'.length));
      if (this.#viewIndex.has(blockId) || findBlock(this.store.doc.blocks, blockId)) {
        this.#focusBlock(blockId, 0);
      }
      return true;
    }
    if (href?.startsWith('#page-')) {
      event.preventDefault();
      event.stopPropagation();
      const raw = href.slice('#page-'.length);
      let pageId = raw;
      try {
        pageId = decodeURIComponent(raw);
      } catch {
        // Keep raw fragment if malformed.
      }
      if (pageId) this.openPage(pageId);
      return true;
    }
    return false;
  }

  #bindChrome(): void {
    this.#overlay.addEventListener(
      'click',
      event => {
        const target = event.target instanceof Element ? event.target : null;
        if (target) this.#handleInlineNavClick(target, event);
      },
      { signal: this.#bodyEvents.signal }
    );
    document.addEventListener('selectionchange', this.#onDocumentSelection);
    this.root.addEventListener('pointerup', this.#onImmediateSelection, true);
    this.root.addEventListener('keyup', this.#onImmediateSelection, true);
    window.addEventListener('scroll', this.#onScroll, true);
    window.addEventListener('resize', this.#onResize);
    window.addEventListener('keydown', this.#onWindowKeyDown, true);
    this.#tail.addEventListener('mousedown', event => {
      event.preventDefault();
      const blocks = this.store.doc.blocks;
      const last = blocks[blocks.length - 1];
      if (!last) {
        const block = createBlock('paragraph');
        this.#commit({ ...this.store.doc, blocks: [block] }, {
          anchor: { blockId: block.id, offset: 0 },
          focus: { blockId: block.id, offset: 0 },
        });
        this.#focusBlock(block.id, 0);
        return;
      }
      if (!isTextualBlock(last)) {
        const { doc, block } = appendParagraphAfter(this.store.doc, last.id);
        const caret: Point = { blockId: block.id, offset: 0 };
        this.#commit(doc, { anchor: caret, focus: caret });
        this.#focusBlock(block.id, 0);
        return;
      }
      const lastText = flattenBlocks(blocks).reverse().find(isTextualBlock);
      if (lastText) this.#focusBlock(lastText.id, runsLength(lastText.text));
    });
  }

  #onStoreChange(change: { doc: Doc; previous: Doc; source: string }): void {
    if (this.#destroyed) return;
    if (change.source === 'replace') {
      this.#display.databases.clear();
      this.#docEpoch += 1;
      this.clearBlockSelection();
    }
    this.#syncBody(change.doc.blocks, undefined, change.source !== 'replace');
    if (this.#display.databases.size) {
      const local = this.#localDatabases();
      for (const id of this.#display.databases.keys()) if (!local.has(id)) this.#display.databases.delete(id);
    }
    this.refreshDatabases();
    const sync = this.#options.onRelationSync;
    if (sync && change.source !== 'replace' && change.source !== 'remote') {
      const before = documentDatabases(change.previous.blocks),
        after = this.#localDatabases();
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(id) === after.get(id)) continue;
        for (const delta of relationChanges(id, before.get(id), after.get(id)))
          if (
            delta.target.pageId ||
            (!before.has(delta.target.databaseId) && !after.has(delta.target.databaseId))
          )
            sync(delta);
      }
    }
    if (change.source !== 'replace' && this.#selectedBlockIds.size > 0) {
      for (const id of this.#selectedBlockIds) {
        if (!this.#findView(id) && !(this.#virtual?.has(id) ?? findBlock(change.doc.blocks, id))) {
          this.#selectedBlockIds.delete(id);
        }
      }
      if (
        this.#blockAnchorId &&
        !this.#findView(this.#blockAnchorId) &&
        !findBlock(change.doc.blocks, this.#blockAnchorId)
      ) {
        this.#blockAnchorId = this.#selectedBlockIds.values().next().value ?? null;
      }
      if (
        this.#blockFocusId &&
        !this.#findView(this.#blockFocusId) &&
        !findBlock(change.doc.blocks, this.#blockFocusId)
      ) {
        const remaining = Array.from(this.#selectedBlockIds);
        this.#blockFocusId = remaining[remaining.length - 1] ?? null;
      }
      this.#syncBlockSelection();
    }
    this.#syncTitle();
    this.#syncPlaceholders();
    this.#options.onChange?.(change.doc, { source: change.source });
  }

  #syncTitle(): void {
    const title = this.store.doc.title;
    if ((this.#title.textContent ?? '') !== title) this.#title.textContent = title;
    this.#title.contentEditable = this.#readonly ? 'false' : 'true';
  }

  #syncBody(blocks: readonly Block[], pins?: string[], preserveState = true): void {
    const unchanged = blocks === this.#syncedBlocks;
    if (unchanged && !pins) return;
    this.#syncedBlocks = blocks;
    const option = this.#options.virtualize;
    const config = typeof option === 'object' ? option : undefined;
    let layout: number[] | undefined;
    if (!this.#printing && option !== false && blocks.length >= (config?.threshold ?? 300)) {
      this.#virtual ??= new Virtualizer(this.#body, Math.max(0, config?.overscanPx ?? 800),
        () => { if (!this.#printing) this.#syncBody(this.doc.blocks, []); });
      const selection = this.#currentSelection() ?? this.#lastSelection;
      const active = this.root.activeElement?.closest<HTMLElement>('.nb-block');
      layout = this.#virtual.layout(blocks, [
        this.#compositionBlockId, this.#drag?.blockId, active?.dataset.blockId, this.#focusedBlockId,
        selection?.anchor.blockId, selection?.focus.blockId, ...(pins ?? []),
        ...Array.from(this.#overlay.querySelectorAll<HTMLElement>('[data-record-owner]'), el => el.dataset.recordOwner),
      ]);
      if (unchanged && layout.length === this.#layout.length && layout.every((n, i) => n === this.#layout[i])) return;
      this.#layout = layout;
    } else if (!this.#printing && this.#virtual) {
      this.#virtual.destroy();
      this.#virtual = undefined;
      this.#layout = [];
    }
    const restoreAnchor = unchanged && this.#virtual?.anchor(this.#views.values());
    for (const gap of this.#gaps) gap.remove();
    this.#gaps.length = 0;
    if (this.#views.size) {
      const ids = new Set(layout ? layout.filter(i => i >= 0).map(i => blocks[i]!.id) : blocks.map(b => b.id));
      for (const [id, view] of this.#views) {
        if (ids.has(id)) continue;
        this.#virtual?.unobserve(view.element);
        view.destroy(preserveState && !!layout && !!this.#virtual?.has(id));
        this.#views.delete(id);
      }
    }
    let cursor = this.#body.firstChild;
    let number = 0, previous = -1;
    const render = (block: Block, index: number) => {
      if (block.type === 'numbered' && previous !== index - 1) {
        number = 0;
        for (let i = index - 1; i >= 0 && blocks[i]!.type === 'numbered'; i--) number++;
      }
      previous = index;
      number = block.type === 'numbered' ? number + 1 : 0;
      const context = { depth: 0, index, number };
      let view = this.#views.get(block.id);
      if (!view) {
        view = new BlockView(this, block, context, this.#display);
        this.#views.set(block.id, view);
      }
      if (view.element === cursor) cursor = cursor.nextSibling;
      else this.#body.insertBefore(view.element, cursor);
      view.update(block, context);
      if (layout) this.#virtual!.observe(view.element);
    };
    if (!layout) { blocks.forEach(render); return; }
    for (const index of layout) {
      if (index >= 0) render(blocks[index]!, index);
      else {
        const gap = document.createElement('div');
        gap.contentEditable = 'false';
        gap.setAttribute('aria-hidden', 'true');
        gap.style.height = -index + 'px';
        this.#body.insertBefore(gap, cursor);
        this.#gaps.push(gap);
      }
    }
    if (restoreAnchor) restoreAnchor();
    if (this.#selectedBlockIds.size) this.#syncBlockSelection();
  }

  /** Reveal a block (including a nested block) without changing the selection. */
  scrollToBlock(blockId: string): boolean {
    if (this.#virtual) this.#syncBody(this.doc.blocks, [blockId]);
    const view = this.#findView(blockId);
    let ancestor = view?.element.parentElement?.closest<HTMLElement>('.nb-block[data-collapsed="true"]');
    while (ancestor) {
      this.#display.revealed.add(this.#viewIndex.get(ancestor.dataset.blockId!)!.block.props);
      delete ancestor.dataset.collapsed;
      ancestor = ancestor.parentElement?.closest<HTMLElement>('.nb-block[data-collapsed="true"]');
    }
    view?.element.scrollIntoView({ block: 'nearest' });
    return !!view;
  }

  #syncPlaceholders(): void {
    const selection =
      this.#readonly || this.#composing || this.#selectedBlockIds.size > 0
        ? null
        : this.#currentSelection();
    const activeId =
      selection && this.#isCollapsed(selection) ? selection.focus.blockId : null;
    const activeView = activeId ? this.#findView(activeId) : null;
    const nextText =
      activeView && runsLength(activeView.block.text) === 0
        ? this.#placeholderFor(activeView.block)
        : '';
    const nextId = nextText ? activeId : null;

    if (this.#placeholderBlockId && this.#placeholderBlockId !== nextId) {
      this.#findView(this.#placeholderBlockId)?.setPlaceholder('');
    }
    if (nextId && activeView) {
      activeView.setPlaceholder(nextText);
    }
    this.#placeholderBlockId = nextId;
  }

  #placeholderFor(block: Block): string {
    if (block.type === 'paragraph') return this.placeholder;
    if (block.type === 'heading') return `Heading ${block.props.level ?? 1}`;
    return '';
  }

  #findView(blockId: string): BlockView | null {
    return this.#viewIndex.get(blockId) ?? null;
  }

  #focusBlock(blockId: string, offset: number): void {
    if (this.#virtual) this.scrollToBlock(blockId);
    const view = this.#findView(blockId);
    const block = view?.block ?? findBlock(this.store.doc.blocks, blockId);
    if (!view || !block) return;
    this.clearBlockSelection();
    this.#menu.close();
    this.#slash = null;
    if (block.type === 'database') {
      view.focusDatabase();
      return;
    }
    if (block.type === 'table') {
      this.#focusedBlockId = blockId;
      view.focusTable();
      return;
    }
    if (block.type === 'image') {
      view.focusImageInput();
      return;
    }
    if (block.type === 'divider') {
      const next = this.#adjacentTextBlock(blockId, 1);
      if (next) this.#focusBlock(next.id, 0);
      return;
    }
    if (block.type === 'page') {
      this.#focusedBlockId = blockId;
      view.focusPageLink();
      return;
    }
    const point: Point = { blockId, offset };
    this.#restoreSelection({ anchor: point, focus: point }, false);
    this.#focusedBlockId = blockId;
  }

  #currentSelection(): EditorSelection | null {
    const selection = nativeSelection(this.root);
    if (!selection || selection.rangeCount === 0) return null;
    const anchor = this.#pointForNode(selection.anchorNode, selection.anchorOffset);
    const focus = this.#pointForNode(selection.focusNode, selection.focusOffset);
    if (!anchor || !focus) return null;
    return { anchor, focus };
  }

  #pointForNode(node: Node | null, offset: number): Point | null {
    if (!node) return null;
    if (!isNodeInside(node, this.root)) return null;
    if (isNodeInside(node, this.#title)) return null;
    const element = closestElement(node, '.nb-block');
    if (!element) return null;
    const blockId = element.dataset.blockId;
    if (!blockId) return null;
    const view = this.#findView(blockId);
    const textElement = view?.textElement;
    if (!view || !textElement) return null;
    const localOffset = textElement.contains(node)
      ? domPointToOffset(textElement, node, offset)
      : 0;
    return { blockId, offset: Math.min(localOffset, runsLength(view.block.text)) };
  }

  #restoreSelection(selection: EditorSelection | null, preventScroll = false): void {
    if (!selection) return;
    if (this.#virtual) this.#syncBody(this.doc.blocks, [selection.anchor.blockId, selection.focus.blockId]);
    const anchorView = this.#findView(selection.anchor.blockId);
    const focusView = this.#findView(selection.focus.blockId);
    if (!anchorView?.textElement || !focusView?.textElement) return;
    if (this.#selectedBlockIds.size > 0) this.clearBlockSelection();
    const anchorPoint = offsetToDomPoint(anchorView.textElement, selection.anchor.offset);
    const focusPoint = offsetToDomPoint(focusView.textElement, selection.focus.offset);
    this.#body.focus({ preventScroll: true });
    const native = nativeSelection(this.root);
    if (!native) return;
    try {
      native.setBaseAndExtent(anchorPoint.node, anchorPoint.offset, focusPoint.node, focusPoint.offset);
    } catch {
      const range = document.createRange();
      range.setStart(anchorPoint.node, anchorPoint.offset);
      range.collapse(true);
      native.removeAllRanges();
      native.addRange(range);
    }
    if (!preventScroll) {
      const rect = focusView.element.getBoundingClientRect();
      if (this.#virtual || rect.top < 8 || rect.bottom > window.innerHeight - 8) {
        focusView.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    this.#lastSelection = selection;
    this.store.setSelection(selection);
    this.#syncPlaceholders();
  }

  #isCollapsed(selection: EditorSelection): boolean {
    return (
      selection.anchor.blockId === selection.focus.blockId &&
      selection.anchor.offset === selection.focus.offset
    );
  }

  #ordered(selection: EditorSelection): { start: Point; end: Point } {
    const { start, end } = orderedRange(this.store.doc.blocks, selection);
    return { start, end };
  }

  #blockRange(
    selection: EditorSelection,
    blocks: readonly Block[] = this.store.doc.blocks
  ) {
    return blockRange(blocks, selection);
  }

  #offsetInSelection(blockId: string, selection: EditorSelection): number {
    if (selection.focus.blockId === blockId) return selection.focus.offset;
    if (selection.anchor.blockId === blockId) return selection.anchor.offset;
    return 0;
  }

  #commit(
    next: Doc,
    caret: EditorSelection | null,
    options: { history?: boolean; mergeKey?: string; restore?: boolean } = {}
  ): void {
    if (next === this.store.doc) {
      if (caret) this.#restoreSelection(caret);
      return;
    }
    const previous = this.#localDatabases();
    if (previous.size) {
      const remaining = this.#localDatabases(next.blocks);
      for (const [id, database] of previous) {
        if (!remaining.has(id)) next = updateDatabaseRelations(next, id, database);
      }
    }
    this.store.update(() => next, {
      ...(caret ? { selection: caret } : {}),
      ...(options.history === false ? { history: false } : {}),
      ...(options.mergeKey ? { mergeKey: options.mergeKey } : {}),
    });
    if (caret && options.restore !== false) this.#restoreSelection(caret);
  }

  #pointFromCaret(blockId: string): Point {
    const selection = this.#currentSelection();
    if (selection && this.#isCollapsed(selection) && selection.anchor.blockId === blockId) {
      return selection.anchor;
    }
    const view = this.#findView(blockId);
    if (!view) return { blockId, offset: 0 };
    return { blockId, offset: view.caretOffset() };
  }

  /** ---- input ---- */

  #insertText(blockId: string, text: string): void {
    if (this.#readonly || !text) return;
    let doc = this.store.doc;
    let point = this.#pointFromCaret(blockId);
    const selection = this.#currentSelection();
    if (selection && !this.#isCollapsed(selection)) {
      const deleted = this.#applyDeletion(doc, selection);
      doc = deleted.doc;
      if (!deleted.caret) return;
      point = deleted.caret;
    }
    const block = findBlock(doc.blocks, point.blockId);
    if (!block) return;
    const before = plainText(block.text);

    // Block shortcuts: "# " → heading, "- " → list, "``` " → code, ...
    if (text === ' ') {
      const blockMatch = matchBlockMarkdown(`${before} `);
      if (blockMatch && point.offset === before.length) {
        doc = setBlockType(
          doc,
          point.blockId,
          blockMatch.type,
          blockMatch.props
        );
        doc = replaceBlockText(doc, point.blockId, []);
        this.#slash = null;
        this.#menu.close();
        let caret: Point = { blockId: point.blockId, offset: 0 };
        if (blockMatch.type === 'divider') {
          const paragraph = createBlock('paragraph');
          doc = insertBlockRelative(doc, point.blockId, paragraph, 'after');
          caret = { blockId: paragraph.id, offset: 0 };
        }
        this.#commit(doc, { anchor: caret, focus: caret });
        if (blockMatch.type === 'divider') this.#focusBlock(caret.blockId, 0);
        return;
      }
      const inline = matchInlineMarkdown(before);
      if (inline && inline.end === point.offset) {
        const replaced = replaceBlockText(doc, point.blockId, [
          ...sliceRuns(block.text, 0, inline.start),
          { text: inline.text, marks: inline.marks },
          ...sliceRuns(block.text, inline.end, runsLength(block.text)),
        ]);
        const caretOffset = inline.start + inline.text.length;
        const inserted = insertTextAt(
          findBlock(replaced.blocks, point.blockId)?.text ?? [],
          caretOffset,
          ' '
        );
        doc = replaceBlockText(replaced, point.blockId, inserted);
        this.#pendingMarks = undefined;
        const caret: Point = { blockId: point.blockId, offset: caretOffset + 1 };
        this.#commit(doc, { anchor: caret, focus: caret }, { mergeKey: `text:${point.blockId}` });
        return;
      }
    }

    const marks = this.#pendingMarks;
    const runs = insertTextAt(
      block.text,
      point.offset,
      text,
      marks === undefined ? undefined : marks
    );
    doc = replaceBlockText(doc, point.blockId, runs);
    const caret: Point = { blockId: point.blockId, offset: point.offset + text.length };
    this.#pendingMarks = undefined;
    this.#commit(doc, { anchor: caret, focus: caret }, { mergeKey: `text:${point.blockId}` });

    if (text === '/' && this.#isSlashPosition(before, point.offset)) {
      this.#openSlashMenu(point.blockId, point.offset);
    } else if (
      text === '@' &&
      block.type !== 'code' &&
      this.#options.mentionProvider &&
      this.#isSlashPosition(before, point.offset)
    ) {
      void this.#openMentionMenu(point.blockId, point.offset);
    } else if (
      text === '[' &&
      block.type !== 'code' &&
      this.#options.pageProvider &&
      point.offset > 0 &&
      before[point.offset - 1] === '[' &&
      !this.#pageLink
    ) {
      void this.#openPageLinkMenu(point.blockId, point.offset - 1, 'inline');
    } else if (this.#slash) {
      this.#syncSlashMenu();
    } else if (this.#mention) {
      this.#syncMentionMenu();
    } else if (this.#pageLink) {
      this.#syncPageLinkMenu();
    }
  }

  #isSlashPosition(before: string, offset: number): boolean {
    if (offset === 0) return true;
    const previous = before[offset - 1];
    return previous === ' ' || previous === '\n' || previous === '\t';
  }

  #applyDeletion(doc: Doc, selection: EditorSelection): { doc: Doc; caret: Point | null } {
    const range = this.#blockRange(selection, doc.blocks);
    if (!range) return { doc, caret: null };
    const { flat, start, end, startIndex, endIndex } = range;
    if (startIndex === endIndex) {
      const block = flat[startIndex];
      if (!block) return { doc, caret: null };
      const runs = deleteTextRange(block.text, start.offset, end.offset);
      return {
        doc: replaceBlockText(doc, start.blockId, runs),
        caret: { blockId: start.blockId, offset: Math.min(start.offset, runsLength(runs)) },
      };
    }
    const startBlock = flat[startIndex];
    const endBlock = flat[endIndex];
    if (!startBlock || !endBlock) return { doc, caret: null };
    const between = flat.slice(startIndex + 1, endIndex).map(block => block.id);
    let next = replaceBlockText(
      doc,
      start.blockId,
      normalizeRuns([
        ...sliceRuns(startBlock.text, 0, start.offset),
        ...sliceRuns(endBlock.text, end.offset, runsLength(endBlock.text)),
      ])
    );
    next = {
      ...next,
      blocks: setChildrenDeep(next.blocks, start.blockId, [
        ...startBlock.children,
        ...endBlock.children,
      ]),
    };
    for (const id of [...between, end.blockId]) next = removeById(next, id);
    return {
      doc: next,
      caret: {
        blockId: start.blockId,
        offset: Math.min(start.offset, runsLength(findBlock(next.blocks, start.blockId)?.text ?? [])),
      },
    };
  }

  #deleteSelection(): void {
    this.#scheduleMentionSync();
    this.#schedulePageLinkSync();
    const selection = this.#currentSelection();
    if (!selection || this.#isCollapsed(selection)) return;
    const { doc, caret } = this.#applyDeletion(this.store.doc, selection);
    this.#commit(doc, caret ? { anchor: caret, focus: caret } : null);
  }

  #onEnter(blockId: string): void {
    const selection = this.#currentSelection();
    if (selection && !this.#isCollapsed(selection)) {
      this.#deleteSelection();
    }
    const point = this.#pointFromCaret(blockId);
    const block = findBlock(this.store.doc.blocks, blockId);
    if (!block) return;
    if (block.type === 'page') {
      this.#insertParagraphAfter(blockId);
      return;
    }
    if (block.type === 'table') {
      this.#insertParagraphAfter(blockId);
      return;
    }
    const length = runsLength(block.text);
    const text = plainText(block.text);

    if (block.type !== 'code' && text === '---') {
      this.#convertBlock(blockId, 'divider');
      return;
    }
    if (block.type !== 'code' && text === '```') {
      this.#convertBlock(blockId, 'code');
      return;
    }

    if (block.type === 'code') {
      this.#insertText(blockId, '\n');
      return;
    }

    if (text.length === 0 && (block.type === 'bulleted' || block.type === 'numbered' || block.type === 'todo')) {
      const location = locateBlock(this.store.doc.blocks, blockId);
      if (location && location.depth > 0) {
        this.#dedent(blockId);
      } else {
        this.#convertBlock(blockId, 'paragraph');
      }
      return;
    }

    if (point.offset >= length && (block.type === 'heading' || block.type === 'quote' || block.type === 'callout')) {
      this.#insertParagraphAfter(blockId);
      return;
    }

    const result = splitBlock(this.store.doc, blockId, point.offset);
    const caret: Point = { blockId: result.newBlock.id, offset: 0 };
    this.#commit(result.doc, { anchor: caret, focus: caret });
    this.#focusBlock(caret.blockId, caret.offset);
  }

  #insertParagraphAfter(blockId: string): void {
    const { doc, block } = appendParagraphAfter(this.store.doc, blockId);
    const caret: Point = { blockId: block.id, offset: 0 };
    this.#commit(doc, { anchor: caret, focus: caret });
    this.#focusBlock(block.id, 0);
  }

  #onBackspace(blockId: string): void {
    this.#scheduleMentionSync();
    this.#schedulePageLinkSync();
    const selection = this.#currentSelection();
    if (selection && !this.#isCollapsed(selection)) {
      this.#deleteSelection();
      return;
    }
    const point = this.#pointFromCaret(blockId);
    const block = findBlock(this.store.doc.blocks, blockId);
    if (!block) return;
    if (point.offset > 0) {
      const atomic = atomicRangeAt(block.text, point.offset - 1);
      const start = atomic?.start ?? point.offset - 1;
      const end = atomic?.end ?? point.offset;
      const runs = deleteTextRange(block.text, start, end);
      const caret: Point = { blockId, offset: start };
      this.#commit(replaceBlockText(this.store.doc, blockId, runs), { anchor: caret, focus: caret }, {
        mergeKey: `delete:${blockId}`,
      });
      return;
    }
    if (block.type !== 'paragraph' && isTextualBlock(block)) {
      const next = setBlockType(this.store.doc, blockId, 'paragraph');
      const caret: Point = { blockId, offset: 0 };
      this.#commit(next, { anchor: caret, focus: caret });
      return;
    }
    const location = locateBlock(this.store.doc.blocks, blockId);
    if (location && location.depth > 0) {
      this.#dedent(blockId);
      return;
    }
    const previous = location ? location.siblings[location.index - 1] : undefined;
    if (previous && !isTextualBlock(previous)) return;
    const merged = mergeBlockWithPrevious(this.store.doc, blockId);
    if (!merged) return;
    const caret: Point = { blockId: merged.caretBlockId, offset: merged.caretOffset };
    this.#commit(merged.doc, { anchor: caret, focus: caret });
    this.#focusBlock(caret.blockId, caret.offset);
  }

  #onDelete(blockId: string): void {
    this.#scheduleMentionSync();
    this.#schedulePageLinkSync();
    const selection = this.#currentSelection();
    if (selection && !this.#isCollapsed(selection)) {
      this.#deleteSelection();
      return;
    }
    const point = this.#pointFromCaret(blockId);
    const block = findBlock(this.store.doc.blocks, blockId);
    if (!block) return;
    const length = runsLength(block.text);
    if (point.offset < length) {
      const atomic = atomicRangeAt(block.text, point.offset);
      const start = atomic?.start ?? point.offset;
      const end = atomic?.end ?? point.offset + 1;
      const runs = deleteTextRange(block.text, start, end);
      const caret: Point = { blockId, offset: start };
      this.#commit(replaceBlockText(this.store.doc, blockId, runs), { anchor: caret, focus: caret }, {
        mergeKey: `delete:${blockId}`,
      });
      return;
    }
    const location = locateBlock(this.store.doc.blocks, blockId);
    const next = location ? location.siblings[location.index + 1] : undefined;
    if (next && !isTextualBlock(next)) return;
    const merged = mergeBlockWithNext(this.store.doc, blockId);
    if (!merged) return;
    const caret: Point = { blockId, offset: point.offset };
    this.#commit(merged, { anchor: caret, focus: caret });
  }

  #convertBlock(blockId: string, type: BlockType, props: Partial<BlockProps> = {}): void {
    const current = findBlock(this.store.doc.blocks, blockId);
    if (!current) return;
    let next = setBlockType(this.store.doc, blockId, type, props);
    let caret: Point = { blockId, offset: 0 };
    if (type === 'divider') {
      const paragraph = createBlock('paragraph');
      next = insertBlockRelative(next, blockId, paragraph, 'after');
      caret = { blockId: paragraph.id, offset: 0 };
    }
    this.#commit(next, { anchor: caret, focus: caret });
    if (type === 'image') {
      this.#findView(blockId)?.focusImageInput();
    } else {
      this.#focusBlock(caret.blockId, caret.offset);
    }
  }

  #moveBlockVertically(
    blockId: string,
    direction: 'before' | 'after',
    offset?: number
  ): void {
    const location = locateBlock(this.store.doc.blocks, blockId);
    if (!location) return;
    const point: Point = {
      blockId,
      offset: offset ?? this.#pointFromCaret(blockId).offset,
    };
    const sibling = location.siblings[location.index + (direction === 'before' ? -1 : 1)];
    if (!sibling) {
      this.#focusBlock(blockId, point.offset);
      return;
    }
    this.#commit(moveBlock(this.store.doc, blockId, sibling.id, direction), {
      anchor: point,
      focus: point,
    });
    this.#focusBlock(blockId, point.offset);
  }

  #copyBlockToClipboard(blockId: string, offset: number): void {
    const block = findBlock(this.store.doc.blocks, blockId);
    if (!block) return;
    void this.#writeBlocksToClipboard([block])
      .catch(() => undefined)
      .finally(() => {
        this.#focusBlock(blockId, offset);
      });
  }

  #copyMarkdown(blocks: Block[]) {
    return this.#writePlainTextToClipboard(blocksToMarkdown(
      { ...this.doc, blocks },
      { title: false, resolveDatabase: this.#resolveDatabase }
    ));
  }

  async #writeBlocksToClipboard(blocks: Block[]): Promise<void> {
    const payload = serializeBlocksForClipboard(blocks, this.#resolveDatabase, blocks.map(duplicateBlockTree));
    if (await this.#writeModernClipboard(payload, true)) return;
    if (this.#writeLegacyClipboard(payload)) return;
    if (await this.#writeModernClipboard(payload, false)) return;
    try {
      await navigator.clipboard?.writeText(payload.text);
    } catch {
      // Clipboard access can be denied; leave the document untouched.
    }
  }

  async #writeModernClipboard(
    payload: ClipboardPayload,
    includeJson: boolean
  ): Promise<boolean> {
    const clipboard = navigator.clipboard;
    if (!clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    const data: Record<string, Blob> = {
      'text/plain': new Blob([payload.text], { type: 'text/plain' }),
      'text/html': new Blob([payload.html], { type: 'text/html' }),
    };
    if (includeJson) {
      data['application/x-nobita+json'] = new Blob([payload.json], {
        type: 'application/x-nobita+json',
      });
    }
    try {
      await clipboard.write([new ClipboardItem(data)]);
      return true;
    } catch {
      return false;
    }
  }

  #writeLegacyClipboard(payload: ClipboardPayload): boolean {
    if (typeof document.execCommand !== 'function' || !document.body) {
      return false;
    }
    const field = document.createElement('textarea');
    field.value = payload.text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.left = '-9999px';
    field.style.top = '0';
    field.style.opacity = '0';
    field.style.pointerEvents = 'none';
    const onCopy = (event: ClipboardEvent): void => {
      if (!event.clipboardData) return;
      event.preventDefault();
      writeClipboardData(event.clipboardData, payload);
    };
    document.addEventListener('copy', onCopy, true);
    document.body.append(field);
    try {
      field.focus();
      field.select();
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      field.remove();
      document.removeEventListener('copy', onCopy, true);
    }
  }

  #indent(blockId: string): void {
    const next = indentBlock(this.store.doc, blockId);
    if (next === this.store.doc) return;
    const point = this.#pointFromCaret(blockId);
    this.#commit(next, { anchor: point, focus: point });
    this.#focusBlock(blockId, point.offset);
  }

  #dedent(blockId: string): void {
    const next = dedentBlock(this.store.doc, blockId);
    if (next === this.store.doc) return;
    const point = this.#pointFromCaret(blockId);
    this.#commit(next, { anchor: point, focus: point });
    this.#focusBlock(blockId, point.offset);
  }

  #dedentToRoot(blockId: string): void {
    let doc = this.store.doc;
    let guard = 0;
    while ((locateBlock(doc.blocks, blockId)?.depth ?? 0) > 0 && guard < 100) {
      doc = dedentBlock(doc, blockId);
      guard += 1;
    }
    if (doc === this.store.doc) return;
    const point = this.#pointFromCaret(blockId);
    this.#commit(doc, { anchor: point, focus: point });
    this.#focusBlock(blockId, point.offset);
  }

  #selectAllInBlock(blockId: string): void {
    const view = this.#findView(blockId);
    const block = findBlock(this.store.doc.blocks, blockId);
    if (!view || !block) return;
    const selection = this.#currentSelection();
    const length = runsLength(block.text);
    const spansEntireBlock =
      selection !== null &&
      selection.anchor.blockId === blockId &&
      selection.focus.blockId === blockId &&
      ((selection.anchor.offset === 0 && selection.focus.offset === length) ||
        (selection.anchor.offset === length && selection.focus.offset === 0));
    if (length > 0 && !spansEntireBlock) {
      this.#restoreSelection({
        anchor: { blockId, offset: 0 },
        focus: { blockId, offset: length },
      });
      return;
    }
    const ids = this.store.doc.blocks.map(b => b.id);
    if (ids.length > 0) {
      this.#setBlockSelection(ids, ids[0]!, ids[ids.length - 1]!);
    }
  }

  /** ---- block selection ---- */

  #syncBlockSelection(): void {
    const nextEls = new Set<HTMLElement>();
    if (this.#selectedBlockIds.size) {
      for (const [id, view] of this.#viewIndex) {
        if (this.#selectedBlockIds.has(id)) nextEls.add(view.element);
      }
    }
    for (const el of this.#selectedBlockEls) {
      if (!nextEls.has(el)) {
        el.classList.remove('nb-block-selected');
        el.removeAttribute('aria-selected');
      }
    }
    for (const el of nextEls) {
      if (!this.#selectedBlockEls.has(el)) {
        el.classList.add('nb-block-selected');
        el.setAttribute('aria-selected', 'true');
      }
    }
    this.#selectedBlockEls = nextEls;
  }

  #setBlockSelection(
    ids: Iterable<string>,
    anchorId: string | null,
    focusId: string | null,
    focusBody = true
  ): void {
    this.#selectedBlockIds = new Set(ids);
    this.#blockAnchorId = anchorId;
    this.#blockFocusId = focusId;
    if (this.#selectedBlockIds.size > 0) {
      nativeSelection(this.root)?.removeAllRanges();
      this.#toolbar.hide();
      this.#linkPopover.hide();
      this.#menu.close();
      this.#mention = null;
      if (focusBody) {
        this.#body.focus({ preventScroll: true });
      }
      if (focusId) {
        if (this.#virtual && !this.#findView(focusId)) this.scrollToBlock(focusId);
        const el = this.#findView(focusId)?.element;
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top < 8 || rect.bottom > window.innerHeight - 8) {
            el.scrollIntoView({ block: 'nearest' });
          }
        }
      }
    }
    this.#syncBlockSelection();
    this.#syncPlaceholders();
  }

  #visibleBlocks(blocks: readonly Block[] = this.store.doc.blocks): Block[] {
    const out: Block[] = [];
    const visit = (list: readonly Block[]): void => {
      for (const block of list) {
        out.push(block);
        if (block.children.length && (!block.props.collapsed || this.#display.revealed.has(block.props))) {
          visit(block.children);
        }
      }
    };
    visit(blocks);
    return out;
  }

  #selectBlockRange(anchorId: string, focusId: string, focusBody = true): void {
    const order = this.#visibleBlocks();
    const a = order.findIndex(b => b.id === anchorId);
    const f = order.findIndex(b => b.id === focusId);
    if (a < 0 || f < 0) {
      if (findBlock(this.store.doc.blocks, focusId)) {
        this.#setBlockSelection([focusId], focusId, focusId, focusBody);
      }
      return;
    }
    const start = Math.min(a, f);
    const end = Math.max(a, f);
    const ids = order.slice(start, end + 1).map(b => b.id);
    this.#setBlockSelection(ids, anchorId, focusId, focusBody);
  }

  #toggleBlockInSelection(blockId: string, focusBody = true): void {
    const next = new Set(this.#selectedBlockIds);
    let nextAnchor = this.#blockAnchorId;
    let nextFocus = this.#blockFocusId;
    if (next.has(blockId)) {
      next.delete(blockId);
      if (next.size === 0) {
        this.clearBlockSelection();
        return;
      }
      if (nextAnchor === blockId || !nextAnchor || !next.has(nextAnchor)) {
        nextAnchor = next.values().next().value ?? null;
      }
      if (nextFocus === blockId || !nextFocus || !next.has(nextFocus)) {
        const remaining = Array.from(next);
        nextFocus = remaining[remaining.length - 1] ?? null;
      }
    } else {
      next.add(blockId);
      nextAnchor ??= blockId;
      nextFocus = blockId;
    }
    this.#setBlockSelection(next, nextAnchor, nextFocus, focusBody);
  }

  #onBlockSelectionKeyDown(event: KeyboardEvent): void {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (event.key === 'Escape') {
      event.preventDefault();
      const focusId = this.#blockFocusId;
      this.clearBlockSelection();
      const block = focusId ? findBlock(this.store.doc.blocks, focusId) : null;
      if (block && isTextualBlock(block)) {
        this.#focusBlock(block.id, runsLength(block.text));
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const order = this.#visibleBlocks();
      if (order.length === 0) return;
      const currentId = this.#blockFocusId ?? this.#blockAnchorId;
      const currentIndex = currentId ? order.findIndex(b => b.id === currentId) : -1;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex =
        currentIndex < 0
          ? delta > 0
            ? 0
            : order.length - 1
          : Math.max(0, Math.min(order.length - 1, currentIndex + delta));
      const nextId = order[nextIndex]?.id;
      if (!nextId) return;
      if (event.shiftKey) {
        this.#selectBlockRange(this.#blockAnchorId ?? nextId, nextId);
      } else {
        this.#setBlockSelection([nextId], nextId, nextId);
      }
      return;
    }

    if (mod && key === 'a') {
      event.preventDefault();
      const ids = this.store.doc.blocks.map(b => b.id);
      if (ids.length > 0) {
        this.#setBlockSelection(ids, ids[0]!, ids[ids.length - 1]!);
      }
      return;
    }

    if (!this.#readonly && handleHistoryKey(event, redo => (redo ? this.redo() : this.undo()))) {
      return;
    }

    if (event.key === 'Enter' && !mod && !event.altKey && !event.shiftKey) {
      if (this.#readonly) return;
      event.preventDefault();
      const selected = selectedTopLevelBlocks(this.store.doc.blocks, this.#selectedBlockIds);
      const last = selected[selected.length - 1];
      if (!last) return;
      const { doc, block } = appendParagraphAfter(this.store.doc, last.id);
      this.clearBlockSelection();
      const caret: Point = { blockId: block.id, offset: 0 };
      this.#commit(doc, { anchor: caret, focus: caret });
      this.#focusBlock(block.id, 0);
      return;
    }

    if ((event.key === 'Backspace' || event.key === 'Delete') && !mod) {
      if (this.#readonly) return;
      event.preventDefault();
      this.#deleteSelectedBlocks();
      return;
    }

    if (mod && key === 'd') {
      event.preventDefault();
      this.#duplicateSelectedBlocks();
    }
  }

  #duplicateSelectedBlocks(): void {
    if (this.#readonly || this.#selectedBlockIds.size === 0) return;
    const { doc, duplicatedIds } = duplicateBlocks(this.store.doc, this.#selectedBlockIds);
    if (duplicatedIds.length === 0) return;
    const firstDup = duplicatedIds[0]!;
    const lastDup = duplicatedIds[duplicatedIds.length - 1]!;
    this.#commit(
      doc,
      {
        anchor: { blockId: firstDup, offset: 0 },
        focus: { blockId: lastDup, offset: 0 },
      },
      { restore: false }
    );
    this.#setBlockSelection(duplicatedIds, firstDup, lastDup);
  }

  #deleteSelectedBlocks(): void {
    if (this.#readonly || this.#selectedBlockIds.size === 0) return;
    const { doc: nextDoc, focusBlockId } = removeBlocks(this.store.doc, this.#selectedBlockIds);
    this.clearBlockSelection();
    const focusBlock = focusBlockId ? findBlock(nextDoc.blocks, focusBlockId) : null;
    if (focusBlock && isTextualBlock(focusBlock)) {
      const caret: Point = { blockId: focusBlock.id, offset: runsLength(focusBlock.text) };
      this.#commit(nextDoc, { anchor: caret, focus: caret });
      this.#focusBlock(caret.blockId, caret.offset);
      return;
    }
    const point: Point | null = focusBlock ? { blockId: focusBlock.id, offset: 0 } : null;
    this.#commit(
      nextDoc,
      point ? { anchor: point, focus: point } : null,
      { restore: false }
    );
    if (focusBlock) {
      this.#setBlockSelection([focusBlock.id], focusBlock.id, focusBlock.id);
    }
  }

  #copyBlocksToEvent(event: ClipboardEvent, blocks: Block[]): void {
    writeClipboardData(event.clipboardData, serializeBlocksForClipboard(blocks, this.#resolveDatabase));
  }

  #copySelectedBlocks(event: ClipboardEvent, cut: boolean): void {
    event.preventDefault();
    const blocks = selectedTopLevelBlocks(this.store.doc.blocks, this.#selectedBlockIds);
    if (blocks.length === 0) return;
    this.#copyBlocksToEvent(event, blocks);
    if (cut && !this.#readonly) {
      this.#deleteSelectedBlocks();
    }
  }

  #pasteInBlockSelection(event: ClipboardEvent): void {
    event.preventDefault();
    if (this.#readonly) return;
    const selected = selectedTopLevelBlocks(this.store.doc.blocks, this.#selectedBlockIds);
    if (selected.length === 0) return;
    const lastSelected = selected[selected.length - 1]!;
    const image = Array.from(event.clipboardData?.files ?? []).find(file =>
      file.type.startsWith('image/')
    );
    if (image) {
      if (this.#options.uploadImage) {
        void this.#uploadImage(
          lastSelected.id,
          image,
          new Set(selected.map(block => block.id))
        );
      }
      return;
    }
    const payload = readClipboardPayload(event);
    if (!payload || payload.blocks.length === 0) return;
    const copies = payload.blocks.map(duplicateBlockTree);
    const inserted = insertBlocksAfter(this.store.doc, lastSelected.id, copies);
    const { doc: nextDoc } = removeBlocks(inserted, new Set(selected.map(b => b.id)));
    this.clearBlockSelection();
    const lastCopy = copies[copies.length - 1]!;
    if (isTextualBlock(lastCopy)) {
      const caret: Point = { blockId: lastCopy.id, offset: runsLength(lastCopy.text) };
      this.#commit(nextDoc, { anchor: caret, focus: caret });
      this.#focusBlock(caret.blockId, caret.offset);
      return;
    }
    const pastedIds = copies.map(b => b.id);
    this.#commit(
      nextDoc,
      {
        anchor: { blockId: pastedIds[0]!, offset: 0 },
        focus: { blockId: pastedIds[pastedIds.length - 1]!, offset: 0 },
      },
      { restore: false }
    );
    this.#setBlockSelection(pastedIds, pastedIds[0]!, pastedIds[pastedIds.length - 1]!);
  }

  #adjacentTextBlock(blockId: string, direction: -1 | 1): Block | null {
    const blocks = flattenBlocks(this.store.doc.blocks).filter(isTextualBlock);
    const index = blocks.findIndex(block => block.id === blockId);
    return index < 0 ? null : blocks[index + direction] ?? null;
  }

  #insertBlocks(blocks: Block[]): void {
    if (blocks.length === 0 || this.#readonly) return;
    const selection = this.#currentSelection();
    let doc = this.store.doc;
    let caretPoint: Point | null = null;
    if (selection && !this.#isCollapsed(selection)) {
      const deleted = this.#applyDeletion(doc, selection);
      doc = deleted.doc;
      caretPoint = deleted.caret;
    }
    const focused = this.#focusedBlockId;
    const fallbackBlock = doc.blocks[doc.blocks.length - 1];
    const point =
      caretPoint ??
      (focused
        ? this.#pointFromCaret(focused)
        : fallbackBlock
          ? { blockId: fallbackBlock.id, offset: runsLength(fallbackBlock.text) }
          : null);
    if (!point) return;
    const block = findBlock(doc.blocks, point.blockId);
    if (!block) return;
    const length = runsLength(block.text);
    const inserted = blocks.map(blockItem => duplicateBlockTree(blockItem));
    const first = inserted[0];
    if (!first) return;
    let caret: Point;

    if (!isTextualBlock(block)) {
      doc = insertBlocksAfter(doc, block.id, inserted);
      const last = inserted[inserted.length - 1] ?? block;
      caret = { blockId: last.id, offset: runsLength(last.text) };
      this.#commit(doc, { anchor: caret, focus: caret });
      this.#focusBlock(caret.blockId, caret.offset);
      return;
    }

    if (point.offset === 0 && length === 0) {
      doc = updateBlock(doc, block.id, () => ({
        ...first,
        id: block.id,
        children: [...first.children, ...block.children],
      }));
      doc = insertBlocksAfter(doc, block.id, inserted.slice(1));
      const last = inserted[inserted.length - 1];
      caret = { blockId: block.id, offset: runsLength(first.text) };
      if (inserted.length > 1 && last) caret = { blockId: last.id, offset: runsLength(last.text) };
    } else {
      const head = sliceRuns(block.text, 0, point.offset);
      const tail = sliceRuns(block.text, point.offset, length);
      doc = replaceBlockText(doc, block.id, head);
      const list = [...inserted];
      if (tail.length > 0) {
        list.push(
          createBlock(block.type === 'code' ? 'paragraph' : block.type, {
            text: tail,
            props: block.props,
          })
        );
      }
      doc = insertBlocksAfter(doc, block.id, list);
      const last = inserted[inserted.length - 1];
      caret = { blockId: last?.id ?? block.id, offset: runsLength(last?.text ?? []) };
    }
    this.#commit(doc, { anchor: caret, focus: caret });
    this.#focusBlock(caret.blockId, caret.offset);
  }


  /** ---- marks & toolbar ---- */

  #updateToolbar(): void {
    if (this.#readonly || this.#menu.isOpen) {
      this.#toolbar.hide();
      return;
    }
    const selection = this.#currentSelection();
    if (!selection || this.#isCollapsed(selection)) {
      this.#toolbarDismissedKey = null;
      this.#toolbar.hide();
      return;
    }
    const selectionKey = this.#selectionKey(selection);
    if (this.#toolbarDismissedKey !== null) {
      if (this.#toolbarDismissedKey === selectionKey) {
        this.#toolbar.hide();
        return;
      }
      this.#toolbarDismissedKey = null;
    }
    const rect = selectionRect(this.root);
    if (!rect) {
      this.#toolbar.hide();
      return;
    }
    const range = this.#blockRange(selection);
    const block = range ? range.flat[range.startIndex] : null;
    if (!range || !block) {
      this.#toolbar.hide();
      return;
    }
    const { start, end, flat, startIndex, endIndex } = range;
    let state: InlineMark;
    if (startIndex === endIndex) {
      state = markStateInRange(block.text, start.offset, end.offset);
    } else {
      state = {
        ...markStateInRange(block.text, start.offset, runsLength(block.text)),
      };
      let highlight: HighlightColor | undefined;
      let color: TextColor | undefined;
      let first = true;
      for (let index = startIndex; index <= endIndex; index += 1) {
        const current = flat[index];
        if (!current) continue;
        const from = index === startIndex ? start.offset : 0;
        const to = index === endIndex ? end.offset : runsLength(current.text);
        const part = markStateInRange(current.text, from, to);
        if (first) {
          highlight = part.highlight;
          color = part.color;
          first = false;
        } else {
          if (highlight !== part.highlight) highlight = undefined;
          if (color !== part.color) color = undefined;
        }
      }
      if (highlight) state.highlight = highlight;
      else delete state.highlight;
      if (color) state.color = color;
      else delete state.color;
    }
    this.#toolbar.show(
      rect,
      state,
      block.props.align ?? 'left',
      block.type,
      block.props.level
    );
  }

  #selectionBlockIds(
    selection: EditorSelection | null,
    fallbackToFocused = false
  ): string[] {
    if (!selection) {
      return fallbackToFocused && this.#focusedBlockId
        ? [this.#focusedBlockId]
        : [];
    }
    if (this.#isCollapsed(selection)) return [selection.focus.blockId];
    const range = this.#blockRange(selection);
    if (!range) return [];
    return range.flat
      .slice(range.startIndex, range.endIndex + 1)
      .map(block => block.id);
  }

  #applyTurnInto(type: BlockType, level?: HeadingLevel): void {
    if (this.#readonly) return;
    const selection = this.#currentSelection() ?? this.#lastSelection;
    if (!selection) return;
    const ids = this.#selectionBlockIds(selection);
    if (ids.length === 0) return;
    let doc = this.store.doc;
    for (const id of ids) {
      doc = setBlockType(doc, id, type, level ? { level } : {});
    }
    this.#commit(doc, selection);
    this.#updateToolbar();
  }

  #applyAlignment(align: TextAlign): void {
    if (this.#readonly) return;
    const selection = this.#currentSelection() ?? this.#lastSelection;
    const ids = this.#selectionBlockIds(selection, true);
    if (ids.length === 0) return;
    const caret: EditorSelection | null =
      selection ??
      (this.#focusedBlockId
        ? {
            anchor: { blockId: this.#focusedBlockId, offset: 0 },
            focus: { blockId: this.#focusedBlockId, offset: 0 },
          }
        : null);
    let doc = this.store.doc;
    for (const id of ids) doc = setBlockAlign(doc, id, align);
    this.#commit(doc, caret);
    this.#updateToolbar();
  }

  #alignBlockAt(blockId: string, align: TextAlign, offset: number): void {
    const next = setBlockAlign(this.store.doc, blockId, align);
    const caret: Point = { blockId, offset };
    this.#commit(next, { anchor: caret, focus: caret });
    this.#focusBlock(blockId, offset);
  }

  #applyValueMark(
    transform: (runs: Block['text'], from: number, to: number) => Block['text']
  ): void {
    if (this.#readonly) return;
    if (this.#transformSelection(transform)) this.#updateToolbar();
  }

  #applyHighlight(highlight: HighlightColor | null): void {
    this.#applyValueMark((runs, from, to) =>
      setHighlightInRange(runs, from, to, highlight)
    );
  }

  #applyTextColor(color: TextColor | null): void {
    this.#applyValueMark((runs, from, to) =>
      setTextColorInRange(runs, from, to, color)
    );
  }

  #transformSelection(
    transform: (runs: Block['text'], from: number, to: number) => Block['text']
  ): boolean {
    const selection = this.#currentSelection() ?? this.#lastSelection;
    if (!selection || this.#isCollapsed(selection)) return false;
    const range = this.#blockRange(selection);
    if (!range) return false;
    const { start, end, flat, startIndex, endIndex } = range;
    let doc = this.store.doc;
    if (startIndex === endIndex) {
      const block = flat[startIndex];
      if (!block) return false;
      doc = replaceBlockText(
        doc,
        start.blockId,
        transform(block.text, start.offset, end.offset)
      );
    } else {
      for (let index = startIndex; index <= endIndex; index += 1) {
        const block = flat[index];
        if (!block) continue;
        const current = findBlock(doc.blocks, block.id);
        if (!current) continue;
        const from = index === startIndex ? start.offset : 0;
        const to = index === endIndex ? end.offset : runsLength(current.text);
        doc = replaceBlockText(
          doc,
          block.id,
          transform(current.text, from, to)
        );
      }
    }
    this.#commit(doc, selection);
    return true;
  }

  #toggleMark(key: ToolbarMark): void {
    if (this.#readonly) return;
    const selection = this.#currentSelection() ?? this.#lastSelection;
    if (!selection) return;
    if (this.#isCollapsed(selection)) {
      const block = findBlock(this.store.doc.blocks, selection.anchor.blockId);
      if (!block) return;
      const base = this.#pendingMarks ?? marksAt(block.text, selection.anchor.offset) ?? {};
      const next: InlineMark = { ...base };
      // Typing after an atomic chip must not extend the reference.
      delete next.mention;
      delete next.page;
      if (next[key]) delete next[key];
      else next[key] = true;
      this.#pendingMarks = next;
      this.#lastSelectionKey = this.#selectionKey(selection);
      this.#toolbar.update(
        next,
        block.props.align ?? 'left',
        block.type,
        block.props.level
      );
      this.#toolbar.hide();
      return;
    }
    const changed = this.#transformSelection((runs, from, to) =>
      toggleMarkInRange(runs, from, to, key)
    );
    if (changed) this.#updateToolbar();
  }

  #toggleLink(): void {
    if (this.#readonly) return;
    const selection = this.#currentSelection();
    if (!selection || this.#isCollapsed(selection)) return;
    const rect = selectionRect(this.root);
    if (!rect) return;
    this.#savedSelection = selection;
    const { start, end } = this.#ordered(selection);
    const block = findBlock(this.store.doc.blocks, start.blockId);
    const initial = block ? markStateInRange(block.text, start.offset, Math.max(start.offset + 1, end.offset)).link : undefined;
    this.#toolbar.hide();
    this.#linkPopover.show(rect, initial, value => {
      const restored = this.#savedSelection;
      this.#savedSelection = null;
      if (!restored) return;
      this.#restoreSelection(restored);
      const link = value ? normalizeLink(value) : null;
      const range = this.#blockRange(restored);
      if (!range) return;
      const { start, end, flat, startIndex, endIndex } = range;
      let doc = this.store.doc;
      const linkMark: InlineMark | undefined = link ? { link } : undefined;
      if (startIndex === endIndex) {
        const target = flat[startIndex];
        if (target) {
          doc = replaceBlockText(
            doc,
            start.blockId,
            applyMarkPatch(target.text, start.offset, end.offset, { link })
          );
        }
      } else {
        for (let index = startIndex; index <= endIndex; index += 1) {
          const current = flat[index];
          if (!current) continue;
          const from = index === startIndex ? start.offset : 0;
          const to = index === endIndex ? end.offset : runsLength(current.text);
          doc = replaceBlockText(
            doc,
            current.id,
            applyMarkPatch(current.text, from, to, { link: linkMark ? link : null })
          );
        }
      }
      this.#commit(doc, restored, { restore: true });
    });
  }

  /** ---- mentions ---- */

  async #openMentionMenu(blockId: string, offset: number): Promise<void> {
    const provider = this.#options.mentionProvider;
    if (!provider || this.#readonly) return;
    this.#slash = null;
    this.#pageLink = null;
    const mention: MentionState = {
      blockId,
      start: offset,
      end: offset + 1,
      query: '',
    };
    this.#mention = mention;
    let items: readonly MentionItem[];
    try {
      items = await Promise.resolve(provider.search(''));
    } catch {
      if (this.#mention === mention) this.#mention = null;
      return;
    }
    if (this.#mention !== mention) return;
    const selection = this.#currentSelection();
    const active = this.root.activeElement;
    if (
      this.#readonly ||
      !active ||
      !this.#body.contains(active) ||
      !selection ||
      !this.#isCollapsed(selection) ||
      selection.anchor.blockId !== blockId ||
      selection.anchor.offset < offset
    ) {
      this.#mention = null;
      return;
    }
    this.#menu.open({
      items: this.#mentionMenuItems(items, mention),
      anchor: rectAnchor(this.#caretRect(blockId)),
      filterable: true,
      query: mention.query,
      width: 280,
      onClose: () => {
        if (this.#mention === mention) this.#mention = null;
      },
    });
    // The query may have advanced while the initial search was in flight.
    if (mention.query.length > 0) this.#syncMentionMenu(true);
  }

  #scheduleMentionSync(): void {
    if (!this.#mention || this.#mentionSyncQueued) return;
    this.#mentionSyncQueued = true;
    queueMicrotask(() => {
      this.#mentionSyncQueued = false;
      if (this.#mention) this.#syncMentionMenu();
    });
  }

  #syncMentionMenu(forceSearch = false): void {
    const mention = this.#mention;
    if (!mention) return;
    const selection = this.#currentSelection();
    const valid =
      selection !== null &&
      this.#isCollapsed(selection) &&
      selection.anchor.blockId === mention.blockId;
    const block = valid ? findBlock(this.store.doc.blocks, mention.blockId) : undefined;
    const end = valid ? selection.anchor.offset : -1;
    const query = block && end > mention.start ? plainText(block.text).slice(mention.start + 1, end) : '';
    if (!block || end <= mention.start || /[\s\n]/u.test(query)) {
      if (this.#mention === mention) this.#mention = null;
      this.#menu.close();
      return;
    }
    const queryChanged = query !== mention.query;
    mention.end = end;
    mention.query = query;
    if (!this.#menu.isOpen) return;
    this.#menu.setQuery(query);
    const provider = this.#options.mentionProvider;
    if (!provider || (!forceSearch && !queryChanged)) return;
    const token = ++this.#mentionQueryToken;
    void Promise.resolve(provider.search(query))
      .then(items => {
        if (this.#mention !== mention || token !== this.#mentionQueryToken) {
          return;
        }
        this.#menu.setItems(this.#mentionMenuItems(items, mention));
      })
      .catch(() => undefined);
  }

  #mentionMenuItems(
    items: readonly MentionItem[],
    mention: MentionState
  ): MenuItem[] {
    return items.map(item => ({
      id: `mention-${item.id}`,
      label: item.label,
      icon: icon.user,
      group: 'Mentions',
      keywords: [item.id, ...(item.keywords ?? [])],
      action: () => this.#insertMention(mention, item),
    }));
  }

  #insertMention(mention: MentionState, item: MentionItem): void {
    const block = findBlock(this.store.doc.blocks, mention.blockId);
    if (!block) return;
    const end = Math.min(mention.end, runsLength(block.text));
    const runs = deleteTextRange(block.text, mention.start, end);
    const text = `@${item.label}`;
    const nextRuns = insertTextAt(runs, mention.start, text, {
      mention: {
        id: item.id,
        label: item.label,
        ...(item.kind ? { kind: item.kind } : {}),
      },
    });
    const next = replaceBlockText(this.store.doc, mention.blockId, nextRuns);
    this.#mention = null;
    const caret: Point = {
      blockId: mention.blockId,
      offset: mention.start + text.length,
    };
    this.#commit(next, { anchor: caret, focus: caret });
    this.#focusBlock(mention.blockId, caret.offset);
  }

  /** ---- page links (`[[` & `/page`) ---- */

  async #openPageLinkMenu(
    blockId: string,
    startOffset: number,
    mode: 'inline' | 'block'
  ): Promise<void> {
    const provider = this.#options.pageProvider;
    if (!provider || this.#readonly) return;
    const triggerLength = mode === 'inline' ? 2 : 0;
    const state: PageLinkState = {
      blockId,
      start: startOffset,
      end: startOffset + triggerLength,
      query: '',
      triggerLength,
      mode,
      items: [],
    };
    this.#slash = null;
    this.#mention = null;
    this.#pageLink = state;
    const epoch = this.#docEpoch;
    let items: readonly PageInfo[];
    try {
      items = await Promise.resolve(provider.search(''));
    } catch {
      if (this.#pageLink === state) this.#pageLink = null;
      return;
    }
    if (this.#destroyed || this.#readonly || epoch !== this.#docEpoch || this.#pageLink !== state) {
      return;
    }
    const selection = this.#currentSelection();
    const active = this.root.activeElement;
    if (
      !active ||
      !this.#body.contains(active) ||
      !selection ||
      !this.#isCollapsed(selection) ||
      selection.anchor.blockId !== blockId ||
      selection.anchor.offset < state.start + state.triggerLength
    ) {
      this.#pageLink = null;
      return;
    }
    state.items = items;
    this.#menu.open({
      items: this.#pageLinkMenuItems(items, state),
      anchor: rectAnchor(this.#caretRect(blockId)),
      filterable: true,
      query: state.query,
      width: 300,
      onClose: () => {
        if (this.#pageLink === state) this.#pageLink = null;
      },
    });
    if (state.query.length > 0) this.#syncPageLinkMenu(true);
  }

  #schedulePageLinkSync(): void {
    if (!this.#pageLink || this.#pageLinkSyncQueued) return;
    this.#pageLinkSyncQueued = true;
    queueMicrotask(() => {
      this.#pageLinkSyncQueued = false;
      if (this.#pageLink) this.#syncPageLinkMenu();
    });
  }

  #syncPageLinkMenu(forceSearch = false): void {
    const state = this.#pageLink;
    if (!state) return;
    const selection = this.#currentSelection();
    const valid =
      selection !== null &&
      this.#isCollapsed(selection) &&
      selection.anchor.blockId === state.blockId;
    const block = valid ? findBlock(this.store.doc.blocks, state.blockId) : undefined;
    const end = valid ? selection.anchor.offset : -1;
    const minEnd = state.start + state.triggerLength;
    const text = block ? plainText(block.text) : '';
    const triggerOk =
      state.triggerLength === 0 || text.slice(state.start, state.start + 2) === '[[';
    const query = block && end >= minEnd ? text.slice(minEnd, end) : '';
    if (!block || !triggerOk || end < minEnd || query.includes('\n')) {
      if (this.#pageLink === state) this.#pageLink = null;
      this.#menu.close();
      return;
    }
    state.end = end;
    if (state.mode === 'inline' && query.endsWith(']]')) {
      const target = query.slice(0, -2).trim();
      const lowerTarget = target.toLowerCase();
      const exact = lowerTarget
        ? state.items.find(
            item => (item.title.trim() || 'Untitled page').toLowerCase() === lowerTarget
          )
        : undefined;
      if (exact) {
        this.#menu.close(false);
        this.#insertPageLinkFromState(state, exact);
        return;
      }
      const provider = this.#options.pageProvider;
      const snapshot: PageLinkState = { ...state, end };
      const expectedSlice = text.slice(snapshot.start, snapshot.end);
      if (this.#pageLink === state) this.#pageLink = null;
      this.#menu.close();
      if (target && provider) {
        void this.#resolveClosingBracketPageLink(snapshot, target, expectedSlice);
      }
      return;
    }
    const searchQuery =
      state.mode === 'inline' ? query.replace(/\]+$/u, '') : query;
    const queryChanged = searchQuery !== state.query;
    state.query = searchQuery;
    if (!this.#menu.isOpen) return;
    this.#menu.setQuery(searchQuery);
    const provider = this.#options.pageProvider;
    if (!provider || (!forceSearch && !queryChanged)) {
      if (queryChanged) {
        this.#menu.setItems(this.#pageLinkMenuItems(state.items, state));
      }
      return;
    }
    const token = ++this.#pageLinkQueryToken;
    const epoch = this.#docEpoch;
    void Promise.resolve(provider.search(searchQuery))
      .then(items => {
        if (
          this.#destroyed ||
          this.#readonly ||
          epoch !== this.#docEpoch ||
          this.#pageLink !== state ||
          token !== this.#pageLinkQueryToken
        ) {
          return;
        }
        state.items = items;
        this.#menu.setItems(this.#pageLinkMenuItems(items, state));
      })
      .catch(() => undefined);
  }

  #pageLinkMenuItems(items: readonly PageInfo[], state: PageLinkState): MenuItem[] {
    const out: MenuItem[] = items.map(page => {
      const title = page.title.trim() || 'Untitled page';
      const iconHtml = page.icon?.trim()
        ? `<span>${escapeMenuText(page.icon.trim())}</span>`
        : icon.page;
      return {
        id: `page-${page.id}`,
        label: title,
        icon: iconHtml,
        group: 'Pages',
        keywords: [page.id, title],
        action: () => this.#insertPageLinkFromState(state, page),
      };
    });
    const provider = this.#options.pageProvider;
    const trimmed = state.query.trim();
    const hasExact =
      trimmed.length > 0 &&
      items.some(item => (item.title.trim() || 'Untitled page').toLowerCase() === trimmed.toLowerCase());
    if (provider?.create && trimmed.length > 0 && !hasExact) {
      out.push({
        id: `page-create-${trimmed}`,
        label: `Create "${trimmed}"`,
        description: 'New page',
        icon: icon.plus,
        group: 'Create',
        keywords: [trimmed, 'create', 'new'],
        action: () => void this.#createAndInsertPage(state, trimmed),
      });
    }
    return out;
  }

  #insertPageLinkFromState(
    state: PageLinkState,
    page: PageInfo,
    preserveExternalSelection = false
  ): void {
    const pageId = page.id.trim();
    if (!pageId) return;
    const pageTitle = page.title.trim() || 'Untitled page';
    const pageIcon = page.icon?.trim();
    const block = findBlock(this.store.doc.blocks, state.blockId);
    if (!block) return;
    const end = Math.min(state.end, runsLength(block.text));
    const runs = deleteTextRange(block.text, state.start, end);
    if (!preserveExternalSelection || this.#pageLink === state) {
      this.#pageLink = null;
    }
    const selectionBefore =
      preserveExternalSelection
        ? this.#selectedBlockIds.size === 0
          ? this.#currentSelection()
          : null
        : null;
    const touchesSelection =
      !preserveExternalSelection ||
      (selectionBefore !== null &&
        (selectionBefore.anchor.blockId === state.blockId ||
          selectionBefore.focus.blockId === state.blockId));

    if (state.mode === 'block') {
      const cleaned = replaceBlockText(this.store.doc, state.blockId, runs);
      const updatedBlock = findBlock(cleaned.blocks, state.blockId);
      let next: Doc;
      let targetBlockId: string;
      if (updatedBlock && updatedBlock.type === 'paragraph' && runsLength(updatedBlock.text) === 0) {
        next = setBlockType(cleaned, state.blockId, 'page', {
          pageId,
          pageTitle,
          ...(pageIcon ? { pageIcon } : {}),
        });
        targetBlockId = state.blockId;
      } else {
        const pageBlock = createBlock('page', {
          props: {
            pageId,
            pageTitle,
            ...(pageIcon ? { pageIcon } : {}),
          },
        });
        next = insertBlockRelative(cleaned, state.blockId, pageBlock, 'after');
        targetBlockId = pageBlock.id;
      }
      if (touchesSelection) {
        const point: Point = { blockId: targetBlockId, offset: 0 };
        this.#commit(next, { anchor: point, focus: point }, { restore: false });
        this.#focusBlock(targetBlockId, 0);
      } else {
        this.#commit(next, selectionBefore, { restore: false });
      }
      return;
    }

    const nextRuns = insertTextAt(runs, state.start, pageTitle, {
      page: {
        id: pageId,
        title: pageTitle,
        ...(pageIcon ? { icon: pageIcon } : {}),
      },
    });
    const next = replaceBlockText(this.store.doc, state.blockId, nextRuns);
    if (!preserveExternalSelection) {
      const caret: Point = {
        blockId: state.blockId,
        offset: state.start + pageTitle.length,
      };
      this.#commit(next, { anchor: caret, focus: caret });
      this.#focusBlock(state.blockId, caret.offset);
      return;
    }
    const delta = pageTitle.length - (end - state.start);
    const adjustPoint = (point: Point): Point => {
      if (point.blockId !== state.blockId || point.offset <= state.start) {
        return point;
      }
      if (point.offset >= end) {
        return { blockId: point.blockId, offset: Math.max(0, point.offset + delta) };
      }
      return { blockId: point.blockId, offset: state.start + pageTitle.length };
    };
    const nextSelection = selectionBefore
      ? {
          anchor: adjustPoint(selectionBefore.anchor),
          focus: adjustPoint(selectionBefore.focus),
        }
      : null;
    this.#commit(next, nextSelection, { restore: touchesSelection });
  }

  async #resolveClosingBracketPageLink(
    snapshot: PageLinkState,
    target: string,
    expectedSlice: string
  ): Promise<void> {
    const provider = this.#options.pageProvider;
    if (!provider || this.#readonly) return;
    const epoch = this.#docEpoch;
    let items: readonly PageInfo[];
    try {
      items = await Promise.resolve(provider.search(target));
    } catch {
      return;
    }
    if (this.#destroyed || this.#readonly || epoch !== this.#docEpoch) return;
    const lowerTarget = target.toLowerCase();
    const exact = items.find(
      item => (item.title.trim() || 'Untitled page').toLowerCase() === lowerTarget
    );
    if (!exact?.id) return;
    const block = findBlock(this.store.doc.blocks, snapshot.blockId);
    if (!block) return;
    const currentText = plainText(block.text);
    if (
      snapshot.end > currentText.length ||
      currentText.slice(snapshot.start, snapshot.end) !== expectedSlice
    ) {
      return;
    }
    this.#insertPageLinkFromState(snapshot, exact, true);
  }

  async #createAndInsertPage(state: PageLinkState, title: string): Promise<void> {
    const provider = this.#options.pageProvider;
    if (!provider?.create || this.#readonly) return;
    const blockBefore = findBlock(this.store.doc.blocks, state.blockId);
    if (!blockBefore) return;
    const textBefore = plainText(blockBefore.text);
    const snapshot: PageLinkState = {
      ...state,
      end: Math.min(state.end, textBefore.length),
    };
    const epoch = this.#docEpoch;
    try {
      const created = await Promise.resolve(provider.create(title));
      if (this.#destroyed || this.#readonly || epoch !== this.#docEpoch) return;
      if (!created?.id) return;
      const blockAfter = findBlock(this.store.doc.blocks, snapshot.blockId);
      if (!blockAfter || plainText(blockAfter.text) !== textBefore) return;
      this.#insertPageLinkFromState(snapshot, created, true);
    } catch {
      // Host creation errors leave the document unchanged.
    }
  }

  async #createSlashPage(blockId: string, offset: number): Promise<void> {
    const provider = this.#options.pageProvider;
    if (!provider?.create || this.#readonly) return;
    const blockBefore = findBlock(this.store.doc.blocks, blockId);
    if (!blockBefore) return;
    const textBefore = plainText(blockBefore.text);
    const typeBefore = blockBefore.type;
    const epoch = this.#docEpoch;
    try {
      const created = await Promise.resolve(provider.create('Untitled'));
      if (this.#destroyed || this.#readonly || epoch !== this.#docEpoch) return;
      if (!created?.id) return;
      const blockAfter = findBlock(this.store.doc.blocks, blockId);
      if (
        !blockAfter ||
        blockAfter.type !== typeBefore ||
        plainText(blockAfter.text) !== textBefore
      ) {
        return;
      }
      this.#insertPageLinkFromState(
        {
          blockId,
          start: offset,
          end: offset,
          query: '',
          triggerLength: 0,
          mode: 'block',
          items: [],
        },
        created,
        true
      );
    } catch {
      // Host creation errors leave the document unchanged.
    }
  }

  /** ---- slash menu ---- */

  #openSlashMenu(blockId: string, slashOffset: number): void {
    this.#mention = null;
    this.#pageLink = null;
    const slash = { blockId, start: slashOffset, end: slashOffset + 1 };
    this.#slash = slash;
    const removeSlash = (): void => {
      this.#removeSlashQuery(slash);
    };
    const rect = this.#caretRect(blockId);
    const pageProvider = this.#options.pageProvider;
    const items = buildSlashMenuItems({
      convert: (type, props) => {
        removeSlash();
        this.#convertBlock(blockId, type, props);
      },
      insertText: text => this.#insertSlashText(slash, blockId, text),
      alignBlock: align => {
        removeSlash();
        this.#alignBlockAt(blockId, align, slashOffset);
      },
      moveBlock: position => {
        removeSlash();
        this.#moveBlockVertically(blockId, position, slashOffset);
      },
      copyBlock: () => {
        removeSlash();
        this.#copyBlockToClipboard(blockId, slashOffset);
      },
      ...(pageProvider
        ? {
            linkPage: () => {
              removeSlash();
              this.#focusBlock(blockId, slashOffset);
              void this.#openPageLinkMenu(blockId, slashOffset, 'block');
            },
          }
        : {}),
      ...(pageProvider?.create
        ? {
            createPage: () => {
              removeSlash();
              this.#focusBlock(blockId, slashOffset);
              void this.#createSlashPage(blockId, slashOffset);
            },
          }
        : {}),
    });
    this.#menu.open({
      items,
      anchor: rectAnchor(rect),
      filterable: true,
      query: '',
      width: 330,
      onClose: () => {
        this.#slash = null;
      },
    });
  }

  #syncSlashMenu(): void {
    const slash = this.#slash;
    if (!slash) return;
    if (!this.#menu.isOpen) {
      this.#slash = null;
      return;
    }
    const selection = this.#currentSelection();
    if (!selection || !this.#isCollapsed(selection) || selection.anchor.blockId !== slash.blockId) {
      this.#menu.close();
      return;
    }
    const block = findBlock(this.store.doc.blocks, slash.blockId);
    if (!block) {
      this.#menu.close();
      return;
    }
    const text = plainText(block.text);
    const end = selection.anchor.offset;
    if (end <= slash.start) {
      this.#menu.close();
      return;
    }
    const query = text.slice(slash.start + 1, end);
    if (/[\s\n]/u.test(query)) {
      this.#menu.close();
      return;
    }
    slash.end = end;
    this.#menu.setQuery(query);
  }

  #removeSlashQuery(slash: SlashState): void {
    const block = findBlock(this.store.doc.blocks, slash.blockId);
    if (!block) return;
    const length = runsLength(block.text);
    const end = Math.min(slash.end, length);
    const runs = deleteTextRange(block.text, slash.start, end);
    const next = replaceBlockText(this.store.doc, slash.blockId, runs);
    this.#slash = null;
    this.store.update(() => next, {
      history: false,
      selection: {
        anchor: { blockId: slash.blockId, offset: slash.start },
        focus: { blockId: slash.blockId, offset: slash.start },
      },
    });
  }

  #insertSlashText(slash: SlashState, blockId: string, text: string): void {
    const offset = slash.start;
    this.#removeSlashQuery(slash);
    const block = findBlock(this.store.doc.blocks, blockId);
    if (!block) return;
    const next = replaceBlockText(
      this.store.doc,
      blockId,
      insertTextAt(block.text, offset, text)
    );
    const caret: Point = { blockId, offset: offset + text.length };
    this.#commit(next, { anchor: caret, focus: caret });
    this.#focusBlock(blockId, caret.offset);
  }

  #copyBlockLink(blockId: string): void {
    const link = this.getBlockLink(blockId);
    if (!link) return;
    void this.#writePlainTextToClipboard(link);
  }

  async #writePlainTextToClipboard(text: string): Promise<void> {
    if (typeof navigator.clipboard?.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Fall through to the legacy path.
      }
    }
    if (typeof document.execCommand !== 'function' || !document.body) return;
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.left = '-9999px';
    field.style.top = '0';
    field.style.opacity = '0';
    field.style.pointerEvents = 'none';
    document.body.append(field);
    try {
      field.focus();
      field.select();
      document.execCommand('copy');
    } catch {
      // Clipboard access can be denied; leave the document untouched.
    } finally {
      field.remove();
    }
  }

  #deleteBlock(blockId: string): void {
    const flat = flattenBlocks(this.store.doc.blocks);
    if (flat.length <= 1) {
      const block = findBlock(this.store.doc.blocks, blockId);
      if (!block) return;
      if (block.type !== 'paragraph') {
        // A document always keeps one block. Deleting the only table/image/heading
        // should leave a blank paragraph rather than silently doing nothing.
        const paragraph = createBlock('paragraph', { id: blockId });
        const next = updateBlock(this.store.doc, blockId, () => paragraph);
        const caret: Point = { blockId, offset: 0 };
        this.#commit(next, { anchor: caret, focus: caret });
        this.#focusBlock(blockId, 0);
        return;
      }
      this.#commit(replaceBlockText(this.store.doc, blockId, []), {
        anchor: { blockId, offset: 0 },
        focus: { blockId, offset: 0 },
      });
      return;
    }
    const location = locateBlock(this.store.doc.blocks, blockId);
    const previous = location && location.index > 0 ? location.siblings[location.index - 1] : null;
    const next = location?.siblings[location.index + 1] ?? null;
    let doc = this.store.doc;
    const children = findBlock(doc.blocks, blockId)?.children ?? [];
    if (children.length > 0) doc = insertBlocksAfter(doc, blockId, children);
    doc = removeById(doc, blockId);
    const caret: Point = { blockId: previous?.id ?? next?.id ?? flat[0]?.id ?? blockId, offset: 0 };
    this.#commit(doc, { anchor: caret, focus: caret });
    this.#focusBlock(caret.blockId, caret.offset);
  }

  /** ---- selection plumbing ---- */

  #handleSelectionChange(): void {
    if (this.#destroyed) return;
    const selection = this.#currentSelection();
    this.#lastSelection = selection;
    if (selection) {
      this.store.setSelection(selection);
      this.#focusedBlockId = selection.focus.blockId;
    } else {
      this.#focusedBlockId = null;
    }
    const key = selection ? this.#selectionKey(selection) : '';
    if (key !== this.#lastSelectionKey && !this.#toolbar.isVisible) {
      this.#pendingMarks = undefined;
    }
    this.#lastSelectionKey = key;
    this.#updateToolbar();
    this.#syncSlashMenu();
    this.#syncMentionMenu();
    this.#syncPageLinkMenu();
    this.#syncPlaceholders();
    this.#options.onSelectionChange?.(selection);
  }

  #selectionKey(selection: EditorSelection): string {
    return `${selection.anchor.blockId}:${selection.anchor.offset}:${selection.focus.blockId}:${selection.focus.offset}`;
  }

  #caretRect(blockId: string): DOMRect {
    const view = this.#findView(blockId);
    const element = view?.textElement;
    if (!element) return new DOMRect(0, 0, 0, 0);
    const selection = nativeSelection(this.root);
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(false);
      const rects = range.getClientRects();
      const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
      if (rect.width + rect.height > 0) return rect;
    }
    return caretRect(element, 0, nativeSelection(this.root)) ?? element.getBoundingClientRect();
  }

  /** ---- drag & drop ---- */

  #onDragMove = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < 5) return;
      drag.moved = true;
      this.#findView(drag.blockId)?.element.classList.add('nb-dragging');
      this.#menu.close();
    }
    const target = this.root.elementFromPoint?.(event.clientX, event.clientY);
    const element = target ? closestElement(target, '.nb-block') : null;
    this.#clearDropMarkers(drag);
    if (!element) {
      drag.targetId = null;
      drag.position = null;
      return;
    }
    const targetId = element.dataset.blockId ?? '';
    if (!targetId) return;
    if (
      targetId === drag.blockId ||
      this.#isDescendant(drag.blockId, targetId) ||
      (this.#selectedBlockIds.has(drag.blockId) &&
        selectedTopLevelBlocks(this.store.doc.blocks, this.#selectedBlockIds).some(
          b => findBlock([b], targetId) !== null
        ))
    ) {
      drag.targetId = null;
      drag.position = null;
      return;
    }
    const row = element.querySelector<HTMLElement>(':scope > .nb-row') ?? element;
    const rect = row.getBoundingClientRect();
    const asChild = event.clientX > rect.left + 40 && event.clientY > rect.top - 4 && event.clientY < rect.bottom + 4;
    drag.targetId = targetId;
    drag.targetElement = element;
    if (asChild) {
      drag.position = 'child';
      element.classList.add('nb-drop-child');
      return;
    }
    const before = event.clientY < rect.top + rect.height / 2;
    drag.position = before ? 'before' : 'after';
    drag.line.style.left = `${rect.left}px`;
    drag.line.style.width = `${rect.width}px`;
    drag.line.style.top = `${(before ? rect.top : rect.bottom) - 1}px`;
    if (!drag.line.isConnected) this.#overlay.append(drag.line);
  };

  #onDragEnd = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { blockId, moved, targetId, position } = drag;
    const handle = drag.handle;
    this.#endDrag();
    if (!moved) {
      this.#setBlockSelection([blockId], blockId, blockId, false);
      this.openBlockMenu(blockId, handle);
      return;
    }
    if (!targetId || !position) return;
    if (this.#selectedBlockIds.has(blockId) && this.#selectedBlockIds.size > 1) {
      const next = moveBlocks(this.store.doc, this.#selectedBlockIds, targetId, position);
      if (next !== this.store.doc) {
        this.#commit(next, null);
        this.#syncBlockSelection();
      }
      return;
    }
    const next = moveBlock(this.store.doc, blockId, targetId, position);
    if (next === this.store.doc) return;
    const caret: Point = { blockId, offset: 0 };
    this.#commit(next, { anchor: caret, focus: caret });
    this.#focusBlock(blockId, 0);
  };

  #onDragCancel = (): void => {
    this.#endDrag();
  };

  #endDrag(): void {
    const drag = this.#drag;
    if (!drag) return;
    this.#drag = null;
    window.removeEventListener('pointermove', this.#onDragMove, true);
    window.removeEventListener('pointerup', this.#onDragEnd, true);
    window.removeEventListener('pointercancel', this.#onDragCancel, true);
    try {
      drag.handle.releasePointerCapture?.(drag.pointerId);
    } catch {
      // Ignore uncaptured pointers.
    }
    this.#findView(drag.blockId)?.element.classList.remove('nb-dragging');
    drag.targetElement?.classList.remove('nb-drop-child');
    drag.line.remove();
  }

  #clearDropMarkers(drag: DragState): void {
    drag.targetElement?.classList.remove('nb-drop-child');
    drag.targetElement = null;
    if (drag.line.isConnected) drag.line.remove();
  }

  #isDescendant(ancestorId: string, candidateId: string): boolean {
    const block = findBlock(this.store.doc.blocks, ancestorId);
    if (!block) return false;
    const stack = [...block.children];
    while (stack.length > 0) {
      const item = stack.pop();
      if (!item) continue;
      if (item.id === candidateId) return true;
      stack.push(...item.children);
    }
    return false;
  }
}

/** ---- helpers without DOM ---- */

function escapeMenuText(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}




function replaceBlockText(doc: Doc, blockId: string, runs: Block['text']): Doc {
  return updateBlock(doc, blockId, block => block.text === runs ? block : { ...block, text: runs });
}

function setChildrenDeep(blocks: readonly Block[], blockId: string, children: Block[]): Block[] {
  return blocks.map(block => {
    if (block.id === blockId) return { ...block, children };
    const next = setChildrenDeep(block.children, blockId, children);
    return next === block.children ? block : { ...block, children: next };
  });
}

function removeById(doc: Doc, blockId: string): Doc {
  const remove = (blocks: readonly Block[]): Block[] | null => {
    const index = blocks.findIndex(block => block.id === blockId);
    if (index >= 0) {
      const next = blocks.slice();
      next.splice(index, 1);
      return next;
    }
    let changed = false;
    const next = blocks.map(block => {
      const children = remove(block.children);
      if (children) {
        changed = true;
        return { ...block, children };
      }
      return block;
    });
    return changed ? next : null;
  };
  const blocks = remove(doc.blocks);
  return blocks ? { ...doc, blocks } : doc;
}

function appendParagraphAfter(doc: Doc, blockId: string): { doc: Doc; block: Block } {
  const block = createBlock('paragraph');
  return { doc: insertBlockRelative(doc, blockId, block, 'after'), block };
}

