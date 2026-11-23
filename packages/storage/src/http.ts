import type {
  Doc,
  DocSummary,
  DocumentStore,
  SaveDocumentOptions,
  StoredDoc,
} from '@nobita/core';
import { DocumentConflictError, DocumentStoreError } from './errors.js';
import { assertDoc, assertVersion } from './validate.js';

export interface HttpDocumentStoreOptions {
  /** Base URL of the API, for example `https://api.example.com`. */
  baseUrl: string;
  /** Static headers or a function so short-lived tokens can be refreshed. */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
}

interface SummaryResponse {
  version?: unknown;
  updatedAt?: unknown;
}

/**
 * Client for the small JSON API implemented by `examples/cloudflare-d1`.
 *
 * - `GET    /docs`       -> `{ docs: DocSummary[] }`
 * - `GET    /docs/:id`   -> `{ doc, version, updatedAt }`
 * - `PUT    /docs/:id`   -> `{ version, updatedAt }` (`If-Match: <version>`)
 * - `DELETE /docs/:id`   -> `204`
 */
export class HttpDocumentStore implements DocumentStore {
  #baseUrl: string;
  #headers: HttpDocumentStoreOptions['headers'];
  #credentials: RequestCredentials | undefined;
  #fetch: typeof fetch;

  constructor(options: HttpDocumentStoreOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#headers = options.headers;
    this.#credentials = options.credentials;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async load(id: string): Promise<StoredDoc | null> {
    const response = await this.#fetch(this.#url(id), {
      method: 'GET',
      headers: await this.#requestHeaders(),
      ...(this.#credentials ? { credentials: this.#credentials } : {}),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await this.#error(response);

    const body = (await response.json()) as {
      doc?: unknown;
      version?: unknown;
      updatedAt?: unknown;
    };
    if (!isRecord(body.doc) || typeof body.version !== 'number') {
      throw new DocumentStoreError('The server returned an invalid document');
    }
    assertDoc(body.doc as unknown as Doc);
    return {
      doc: body.doc as unknown as Doc,
      version: body.version,
      updatedAt:
        typeof body.updatedAt === 'number' ? body.updatedAt : Date.now(),
    };
  }

  async save(doc: Doc, options: SaveDocumentOptions = {}): Promise<DocSummary> {
    assertDoc(doc);
    assertVersion(options.version);
    const headers = await this.#requestHeaders();
    headers.set('content-type', 'application/json');
    if (options.version !== undefined) {
      headers.set('if-match', String(options.version));
    }
    const response = await this.#fetch(this.#url(doc.id), {
      method: 'PUT',
      headers,
      body: JSON.stringify({ doc }),
      ...(this.#credentials ? { credentials: this.#credentials } : {}),
    });
    if (response.status === 409) {
      throw new DocumentConflictError(options.version ?? 0);
    }
    if (!response.ok) throw await this.#error(response);

    const body = (await response.json()) as SummaryResponse;
    if (typeof body.version !== 'number') {
      throw new DocumentStoreError('The server did not return a version');
    }
    return {
      id: doc.id,
      title: doc.title,
      version: body.version,
      updatedAt:
        typeof body.updatedAt === 'number' ? body.updatedAt : Date.now(),
    };
  }

  async list(): Promise<DocSummary[]> {
    const response = await this.#fetch(`${this.#baseUrl}/docs`, {
      method: 'GET',
      headers: await this.#requestHeaders(),
      ...(this.#credentials ? { credentials: this.#credentials } : {}),
    });
    if (!response.ok) throw await this.#error(response);

    const body = (await response.json()) as { docs?: unknown };
    if (!Array.isArray(body.docs)) {
      throw new DocumentStoreError('The server returned an invalid document list');
    }
    return body.docs
      .filter(isSummary)
      .map(summary => ({
        id: summary.id,
        title: summary.title,
        version: summary.version,
        updatedAt: summary.updatedAt,
      }));
  }

  async delete(id: string): Promise<boolean> {
    const response = await this.#fetch(this.#url(id), {
      method: 'DELETE',
      headers: await this.#requestHeaders(),
      ...(this.#credentials ? { credentials: this.#credentials } : {}),
    });
    if (response.status === 404) return false;
    if (!response.ok) throw await this.#error(response);
    return true;
  }

  #url(id: string): string {
    return `${this.#baseUrl}/docs/${encodeURIComponent(id)}`;
  }

  async #requestHeaders(): Promise<Headers> {
    const value =
      typeof this.#headers === 'function'
        ? await this.#headers()
        : this.#headers;
    return new Headers(value);
  }

  async #error(response: Response): Promise<DocumentStoreError> {
    let detail = '';
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') detail = `: ${body.error}`;
    } catch {
      // The response was not JSON; the status is still useful.
    }
    return new DocumentStoreError(
      `Storage request failed (${response.status} ${response.statusText})${detail}`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSummary(value: unknown): value is DocSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.version === 'number' &&
    typeof value.updatedAt === 'number'
  );
}
