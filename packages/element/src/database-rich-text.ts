import {
  applyMarkPatch,
  deleteTextRange,
  insertTextAt,
  markStateInRange,
  marksAt,
  normalizeMark,
  runsLength,
  toggleMarkInRange,
} from '@nobita/core';
import type { InlineMark, MarkPatch, PageInfo } from '@nobita/core';
import { nativeSelection } from './dom.js';
import { placeFloating } from './floating.js';
import { icon } from './icons.js';
import {
  TAG_TO_MARK,
  el,
  iconBtn,
  isComposingKey as checkComposingKey,
  isMultilineRichText,
  readRichTextRuns,
  renderRichTextRuns,
  selectionOffsets,
  setSelectionOffsets,
} from './database-dom.js';

export interface DatabaseRichTextContext {
  rootElement: HTMLElement;
  getDetailElement?: () => HTMLElement | null;
  isReadonly: () => boolean;
  getSignal: () => AbortSignal;
  richTextSelector?: string;
  resolvePage?: (pageId: string) => PageInfo | null;
}

/** Manages inline rich-text formatting toolbar, pending marks, IME composition, and paste. */
export class DatabaseRichTextController {
  #ctx: DatabaseRichTextContext;
  #cellToolbar: HTMLElement | null = null;
  #pendingMarks: { target: HTMLElement; offset: number; marks: InlineMark } | null = null;
  readonly composingTargets = new WeakSet<HTMLElement>();

  constructor(ctx: DatabaseRichTextContext) {
    this.#ctx = ctx;
  }

  isComposing(target: HTMLElement): boolean {
    return this.composingTargets.has(target);
  }

  isComposingKey(event: KeyboardEvent, target?: HTMLElement | null): boolean {
    return checkComposingKey(event, this.composingTargets, target);
  }

  handleSelectionChange(): void {
    if (this.#pendingMarks) {
      const offsets = selectionOffsets(this.#pendingMarks.target);
      if (
        !offsets ||
        offsets.start !== offsets.end ||
        offsets.start !== this.#pendingMarks.offset
      ) {
        this.#pendingMarks = null;
      }
    }
    this.syncToolbar();
  }

  hideToolbar = (): void => {
    if (this.#cellToolbar) this.#cellToolbar.hidden = true;
  };

  clearPendingMarks(inside?: HTMLElement): void {
    if (this.#pendingMarks && (!inside || inside.contains(this.#pendingMarks.target))) {
      this.#pendingMarks = null;
    }
  }

  resetToolbar(): void {
    this.#cellToolbar = null;
  }

  destroy(): void {
    this.#cellToolbar?.remove();
    this.#cellToolbar = null;
    this.#pendingMarks = null;
  }

  syncToolbar(): void {
    if (this.#ctx.isReadonly()) {
      this.hideToolbar();
      return;
    }
    const selector = this.#ctx.richTextSelector ?? '.nb-db-rich-text';
    const root = this.#ctx.rootElement.getRootNode() as ShadowRoot;
    const active = root.activeElement as HTMLElement | null;
    if (
      active &&
      active.isContentEditable !== true &&
      !active.closest(selector)
    ) {
      this.hideToolbar();
      return;
    }
    const selection = nativeSelection(root);
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      this.hideToolbar();
      return;
    }
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as HTMLElement)
        : node.parentElement;
    const target = element?.closest<HTMLElement>(selector) ?? null;
    const detail = this.#ctx.getDetailElement?.() ?? null;
    if (
      !target ||
      target.isContentEditable !== true ||
      (!this.#ctx.rootElement.contains(target) && !detail?.contains(target))
    ) {
      this.hideToolbar();
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      this.hideToolbar();
      return;
    }
    const offsets = selectionOffsets(target);
    const activeMarks = offsets
      ? markStateInRange(readRichTextRuns(target), offsets.start, offsets.end)
      : {};
    const toolbar = this.#ensureCellToolbar();
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('.nb-db-inline-tool')) {
      const markKey = button.dataset.tag ? TAG_TO_MARK[button.dataset.tag] : undefined;
      const isActive = Boolean(markKey && activeMarks[markKey] === true);
      button.dataset.active = String(isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
    toolbar.hidden = false;
    placeFloating(toolbar, rect, {
      align: 'center',
      side: 'above',
      gap: 8,
      margin: 8,
    });
  }

  #ensureCellToolbar(): HTMLElement {
    if (this.#cellToolbar?.isConnected) return this.#cellToolbar;
    const toolbar = el('div', 'nb-db-inline-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Text formatting');
    toolbar.hidden = true;
    const commands: Array<{ tag: string; label: string; glyph: string }> = [
      { tag: 'strong', label: 'Bold', glyph: icon.bold },
      { tag: 'em', label: 'Italic', glyph: icon.italic },
      { tag: 'u', label: 'Underline', glyph: icon.underline },
      { tag: 's', label: 'Strikethrough', glyph: icon.strike },
      { tag: 'code', label: 'Inline code', glyph: icon.inlineCode },
    ];
    for (const command of commands) {
      const button = iconBtn('nb-db-inline-tool', command.glyph, command.label, {
        dataset: { tag: command.tag },
      });
      const signal = this.#ctx.getSignal();
      button.addEventListener('mousedown', event => event.preventDefault(), {
        signal,
      });
      button.addEventListener('click', () => {
        this.toggleInlineTag(command.tag);
      }, { signal });
      toolbar.append(button);
    }
    this.#ctx.rootElement.append(toolbar);
    this.#cellToolbar = toolbar;
    return toolbar;
  }

  attachCompositionHandlers(
    target: HTMLElement,
    onCommit: () => void,
    signal: AbortSignal,
    richText = false
  ): void {
    let pendingOnStart: { offset: number; marks: InlineMark } | null = null;
    target.addEventListener(
      'compositionstart',
      () => {
        this.composingTargets.add(target);
        if (
          richText &&
          this.#pendingMarks &&
          this.#pendingMarks.target === target
        ) {
          pendingOnStart = {
            offset: this.#pendingMarks.offset,
            marks: this.#pendingMarks.marks,
          };
          this.#pendingMarks = null;
        } else {
          pendingOnStart = null;
        }
      },
      { signal }
    );
    target.addEventListener(
      'compositionend',
      () => {
        this.composingTargets.delete(target);
        if (richText && pendingOnStart) {
          const { offset, marks } = pendingOnStart;
          pendingOnStart = null;
          const offsets = selectionOffsets(target);
          const endOffset = offsets ? offsets.end : offset;
          if (endOffset > offset) {
            const runs = readRichTextRuns(target);
            const patch: MarkPatch = {
              bold: marks.bold === true,
              italic: marks.italic === true,
              underline: marks.underline === true,
              strike: marks.strike === true,
              code: marks.code === true,
            };
            const nextRuns = applyMarkPatch(runs, offset, endOffset, patch);
            renderRichTextRuns(target, nextRuns, this.#ctx.resolvePage);
            setSelectionOffsets(target, endOffset, endOffset);
          }
        }
        onCommit();
      },
      { signal }
    );
  }

  attachRichTextHandlers(target: HTMLElement, signal: AbortSignal): void {
    target.addEventListener(
      'beforeinput',
      event => {
        const inputEvent = event as InputEvent;
        if (inputEvent.isComposing) return;
        const pending = this.#pendingMarks;
        if (!pending || pending.target !== target) return;
        if (
          inputEvent.inputType !== 'insertText' ||
          typeof inputEvent.data !== 'string' ||
          inputEvent.data.length === 0
        ) {
          this.#pendingMarks = null;
          return;
        }
        const offsets = selectionOffsets(target);
        if (
          !offsets ||
          offsets.start !== offsets.end ||
          offsets.start !== pending.offset
        ) {
          this.#pendingMarks = null;
          return;
        }
        event.preventDefault();
        const { marks } = pending;
        this.#pendingMarks = null;
        const data = isMultilineRichText(target)
          ? inputEvent.data
          : inputEvent.data.replace(/\r?\n/gu, ' ');
        const runs = readRichTextRuns(target);
        const nextRuns = insertTextAt(runs, offsets.start, data, marks);
        renderRichTextRuns(target, nextRuns, this.#ctx.resolvePage);
        const pos = offsets.start + data.length;
        setSelectionOffsets(target, pos, pos);
        target.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data,
          })
        );
        this.syncToolbar();
      },
      { signal }
    );
    target.addEventListener(
      'blur',
      () => {
        if (this.#pendingMarks?.target === target) {
          this.#pendingMarks = null;
        }
      },
      { signal }
    );
  }

  pasteIntoRichText(target: HTMLElement, value: string): void {
    const runs = readRichTextRuns(target);
    const fallback = runsLength(runs);
    const offsets = selectionOffsets(target) ?? { start: fallback, end: fallback };
    const pending =
      this.#pendingMarks &&
      this.#pendingMarks.target === target &&
      offsets.start === offsets.end &&
      offsets.start === this.#pendingMarks.offset
        ? this.#pendingMarks.marks
        : undefined;
    this.#pendingMarks = null;
    const deleted = deleteTextRange(runs, offsets.start, offsets.end);
    const nextRuns = insertTextAt(deleted, offsets.start, value, pending);
    renderRichTextRuns(target, nextRuns, this.#ctx.resolvePage);
    const pos = offsets.start + value.length;
    setSelectionOffsets(target, pos, pos);
    target.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertFromPaste',
        data: value,
      })
    );
    this.syncToolbar();
  }

  pastePlainText(target: HTMLElement, value: string): void {
    const current = target.textContent ?? '';
    const offsets = selectionOffsets(target) ?? {
      start: current.length,
      end: current.length,
    };
    const next = current.slice(0, offsets.start) + value + current.slice(offsets.end);
    target.textContent = next;
    const pos = offsets.start + value.length;
    setSelectionOffsets(target, pos, pos);
    target.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertFromPaste',
        data: value,
      })
    );
  }

  toggleInlineTag(tag: string): void {
    const markKey = TAG_TO_MARK[tag];
    if (!markKey) return;
    const root = this.#ctx.rootElement.getRootNode() as ShadowRoot;
    const selection = nativeSelection(root);
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as HTMLElement)
        : node.parentElement;
    const selector = this.#ctx.richTextSelector ?? '.nb-db-rich-text';
    const target = element?.closest<HTMLElement>(selector) ?? null;
    const detail = this.#ctx.getDetailElement?.() ?? null;
    if (
      !target ||
      target.isContentEditable !== true ||
      (!this.#ctx.rootElement.contains(target) && !detail?.contains(target))
    ) {
      return;
    }
    const offsets = selectionOffsets(target);
    if (!offsets) return;
    const { start, end } = offsets;
    const runs = readRichTextRuns(target);
    if (end > start) {
      this.#pendingMarks = null;
      const nextRuns = toggleMarkInRange(runs, start, end, markKey);
      renderRichTextRuns(target, nextRuns, this.#ctx.resolvePage);
      setSelectionOffsets(target, start, end);
      target.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'format' })
      );
      this.syncToolbar();
      return;
    }
    const baseSource =
      this.#pendingMarks &&
      this.#pendingMarks.target === target &&
      this.#pendingMarks.offset === start
        ? this.#pendingMarks.marks
        : (marksAt(runs, start) ?? {});
    const next: InlineMark = { ...baseSource };
    // Typing next to an atomic mention or page chip must not extend it.
    delete next.mention;
    delete next.page;
    if (next[markKey] === true) delete next[markKey];
    else next[markKey] = true;
    this.#pendingMarks = {
      target,
      offset: start,
      marks: normalizeMark(next) ?? {},
    };
  }
}
