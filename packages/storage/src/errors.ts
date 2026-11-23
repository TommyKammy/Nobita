/** Base error for adapter failures that are not caused by a version mismatch. */
export class DocumentStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DocumentStoreError';
  }
}

/** Thrown when a save is based on a stale document version. */
export class DocumentConflictError extends DocumentStoreError {
  readonly expectedVersion: number;

  constructor(expectedVersion: number) {
    super(`Document version conflict: expected version ${expectedVersion}`);
    this.name = 'DocumentConflictError';
    this.expectedVersion = expectedVersion;
  }
}
