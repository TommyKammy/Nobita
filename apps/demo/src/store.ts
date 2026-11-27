import { createId, duplicateBlockTree, parseDoc, type Doc } from '@nobita/core';

export interface PageRecord {
  doc: Doc;
  parentId: string | null;
  favorite: boolean;
  order?: number;
  tags?: string[] | undefined;
  createdAt?: number | undefined;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface DemoState {
  pages: Record<string, PageRecord>;
  activeId: string | null;
  theme: 'light' | 'dark';
}

const STORAGE_KEY = 'nobita.demo.v2';

export async function loadState(): Promise<{ state: DemoState; saved: boolean }> {
  let empty = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    empty = raw === null;
    if (raw) {
      const state = parseState(raw);
      if (state) return { state, saved: true };
    }
  } catch {
    // An unreadable workspace must survive opening the demo.
  }
  const state = (await import('./seed')).createSeedState();
  return { state, saved: empty && saveState(state) };
}

function parseState(raw: string): DemoState | null {
  const parsed = JSON.parse(raw) as {
    pages?: Record<
      string,
      {
        doc?: unknown;
        parentId?: string | null;
        favorite?: boolean;
        order?: number;
        tags?: string[] | undefined;
        createdAt?: number | undefined;
        updatedAt?: number;
        deletedAt?: number | null;
      }
    >;
    activeId?: string | null;
    theme?: string;
  };
  const pages: Record<string, PageRecord> = {};
  for (const [id, record] of Object.entries(parsed.pages ?? {})) {
    if (!record || typeof record !== 'object') continue;
    const doc = parseDoc(record.doc);
    pages[id] = {
      doc: { ...doc, id },
      parentId: typeof record.parentId === 'string' ? record.parentId : null,
      favorite: Boolean(record.favorite),
      ...(typeof record.order === 'number' && Number.isFinite(record.order)
        ? { order: record.order }
        : {}),
      tags: Array.isArray(record.tags) ? record.tags.filter(tag => typeof tag === 'string') : undefined,
      createdAt: record.createdAt,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
      ...(typeof record.deletedAt === 'number' && Number.isFinite(record.deletedAt)
        ? { deletedAt: record.deletedAt }
        : {}),
    };
  }
  if (Object.keys(pages).length === 0) return null;
  const firstActiveId = Object.keys(pages).find(id => {
    const value = pages[id]?.deletedAt;
    return !(typeof value === 'number' && Number.isFinite(value));
  });
  const activeId =
    typeof parsed.activeId === 'string' && pages[parsed.activeId]
      ? parsed.activeId
      : (firstActiveId ?? null);
  return {
    pages,
    activeId,
    theme: parsed.theme === 'dark' ? 'dark' : 'light',
  };
}

export function saveState(state: DemoState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function duplicatePageRecord(record: PageRecord, parentId = record.parentId): PageRecord {
  const doc: Doc = {
    ...record.doc,
    id: createId('d'),
    title: record.doc.title ? `${record.doc.title} copy` : 'Untitled',
    blocks: record.doc.blocks.map(duplicateBlockTree),
  };
  const now = Date.now();
  return {
    doc,
    tags: record.tags?.slice(),
    parentId,
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
}
