-- VIS Humile device-only chat mode.
-- DESTRUCTIVE MIGRATION: back up/export any existing messages BEFORE deployment.
-- Message bodies are no longer retained by Cloudflare D1. Existing messages
-- cannot be migrated to clients automatically, so old remote history is erased.
DROP TABLE IF EXISTS humile_messages;
-- humile_chats/humile_chat_members remain online for routing and membership.
