import { blockSearchText } from './commands.js';
import { walkBlocks } from './doc.js';
import { plainText } from './text.js';
import type { Block, Doc, InlineRun } from './types.js';

export interface PageLinkReference {
  pageId: string;
  blockId: string;
  kind: 'block' | 'inline';
  /** Plain-text context snippet from the linking block. */
  snippet: string;
  title?: string;
  icon?: string;
}

export interface BacklinkItem {
  sourceDocId: string;
  sourceTitle: string;
  sourceIcon?: string;
  blockId: string;
  kind: 'block' | 'inline';
  snippet: string;
}

export interface BacklinkOptions {
  /** Include links where a document references itself. Defaults to `false`. */
  includeSelf?: boolean;
}

export interface PageTreeInput {
  id: string;
  title: string;
  icon?: string;
  parentId?: string | null;
  favorite?: boolean;
  order?: number;
  updatedAt?: number;
  /** Epoch ms timestamp when moved to Trash; omitted or null means active. */
  deletedAt?: number | null;
}

export interface PageTreeNode {
  id: string;
  title: string;
  icon?: string;
  parentId: string | null;
  favorite: boolean;
  order?: number;
  updatedAt: number;
  depth: number;
  children: PageTreeNode[];
}

export interface PageSearchHit {
  docId: string;
  title: string;
  icon?: string;
  matchType: 'title' | 'block';
  blockId?: string;
  snippet?: string;
  score: number;
}

const MAX_SNIPPET_LENGTH = 160;
const PAGE_HASH_PREFIX = '#page-';

function compactSnippet(text: string): string {
  const collapsed = text.replace(/\s+/gu, ' ').trim();
  if (collapsed.length <= MAX_SNIPPET_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`;
}

function decodePageHash(href: string): string | null {
  if (!href.startsWith(PAGE_HASH_PREFIX)) return null;
  const raw = href.slice(PAGE_HASH_PREFIX.length);
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded || null;
  } catch {
    return raw.trim() || null;
  }
}

function collectRunLinks(
  runs: readonly InlineRun[],
  blockId: string,
  snippetSource: string,
  out: PageLinkReference[]
): void {
  const snippet = compactSnippet(snippetSource);
  for (const run of runs) {
    const page = run.marks?.page;
    if (page?.id) {
      out.push({
        pageId: page.id,
        blockId,
        kind: 'inline',
        snippet: snippet || page.title || run.text,
        ...(page.title ? { title: page.title } : {}),
        ...(page.icon ? { icon: page.icon } : {}),
      });
      continue;
    }
    const href = run.marks?.link;
    if (href) {
      const pageId = decodePageHash(href);
      if (pageId) {
        const title = run.text.trim();
        out.push({
          pageId,
          blockId,
          kind: 'inline',
          snippet: snippet || title,
          ...(title ? { title } : {}),
        });
      }
    }
  }
}

/**
 * Extract all outgoing page links from a document — including `page` blocks,
 * inline `marks.page` chips, `#page-<id>` links, and rich-text cells inside
 * tables and databases.
 */
export function extractPageLinks(doc: Doc): PageLinkReference[] {
  const out: PageLinkReference[] = [];
  walkBlocks(doc.blocks, (block: Block) => {
    if (block.type === 'page') {
      const pageId = block.props.pageId?.trim();
      if (pageId) {
        const title = block.props.pageTitle?.trim();
        const icon = block.props.pageIcon?.trim();
        out.push({
          pageId,
          blockId: block.id,
          kind: 'block',
          snippet: compactSnippet(title || 'Untitled page'),
          ...(title ? { title } : {}),
          ...(icon ? { icon } : {}),
        });
      }
      return;
    }

    if (block.text.length > 0) {
      collectRunLinks(block.text, block.id, plainText(block.text), out);
    }

    if (block.type === 'table' && block.props.table) {
      for (const row of block.props.table.rows) {
        for (const cell of Object.values(row.cells)) {
          if (cell.runs && cell.runs.length > 0) {
            collectRunLinks(cell.runs, block.id, cell.text || plainText(cell.runs), out);
          }
        }
      }
    }

    if (block.type === 'database' && block.props.database) {
      for (const row of block.props.database.rows) {
        for (const cell of Object.values(row.cells)) {
          if (cell.runs && cell.runs.length > 0) {
            collectRunLinks(cell.runs, block.id, cell.text || plainText(cell.runs), out);
          }
        }
        if (row.page?.content && row.page.content.length > 0) {
          collectRunLinks(row.page.content, block.id, plainText(row.page.content), out);
        }
      }
    }
  });
  return out;
}

/**
 * Build a map from target `pageId` to incoming backlinks across all workspace
 * documents. Multiple links from the same `(sourceDocId, blockId)` to the same
 * target page are deduplicated into one entry.
 */
export function buildBacklinkIndex(
  docs: readonly Doc[],
  options: BacklinkOptions = {}
): Map<string, BacklinkItem[]> {
  const includeSelf = options.includeSelf ?? false;
  const index = new Map<string, BacklinkItem[]>();

  for (const doc of docs) {
    const refs = extractPageLinks(doc);
    if (refs.length === 0) continue;
    const seen = new Set<string>();
    const sourceTitle = doc.title.trim() || 'Untitled';
    const sourceIcon = doc.icon?.trim();

    for (const ref of refs) {
      if (!includeSelf && ref.pageId === doc.id) continue;
      const dedupeKey = `${ref.pageId}\u0000${ref.blockId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const entry: BacklinkItem = {
        sourceDocId: doc.id,
        sourceTitle,
        ...(sourceIcon ? { sourceIcon } : {}),
        blockId: ref.blockId,
        kind: ref.kind,
        snippet: ref.snippet,
      };
      const list = index.get(ref.pageId);
      if (list) list.push(entry);
      else index.set(ref.pageId, [entry]);
    }
  }

  return index;
}

/** Return incoming backlinks pointing to `targetPageId`. */
export function getBacklinks(
  docs: readonly Doc[],
  targetPageId: string,
  options: BacklinkOptions = {}
): BacklinkItem[] {
  if (!targetPageId) return [];
  return buildBacklinkIndex(docs, options).get(targetPageId) ?? [];
}

function compareTreeInputs(a: PageTreeInput, b: PageTreeInput): number {
  const aOrdered = typeof a.order === 'number' && Number.isFinite(a.order);
  const bOrdered = typeof b.order === 'number' && Number.isFinite(b.order);
  if (aOrdered && bOrdered && a.order !== b.order) return a.order! - b.order!;
  if (aOrdered !== bOrdered) return aOrdered ? -1 : 1;
  const aFav = Boolean(a.favorite);
  const bFav = Boolean(b.favorite);
  if (aFav !== bFav) return aFav ? -1 : 1;
  const aTime = a.updatedAt ?? 0;
  const bTime = b.updatedAt ?? 0;
  if (aTime !== bTime) return aTime - bTime;
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

/** Return `true` when a page record has been soft-deleted into Trash. */
export function isTrashedPage(page: Pick<PageTreeInput, 'deletedAt'>): boolean {
  return typeof page.deletedAt === 'number' && Number.isFinite(page.deletedAt);
}

function normalizedParentMap(
  pages: readonly PageTreeInput[],
  includeTrashed = false
): {
  byId: Map<string, PageTreeInput>;
  parentOf: Map<string, string | null>;
} {
  const byId = new Map<string, PageTreeInput>();
  for (const page of pages) {
    if (!page.id || byId.has(page.id)) continue;
    if (!includeTrashed && isTrashedPage(page)) continue;
    byId.set(page.id, page);
  }
  const parentOf = new Map<string, string | null>();
  for (const [id, page] of byId) {
    const raw = page.parentId ?? null;
    parentOf.set(id, raw && raw !== id && byId.has(raw) ? raw : null);
  }
  // Break any remaining ancestor cycles by promoting the closing edge to root.
  for (const id of byId.keys()) {
    const chain = new Set<string>([id]);
    let cursor = parentOf.get(id) ?? null;
    while (cursor !== null) {
      if (chain.has(cursor)) {
        parentOf.set(id, null);
        break;
      }
      chain.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }
  return { byId, parentOf };
}

/**
 * Build a cycle-safe hierarchical page tree from flat page records.
 * Missing parents and cyclic parent pointers are promoted to root so every
 * page appears exactly once.
 */
export function buildPageTree(pages: readonly PageTreeInput[]): PageTreeNode[] {
  const { byId, parentOf } = normalizedParentMap(pages);
  const childrenByParent = new Map<string | null, PageTreeInput[]>();
  for (const [id, page] of byId) {
    const parentId = parentOf.get(id) ?? null;
    const siblings = childrenByParent.get(parentId);
    if (siblings) siblings.push(page);
    else childrenByParent.set(parentId, [page]);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort(compareTreeInputs);
  }

  const buildLevel = (parentId: string | null, depth: number): PageTreeNode[] => {
    const siblings = childrenByParent.get(parentId) ?? [];
    return siblings.map(item => ({
      id: item.id,
      title: item.title,
      ...(item.icon ? { icon: item.icon } : {}),
      parentId,
      favorite: Boolean(item.favorite),
      ...(typeof item.order === 'number' && Number.isFinite(item.order)
        ? { order: item.order }
        : {}),
      updatedAt: item.updatedAt ?? 0,
      depth,
      children: buildLevel(item.id, depth + 1),
    }));
  };

  return buildLevel(null, 0);
}

/** Pre-order depth-first flattening of a page tree. */
export function flattenPageTree(tree: readonly PageTreeNode[]): PageTreeNode[] {
  const out: PageTreeNode[] = [];
  const visit = (nodes: readonly PageTreeNode[]): void => {
    for (const node of nodes) {
      out.push(node);
      if (node.children.length > 0) visit(node.children);
    }
  };
  visit(tree);
  return out;
}

/** Return the cycle-safe ancestor path from root down to `pageId` (inclusive). */
export function getPageBreadcrumbs(
  pages: readonly PageTreeInput[],
  pageId: string
): PageTreeInput[] {
  const { byId, parentOf } = normalizedParentMap(pages);
  const start = byId.get(pageId);
  if (!start) return [];
  const path: PageTreeInput[] = [start];
  const seen = new Set<string>([pageId]);
  let cursor = parentOf.get(pageId) ?? null;
  while (cursor && !seen.has(cursor)) {
    const ancestor = byId.get(cursor);
    if (!ancestor) break;
    path.unshift(ancestor);
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return path;
}

/** Return the set of all descendant page IDs below `pageId` (excluding `pageId` itself). */
export function getPageDescendantIds(
  pages: readonly PageTreeInput[],
  pageId: string
): Set<string> {
  const { parentOf } = normalizedParentMap(pages);
  const childrenByParent = new Map<string, string[]>();
  for (const [id, parentId] of parentOf) {
    if (!parentId) continue;
    const list = childrenByParent.get(parentId);
    if (list) list.push(id);
    else childrenByParent.set(parentId, [id]);
  }
  const descendants = new Set<string>();
  const queue = [...(childrenByParent.get(pageId) ?? [])];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (descendants.has(current)) continue;
    descendants.add(current);
    const next = childrenByParent.get(current);
    if (next) queue.push(...next);
  }
  return descendants;
}

/**
 * Check whether `pageId` can be moved under `newParentId` (`null` for root)
 * without creating a self-loop or ancestor cycle.
 */
export function canReparentPage(
  pages: readonly PageTreeInput[],
  pageId: string,
  newParentId: string | null
): boolean {
  const { byId } = normalizedParentMap(pages);
  if (!byId.has(pageId)) return false;
  if (newParentId === null) return true;
  if (newParentId === pageId) return false;
  if (!byId.has(newParentId)) return false;
  return !getPageDescendantIds(pages, pageId).has(newParentId);
}

/**
 * Partition page records into active and trashed lists.
 * Trashed pages are sorted most recently deleted first.
 */
export function partitionTrashedPages<T extends PageTreeInput>(
  pages: readonly T[]
): { active: T[]; trashed: T[] } {
  const active: T[] = [];
  const trashed: T[] = [];
  for (const page of pages) {
    if (isTrashedPage(page)) trashed.push(page);
    else active.push(page);
  }
  trashed.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0) || a.title.localeCompare(b.title));
  return { active, trashed };
}

/**
 * Collect `pageId` and all of its active descendant IDs to soft-delete together.
 * Already-trashed descendants are left untouched so their original deletion
 * timestamp is preserved.
 */
export function collectTrashTargetIds(
  pages: readonly PageTreeInput[],
  pageId: string
): Set<string> {
  const { byId } = normalizedParentMap(pages, false);
  const targets = new Set<string>();
  if (!byId.has(pageId)) return targets;
  targets.add(pageId);
  for (const descendantId of getPageDescendantIds(pages, pageId)) {
    targets.add(descendantId);
  }
  return targets;
}

/**
 * Resolve a safe `parentId` when restoring `pageId` from Trash.
 * Keeps the original parent if it exists and is currently active; otherwise
 * promotes the restored page to workspace root (`null`).
 */
export function resolveRestoreParentId(
  pages: readonly PageTreeInput[],
  pageId: string
): string | null {
  const { byId, parentOf } = normalizedParentMap(pages, true);
  const page = byId.get(pageId);
  if (!page) return null;
  const candidate = parentOf.get(pageId) ?? null;
  if (!candidate) return null;
  const parent = byId.get(candidate);
  if (!parent || isTrashedPage(parent)) return null;
  return candidate;
}

/**
 * Collect `pageId` and its trashed descendants that should be restored together.
 * By default, only descendants deleted at or after `pageId.deletedAt` are
 * included so children previously trashed on their own stay in Trash.
 */
export function collectRestoreTargetIds(
  pages: readonly PageTreeInput[],
  pageId: string,
  options: { includeAllDescendants?: boolean } = {}
): Set<string> {
  const { byId, parentOf } = normalizedParentMap(pages, true);
  const root = byId.get(pageId);
  const targets = new Set<string>();
  if (!root || !isTrashedPage(root)) return targets;
  targets.add(pageId);
  const rootDeletedAt = root.deletedAt ?? 0;

  const childrenByParent = new Map<string, string[]>();
  for (const [id, parentId] of parentOf) {
    if (!parentId) continue;
    const list = childrenByParent.get(parentId);
    if (list) list.push(id);
    else childrenByParent.set(parentId, [id]);
  }

  const queue = [...(childrenByParent.get(pageId) ?? [])];
  while (queue.length > 0) {
    const currentId = queue.pop()!;
    if (targets.has(currentId)) continue;
    const node = byId.get(currentId);
    if (!node || !isTrashedPage(node)) continue;
    if (options.includeAllDescendants || (node.deletedAt ?? 0) >= rootDeletedAt) {
      targets.add(currentId);
      const next = childrenByParent.get(currentId);
      if (next) queue.push(...next);
    }
  }
  return targets;
}

function normalizeQuery(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').trim();
}

/**
 * Search workspace documents across titles and block body text.
 * Title matches rank ahead of body matches; an empty query lists all docs.
 */
export function searchWorkspacePages(
  docs: readonly Doc[],
  query: string
): PageSearchHit[] {
  const needle = normalizeQuery(query);
  const hits: PageSearchHit[] = [];

  for (const doc of docs) {
    const title = doc.title.trim() || 'Untitled';
    const icon = doc.icon?.trim();
    if (!needle) {
      hits.push({
        docId: doc.id,
        title,
        ...(icon ? { icon } : {}),
        matchType: 'title',
        score: 1,
      });
      continue;
    }

    const normTitle = normalizeQuery(title);
    let titleScore = 0;
    if (normTitle === needle) titleScore = 100;
    else if (normTitle.startsWith(needle)) titleScore = 80;
    else if (normTitle.includes(needle)) titleScore = 60;

    let bestBlock: { blockId: string; snippet: string; score: number } | null = null;
    walkBlocks(doc.blocks, block => {
      if (bestBlock && bestBlock.score >= 45) return;
      const text = blockSearchText(block);
      if (!text) return;
      const norm = normalizeQuery(text);
      const pos = norm.indexOf(needle);
      if (pos < 0) return;
      const score = pos === 0 ? 45 : 30;
      if (!bestBlock || score > bestBlock.score) {
        bestBlock = {
          blockId: block.id,
          snippet: compactSnippet(text),
          score,
        };
      }
    });

    if (titleScore > 0) {
      const blockMatch = bestBlock as { blockId: string; snippet: string; score: number } | null;
      hits.push({
        docId: doc.id,
        title,
        ...(icon ? { icon } : {}),
        matchType: 'title',
        ...(blockMatch ? { blockId: blockMatch.blockId, snippet: blockMatch.snippet } : {}),
        score: titleScore + (blockMatch ? 5 : 0),
      });
    } else if (bestBlock) {
      const blockMatch = bestBlock as { blockId: string; snippet: string; score: number };
      hits.push({
        docId: doc.id,
        title,
        ...(icon ? { icon } : {}),
        matchType: 'block',
        blockId: blockMatch.blockId,
        snippet: blockMatch.snippet,
        score: blockMatch.score,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits;
}
