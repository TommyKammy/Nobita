import { describe, expect, it } from 'vitest';
import { createBlock, createDoc } from '@nobita/core';
import { DocumentConflictError } from '../src/errors.js';
import { HttpDocumentStore } from '../src/http.js';

function doc(title: string, id = 'doc-1') {
  return createDoc({
    id,
    title,
    blocks: [createBlock('paragraph', { text: title })],
  });
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HttpDocumentStore', () => {
  it('loads, saves and deletes through the JSON API', async () => {
    const calls: Call[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/docs/doc-1') && (!init || init.method === 'GET')) {
        return json({
          doc: doc('Remote'),
          version: 3,
          updatedAt: 42,
        });
      }
      if (url.endsWith('/docs/doc-1') && init?.method === 'PUT') {
        return json({ version: 4, createdAt: 10, updatedAt: 43 });
      }
      if (url.endsWith('/docs/doc-1') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      return json({ error: 'not found' }, 404);
    }) as unknown as typeof fetch;

    const store = new HttpDocumentStore({
      baseUrl: 'https://example.com/',
      headers: { authorization: 'Bearer test' },
      fetch: fakeFetch,
    });

    const loaded = await store.load('doc-1');
    expect(loaded?.doc.title).toBe('Remote');
    expect(loaded?.version).toBe(3);

    const saved = await store.save(doc('Updated'), { version: 3 });
    expect(saved).toEqual({
      id: 'doc-1',
      title: 'Updated',
      version: 4,
      createdAt: 10,
      updatedAt: 43,
    });
    const put = calls.find(call => call.init?.method === 'PUT');
    expect(new Headers(put?.init?.headers).get('if-match')).toBe('3');
    expect(await store.delete('doc-1')).toBe(true);
  });

  it('returns null for a missing document and reports conflicts', async () => {
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return json({ error: 'conflict' }, 409);
      return json({ error: 'not found' }, 404);
    }) as unknown as typeof fetch;
    const store = new HttpDocumentStore({
      baseUrl: 'https://example.com',
      fetch: fakeFetch,
    });

    expect(await store.load('missing')).toBeNull();
    await expect(store.save(doc('Stale'), { version: 2 })).rejects.toBeInstanceOf(
      DocumentConflictError
    );
  });

  it('lists summaries and refreshes headers per request', async () => {
    let token = 'first';
    const seen: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      seen.push(new Headers(init?.headers).get('authorization') ?? '');
      return json({
        docs: [{ id: 'doc-1', title: 'One', version: 1, updatedAt: 1 }],
      });
    }) as unknown as typeof fetch;
    const store = new HttpDocumentStore({
      baseUrl: 'https://example.com',
      headers: () => ({ authorization: `Bearer ${token}` }),
      fetch: fakeFetch,
    });

    expect(await store.list()).toHaveLength(1);
    token = 'second';
    await store.list();
    expect(seen).toEqual(['Bearer first', 'Bearer second']);
  });
});
