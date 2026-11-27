import { describe, expect, it } from 'vitest';
import { createBlock, createDoc } from '@nobita/core';
import { DocumentConflictError } from '../src/errors.js';
import { MemoryDocumentStore } from '../src/memory.js';

function doc(title: string, id = 'doc-1') {
  return createDoc({
    id,
    title,
    blocks: [createBlock('paragraph', { text: title })],
  });
}

describe('MemoryDocumentStore', () => {
  it('creates, loads and lists documents', async () => {
    let clock = 0;
    const store = new MemoryDocumentStore({ now: () => ++clock });
    const created = await store.save(doc('First'), { version: 0 });
    expect(created.version).toBe(1);

    const loaded = await store.load('doc-1');
    expect(loaded?.doc.title).toBe('First');
    expect(loaded?.version).toBe(1);

    const listed = await store.list();
    expect(listed).toEqual([
      { id: 'doc-1', title: 'First', version: 1, createdAt: 1, updatedAt: 1 },
    ]);
  });

  it('rejects stale writes and accepts the current version', async () => {
    const store = new MemoryDocumentStore();
    await store.save(doc('First'), { version: 0 });
    await expect(store.save(doc('Stale'), { version: 0 })).rejects.toBeInstanceOf(
      DocumentConflictError
    );

    const updated = await store.save(doc('Second'), { version: 1 });
    expect(updated.version).toBe(2);
    expect((await store.load('doc-1'))?.doc.title).toBe('Second');
  });

  it('clones documents instead of sharing references', async () => {
    const store = new MemoryDocumentStore();
    const source = doc('First');
    await store.save(source, { version: 0 });
    source.title = 'Mutated';

    expect((await store.load('doc-1'))?.doc.title).toBe('First');
  });

  it('deletes documents', async () => {
    const store = new MemoryDocumentStore();
    await store.save(doc('First'), { version: 0 });
    expect(await store.delete('doc-1')).toBe(true);
    expect(await store.delete('doc-1')).toBe(false);
    expect(await store.load('doc-1')).toBeNull();
  });
});
