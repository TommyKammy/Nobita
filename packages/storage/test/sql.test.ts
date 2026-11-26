import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createBlock, createDoc } from '@nobita/core';
import { DocumentConflictError } from '../src/errors.js';
import {
  SqlDocumentStore,
  ensureSqlSchema,
  type SqlDriver,
} from '../src/sql.js';

function driver(db: DatabaseSync): SqlDriver {
  return {
    async all(sql, params = []) {
      return db.prepare(sql).all(...params) as never[];
    },
    async run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
  };
}

function doc(title: string, id = 'doc-1') {
  return createDoc({
    id,
    title,
    blocks: [createBlock('paragraph', { text: title })],
  });
}

async function setup() {
  const db = new DatabaseSync(':memory:');
  const sql = driver(db);
  await ensureSqlSchema(sql);
  return { db, sql };
}

describe('SqlDocumentStore', () => {
  it('creates, loads and lists documents', async () => {
    const { db, sql } = await setup();
    let clock = 100;
    const store = new SqlDocumentStore(sql, { now: () => ++clock });

    const created = await store.save(doc('First'), { version: 0 });
    expect(created).toEqual({
      id: 'doc-1',
      title: 'First',
      version: 1,
      updatedAt: 101,
    });

    const loaded = await store.load('doc-1');
    expect(loaded?.doc.title).toBe('First');
    expect(loaded?.version).toBe(1);
    expect((await store.list())[0]?.id).toBe('doc-1');
    db.close();
  });

  it('rejects stale writes and increments the version', async () => {
    const { db, sql } = await setup();
    const store = new SqlDocumentStore(sql);
    await store.save(doc('First'), { version: 0 });

    await expect(store.save(doc('Stale'), { version: 0 })).rejects.toBeInstanceOf(
      DocumentConflictError
    );
    const updated = await store.save(doc('Second'), { version: 1 });
    expect(updated.version).toBe(2);
    expect((await store.load('doc-1'))?.doc.title).toBe('Second');
    db.close();
  });

  it('does not create a document with a non-zero expected version', async () => {
    const { db, sql } = await setup();
    const store = new SqlDocumentStore(sql);
    await expect(store.save(doc('Missing'), { version: 4 })).rejects.toBeInstanceOf(
      DocumentConflictError
    );
    expect(await store.load('doc-1')).toBeNull();
    db.close();
  });

  it('supports unconditional saves', async () => {
    const { db, sql } = await setup();
    const store = new SqlDocumentStore(sql);
    expect((await store.save(doc('First'))).version).toBe(1);
    expect((await store.save(doc('Second'))).version).toBe(2);
    expect((await store.load('doc-1'))?.doc.title).toBe('Second');
    db.close();
  });

  it('returns each concurrent writer its own revision', async () => {
    const { db, sql } = await setup();
    try {
      let clock = 100;
      const store = new SqlDocumentStore(sql, { now: () => ++clock });
      const [first, second] = await Promise.all([store.save(doc('A')), store.save(doc('B'))]);
      expect(first).toMatchObject({ title: 'A', version: 1, updatedAt: 101 });
      expect(second).toMatchObject({ title: 'B', version: 2, updatedAt: 102 });
      await expect(store.save(doc('stale'), { version: first.version })).rejects.toBeInstanceOf(DocumentConflictError);
    } finally {
      db.close();
    }
  });

  it('isolates workspaces and deletes documents', async () => {
    const { db, sql } = await setup();
    const alpha = new SqlDocumentStore(sql, { workspaceId: 'alpha' });
    const beta = new SqlDocumentStore(sql, { workspaceId: 'beta' });

    await alpha.save(doc('Alpha'), { version: 0 });
    expect(await beta.load('doc-1')).toBeNull();
    expect(await beta.list()).toEqual([]);

    await beta.save(doc('Beta'), { version: 0 });
    expect((await alpha.load('doc-1'))?.doc.title).toBe('Alpha');
    expect((await beta.load('doc-1'))?.doc.title).toBe('Beta');

    expect(await alpha.delete('doc-1')).toBe(true);
    expect(await alpha.load('doc-1')).toBeNull();
    expect((await beta.load('doc-1'))?.doc.title).toBe('Beta');
    db.close();
  });
});
