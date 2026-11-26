import {
  diffDocs,
  sameSelection,
  type EditorSelection,
  type InlineMark,
  type CollaborationAdapter,
  type EditorStore,
  type PeerPresence,
  type CompositionTarget,
  type RemoteDocUpdate,
} from '@nobita/core';
import { domPointToOffset, nativeSelection, offsetToDomPoint } from './dom.js';

export function connect(
  adapter: CollaborationAdapter,
  store: EditorStore,
  root: ShadowRoot,
  overlay: HTMLElement,
  restore: () => void
) {
  const events = new AbortController(),
    capture = { capture: true, signal: events.signal };
  let composing: CompositionTarget | null = null;
  let compositionElement: HTMLElement | null = null;
  const block = (id: string) =>
    root.querySelector<HTMLElement>('[data-block-id="' + CSS.escape(id) + '"]');
  const bodyText = (id: string) =>
    block(id)?.querySelector<HTMLElement>('.nb-text');
  function cellText(id: string, row: string, col: string) {
    return block(id)?.querySelector<HTMLElement>(
      `[data-row-id="${CSS.escape(row)}"][data-column-id="${CSS.escape(col)}"] :is(.nb-table-cell,.nb-db-rich-text)`
    );
  }
  function targetOf(cell: HTMLElement | null | undefined) {
    const detail = cell?.closest<HTMLElement>('[data-record-owner]')?.dataset;
    const rowId =
      detail?.rowId ??
      cell?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId;
    const columnId =
      cell?.closest<HTMLElement>('[data-column-id]')?.dataset.columnId;
    const id =
      detail?.recordOwner ??
      cell?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
    return { detail, rowId, columnId, id };
  }
  const receive = ({
    doc,
    remapPoint,
    remapCellOffset,
    remapPageOffset,
    history,
    historySelection,
  }: RemoteDocUpdate) => {
    if (composing) return;
    const active = root.activeElement?.classList.contains('nb-body');
    const cell = root.activeElement?.closest<HTMLElement>(
      '.nb-table-cell,.nb-db-rich-text'
    );
    const { detail, rowId, columnId, id } = targetOf(cell);
    const sel = nativeSelection(root);
    let restoreCell: (() => void) | undefined;
    if (
      cell &&
      id &&
      rowId &&
      (columnId
        ? remapCellOffset
        : cell.matches('.nb-db-page-text') && remapPageOffset) &&
      sel?.anchorNode &&
      sel.focusNode &&
      cell.contains(sel.anchorNode) &&
      cell.contains(sel.focusNode)
    ) {
      const remap = (node: Node, offset: number) => {
        const at = domPointToOffset(cell, node, offset);
        return columnId
          ? remapCellOffset!(id, rowId, columnId, at)
          : remapPageOffset!(id, rowId, at);
      };
      const anchor = remap(sel.anchorNode, sel.anchorOffset);
      const focus = remap(sel.focusNode, sel.focusOffset);
      restoreCell = () => {
        const el = cell.isConnected
          ? cell
          : detail
            ? root.querySelector<HTMLElement>(
                `[data-record-owner="${CSS.escape(id)}"][data-row-id="${CSS.escape(rowId)}"] ${columnId ? `[data-column-id="${CSS.escape(columnId)}"] .nb-db-rich-text` : '.nb-db-page-text'}`
              )
            : columnId
              ? cellText(id, rowId, columnId)
              : null;
        if (!el || anchor === null || focus === null) return;
        el.focus({ preventScroll: true });
        const a = offsetToDomPoint(el, anchor),
          f = offsetToDomPoint(el, focus);
        nativeSelection(root)?.setBaseAndExtent(
          a.node,
          a.offset,
          f.node,
          f.offset
        );
      };
    }
    store.applyRemote(doc, remapPoint, history, historySelection);
    restoreCell?.();
    if (active) restore();
  };
  store.setHistoryAdapter(adapter);
  store.applyRemote(adapter.getDoc());
  const remote = adapter.subscribe(receive);
  const local = store.subscribe((change) => {
    if (
      change.source !== 'remote' &&
      change.source !== 'undo' &&
      change.source !== 'redo'
    )
      adapter.applyLocalChange(change, diffDocs(change.previous, change.doc));
  });
  const inputSelector = '.nb-text,.nb-table-cell,.nb-db-rich-text';
  root.addEventListener(
    'compositionstart',
    (event) => {
      const sel = nativeSelection(root),
        node = sel?.anchorNode;
      if (!node || !sel?.focusNode) return;
      const text = (
        node instanceof Element ? node : node.parentElement
      )?.closest<HTMLElement>(inputSelector);
      const { id, rowId: row, columnId: col } = targetOf(text);
      if (
        !text ||
        !id ||
        !text.contains(sel.focusNode) ||
        text.closest('[contenteditable=false]') === text
      )
        return;
      const a = domPointToOffset(text, node, sel.anchorOffset),
        b = domPointToOffset(text, sel.focusNode, sel.focusOffset);
      if (
        !text.classList.contains('nb-text') &&
        !(row && (col || text.matches('.nb-db-page-text')))
      )
        return;
      const base = {
        ...(a > b && { backward: true }),
        blockId: id,
        from: Math.min(a, b),
        to: Math.max(a, b),
      };
      composing = row
        ? { ...base, rowId: row, ...(col && { columnId: col }) }
        : base;
      if (row && a === b) {
        const target = composing;
        text.dispatchEvent(
          new CustomEvent('nb-composition-marks', {
            detail: (offset: number, marks: InlineMark) => {
              if (offset === a) target.pendingMarks = marks;
            },
          })
        );
      }
      compositionElement = text;
      adapter.beginComposition(composing);
      event.stopPropagation();
    },
    capture
  );
  for (const type of ['beforeinput', 'input'])
    root.addEventListener(
      type,
      (e) => {
        if (composing) e.stopPropagation();
      },
      capture
    );
  root.addEventListener(
    'compositionend',
    (e) => {
      if (!composing) return;
      e.stopPropagation();
      const original = compositionElement;
      compositionElement = null;
      const target = composing,
        data = (e as CompositionEvent).data;
      composing = null;
      const update = data
        ? adapter.commitComposition(data)
        : adapter.cancelComposition();
      const point = update.remapPoint?.({
        blockId: target.blockId,
        offset: target.from,
      });
      store.applyRemote(update.doc);
      const text =
        target.rowId === undefined
          ? bodyText(point?.blockId ?? target.blockId)
          : original?.isConnected
            ? original
            : target.columnId !== undefined
              ? cellText(target.blockId, target.rowId, target.columnId)
              : null;
      if (text) {
        const p = offsetToDomPoint(text, point?.offset ?? target.from);
        nativeSelection(root)?.collapse(p.node, p.offset);
      }
    },
    capture
  );
  const layer = document.createElement('div');
  overlay.append(layer);
  let peers: readonly PeerPresence[] = [];
  const draw = () => {
    layer.replaceChildren();
    const origin = overlay.getBoundingClientRect();
    for (const { selection, user } of peers) {
      if (!selection) continue;
      const a = bodyText(selection.anchor.blockId),
        b = bodyText(selection.focus.blockId);
      if (!a || !b) continue;
      const start = offsetToDomPoint(a, selection.anchor.offset),
        end = offsetToDomPoint(b, selection.focus.offset);
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.collapse(true);
      if (range.comparePoint(end.node, end.offset) < 0) {
        range.setStart(end.node, end.offset);
        range.setEnd(start.node, start.offset);
      } else range.setEnd(end.node, end.offset);
      for (const rect of range.getClientRects()) {
        const mark = document.createElement('div');
        mark.title = user.name;
        mark.className = 'nb-peer-selection';
        Object.assign(mark.style, {
          position: 'absolute',
          pointerEvents: 'none',
          backgroundColor: user.color,
          opacity: range.collapsed ? '1' : '.25',
          top: rect.top - origin.top + 'px',
          left: rect.left - origin.left + 'px',
          width: Math.max(2, rect.width) + 'px',
          height: rect.height + 'px',
        });
        layer.append(mark);
      }
    }
  };
  const presence = adapter.subscribePresence?.((p) => {
    peers = p;
    draw();
  });
  let advertised: EditorSelection | null = null;
  const publish = (s: EditorSelection | null) => {
    if (sameSelection(s, advertised)) return;
    advertised = s;
    adapter.setLocalPresence?.({
      user: { name: '', color: '#597ad4' },
      selection: s,
      focusedBlockId: s?.focus.blockId ?? null,
    });
  };
  const selection = store.subscribeSelection(publish);
  const refresh = store.subscribe((change) => {
    if (root.activeElement) publish(change.selection);
    if (peers.length) draw();
  });
  root.addEventListener(
    'focusout',
    (e) => {
      if (!root.contains((e as FocusEvent).relatedTarget as Node | null)) {
        advertised = null;
        adapter.setLocalPresence?.(null);
      }
    },
    capture
  );
  root.addEventListener('scroll', draw, capture);
  window.addEventListener('resize', draw, { signal: events.signal });
  return () => {
    events.abort();
    const canceled = composing ? adapter.cancelComposition() : undefined;
    composing = null;
    remote();
    local();
    refresh();
    presence?.();
    selection();
    adapter.setLocalPresence?.(null);
    layer.remove();
    store.setHistoryAdapter(null);
    if (canceled) store.applyRemote(canceled.doc, canceled.remapPoint);
  };
}
