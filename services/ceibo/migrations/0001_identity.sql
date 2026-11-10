-- VIS Ceibo: cloud identity schema (POSTGRESQL, not yet attached to desktop).
-- Never accept role='admin' from a client request; roles are server-authorized.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS ceibo_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username varchar(24) NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,24}$'),
    password_hash text NOT NULL,  -- Argon2id encoded hash, NEVER a PIN in plaintext
    role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')),
    created_at timestamptz NOT NULL DEFAULT now(),
    disabled_at timestamptz,
    deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS ceibo_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES ceibo_accounts(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE, -- SHA-256/HMAC digest only, never raw bearer token
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS ceibo_sessions_expiration_idx ON ceibo_sessions(expires_at);
CREATE TABLE IF NOT EXISTS ceibo_admin_invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issuer_id uuid NOT NULL REFERENCES ceibo_accounts(id),
    token_hash bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    redeemed_by uuid UNIQUE REFERENCES ceibo_accounts(id),
    redeemed_at timestamptz,
    revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS ceibo_invites_expiration_idx ON ceibo_admin_invites(expires_at);
-- Admin bootstrap must be performed once through an operator-controlled initialization process.
-- A local user's historical 'admin' role is not a cloud administrator credential.
