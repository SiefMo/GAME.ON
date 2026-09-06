CREATE TABLE IF NOT EXISTS user_admin (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','admin')),
  is_suspended INTEGER NOT NULL DEFAULT 0 CHECK(is_suspended IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_admin_role ON user_admin(role);
CREATE INDEX IF NOT EXISTS idx_user_admin_suspended ON user_admin(is_suspended);
INSERT OR IGNORE INTO user_admin (user_id) SELECT id FROM users;
