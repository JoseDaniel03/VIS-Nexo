-- VIS Social avatar thumbnails. Images are WebP <= 24 KiB only.
-- This small D1-backed profile image store can later migrate to a dedicated R2 bucket.
ALTER TABLE social_users ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS social_avatars (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL DEFAULT 'image/webp' CHECK(mime='image/webp'),
  data_base64 TEXT NOT NULL CHECK(length(data_base64) BETWEEN 64 AND 32768),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 24576),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
