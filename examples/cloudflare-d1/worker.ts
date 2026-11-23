import { parseDoc } from '@nobita/core';
import { DocumentConflictError } from '@nobita/storage';
import {
  SqlDocumentStore,
  ensureSqlSchema,
  type SqlDriver,
  type SqlValue,
} from '@nobita/storage/sql';

/**
 * Minimal D1 types so this example typechecks without @cloudflare/workers-types.
 * Replace them with `wrangler types` output in a real project.
 */
interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[] | null;
  meta?: { changes?: number };
}

interface D1PreparedStatement {
  bind(...values: SqlValue[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  DB: D1Database;
  NOBITA_TOKEN?: string;
  WORKSPACE_ID?: string;
  ALLOWED_ORIGIN?: string;
}

const MAX_DOC_BYTES = 1_800_000;

let schemaReady: Promise<void> | null = null;

function ensureSchema(driver: SqlDriver): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureSqlSchema(driver).catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function d1Driver(db: D1Database): SqlDriver {
  return {
    async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      const result = await db.prepare(sql).bind(...params).all<T>();
      return result.results ?? [];
    },
    async run(sql: string, params: readonly SqlValue[] = []) {
      const result = await db.prepare(sql).bind(...params).run();
      return { changes: result.meta?.changes ?? 0 };
    },
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env);
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
      }
      if (!authorized(request, env)) {
        return json({ error: 'unauthorized' }, 401, cors);
      }

      const driver = d1Driver(env.DB);
      await ensureSchema(driver);
      const store = new SqlDocumentStore(driver, {
        workspaceId: env.WORKSPACE_ID ?? 'default',
      });
      const url = new URL(request.url);

      if (url.pathname === '/docs') {
        if (request.method === 'GET') {
          return json({ docs: await store.list() }, 200, cors);
        }
        return json({ error: 'method not allowed' }, 405, cors);
      }

      const match = /^\/docs\/([^/]+)$/.exec(url.pathname);
      if (!match?.[1]) return json({ error: 'not found' }, 404, cors);
      const id = decodeURIComponent(match[1]);

      if (request.method === 'GET') {
        const stored = await store.load(id);
        if (!stored) return json({ error: 'not found' }, 404, cors);
        return json(stored, 200, { ...cors, etag: `"${stored.version}"` });
      }
      if (request.method === 'PUT') {
        return await putDocument(request, store, id, cors);
      }
      if (request.method === 'DELETE') {
        const deleted = await store.delete(id);
        return new Response(null, {
          status: deleted ? 204 : 404,
          headers: cors,
        });
      }
      return json({ error: 'method not allowed' }, 405, cors);
    } catch (error) {
      console.error(error);
      return json({ error: 'internal error' }, 500, cors);
    }
  },
};

async function putDocument(
  request: Request,
  store: SqlDocumentStore,
  id: string,
  cors: Record<string, string>
): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_DOC_BYTES) {
    return json({ error: 'document too large' }, 413, cors);
  }

  const raw = await request.text();
  if (byteLength(raw) > MAX_DOC_BYTES) {
    return json({ error: 'document too large' }, 413, cors);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    return json({ error: 'invalid json' }, 400, cors);
  }
  if (!isRecord(body) || !isRecord(body.doc)) {
    return json({ error: 'doc is required' }, 400, cors);
  }

  const doc = parseDoc(body.doc);
  if (doc.id !== id) {
    return json({ error: 'document id mismatch' }, 400, cors);
  }

  const expected = parseIfMatch(request.headers.get('if-match'));
  if (expected === null) {
    return json({ error: 'invalid If-Match' }, 400, cors);
  }

  try {
    const saved =
      expected === undefined
        ? await store.save(doc)
        : await store.save(doc, { version: expected });
    return json(
      { version: saved.version, updatedAt: saved.updatedAt },
      200,
      { ...cors, etag: `"${saved.version}"` }
    );
  } catch (error) {
    if (error instanceof DocumentConflictError) {
      return json({ error: 'conflict' }, 409, cors);
    }
    throw error;
  }
}

function parseIfMatch(value: string | null): number | undefined | null {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed === '*') return undefined;
  const normalized = trimmed.replace(/^W\//, '').replace(/^"|"$/g, '');
  if (!/^\d+$/.test(normalized)) return null;
  const version = Number(normalized);
  return Number.isSafeInteger(version) ? version : null;
}

function authorized(request: Request, env: Env): boolean {
  const expected = env.NOBITA_TOKEN;
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return timingSafeEqual(token, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function corsHeaders(env: Env): Record<string, string> {
  const origin = env.ALLOWED_ORIGIN;
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, if-match',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function json(
  data: unknown,
  status: number,
  headers: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
