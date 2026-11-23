import { describe, expect, it } from 'vitest';
import { createBlock, createDoc } from '@nobita/core';
import { DocumentConflictError } from '../src/errors.js';
import {
  LocalStorageDocumentStore,
  type StorageLike,
} from '../src/local-storage.js';

class FakeStorage implements StorageLike {
  #map = new Map<string, string>();

  get length(): number {
    return this.#map.size;
  }

  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }

  removeItem(key: string): void {
    this.#map.delete(key);
  }
}

function doc(title: string, id = 'doc-1') {
  return createDoc({
    id,
    title,
    blocks: [createBlock('paragraph', { text: title })],
  });
}

describe('LocalStorageDocumentStore', () => {
  it('persists JSON entries under a prefix', async () => {
    const storage = new FakeStorage();
    let clock = 0;
    const store = new LocalStorageDocumentStore({
      storage,
      now: () => ++clock,
    });

    await store.save(doc('First'), { version: 0 });
    await store.save(doc('Second', 'doc-2'), { version: 0 });

    expect(storage.getItem('nobita:doc:doc-1')).toContain('"version":1');
    expect((await store.load('doc-1'))?.doc.title).toBe('First');
    expect((await store.list()).map(item => item.id)).toEqual([
      'doc-2',
      'doc-1',
    ]);
  });

  it('enforces optimistic concurrency', async () => {
    const store = new LocalStorageDocumentStore({ storage: new FakeStorage() });
    await store.save(doc('First'), { version: 0 });
    await expect(store.save(doc('Stale'), { version: 0 })).rejects.toBeInstanceOf(
      DocumentConflictError
    );
    expect((await store.save(doc('Second'), { version: 1 })).version).toBe(2);
  });

  it('ignores unrelated keys and reports deletion', async () => {
    const storage = new FakeStorage();
    storage.setItem('unrelated', 'value');
    const store = new LocalStorageDocumentStore({ storage });
    await store.save(doc('First'), { version: 0 });

    expect(await store.list()).toHaveLength(1);
    expect(await store.delete('doc-1')).toBe(true);
    expect(await store.delete('doc-1')).toBe(false);
    expect(await store.list()).toHaveLength(0);
  });
});
