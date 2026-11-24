import {
  EditorStore,
  applyMarkPatch,
  blocksToHtml,
  blocksToMarkdown,
  createBlock,
  createDoc,
  dedentBlock,
  deleteTextRange,
  docToJSON,
  duplicateBlockTree,
  findBlock,
  flattenBlocks,
  indentBlock,
  insertBlockRelative,
  insertBlocksAfter,
  insertTextAt,
  locateBlock,
  markdownToBlocks,
  markStateInRange,
  marksAt,
  mentionRangeAt,
  matchBlockMarkdown,
  matchInlineMarkdown,
  mergeBlockWithNext,
  mergeBlockWithPrevious,
  moveBlock,
  normalizeRuns,
  parseDoc,
  plainText,
  runsLength,
  safeHref,
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
  type Point,
  type TextAlign,
  type TextColor,
} from '@nobita/core';
import { BlockView } from './block-view.js';
import type { BlockHost } from './bridge.js';
import {
  readClipboardPayload,
  serializeBlocksForClipboard,
} from './clipboard.js';
import {
  caretRect,
  closestElement,
  domPointToOffset,
  isNodeInside,
  nativeSelection,
  offsetToDomPoint,
  selectionRect,
} from './dom.js';
import { icon } from './icons.js';
import { blockRange, orderedRange, selectionBlocks } from './selection.js';
import { readRunsFromDom } from './inline-dom.js';
import { Menu, type MenuItem } from './menu.js';
import { buildBlockMenuItems, buildSlashMenuItems } from './menu-items.js';
import { styles } from './styles.js';
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

export interface ImageUploadResult {
  src: string;
  alt?: string;
  caption?: string;
}

export type ImageUploadHandler = (
  file: File
) => ImageUploadResult | string | Promise<ImageUploadResult | string>;

export interface NobitaOptions {
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
  /** Optional host-provided image uploader used by paste and drop. */
  uploadImage?: ImageUploadHandler;
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
  #options: NobitaOptions;
  #readonly: boolean;
  #page!: HTMLElement;
  #title!: HTMLElement;
  #body!: HTMLElement;
  #tail!: HTMLElement;
  #overlay!: HTMLElement;
  #views = new Map<string, BlockView>();
  #viewIndex = new Map<string, BlockView>();
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
  #drag: DragState | null = null;
  #savedSelection: EditorSelection | null = null;
  #destroyed = false;
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
    if (event.key === 'Escape') {
      this.#mention = null;
      this.#menu.close();
      this.#toolbar.hide();
      this.#linkPopover.hide();
    }
  };

  constructor(host: HTMLElement, options: NobitaOptions = {}) {
    this.#hostElement = host;
    this.#options = options;
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
    this.#bindChrome();
    this.#syncBody(this.store.doc.blocks);
    this.#syncTitle();

    this.#unsubscribe = this.store.subscribe(change => this.#onStoreChange(change));
    this.#unsubscribeSelection = this.store.subscribeSelection(selection => {
      this.#lastSelection = selection;
    });

    this.#ready = true;
    if (options.autofocus) this.focus();
  }

  get doc(): Doc {
    return this.store.doc;
  }

  get readonly(): boolean {
    return this.#readonly;
  }

  get isReady(): boolean {
    return this.#ready;
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
    this.#options = provider
      ? { ...this.#options, mentionProvider: provider }
      : (({ mentionProvider: _mentionProvider, ...rest }) => rest)(this.#options);
  }

  get uploadImage(): ImageUploadHandler | undefined {
    return this.#options.uploadImage;
  }

  set uploadImage(handler: ImageUploadHandler | undefined) {
    this.setUploadImage(handler);
  }

  setUploadImage(handler: ImageUploadHandler | undefined): void {
    this.#options = handler
      ? { ...this.#options, uploadImage: handler }
      : (({ uploadImage: _uploadImage, ...rest }) => rest)(this.#options);
  }

  getSelection(): EditorSelection | null {
    return this.#currentSelection();
  }

  /** ---- public API ---- */

  getDoc(): Doc {
    return this.store.doc;
  }

  getJSON(pretty = false): string {
    return docToJSON(this.store.doc, pretty);
  }

  getMarkdown(): string {
    return blocksToMarkdown(this.store.doc);
  }

  getHTML(): string {
    return blocksToHtml(this.store.doc.blocks);
  }

  /** Stable fragment for linking to a block inside the host page. */
  getBlockLink(blockId: string): string | null {
    return findBlock(this.store.doc.blocks, blockId)
      ? `#block-${encodeURIComponent(blockId)}`
      : null;
  }

  setDoc(doc: Doc | string, options: { history?: boolean } = {}): void {
    const parsed = parseDoc(doc);
    this.#menu.close();
    this.#toolbar.hide();
    this.#slash = null;
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
    this.#hostElement.toggleAttribute('readonly', readonly);
    this.#title.contentEditable = readonly ? 'false' : 'true';
    this.#body.contentEditable = readonly ? 'false' : 'true';
    if (readonly) {
      this.#menu.close();
      this.#toolbar.hide();
      this.#linkPopover.hide();
    }
    for (const view of this.#views.values()) view.setReadonly(readonly);
    this.#syncPlaceholders();
  }

  setTheme(theme: NobitaTheme): void {
    this.#options = { ...this.#options, theme };
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
      else this.#restoreSelection(this.store.selection, false);
    }
    return changed;
  }

  redo(): boolean {
    const titleFocused = this.root.activeElement === this.#title;
    const changed = this.store.redo();
    if (changed) {
      if (titleFocused) this.focusTitle();
      else this.#restoreSelection(this.store.selection, false);
    }
    return changed;
  }

  insertMarkdown(markdown: string): void {
    const result = markdownToBlocks(markdown);
    this.#insertBlocks(result.blocks);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
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
    this.#toolbar.hide();
    this.#linkPopover.hide();
    this.#endDrag();
    for (const view of this.#views.values()) view.destroy();
    this.#views.clear();
    this.#viewIndex.clear();
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
    if (this.#readonly) {
      if (event.key === 'Escape') this.#menu.close();
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    const selection = this.#currentSelection();
    const block = findBlock(this.store.doc.blocks, blockId);
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
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.#selectAllInBlock(blockId);
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
      const previous = this.#previousTextBlock(blockId);
      if (previous) {
        event.preventDefault();
        this.#focusBlock(previous.id, runsLength(previous.text));
      }
      return;
    }

    if (event.key === 'ArrowDown' && !event.shiftKey && offset >= length) {
      const next = this.#nextTextBlock(blockId);
      if (next) {
        event.preventDefault();
        this.#focusBlock(next.id, 0);
      }
      return;
    }

    if (event.key === 'Escape') {
      this.#mention = null;
      this.#menu.close();
      this.#toolbar.hide();
      this.#linkPopover.hide();
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
    const serialized = serializeBlocksForClipboard(blocks);
    event.clipboardData?.setData('text/plain', serialized.text);
    event.clipboardData?.setData('text/html', serialized.html);
    event.clipboardData?.setData('application/x-nobita+json', serialized.json);
    if (cut) {
      this.#deleteSelection();
    }
  }

  toggleTodo(blockId: string): void {
    if (this.#readonly) return;
    this.#commit(toggleChecked(this.store.doc, blockId), this.store.selection);
  }

  updateDatabase(blockId: string, data: DatabaseData, options: { mergeKey?: string } = {}): void {
    if (this.#readonly) return;
    const next = updateBlock(this.store.doc, blockId, block => {
      if (block.type !== 'database') return block;
      return { ...block, props: { ...block.props, database: data } };
    });
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

  focusAfterBlock(blockId: string): void {
    const next = this.#nextTextBlock(blockId);
    if (next) {
      this.#focusBlock(next.id, 0);
      return;
    }
    const { doc, block } = appendParagraphAfter(this.store.doc, blockId);
    const caret: Point = { blockId: block.id, offset: 0 };
    this.#commit(doc, { anchor: caret, focus: caret });
    this.#focusBlock(block.id, 0);
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

  async #uploadImage(blockId: string, file: File): Promise<void> {
    const upload = this.#options.uploadImage;
    if (!upload) return;
    try {
      const result = await upload(file);
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
      const next = insertBlockRelative(this.store.doc, blockId, block, 'after');
      this.#commit(next, this.store.selection);
      this.#views.get(block.id)?.focusImageCaption();
    } catch {
      // Host upload failures leave the document untouched.
    }
  }

  setCodeLanguage(blockId: string, language: string): void {
    if (this.#readonly) return;
    this.#commit(setCodeLanguage(this.store.doc, blockId, language), this.store.selection);
  }

  setCalloutTone(blockId: string, tone: CalloutTone): void {
    if (this.#readonly) return;
    this.#commit(setCalloutTone(this.store.doc, blockId, tone), this.store.selection);
  }

  openBlockMenu(blockId: string, anchor: HTMLElement): void {
    const block = findBlock(this.store.doc.blocks, blockId);
    if (!block) return;
    const items = buildBlockMenuItems({
      block,
      getDoc: () => this.store.doc,
      pointFromCaret: () => this.#pointFromCaret(blockId),
      commit: (next, caret) => this.#commit(next, caret),
      focusBlock: (id, offset) => this.#focusBlock(id, offset),
      copyBlock: offset => this.#copyBlockToClipboard(blockId, offset),
      copyLink: () => this.#copyBlockLink(blockId),
      deleteBlock: () => this.#deleteBlock(blockId),
    });
    this.#menu.open({
      items,
      anchor: rectAnchor(anchor.getBoundingClientRect()),
      width: 300,
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
    return Boolean(element?.closest('.nb-caption, .nb-db, .nb-image-placeholder, input, textarea, select'));
  }

  #activeBlockId(target: EventTarget | null): string | null {
    const selection = this.#currentSelection();
    if (selection) return selection.focus.blockId;
    const element = target instanceof Node ? closestElement(target, '.nb-block') : null;
    return element?.dataset.blockId ?? this.#focusedBlockId;
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
        if (this.#isNestedField(event.target)) return;
        const blockId = this.#activeBlockId(event.target);
        if (blockId) this.keyDown(blockId, event);
      },
      { signal }
    );

    body.addEventListener(
      'beforeinput',
      event => {
        if (this.#isNestedField(event.target)) return;
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
      () => {
        this.#composing = true;
        this.#compositionBlockId = this.#activeBlockId(null);
        this.#syncPlaceholders();
      },
      { signal }
    );

    body.addEventListener(
      'compositionend',
      () => {
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
        const blockId = this.#activeBlockId(event.target);
        if (blockId) this.paste(blockId, event);
      },
      { signal }
    );

    body.addEventListener(
      'copy',
      event => {
        if (this.#isNestedField(event.target)) return;
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
        const selection = this.#currentSelection();
        const blockId = selection ? this.#ordered(selection).start.blockId : null;
        if (blockId) this.copy(event, true);
      },
      { signal }
    );

    body.addEventListener(
      'focusin',
      event => {
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
        const target = event.target as Element | null;
        const link = target?.closest<HTMLElement>('[data-link]');
        if (link) {
          const href = safeHref(link.dataset.link);
          if (href?.startsWith('#block-')) {
            event.preventDefault();
            const blockId = decodeURIComponent(href.slice('#block-'.length));
            if (findBlock(this.store.doc.blocks, blockId)) {
              this.#focusBlock(blockId, 0);
            }
            return;
          }
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            if (href) window.open(href, '_blank', 'noopener,noreferrer');
          }
        }
      },
      { signal }
    );

    body.addEventListener(
      'pointerdown',
      event => {
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
      'dragstart',
      event => {
        if (this.#isNestedField(event.target)) return;
        event.preventDefault();
      },
      { signal }
    );

    body.addEventListener(
      'drop',
      event => {
        const file = Array.from(event.dataTransfer?.files ?? []).find(item =>
          item.type.startsWith('image/')
        );
        if (file && this.#options.uploadImage) {
          event.preventDefault();
          const blockId =
            this.#activeBlockId(event.target) ?? this.#nearestBlock(event.clientY);
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
      this.#focusedBlockId = null;
      this.#toolbar.hide();
      this.#syncPlaceholders();
    });
  }

  #bindChrome(): void {
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
      if (last.type === 'database' || last.type === 'image' || last.type === 'divider') {
        const { doc, block } = appendParagraphAfter(this.store.doc, last.id);
        const caret: Point = { blockId: block.id, offset: 0 };
        this.#commit(doc, { anchor: caret, focus: caret });
        this.#focusBlock(block.id, 0);
        return;
      }
      const flat = flattenBlocks(blocks);
      const lastText = [...flat].reverse().find(
        item => item.type !== 'divider' && item.type !== 'image' && item.type !== 'database'
      );
      if (lastText) this.#focusBlock(lastText.id, runsLength(lastText.text));
    });
  }

  #onStoreChange(change: { doc: Doc; source: string }): void {
    if (this.#destroyed) return;
    this.#syncBody(change.doc.blocks);
    this.#syncTitle();
    this.#syncPlaceholders();
    this.#options.onChange?.(change.doc, { source: change.source });
  }

  #syncTitle(): void {
    const title = this.store.doc.title;
    if ((this.#title.textContent ?? '') !== title) this.#title.textContent = title;
    this.#title.contentEditable = this.#readonly ? 'false' : 'true';
  }

  #syncBody(blocks: readonly Block[]): void {
    const ids = new Set(blocks.map(block => block.id));
    for (const [id, view] of this.#views) {
      if (ids.has(id)) continue;
      view.destroy();
      this.#views.delete(id);
    }
    let cursor = this.#body.firstChild;
    let number = 0;
    blocks.forEach((block, index) => {
      number = block.type === 'numbered' ? number + 1 : 0;
      let view = this.#views.get(block.id);
      if (!view) {
        view = new BlockView(this, block, {
          depth: 0,
          index,
          number,
        });
        this.#views.set(block.id, view);
      }
      if (view.element === cursor) {
        cursor = cursor.nextSibling;
      } else {
        this.#body.insertBefore(view.element, cursor);
      }
      view.update(block, { depth: 0, index, number });
    });
  }

  #syncPlaceholders(): void {
    const selection = this.#readonly || this.#composing ? null : this.#currentSelection();
    const activeId =
      selection && this.#isCollapsed(selection) ? selection.focus.blockId : null;
    for (const view of this.#viewIndex.values()) {
      const empty = runsLength(view.block.text) === 0;
      view.setPlaceholder(
        activeId === view.id && empty ? this.#placeholderFor(view.block) : ''
      );
    }
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
    const view = this.#findView(blockId);
    const block = findBlock(this.store.doc.blocks, blockId);
    if (!view || !block) return;
    this.#menu.close();
    this.#slash = null;
    if (block.type === 'database') {
      view.focusDatabase();
      return;
    }
    if (block.type === 'image') {
      view.focusImageInput();
      return;
    }
    if (block.type === 'divider') {
      const next = this.#nextTextBlock(blockId);
      if (next) this.#focusBlock(next.id, 0);
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
    const anchorView = this.#findView(selection.anchor.blockId);
    const focusView = this.#findView(selection.focus.blockId);
    if (!anchorView?.textElement || !focusView?.textElement) return;
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
      if (rect.top < 8 || rect.bottom > window.innerHeight - 8) {
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
      this.#options.mentionProvider &&
      this.#isSlashPosition(before, point.offset)
    ) {
      void this.#openMentionMenu(point.blockId, point.offset);
    } else if (this.#slash) {
      this.#syncSlashMenu();
    } else if (this.#mention) {
      this.#syncMentionMenu();
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
    const selection = this.#currentSelection();
    if (selection && !this.#isCollapsed(selection)) {
      this.#deleteSelection();
      return;
    }
    const point = this.#pointFromCaret(blockId);
    const block = findBlock(this.store.doc.blocks, blockId);
    if (!block) return;
    if (point.offset > 0) {
      const mention = mentionRangeAt(block.text, point.offset - 1);
      const start = mention?.start ?? point.offset - 1;
      const end = mention?.end ?? point.offset;
      const runs = deleteTextRange(block.text, start, end);
      const caret: Point = { blockId, offset: start };
      this.#commit(replaceBlockText(this.store.doc, blockId, runs), { anchor: caret, focus: caret }, {
        mergeKey: `delete:${blockId}`,
      });
      return;
    }
    if (block.type !== 'paragraph' && block.type !== 'divider' && block.type !== 'image' && block.type !== 'database') {
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
    if (
      previous &&
      (previous.type === 'image' || previous.type === 'divider' || previous.type === 'database')
    ) {
      return;
    }
    const merged = mergeBlockWithPrevious(this.store.doc, blockId);
    if (!merged) return;
    const caret: Point = { blockId: merged.caretBlockId, offset: merged.caretOffset };
    this.#commit(merged.doc, { anchor: caret, focus: caret });
    this.#focusBlock(caret.blockId, caret.offset);
  }

  #onDelete(blockId: string): void {
    this.#scheduleMentionSync();
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
      const mention = mentionRangeAt(block.text, point.offset);
      const start = mention?.start ?? point.offset;
      const end = mention?.end ?? point.offset + 1;
      const runs = deleteTextRange(block.text, start, end);
      const caret: Point = { blockId, offset: start };
      this.#commit(replaceBlockText(this.store.doc, blockId, runs), { anchor: caret, focus: caret }, {
        mergeKey: `delete:${blockId}`,
      });
      return;
    }
    const location = locateBlock(this.store.doc.blocks, blockId);
    const next = location ? location.siblings[location.index + 1] : undefined;
    if (next && (next.type === 'image' || next.type === 'divider' || next.type === 'database')) return;
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
    const copy = duplicateBlockTree(block);
    void this.#writeBlocksToClipboard([copy])
      .catch(() => undefined)
      .finally(() => {
        this.#focusBlock(blockId, offset);
      });
  }

  async #writeBlocksToClipboard(blocks: Block[]): Promise<void> {
    const payload = serializeBlocksForClipboard(blocks);
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
      event.clipboardData.setData('text/plain', payload.text);
      event.clipboardData.setData('text/html', payload.html);
      event.clipboardData.setData('application/x-nobita+json', payload.json);
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
    if (selection && this.#isCollapsed(selection)) {
      const all: EditorSelection = {
        anchor: { blockId, offset: 0 },
        focus: { blockId, offset: length },
      };
      this.#restoreSelection(all);
      return;
    }
    const flat = flattenBlocks(this.store.doc.blocks).filter(
      item => item.type !== 'divider' && item.type !== 'image' && item.type !== 'database'
    );
    const first = flat[0];
    const last = flat[flat.length - 1];
    if (first && last) {
      this.#restoreSelection({
        anchor: { blockId: first.id, offset: 0 },
        focus: { blockId: last.id, offset: runsLength(last.text) },
      });
    }
  }

  #previousTextBlock(blockId: string): Block | null {
    const flat = flattenBlocks(this.store.doc.blocks).filter(
      block => block.type !== 'divider' && block.type !== 'image' && block.type !== 'database'
    );
    const index = flat.findIndex(block => block.id === blockId);
    return index > 0 ? flat[index - 1] ?? null : null;
  }

  #nextTextBlock(blockId: string): Block | null {
    const flat = flattenBlocks(this.store.doc.blocks).filter(
      block => block.type !== 'divider' && block.type !== 'image' && block.type !== 'database'
    );
    const index = flat.findIndex(block => block.id === blockId);
    return index >= 0 ? flat[index + 1] ?? null : null;
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

    if (block.type === 'database' || block.type === 'divider' || block.type === 'image') {
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
      this.#toolbar.hide();
      return;
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

  #selectedBlockIds(
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
    const ids = this.#selectedBlockIds(selection);
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
    const ids = this.#selectedBlockIds(selection, true);
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
    if (mention.query.length > 0) this.#syncMentionMenu();
  }

  #scheduleMentionSync(): void {
    if (!this.#mention || this.#mentionSyncQueued) return;
    this.#mentionSyncQueued = true;
    queueMicrotask(() => {
      this.#mentionSyncQueued = false;
      if (this.#mention) this.#syncMentionMenu();
    });
  }

  #syncMentionMenu(): void {
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
    mention.end = end;
    mention.query = query;
    if (!this.#menu.isOpen) return;
    this.#menu.setQuery(query);
    const provider = this.#options.mentionProvider;
    if (!provider) return;
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

  /** ---- slash menu ---- */

  #openSlashMenu(blockId: string, slashOffset: number): void {
    const slash = { blockId, start: slashOffset, end: slashOffset + 1 };
    this.#slash = slash;
    const removeSlash = (): void => {
      this.#removeSlashQuery(slash);
    };
    const rect = this.#caretRect(blockId);
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
    void navigator.clipboard?.writeText(link).catch(() => undefined);
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
    if (targetId === drag.blockId || this.#isDescendant(drag.blockId, targetId)) {
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
      this.openBlockMenu(blockId, handle);
      return;
    }
    if (!targetId || !position) return;
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




function replaceBlockText(doc: Doc, blockId: string, runs: Block['text']): Doc {  const blocks = replaceTextIn(doc.blocks, blockId, runs);
  return blocks === doc.blocks ? doc : { ...doc, blocks };
}

function replaceTextIn(
  blocks: readonly Block[],
  blockId: string,
  runs: Block['text']
): Block[] {
  let changed = false;
  const next = blocks.map(block => {
    if (block.id === blockId) {
      if (block.text === runs) return block;
      changed = true;
      return { ...block, text: runs };
    }
    const children = replaceTextIn(block.children, blockId, runs);
    if (children !== block.children) {
      changed = true;
      return { ...block, children };
    }
    return block;
  });
  return changed ? next : (blocks as Block[]);
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

