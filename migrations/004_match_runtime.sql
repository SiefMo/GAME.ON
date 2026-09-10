CREATE TABLE IF NOT EXISTS match_runtime (
  match_id TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  room_code TEXT NOT NULL UNIQUE,
  state_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  last_activity_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reconnect_deadline_at TEXT
);

CREATE TABLE IF NOT EXISTS reconnect_tokens (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(match_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_match_runtime_updated ON match_runtime(updated_at);
CREATE INDEX IF NOT EXISTS idx_reconnect_tokens_lookup ON reconnect_tokens(token_hash, expires_at);
