-- VIS Humile: user-defined status and optional, expiring Minecraft presence.
-- Visibility remains private to accepted friends with an active websocket.
ALTER TABLE humile_presence ADD COLUMN custom_status TEXT NOT NULL DEFAULT ''
  CHECK (length(custom_status) <= 80);
ALTER TABLE humile_presence ADD COLUMN share_game INTEGER NOT NULL DEFAULT 1
  CHECK (share_game IN (0,1));

CREATE TABLE IF NOT EXISTS humile_game_activity (
  account_id TEXT PRIMARY KEY REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  engine TEXT NOT NULL CHECK (engine IN ('java','rust')),
  project TEXT NOT NULL DEFAULT '' CHECK (length(project) <= 64),
  expires_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS humile_game_activity_expires ON humile_game_activity(expires_at);
