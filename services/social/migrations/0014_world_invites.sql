CREATE TABLE world_rooms (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  lease_until INTEGER NOT NULL
);
CREATE INDEX world_rooms_host ON world_rooms(host_id,lease_until);
CREATE TABLE world_invites (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES world_rooms(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined'))
);
CREATE INDEX world_invites_inbox ON world_invites(recipient_id,status,expires_at);

