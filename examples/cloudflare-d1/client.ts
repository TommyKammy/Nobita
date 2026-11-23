import { HttpDocumentStore } from '@nobita/storage';

export interface CloudflareStoreOptions {
  /** Worker URL, for example `http://127.0.0.1:8787`. */
  baseUrl: string;
  /** A bearer token or a function that returns a fresh one. */
  token: string | (() => string | Promise<string>);
}

/** Browser-side client for the Worker in this example. */
export function createCloudflareStore(
  options: CloudflareStoreOptions
): HttpDocumentStore {
  return new HttpDocumentStore({
    baseUrl: options.baseUrl,
    headers: async () => {
      const token =
        typeof options.token === 'function'
          ? await options.token()
          : options.token;
      return { authorization: `Bearer ${token}` };
    },
  });
}
