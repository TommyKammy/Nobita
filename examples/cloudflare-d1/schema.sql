-- Nobita document storage for Cloudflare D1.
-- Keep in sync with SQLITE_SCHEMA in packages/storage/src/sql.ts.
CREATE TABLE IF NOT EXISTS nobita_docs (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  doc TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS nobita_docs_updated
  ON nobita_docs (workspace_id, updated_at DESC);
