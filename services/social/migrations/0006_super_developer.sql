-- Capability grant, NOT a login account or Cloudflare admin token.
-- A VIS cloud user may receive project-management powers without gaining
-- access to user moderation, secrets, R2 or the Cloudflare account itself.
CREATE TABLE IF NOT EXISTS developer_grants (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  granted_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_developer_grants_created ON developer_grants(granted_at);
