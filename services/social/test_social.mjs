import test from "node:test";
import assert from "node:assert/strict";
import socialWorker, { normalizeUsername, validMessage, validCustomStatus, validGameProject, validFriendNickname, pair, isAllowedOrigin } from "./worker.mjs";
import { readFileSync } from "node:fs";

test("Ceibo usernames are canonical and reject unsafe names", () => {
  assert.equal(normalizeUsername("  PePiTo_03  "), "pepito_03");
  for (const name of ["a", "../evil", "a b", "éxito", "a".repeat(25)]) assert.equal(normalizeUsername(name), "");
});
test("Humile messages enforce content limits", () => {
  assert.equal(validMessage("Hola"), true);
  assert.equal(validMessage("<script>"), true); // Client escapes text on render.
  for (const value of ["", " ", "x".repeat(1537), "🔥".repeat(400), null, {}])
    assert.equal(validMessage(value), false);
});
test("Canonical friendship pair prevents reversed duplicates", () => {
  assert.deepEqual(pair("b", "a"), ["a", "b"]);
  assert.deepEqual(pair("a", "b"), ["a", "b"]);
});
test("Only configured browser origins are allowed", () => {
  const configured = "http://tauri.localhost,https://tauri.localhost";
  assert.equal(isAllowedOrigin("http://tauri.localhost", configured), true);
  assert.equal(isAllowedOrigin("https://evil.test", configured), false);
  assert.equal(isAllowedOrigin("http://tauri.localhost.evil.test", configured), false);
});
test("Migration includes integrity and membership constraints", () => {
  const sql = readFileSync(new URL("./migrations/0001_ceibo_humile.sql", import.meta.url), "utf8");
  assert.match(sql, /UNIQUE\(user_a, user_b\)/);
  assert.match(sql, /PRIMARY KEY\(chat_id, account_id\)/);
  assert.match(sql, /token_hash TEXT NOT NULL UNIQUE/);
  const migration = readFileSync(new URL("./migrations/0005_local_messages_only.sql", import.meta.url), "utf8");
  assert.match(migration, /DROP TABLE IF EXISTS humile_messages/);
});

test("Daily cleanup only removes stale authentication metadata", async () => {
  const statements = [];
  const db = {
    prepare(sql) { return { bind(...values) { return { sql, values }; } }; },
    async batch(entries) { statements.push(...entries); return []; }
  };
  const promises = [];
  await socialWorker.scheduled({}, { DB: db }, { waitUntil(promise) { promises.push(promise); } });
  await Promise.all(promises);
  assert.equal(statements.length, 4);
  assert.ok(statements.some(s => s.sql.includes("ceibo_sessions")));
  assert.ok(statements.some(s => s.sql.includes("humile_ws_tickets")));
  assert.ok(statements.some(s => s.sql.includes("ceibo_auth_attempts")));
  assert.ok(statements.some(s => s.sql.includes("humile_game_activity")));
  assert.equal(statements.some(s => s.sql.includes("humile_messages")), false);
  for (const s of statements) assert.equal(s.values.length, 1);
});

test("Statuses and game labels reject controls, markup and oversized text", () => {
  assert.equal(validCustomStatus("Jugando Minecraft ☕"), true);
  assert.equal(validCustomStatus("x".repeat(81)), false);
  assert.equal(validCustomStatus("Hola\nsecret"), false);
  assert.equal(validCustomStatus("<b>unsafe</b>"), false);
  assert.equal(validGameProject("Virgoland 26.3"), true);
  assert.equal(validGameProject("x".repeat(65)), false);
  assert.equal(validGameProject("Incorrecto" + String.fromCharCode(0)), false);
  assert.equal(validGameProject("<img src=x>"), false);
});

test("Friend nicknames validate unicode, length and direction controls", () => {
  assert.equal(validFriendNickname("  Amigo del server  "), true);
  assert.equal(validFriendNickname("José 🎮"), true);
  assert.equal(validFriendNickname("  "), false);
  assert.equal(validFriendNickname("a".repeat(41)), false);
  assert.equal(validFriendNickname(String.fromCharCode(0)), false);
  assert.equal(validFriendNickname("Hola\namigo"), false);
  assert.equal(validFriendNickname("A\u202eB"), false);
  assert.equal(validFriendNickname(null), false);
});
