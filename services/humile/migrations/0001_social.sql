-- VIS Humile: cloud social schema, to be used ONLY by server-authenticated requests.
CREATE TABLE IF NOT EXISTS humile_friendships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requester uuid NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
    recipient uuid NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','blocked')),
    created_at timestamptz NOT NULL DEFAULT now(),
    accepted_at timestamptz,
    CHECK (requester <> recipient)
);
CREATE UNIQUE INDEX IF NOT EXISTS humile_unique_friendship_pair
  ON humile_friendships (LEAST(requester, recipient), GREATEST(requester, recipient));
CREATE INDEX IF NOT EXISTS humile_friendships_recipient ON humile_friendships(recipient, status);

CREATE TABLE IF NOT EXISTS humile_favorites (
    account_id uuid NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
    friend_id uuid NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
    PRIMARY KEY (account_id, friend_id),
    CHECK (account_id <> friend_id)
);
CREATE TABLE IF NOT EXISTS humile_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
    name varchar(70) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS humile_group_members (
    group_id uuid NOT NULL REFERENCES humile_groups(id) ON DELETE CASCADE,
    friend_id uuid NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, friend_id)
);

CREATE TABLE IF NOT EXISTS humile_chats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK(kind IN ('direct','group')),
    title varchar(80),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS humile_chat_members (
    chat_id uuid NOT NULL REFERENCES humile_chats(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now(),
    last_read_at timestamptz,
    PRIMARY KEY(chat_id, account_id)
);
CREATE TABLE IF NOT EXISTS humile_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id uuid NOT NULL REFERENCES humile_chats(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES ceibo_accounts(id),
    body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz,
    deleted_at timestamptz,
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '12 months')
);
CREATE INDEX IF NOT EXISTS humile_messages_chat_page ON humile_messages(chat_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS humile_messages_retention_idx ON humile_messages(expires_at);
-- Service MUST check chat membership, sender identity and permissions on EVERY operation.
-- Presence/typing events should stay in memory/Redis/WebSocket, not persisted in PostgreSQL.
