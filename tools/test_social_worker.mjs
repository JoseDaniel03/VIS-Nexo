import assert from "node:assert/strict";
import worker from "../services/social/worker.mjs";

const url = "https://vis-social.example/health";
const tables = ["social_users", "friend_requests", "friendships",
  "friend_aliases", "pending_messages"];
const env = { DB: { prepare() { return {
  async all() { return { results: tables.map(name => ({ name })) }; }
}; } } };

let res = await worker.fetch(new Request(url), env);
assert.equal(res.status, 200);
assert.deepEqual((await res.json()).status, "ready");

res = await worker.fetch(new Request(url), {});
assert.equal(res.status, 503);

res = await worker.fetch(new Request("https://vis-social.example/private"), env);
assert.equal(res.status, 404);

const migrationMissing = { DB: { prepare() { return {
  async all() { return { results: [{ name: "social_users" }] }; }
}; } } };
res = await worker.fetch(new Request(url), migrationMissing);
assert.equal(res.status, 503);
assert.equal((await res.json()).status, "migration_required");
console.log("VIS Social D1 Worker checks passed");
