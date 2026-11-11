// End-to-end local Workers runtime test: actual HTTP -> Worker -> D1 -> Durable Object.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const port = 17879;
const host = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, [
  "./node_modules/wrangler/bin/wrangler.js", "dev", "--config", "wrangler.test.toml",
  "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", ".wrangler-test"
], { cwd: new URL(".", import.meta.url).pathname,
     env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" },
     stdio: ["ignore", "pipe", "pipe"] });
let output = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", data => { output = (output + data.toString()).slice(-14000); });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const openSockets = [];
function nextSocketEvent(socket, desired) {
  return new Promise((resolve,reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error("WebSocket event not received: " + desired)); }, 15000);
    const message = event => {
      let value;
      try { value = JSON.parse(event.data); } catch { return; }
      if (value?.type !== desired) return;
      cleanup(); resolve(value);
    };
    const failed = () => { cleanup(); reject(new Error("WebSocket closed before " + desired)); };
    function cleanup() {
      clearTimeout(timeout);
      socket.removeEventListener("message",message);
      socket.removeEventListener("close",failed);
      socket.removeEventListener("error",failed);
    }
    socket.addEventListener("message",message);
    socket.addEventListener("close",failed);
    socket.addEventListener("error",failed);
  });
}
async function call(path, method = "GET", data, token, expected = 200) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(host + path, {
    method, headers, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(20000)
  });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify({ method, path, result }));
  return result;
}
async function waitReady() {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw Error("Worker terminó antes de iniciar: " + output);
    try {
      const response = await fetch(host + "/health", { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await sleep(300);
  }
  throw Error("No se inició el Worker:\n" + output);
}
async function main() {
  await waitReady();
  const alice = await call("/v1/auth/register", "POST", { username: "alice", password: "VISstrong-pass123!" }, null, 201);
  const bob = await call("/v1/auth/register", "POST", { username: "bobby", password: "VISstrong-pass321!" }, null, 201);
  const charlie = await call("/v1/auth/register", "POST", { username: "charlie", password: "VISstrong-pass222!" }, null, 201);
  assert.equal(alice.account.username, "alice");
  assert.ok(alice.token.length === 64);
  assert.equal((await call("/v1/social", "GET", undefined, alice.token)).friends.length, 0);
  const unauth = await fetch(host + "/v1/social");
  assert.equal(unauth.status, 401, "Social endpoints must deny unauthenticated access");

  await call("/v1/friends/requests", "POST", { username: "bobby" }, alice.token, 201);
  const pending = await call("/v1/social", "GET", undefined, bob.token);
  assert.equal(pending.incoming[0].username, "alice");
  await call("/v1/friends/answer", "POST", { id: pending.incoming[0].id, action: "accept" }, bob.token);
  const friends = await call("/v1/social", "GET", undefined, alice.token);
  assert.equal(friends.friends[0].username, "bobby");

  await call("/v1/favorites/" + bob.account.id, "POST", {}, alice.token);
  assert.ok((await call("/v1/social", "GET", undefined, alice.token)).favorites.includes(bob.account.id));
  await call("/v1/presence", "POST", { visibility: "invisible" }, bob.token);
  assert.equal((await call("/v1/social", "GET", undefined, bob.token)).me.presence, "invisible");

  const wsTicket = await call("/v1/rt/ticket", "POST", {}, bob.token);
  assert.match(wsTicket.ticket, /^[a-f0-9]{64}$/);
  const socket = new WebSocket(host.replace(/^http:/, "ws:") + "/v1/rt?ticket=" + wsTicket.ticket);
  openSockets.push(socket);
  await nextSocketEvent(socket, "ready");
  const hidden = await call("/v1/social", "GET", undefined, alice.token);
  assert.equal(hidden.friends[0].online, false, "Invisible presence must not expose a connected peer");
  await call("/v1/presence", "POST", { visibility: "online" }, bob.token);
  const publicStatus = await call("/v1/social", "GET", undefined, alice.token);
  assert.equal(publicStatus.friends[0].online, true, "Connected visible peer should appear online");

  // Custom text and real game activity are visible only to connected friends.
  const aliceTicket = await call("/v1/rt/ticket", "POST", {}, alice.token);
  const aliceSocket = new WebSocket(host.replace(/^http:/, "ws:") + "/v1/rt?ticket=" + aliceTicket.ticket);
  openSockets.push(aliceSocket);
  await nextSocketEvent(aliceSocket, "ready");
  const statusNotification = nextSocketEvent(aliceSocket, "social:update");
  const custom = await call("/v1/presence", "POST",
    { custom_status: "Armando Virgoland ☕", share_game: true }, bob.token);
  assert.equal(custom.custom_status, "Armando Virgoland ☕");
  await statusNotification;
  assert.equal((await call("/v1/social", "GET", undefined, alice.token)).friends[0].custom_status,
    "Armando Virgoland ☕");
  await call("/v1/presence", "POST", { custom_status: "x".repeat(81) }, bob.token, 400);
  await call("/v1/presence", "POST", { custom_status: "<script>" }, bob.token, 400);
  await call("/v1/presence", "POST", { share_game: "true" }, bob.token, 400);
  await call("/v1/activity", "POST", { engine: "minecraft" }, bob.token, 400);
  await call("/v1/activity", "POST", { engine: "java", project: "<script>" }, bob.token, 400);
  await call("/v1/activity", "POST", { engine: "rust", project: "Virgoland" }, bob.token);
  const playing = await call("/v1/social", "GET", undefined, alice.token);
  assert.deepEqual(playing.friends[0].activity, { engine: "rust", project: "Virgoland" });
  assert.equal(playing.friends[0].online, true);
  await call("/v1/presence", "POST", { visibility: "invisible" }, bob.token);
  const hiddenGame = await call("/v1/social", "GET", undefined, alice.token);
  assert.equal(hiddenGame.friends[0].activity, null);
  assert.equal(hiddenGame.friends[0].custom_status, "");
  await call("/v1/presence", "POST", { visibility: "online", share_game: false }, bob.token);
  assert.equal((await call("/v1/social", "GET", undefined, alice.token)).friends[0].activity, null);
  await call("/v1/presence", "POST", { share_game: true }, bob.token);
  await call("/v1/activity", "POST", { engine: "java", project: "" }, bob.token);
  assert.equal((await call("/v1/social", "GET", undefined, alice.token)).friends[0].activity.engine, "java");
  await call("/v1/activity", "POST", { engine: null }, bob.token);
  assert.equal((await call("/v1/social", "GET", undefined, alice.token)).friends[0].activity, null);

  // Each account owns its nicknames. The named friend never sees our label.
  await call("/v1/friends/" + bob.account.id + "/nickname", "PUT",
    { nickname: "Bobi del servidor 🎮" }, alice.token);
  const mine = await call("/v1/social", "GET", undefined, alice.token);
  const theirs = await call("/v1/social", "GET", undefined, bob.token);
  assert.equal(mine.friends[0].nickname, "Bobi del servidor 🎮");
  assert.equal(mine.friends[0].username, "bobby", "Canonical Ceibo username must not be rewritten");
  assert.equal(theirs.friends[0].nickname, null, "A friend must never see another account's private nickname");
  await call("/v1/friends/" + bob.account.id + "/nickname", "PUT",
    { nickname: "Bobi 2" }, alice.token);
  assert.equal((await call("/v1/social", "GET", undefined, alice.token)).friends[0].nickname, "Bobi 2");
  await call("/v1/friends/" + bob.account.id + "/nickname", "PUT",
    { nickname: "x".repeat(41) }, alice.token, 400);
  await call("/v1/friends/" + bob.account.id + "/nickname", "PUT",
    { nickname: "A\nB" }, alice.token, 400);
  await call("/v1/friends/" + bob.account.id + "/nickname", "PUT",
    { nickname: "Not permitted" }, charlie.token, 403);
  await call("/v1/friends/" + bob.account.id + "/nickname", "DELETE", undefined, alice.token);
  assert.equal((await call("/v1/social", "GET", undefined, alice.token)).friends[0].nickname, null);
  await call("/v1/friends/" + bob.account.id + "/nickname", "PUT",
    { nickname: "Bobi alias" }, alice.token);
    const direct = await call("/v1/chats/direct", "POST", { username: "bobby" }, alice.token);
  const same = await call("/v1/chats/direct", "POST", { username: "alice" }, bob.token);
  assert.equal(direct.id, same.id, "Direct chats must be unique per user pair");
  const notified = nextSocketEvent(socket, "chat:message");
  await call("/v1/chats/" + direct.id + "/messages", "POST", { body: "Hola, Bob" }, alice.token, 201);
  const delivered = await notified;
  assert.equal(delivered.chat_id, direct.id, "WebSocket notification must reference the committed chat");
  const msgs = await call("/v1/chats/" + direct.id + "/messages", "GET", undefined, bob.token);
  assert.equal(msgs.messages[0].body, "Hola, Bob");
  assert.equal((await call("/v1/social", "GET", undefined, bob.token)).chats[0].unread, 1);
  await call("/v1/chats/" + direct.id + "/read", "POST", {}, bob.token);
  assert.equal((await call("/v1/social", "GET", undefined, bob.token)).chats[0].unread, 0);

  const group = await call("/v1/chats/groups", "POST",
    { title: "Amigos VIS", members: ["bobby"] }, alice.token, 201);
  assert.equal((await call("/v1/chats/" + group.id + "/messages", "GET", undefined, bob.token)).messages.length, 0);
  await call("/v1/chats/" + group.id + "/leave", "POST", {}, bob.token);
  await call("/v1/chats/" + group.id + "/messages", "GET", undefined, bob.token, 404);
  await call("/v1/chats/" + group.id + "/leave", "POST", {}, alice.token);
  await call("/v1/chats/" + group.id + "/messages", "GET", undefined, alice.token, 404);

  await call("/v1/chats/" + direct.id + "/messages", "GET", undefined, charlie.token, 404);
  await call("/v1/chats/" + direct.id + "/messages", "POST", { body: "Forbidden" }, charlie.token, 404);
  await call("/v1/chats/groups", "POST", { title: "No friends", members: ["charlie"] }, alice.token, 403);
  await call("/v1/blocks/" + alice.account.id, "POST", {}, bob.token);
  await call("/v1/chats/" + direct.id + "/messages", "POST", { body: "Blocked" }, alice.token, 403);
  await call("/v1/friends/" + bob.account.id + "/nickname", "PUT",
    { nickname: "Blocked alias" }, alice.token, 403);
  // Blocking removes the accepted friendship and clears both parties' nicknames in D1.
  const nicknameCount = await call("/v1/social", "GET", undefined, alice.token);
  assert.equal(nicknameCount.friends.length, 0);
  await call("/v1/friends/requests", "POST", { username: "bobby" }, alice.token, 403);
  await call("/v1/blocks/" + alice.account.id, "DELETE", undefined, bob.token);
  const me = await call("/v1/me", "GET", undefined, bob.token);
  assert.equal(me.username, "bobby");
  console.log("PASS local Worker + D1 + Durable Objects (friends, private nicknames, DM/groups, custom status, game activity, privacy, websocket)");
}
try {
  await main();
} catch (err) {
  console.error(err);
  console.error("Worker logs:\n" + output);
  process.exitCode = 1;
} finally {
  for (const socket of openSockets) { try { socket.close(); } catch {} }
  child.kill("SIGTERM");
  await sleep(350);
  if (child.exitCode === null) child.kill("SIGKILL");
  child.stdout.destroy(); child.stderr.destroy();
}
