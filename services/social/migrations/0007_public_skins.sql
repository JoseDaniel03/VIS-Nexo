-- VIS Social public Minecraft Java skin chosen by its VIS account holder.
-- These are VIS launcher cosmetics; Microsoft-owned cosmetics remain separate.
ALTER TABLE social_users ADD COLUMN skin_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS social_skins (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL DEFAULT 'image/png' CHECK(mime='image/png'),
  data_base64 TEXT NOT NULL CHECK(length(data_base64) BETWEEN 64 AND 87384),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 24 AND 65536),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);