-- VIS Social: explicit server-side RBAC and project registry.
-- No existing user is promoted automatically. Super admin is provisioned only
-- through the protected GitHub environment after checking the signing key.
ALTER TABLE social_users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user','moderator','project_manager','super_admin'));
ALTER TABLE social_users ADD COLUMN disabled_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_social_users_role ON social_users(role);

CREATE TABLE IF NOT EXISTS social_projects (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  summary TEXT NOT NULL DEFAULT '' CHECK(length(summary) <= 500),
  visibility TEXT NOT NULL DEFAULT 'draft'
    CHECK(visibility IN ('draft','published','archived')),
  created_by TEXT REFERENCES social_users(id),
  updated_by TEXT REFERENCES social_users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK(length(id) BETWEEN 3 AND 48)
);
CREATE INDEX IF NOT EXISTS idx_social_projects_visibility
 ON social_projects(visibility, updated_at);

CREATE TABLE IF NOT EXISTS project_subscriptions (
  project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  subscribed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (project_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_subscriptions_user
 ON project_subscriptions(user_id);

-- Staff roles are granted by a super administrator, never self-selected.
CREATE TABLE IF NOT EXISTS project_staff (
  project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
  staff_role TEXT NOT NULL CHECK(staff_role IN ('editor','manager')),
  granted_by TEXT NOT NULL REFERENCES social_users(id),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(project_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_staff_user ON project_staff(user_id);

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL REFERENCES social_users(id),
  operation TEXT NOT NULL CHECK(length(operation) BETWEEN 3 AND 80),
  target TEXT NOT NULL CHECK(length(target) <= 160),
  occurred_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit(occurred_at);
