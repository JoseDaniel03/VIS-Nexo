-- VIS Social cloud identity: public immutable user ID and salted one-way verifier.
-- Existing Ed25519-only accounts remain valid and must explicitly opt in
-- to username/ID + password login via authenticated /v1/accounts/upgrade.
ALTER TABLE social_users ADD COLUMN public_id TEXT NOT NULL DEFAULT '';
ALTER TABLE social_users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE social_users ADD COLUMN password_salt TEXT NOT NULL DEFAULT '';
ALTER TABLE social_users ADD COLUMN password_iterations INTEGER NOT NULL DEFAULT 0;
UPDATE social_users SET public_id=lower(hex(randomblob(12))) WHERE public_id='';
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_users_public_id ON social_users(public_id);
CREATE INDEX IF NOT EXISTS idx_social_users_cloud_login ON social_users(username,disabled_at);
