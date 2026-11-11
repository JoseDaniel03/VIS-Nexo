import test from "node:test";
import assert from "node:assert/strict";
import { LOCAL_CHAT_LIMIT_BYTES, LOCAL_CHAT_RETENTION_MS, LOCAL_MESSAGE_LIMIT_BYTES,
  loadLocalChat, appendLocalChat, markLocalChatRead, eraseLocalChat, purgeLocalChats
} from "../../web/humile-local-log.js";

class MemoryStorage {
  constructor() { this.items = new Map(); }
  get length() { return this.items.size; }
  key(i) { return [...this.items.keys()][i] ?? null; }
  getItem(k) { return this.items.get(k) ?? null; }
  setItem(k, v) { this.items.set(k, String(v)); }
  removeItem(k) { this.items.delete(k); }
}
const origin = "https://humile.example.workers.dev";
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const chat = "33333333-3333-4333-8333-333333333333";
const second = "44444444-4444-4444-8444-444444444444";
const msg = (number, now, userId = bob, body = "Hola") => ({
  id: String(number).padStart(8, "0") + "-0000-4000-8000-000000000000",
  sender_id: userId, sender: userId === alice ? "alice" : "bobby",
  body, created_at: new Date(now).toISOString()
});

test("Humile local history stays under exactly 2048 UTF-8 bytes per chat", () => {
  const storage = new MemoryStorage(), now = Date.UTC(2026, 10, 11);
  for (let i = 1; i < 60; i++) {
    appendLocalChat(storage, origin, alice, chat, msg(i, now + i * 1000, bob, "Hola 👾 " + "a".repeat(65)), now + 65000);
  }
  const log = loadLocalChat(storage, origin, alice, chat, now + 65000);
  assert.ok(log.bytes <= LOCAL_CHAT_LIMIT_BYTES, JSON.stringify(log));
  assert.ok(log.messages.length > 0 && log.messages.length < 59);
  assert.equal(log.messages.at(-1).body.startsWith("Hola 👾"), true);
  assert.ok([...storage.items.values()].every(json => new TextEncoder().encode(json).length <= LOCAL_CHAT_LIMIT_BYTES));
});

test("Local messages are isolated by account and conversation, never by nickname", () => {
  const storage = new MemoryStorage(), now = Date.now();
  appendLocalChat(storage, origin, alice, chat, msg(1, now), now);
  assert.equal(loadLocalChat(storage, origin, alice, chat, now).messages.length, 1);
  assert.equal(loadLocalChat(storage, origin, bob, chat, now).messages.length, 0);
  assert.equal(loadLocalChat(storage, origin, alice, second, now).messages.length, 0);
  assert.equal(loadLocalChat(storage, "https://other.workers.dev", alice, chat, now).messages.length, 0);
});

test("Messages older than 30 days are purged on next use", () => {
  const storage = new MemoryStorage(), now = Date.UTC(2026, 10, 11);
  appendLocalChat(storage, origin, alice, chat, msg(1, now - LOCAL_CHAT_RETENTION_MS + 1000),
    now - LOCAL_CHAT_RETENTION_MS + 1000);
  assert.equal(loadLocalChat(storage, origin, alice, chat, now).messages.length, 1);
  assert.equal(loadLocalChat(storage, origin, alice, chat, now + 2000).messages.length, 0);
  purgeLocalChats(storage, origin, alice, now + 2000);
  assert.equal(storage.length, 0);
});

test("Unread counts remain local and can be marked as read without server", () => {
  const storage = new MemoryStorage(), now = Date.now();
  appendLocalChat(storage, origin, alice, chat, msg(1, now, bob), now);
  assert.equal(loadLocalChat(storage, origin, alice, chat, now).unread, 1);
  markLocalChatRead(storage, origin, alice, chat, now + 1);
  assert.equal(loadLocalChat(storage, origin, alice, chat, now + 1).unread, 0);
  appendLocalChat(storage, origin, alice, chat, msg(2, now + 2, bob), now + 2);
  assert.equal(loadLocalChat(storage, origin, alice, chat, now + 2).unread, 1);
  eraseLocalChat(storage, origin, alice, chat);
  assert.equal(storage.length, 0);
});

test("Oversized messages and future-dated messages do not write storage", () => {
  const storage = new MemoryStorage(), now = Date.now();
  assert.equal(LOCAL_MESSAGE_LIMIT_BYTES, 1536);
  assert.throws(() => appendLocalChat(storage, origin, alice, chat, msg(1, now, bob, "🔥".repeat(500)), now));
  assert.throws(() => appendLocalChat(storage, origin, alice, chat,
    msg(3, now, bob, "a" + "\n".repeat(950) + "b"), now));
  assert.throws(() => appendLocalChat(storage, origin, alice, chat, msg(2, now + 120000), now));
  assert.equal(storage.length, 0);
});

test("Duplicate WebSocket events are idempotent", () => {
  const storage = new MemoryStorage(), now = Date.now();
  appendLocalChat(storage, origin, alice, chat, msg(1, now), now);
  appendLocalChat(storage, origin, alice, chat, msg(1, now), now);
  assert.equal(loadLocalChat(storage, origin, alice, chat, now).messages.length, 1);
});
