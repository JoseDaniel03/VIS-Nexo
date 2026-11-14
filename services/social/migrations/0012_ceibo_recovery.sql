-- VIS Ceibo Recovery v1: verified recovery email, time-boxed challenges,
-- MFA step-up, single-use emergency codes and revocable sessions.
-- Do not reuse email addresses as identity IDs; user_id stays immutable.
CREATE TABLE IF NOT EXISTS account_emails(
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
 email_lower TEXT NOT NULL COLLATE NOCASE UNIQUE,
 verified_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS account_email_pending(
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
 change_id TEXT NOT NULL,
 email_lower TEXT NOT NULL,
 old_approved INTEGER NOT NULL DEFAULT 0 CHECK(old_approved IN (0,1)),
 new_approved INTEGER NOT NULL DEFAULT 0 CHECK(new_approved IN (0,1)),
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_email_pending_address
 ON account_email_pending(email_lower);
CREATE TABLE IF NOT EXISTS account_recovery_tokens(
 token_hash TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL CHECK(purpose IN ('reset','email_new','email_old')),
 change_id TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ceibo_token_user ON account_recovery_tokens(user_id,purpose,created_at);
CREATE INDEX IF NOT EXISTS idx_ceibo_token_expiry ON account_recovery_tokens(expires_at);
CREATE TABLE IF NOT EXISTS account_recovery_notice_limits(
 user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL,
 sent_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,purpose)
);
CREATE TABLE IF NOT EXISTS account_totp(
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
 secret_ciphertext TEXT NOT NULL,
 last_counter INTEGER NOT NULL DEFAULT -1,
 enabled_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS account_totp_pending(
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
 secret_ciphertext TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_recovery_codes(
 code_hash TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ceibo_recovery_codes_user ON account_recovery_codes(user_id);
ALTER TABLE social_users ADD COLUMN device_credential_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE social_users ADD COLUMN legacy_device_key_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_sessions ADD COLUMN session_id TEXT NOT NULL DEFAULT '';
ALTER TABLE auth_sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'device';
ALTER TABLE auth_sessions ADD COLUMN mfa_verified_at INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ceibo_session_id ON auth_sessions(session_id) WHERE session_id!='';
UPDATE auth_sessions SET session_id=lower(hex(randomblob(16))) WHERE session_id='';

-- Cloud-only accounts have no local signing key yet; keep uniqueness only for real keys.
DROP INDEX IF EXISTS idx_social_users_signing_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_users_signing_key ON social_users(signing_public_key) WHERE signing_public_key!='';
