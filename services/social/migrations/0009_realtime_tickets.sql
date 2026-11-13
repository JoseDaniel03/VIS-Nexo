-- One-time, strictly scoped wake-up WebSocket tickets. NEVER store VIS Social
-- bearer tokens, plaintext messages or device private keys in D1.
CREATE TABLE IF NOT EXISTS realtime_tickets (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_realtime_ticket_expiry ON realtime_tickets(expires_at);
