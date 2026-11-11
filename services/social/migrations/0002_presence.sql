-- VIS Humile: online status preference, server-side privacy controls.
-- Default presence is online only while a WebSocket is connected.
CREATE TABLE IF NOT EXISTS humile_presence (
  account_id TEXT PRIMARY KEY REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'online'
    CHECK (visibility IN ('online', 'away', 'busy', 'invisible')),
  updated_at TEXT NOT NULL
);
