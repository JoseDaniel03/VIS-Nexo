-- VIS Universe community and restricted access, additive migration.
-- Never promote any account automatically. The first superadmin remains CI provisioned.
CREATE TABLE IF NOT EXISTS global_admin_grants (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
 granted_by TEXT NOT NULL REFERENCES social_users(id),
 granted_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS project_members (
 project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
 member_role TEXT NOT NULL CHECK (member_role IN
  ('creator','helper','content_creator','participant','guest','collaborator','mention')),
 can_play INTEGER NOT NULL DEFAULT 0 CHECK (can_play IN (0,1)),
 added_by TEXT NOT NULL REFERENCES social_users(id),
 joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY(project_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE TABLE IF NOT EXISTS project_settings (
 project_id TEXT PRIMARY KEY NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
 admission TEXT NOT NULL DEFAULT 'request' CHECK (admission IN ('open','request','invite_only')),
 play_access TEXT NOT NULL DEFAULT 'public' CHECK (play_access IN ('public','members')),
 updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS project_join_requests (
 project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 note TEXT NOT NULL DEFAULT '' CHECK (length(note)<=300),
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 reviewed_at INTEGER,
 reviewed_by TEXT REFERENCES social_users(id),
 PRIMARY KEY(project_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_join_review ON project_join_requests(project_id,status);
CREATE TABLE IF NOT EXISTS project_media (
 id TEXT PRIMARY KEY NOT NULL,
 project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES social_users(id),
 kind TEXT NOT NULL CHECK (kind IN ('video','stream')),
 provider TEXT NOT NULL CHECK (provider IN ('youtube','twitch')),
 url TEXT NOT NULL CHECK(length(url) BETWEEN 12 AND 500),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 120),
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_project_media_latest ON project_media(project_id,created_at DESC);
