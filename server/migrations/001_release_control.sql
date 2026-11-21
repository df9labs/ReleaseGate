CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  password_hash TEXT NOT NULL
);
CREATE TABLE sessions (
  digest TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE recoveries (
  digest TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL CHECK(json_valid(doc)));
CREATE TABLE bugs (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, updated TEXT NOT NULL,
  doc TEXT NOT NULL CHECK(json_valid(doc)), work TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(work))
);
CREATE TABLE bug_history (
  id TEXT PRIMARY KEY, bug_id TEXT NOT NULL REFERENCES bugs(id), kind TEXT NOT NULL
    CHECK(kind IN ('analysis', 'repair', 'verification', 'gate')),
  at TEXT NOT NULL, doc TEXT NOT NULL CHECK(json_valid(doc))
);
CREATE INDEX bug_history_parent ON bug_history(bug_id, kind, at DESC);
CREATE TABLE versions (
  id TEXT PRIMARY KEY, semantic_version TEXT NOT NULL UNIQUE, at TEXT NOT NULL, doc TEXT NOT NULL CHECK(json_valid(doc))
);
CREATE TABLE version_bugs (
  version_id TEXT NOT NULL REFERENCES versions(id), bug_id TEXT NOT NULL REFERENCES bugs(id),
  revision INTEGER NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(version_id, bug_id)
);
CREATE TABLE healthchecks (id TEXT PRIMARY KEY, at TEXT NOT NULL, doc TEXT NOT NULL CHECK(json_valid(doc)));
CREATE TABLE activity (
  id TEXT PRIMARY KEY, bug_id TEXT REFERENCES bugs(id), at TEXT NOT NULL, doc TEXT NOT NULL CHECK(json_valid(doc))
);
CREATE INDEX activity_parent ON activity(bug_id, at DESC);
CREATE TRIGGER activity_immutable_update BEFORE UPDATE ON activity BEGIN SELECT RAISE(ABORT, 'Activity is append-only'); END;
CREATE TRIGGER activity_immutable_delete BEFORE DELETE ON activity BEGIN SELECT RAISE(ABORT, 'Activity is append-only'); END;
CREATE TABLE intake_receipts (
  sender TEXT NOT NULL, request_key TEXT NOT NULL, body_digest TEXT NOT NULL,
  bug_id TEXT NOT NULL REFERENCES bugs(id), PRIMARY KEY(sender, request_key)
);
CREATE TABLE attempts (bucket TEXT PRIMARY KEY, since INTEGER NOT NULL, count INTEGER NOT NULL);
