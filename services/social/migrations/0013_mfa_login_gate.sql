-- Login MFA: a proof of password/device possession does not confer a bearer session
-- until TOTP or a single-use recovery code is verified. Tickets are hashed.
CREATE TABLE IF NOT EXISTS account_mfa_login_tickets(
  ticket_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  auth_method TEXT NOT NULL CHECK(auth_method IN ('password','device')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ceibo_login_tickets_expiry
  ON account_mfa_login_tickets(expires_at);
CREATE INDEX IF NOT EXISTS idx_ceibo_login_tickets_user
  ON account_mfa_login_tickets(user_id,created_at);
