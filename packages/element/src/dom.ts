/** DOM ⇄ text-offset mapping shared by the inline editor and selection code. */

export function isTextNode(node: Node | null): node is Text {
  return node?.nodeType === Node.TEXT_NODE;
}

export function textLengthOfSubtree(node: Node): number {
  if (isTextNode(node)) return node.data.length;
  if (node.nodeName === 'BR') return 1;
  let total = 0;
  for (const child of Array.from(node.childNodes)) total += textLengthOfSubtree(child);
  return total;
}

/** Convert a DOM point inside `root` to an offset in the block's plain text. */
export function domPointToOffset(root: HTMLElement, node: Node, offset: number): number {
  let total = 0;
  let result = 0;
  let found = false;

  const visit = (current: Node): void => {
    if (found) return;
    if (current === node) {
      if (isTextNode(current)) {
        result = total + Math.max(0, Math.min(offset, current.data.length));
      } else {
        const children = Array.from(current.childNodes);
        const limit = Math.max(0, Math.min(offset, children.length));
        let added = 0;
        for (let index = 0; index < limit; index += 1) {
          const child = children[index];
          if (child) added += textLengthOfSubtree(child);
        }
        result = total + added;
      }
      found = true;
      return;
    }
    if (isTextNode(current)) {
      total += current.data.length;
      return;
    }
    if (current.nodeName === 'BR') {
      total += 1;
      return;
    }
    for (const child of Array.from(current.childNodes)) {
      visit(child);
      if (found) return;
    }
  };

  visit(root);
  return found ? result : total;
}

/** Convert a text offset to the nearest DOM point inside `root`. */
export function offsetToDomPoint(root: HTMLElement, offset: number): { node: Node; offset: number } {
  const target = Math.max(0, offset);
  let total = 0;
  let lastText: Text | null = null;

  const visit = (node: Node): { node: Node; offset: number } | null => {
    if (isTextNode(node)) {
      const end = total + node.data.length;
      if (target <= end) {
        const local = Math.max(0, target - total);
        return { node, offset: local };
      }
      total = end;
      lastText = node;
      return null;
    }
    if (node.nodeName === 'BR') {
      if (target <= total + 1) {
        const parent = node.parentNode ?? root;
        const index = Array.from(parent.childNodes).indexOf(node as ChildNode);
        return { node: parent, offset: Math.max(0, index) };
      }
      total += 1;
      return null;
    }
    for (const child of Array.from(node.childNodes)) {
      const point = visit(child);
      if (point) return point;
    }
    return null;
  };

  const point = visit(root);
  if (point) return point;
  const last = lastText as Text | null;
  if (last) return { node: last, offset: last.data.length };
  return { node: root, offset: 0 };
}

export function compareTextPositions(
  order: readonly string[],
  a: { blockId: string; offset: number },
  b: { blockId: string; offset: number }
): number {
  if (a.blockId === b.blockId) return a.offset - b.offset;
  const indexA = order.indexOf(a.blockId);
  const indexB = order.indexOf(b.blockId);
  return indexA - indexB;
}

/**
 * Return the selection that actually belongs to the editor. Chromium exposes
 * shadow-tree selections through ShadowRoot#getSelection; the document-level
 * selection can otherwise report a stale caret on the host page.
 */
export function nativeSelection(root: ShadowRoot): Selection | null {
  const shadow = root as ShadowRoot & { getSelection?: () => Selection | null };
  if (typeof shadow.getSelection === 'function') {
    const local = shadow.getSelection();
    if (local && local.rangeCount > 0) return local;
  }
  return window.getSelection();
}

export function caretRect(
  root: HTMLElement,
  offset: number,
  selection: Selection | null
): DOMRect | null {
  if (selection && selection.rangeCount > 0 && root.contains(selection.anchorNode)) {
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rects = range.getClientRects();
    const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
    if (rect.width + rect.height > 0) return rect;
  }
  const point = offsetToDomPoint(root, offset);
  const range = document.createRange();
  try {
    range.setStart(point.node, point.offset);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (rect.width + rect.height > 0) return rect;
  } catch {
    // fall through
  }
  return root.getBoundingClientRect();
}

export function selectionRect(root: ShadowRoot): DOMRect | null {
  const selection = nativeSelection(root);
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
}

export function isNodeInside(node: Node | null, container: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === container) return true;
    current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null);
  }
  return false;
}

export function closestElement(node: Node | null, selector: string): HTMLElement | null {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return (element?.closest(selector) as HTMLElement | null) ?? null;
}
