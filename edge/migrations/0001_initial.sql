-- AHIM Edge: isolated staging schema. No production data is migrated.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task TEXT NOT NULL CHECK(task IN ('chat','promptkilat','image')),
  prompt TEXT NOT NULL,
  result_text TEXT,
  asset_id TEXT,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed','failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS generations_user_created ON generations(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 8388608),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS media_user_created ON media(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quotas (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hour_bucket INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK(request_count >= 0),
  PRIMARY KEY (user_id, hour_bucket)
);
