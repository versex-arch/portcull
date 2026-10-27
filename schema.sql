-- Portcull API — D1 (SQLite) schema
-- Apply:  wrangler d1 execute portcull --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,               -- uuid
  github_id    INTEGER UNIQUE,
  username     TEXT UNIQUE NOT NULL,
  display_name TEXT,
  role         TEXT NOT NULL DEFAULT 'user',   -- user | moderator | admin
  created_at   INTEGER NOT NULL                -- unix ms
);

CREATE TABLE IF NOT EXISTS layouts (           -- private saved layouts
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,                    -- JSON: {devices, links, code}
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_layouts_user ON layouts(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS published (         -- community submissions
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  description   TEXT,
  category      TEXT,
  data          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  likes         INTEGER NOT NULL DEFAULT 0,
  report_count  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  reviewed_at   INTEGER,
  reviewer_id   TEXT REFERENCES users(id),
  reject_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_pub_feed ON published(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pub_top  ON published(status, likes DESC);
CREATE INDEX IF NOT EXISTS idx_pub_user ON published(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS likes (
  user_id      TEXT NOT NULL REFERENCES users(id),
  published_id TEXT NOT NULL REFERENCES published(id),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, published_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  published_id TEXT NOT NULL REFERENCES published(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  reason       TEXT,
  created_at   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open'       -- open | resolved
);
CREATE INDEX IF NOT EXISTS idx_reports_open ON reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS progress (          -- lessons / challenges progress
  user_id    TEXT PRIMARY KEY REFERENCES users(id),
  data       TEXT NOT NULL,                    -- JSON
  updated_at INTEGER NOT NULL
);
