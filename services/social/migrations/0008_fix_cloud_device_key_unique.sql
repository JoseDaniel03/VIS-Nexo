-- Cloud-only VIS accounts have signing_public_key='' by design.
-- The old global UNIQUE index incorrectly permitted only one such account.
-- Preserve uniqueness for real enrolled device keys without restricting
-- multiple valid cloud accounts. No account/profile rows are modified.
DROP INDEX IF EXISTS idx_social_users_signing_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_users_signing_key
  ON social_users(signing_public_key)
  WHERE signing_public_key <> '';