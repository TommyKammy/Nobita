import type { Doc, EditorSelection, PageInfo } from '@nobita/core';
import { parseDoc } from '@nobita/core';
import {
  NobitaEditor,
  type ImageUploadHandler,
  type MentionProvider,
  type NobitaOptions,
  type NobitaTheme,
} from './editor.js';

const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

export interface NobitaChangeDetail {
  doc: Doc;
  source: string;
}

export interface NobitaPageOpenDetail {
  pageId: string;
}

/**
 * `<nobita-editor>` — a shadow-DOM web component wrapper around NobitaEditor.
 * Attributes: `readonly`, `theme` (light|dark|auto), `placeholder`,
 * `min-height`. Set the document with the `doc` property or `value` JSON.
 */
export class NobitaEditorElement extends Base {
  static observedAttributes = ['readonly', 'theme', 'placeholder', 'min-height', 'doc'];

  #editor: NobitaEditor | null = null;
  #pendingDoc: Doc | string | undefined;
  #lastDoc: Doc | null = null;
  #mentionProvider: MentionProvider | undefined;
  #uploadImage: ImageUploadHandler | undefined;
  #onOpenPage: ((pageId: string) => void) | undefined;
  #resolvePage: ((pageId: string) => PageInfo | null) | undefined;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    if (this.#editor) return;
    const doc = this.#pendingDoc ?? this.#lastDoc ?? this.getAttribute('doc') ?? undefined;
    this.#editor = new NobitaEditor(this, {
      ...(doc === undefined ? {} : { doc }),
      readonly: this.hasAttribute('readonly'),
      theme: (this.getAttribute('theme') as NobitaTheme | null) ?? 'light',
      ...(this.getAttribute('placeholder')
        ? { placeholder: this.getAttribute('placeholder') as string }
        : {}),
      onChange: (nextDoc, meta) => {
        this.#lastDoc = nextDoc;
        this.dispatchEvent(
          new CustomEvent<NobitaChangeDetail>('nobita-change', {
            detail: { doc: nextDoc, source: meta.source },
            bubbles: true,
            composed: true,
          })
        );
      },
      onSelectionChange: (selection: EditorSelection | null) => {
        this.dispatchEvent(
          new CustomEvent<{ selection: EditorSelection | null }>('nobita-selection', {
            detail: { selection },
            bubbles: true,
            composed: true,
          })
        );
      },
      ...(this.#mentionProvider ? { mentionProvider: this.#mentionProvider } : {}),
      ...(this.#uploadImage ? { uploadImage: this.#uploadImage } : {}),
      onOpenPage: pageId => {
        this.#onOpenPage?.(pageId);
        this.dispatchEvent(
          new CustomEvent<NobitaPageOpenDetail>('nobita-page-open', {
            detail: { pageId },
            bubbles: true,
            composed: true,
          })
        );
      },
      resolvePage: pageId => this.#resolvePage?.(pageId) ?? null,
    });
    this.#applyMinHeight();
    this.#pendingDoc = undefined;
    this.dispatchEvent(new CustomEvent('nobita-ready', { bubbles: true, composed: true }));
  }

  disconnectedCallback(): void {
    if (!this.#editor) return;
    this.#lastDoc = this.#editor.getDoc();
    this.#editor.destroy();
    this.#editor = null;
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (!this.#editor) {
      if (name === 'doc' && value) this.#pendingDoc = value;
      return;
    }
    switch (name) {
      case 'readonly':
        this.#editor.setReadonly(value !== null);
        break;
      case 'theme':
        this.#editor.setTheme((value as NobitaTheme | null) ?? 'light');
        break;
      case 'placeholder':
        this.#editor.setPlaceholder(value ?? "Write something, or press '/' for commands");
        break;
      case 'min-height':
        this.#applyMinHeight();
        break;
      case 'doc':
        if (value !== null) this.#editor.setDoc(value);
        break;
      default:
        break;
    }
  }

  get editor(): NobitaEditor | null {
    return this.#editor;
  }

  get doc(): Doc | null {
    return this.#editor?.getDoc() ?? this.#lastDoc;
  }

  set doc(value: Doc | string) {
    if (this.#editor) this.#editor.setDoc(value);
    else this.#pendingDoc = typeof value === 'string' ? parseDoc(value) : value;
  }

  get mentionProvider(): MentionProvider | undefined {
    return this.#mentionProvider;
  }

  set mentionProvider(value: MentionProvider | undefined) {
    this.#mentionProvider = value;
    this.#editor?.setMentionProvider(value);
  }

  get uploadImage(): ImageUploadHandler | undefined {
    return this.#uploadImage;
  }

  set uploadImage(value: ImageUploadHandler | undefined) {
    this.#uploadImage = value;
    this.#editor?.setUploadImage(value);
  }

  get onOpenPage(): ((pageId: string) => void) | undefined {
    return this.#onOpenPage;
  }

  set onOpenPage(value: ((pageId: string) => void) | undefined) {
    this.#onOpenPage = value;
  }

  get resolvePage(): ((pageId: string) => PageInfo | null) | undefined {
    return this.#resolvePage;
  }

  set resolvePage(value: ((pageId: string) => PageInfo | null) | undefined) {
    this.#resolvePage = value;
    this.#editor?.refreshPageLinks();
  }

  get value(): string {
    return this.#editor?.getJSON() ?? '';
  }

  set value(json: string) {
    this.doc = json;
  }

  get markdown(): string {
    return this.#editor?.getMarkdown() ?? '';
  }

  override focus(options?: FocusOptions): void {
    void options;
    this.#editor?.focus();
  }

  undo(): boolean {
    return this.#editor?.undo() ?? false;
  }

  redo(): boolean {
    return this.#editor?.redo() ?? false;
  }

  getMarkdown(): string {
    return this.#editor?.getMarkdown() ?? '';
  }

  getJSON(): string {
    return this.#editor?.getJSON() ?? '';
  }

  insertPageLink(page: PageInfo, options: { afterBlockId?: string } = {}): string | null {
    return this.#editor?.insertPageLink(page, options) ?? null;
  }

  refreshPageLinks(): void {
    this.#editor?.refreshPageLinks();
  }

  getSelectedBlockIds(): string[] {
    return this.#editor?.getSelectedBlockIds() ?? [];
  }

  selectBlocks(ids: readonly string[]): void {
    this.#editor?.selectBlocks(ids);
  }

  clearBlockSelection(): void {
    this.#editor?.clearBlockSelection();
  }

  setReadonly(readonly: boolean): void {
    if (readonly) this.setAttribute('readonly', '');
    else this.removeAttribute('readonly');
    this.#editor?.setReadonly(readonly);
  }

  setTheme(theme: NobitaTheme): void {
    this.setAttribute('theme', theme);
    this.#editor?.setTheme(theme);
  }

  #applyMinHeight(): void {
    const minHeight = this.getAttribute('min-height');
    if (minHeight) this.style.setProperty('--nb-min-height', minHeight);
    else this.style.removeProperty('--nb-min-height');
  }
}

export function defineNobitaEditor(tagName = 'nobita-editor'): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(tagName)) return;
  customElements.define(tagName, NobitaEditorElement);
}

export function createEditor(container: HTMLElement, options: NobitaOptions = {}): NobitaEditor {
  return new NobitaEditor(container, options);
}

export type { NobitaEditor, NobitaOptions, NobitaTheme };
