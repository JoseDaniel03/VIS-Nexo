-- VIS Social D1 baseline.
-- Local launcher stores 30-day chat history; the cloud queue is only for delivery.
-- No plaintext history or PINs should be persisted here.
CREATE TABLE IF NOT EXISTS social_users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  presence TEXT NOT NULL DEFAULT 'offline'
    CHECK (presence IN ('online', 'away', 'busy', 'invisible', 'offline')),
  custom_status TEXT NOT NULL DEFAULT '' CHECK (length(custom_status) <= 160),
  current_game TEXT NOT NULL DEFAULT '' CHECK (length(current_game) <= 160),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY NOT NULL,
  sender_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (sender_id <> recipient_id),
  UNIQUE (sender_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient
  ON friend_requests(recipient_id, status, created_at);

CREATE TABLE IF NOT EXISTS friendships (
  user_a TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(user_b);

CREATE TABLE IF NOT EXISTS friend_aliases (
  owner_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  alias TEXT NOT NULL CHECK (length(alias) BETWEEN 1 AND 80),
  PRIMARY KEY (owner_id, friend_id),
  CHECK (owner_id <> friend_id)
);

-- This is a short-lived transit queue, not message history. Message bodies are
-- opaque encrypted payloads (max 2 KiB); clients retain their local 30-day log.
-- The future authenticated API must delete acknowledged/expired queue entries.
CREATE TABLE IF NOT EXISTS pending_messages (
  id TEXT PRIMARY KEY NOT NULL,
  sender_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  client_message_id TEXT NOT NULL,
  payload BLOB NOT NULL CHECK (length(payload) BETWEEN 1 AND 2048),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  CHECK (sender_id <> recipient_id),
  UNIQUE (sender_id, client_message_id)
);
CREATE INDEX IF NOT EXISTS idx_pending_recipient
  ON pending_messages(recipient_id, acknowledged_at, created_at);
CREATE INDEX IF NOT EXISTS idx_pending_expiry
  ON pending_messages(expires_at);
