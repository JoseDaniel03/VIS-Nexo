-- VIS Ceibo public identity: the immutable account id and legacy username
-- never change. Public @handles can change without moving friendships,
-- AES-GCM key material, project roles, messages or installed instances.
ALTER TABLE social_users ADD COLUMN public_handle TEXT NOT NULL DEFAULT ''
  CHECK (public_handle='' OR
    (length(public_handle) BETWEEN 3 AND 24 AND
     public_handle NOT GLOB '*[^a-z0-9_]*'));
ALTER TABLE social_users ADD COLUMN public_handle_updated_at INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_users_public_handle
  ON social_users(public_handle) WHERE public_handle<>'';

-- Historical public handles remain reserved for their original account:
-- a renamed user cannot be impersonated by registering the old handle.
CREATE TABLE IF NOT EXISTS public_handle_history(
  handle TEXT PRIMARY KEY COLLATE NOCASE NOT NULL,
  user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (length(handle) BETWEEN 3 AND 24)
);
CREATE INDEX IF NOT EXISTS idx_public_handle_history_owner
  ON public_handle_history(user_id);
