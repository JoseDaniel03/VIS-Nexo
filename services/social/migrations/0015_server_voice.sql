CREATE TABLE voice_sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES social_users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
 client_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX voice_room ON voice_sessions(project_id,expires_at);
CREATE TABLE voice_signals (
 id TEXT PRIMARY KEY,sender TEXT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
 recipient TEXT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
 payload TEXT NOT NULL,expires_at INTEGER NOT NULL
);
CREATE INDEX voice_inbox ON voice_signals(recipient,expires_at);
CREATE TABLE voice_positions (
 project_id TEXT NOT NULL REFERENCES social_projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
 dimension TEXT NOT NULL,x REAL NOT NULL,y REAL NOT NULL,z REAL NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,user_id)
);

