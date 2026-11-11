import test from "node:test";
import assert from "node:assert/strict";
import socialWorker, { normalizeUsername, validMessage, pair, isAllowedOrigin } from "./worker.mjs";
import { readFileSync } from "node:fs";

test("Ceibo usernames are canonical and reject unsafe names", () => {
  assert.equal(normalizeUsername("  PePiTo_03  "), "pepito_03");
  for (const name of ["a", "../evil", "a b", "éxito", "a".repeat(25)]) assert.equal(normalizeUsername(name), "");
});
test("Humile messages enforce content limits", () => {
  assert.equal(validMessage("Hola"), true);
  assert.equal(validMessage("<script>"), true); // Client escapes text on render.
  for (const value of ["", " ", "x".repeat(2001), null, {}]) assert.equal(validMessage(value), false);
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
  assert.match(sql, /CHECK\(length\(body\) BETWEEN 1 AND 2000\)/);
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
  assert.equal(statements.length, 3);
  assert.ok(statements.some(s => s.sql.includes("ceibo_sessions")));
  assert.ok(statements.some(s => s.sql.includes("humile_ws_tickets")));
  assert.ok(statements.some(s => s.sql.includes("ceibo_auth_attempts")));
  assert.equal(statements.some(s => s.sql.includes("humile_messages")), false);
  for (const s of statements) assert.equal(s.values.length, 1);
});
