-- Nicknames are private to the account that created them.
-- Never change the canonical Ceibo username or expose nicknames to the target.
CREATE TABLE IF NOT EXISTS humile_friend_nicknames (
  owner_id TEXT NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL CHECK(length(trim(nickname)) BETWEEN 1 AND 40),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, target_id),
  CHECK(owner_id <> target_id)
);
CREATE INDEX IF NOT EXISTS humile_friend_nickname_target ON humile_friend_nicknames(target_id);
