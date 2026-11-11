-- VIS Ceibo + VIS Humile: Cloudflare D1 (SQLite). Apply with wrangler d1 migrations apply.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ceibo_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 24),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 600000,
  created_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS ceibo_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ceibo_sessions_account ON ceibo_sessions(account_id, expires_at);

CREATE TABLE IF NOT EXISTS ceibo_auth_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS humile_friendships (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  UNIQUE(user_a, user_b),
  CHECK(user_a <> user_b)
);
CREATE INDEX IF NOT EXISTS humile_friendship_a ON humile_friendships(user_a, status);
CREATE INDEX IF NOT EXISTS humile_friendship_b ON humile_friendships(user_b, status);

CREATE TABLE IF NOT EXISTS humile_blocks (
  actor_id TEXT NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_id, target_id),
  CHECK(actor_id <> target_id)
);
CREATE TABLE IF NOT EXISTS humile_favorites (
  actor_id TEXT NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY(actor_id, target_id)
);

CREATE TABLE IF NOT EXISTS humile_chats (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('direct','group')),
  title TEXT,
  pair_key TEXT UNIQUE,
  owner_id TEXT REFERENCES ceibo_accounts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS humile_chat_members (
  chat_id TEXT NOT NULL REFERENCES humile_chats(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  last_read_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(chat_id, account_id)
);
CREATE INDEX IF NOT EXISTS humile_chat_members_user ON humile_chat_members(account_id);

CREATE TABLE IF NOT EXISTS humile_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL REFERENCES humile_chats(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES ceibo_accounts(id),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS humile_message_page ON humile_messages(chat_id, seq DESC);
CREATE INDEX IF NOT EXISTS humile_message_expiry ON humile_messages(expires_at);

CREATE TABLE IF NOT EXISTS humile_ws_tickets (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
