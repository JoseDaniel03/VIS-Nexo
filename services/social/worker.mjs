// VIS Social, authenticated Cloudflare Worker. The launcher PIN never leaves the PC.
// Ed25519 proof-of-possession authenticates a local device. D1 stores only hashes of
// temporary bearer sessions and opaque ECDH/AES-GCM encrypted message envelopes.
const te = new TextEncoder();
const USERNAME = /^[a-z0-9_]{3,24}$/;
const MAX_BODY = 8192;
const MAX_MESSAGE_BYTES = 2048;
const HOUR = 3600;
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  }
});
class HttpFailure extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (status, message) => { throw new HttpFailure(status, message); };
const now = () => Math.floor(Date.now() / 1000);
const base64 = bytes => btoa(String.fromCharCode(...bytes));
function unbase64(value, size) {
  if (typeof value !== "string" || value.length > 512 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) bad(400, "Invalid encoded key");
  try {
    const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    if (size !== undefined && bytes.length !== size) bad(400, "Invalid key length");
    return bytes;
  } catch { bad(400, "Invalid encoded key"); }
}
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
async function hash(text) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(text)))]
    .map(x => x.toString(16).padStart(2, "0")).join("");
}
async function verifySignature(publicKey, signature, message) {
  const keyBytes = unbase64(publicKey, 32);
  const signatureBytes = unbase64(signature, 64);
  try {
    const key = await crypto.subtle.importKey("raw", keyBytes, "Ed25519", false, ["verify"]);
    return crypto.subtle.verify("Ed25519", key, signatureBytes, te.encode(message));
  } catch { return false; }
}
async function parseBody(request) {
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY) bad(413, "Request too large");
  const reader = request.body?.getReader();
  if (!reader) bad(400, "JSON body required");
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) { await reader.cancel(); bad(413, "Request too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let data;
  try { data = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)); }
  catch { bad(400, "Invalid JSON body"); }
  if (!data || Array.isArray(data) || typeof data !== "object") bad(400, "JSON object required");
  return data;
}
function normalName(value) {
  const name = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!USERNAME.test(name)) bad(400, "Username must be 3-24 letters, numbers or underscore");
  return name;
}
function isFriendSql() {
  return "SELECT 1 AS yes FROM friendships WHERE (user_a=? AND user_b=?) OR (user_a=? AND user_b=?)";
}
async function areFriends(db, a, b) {
  return !!(await db.prepare(isFriendSql()).bind(a, b, b, a).first());
}
async function rateLimit(db, request, category, limit) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const fingerprint = await hash(category + ":" + ip);
  const bucket = fingerprint + ":" + Math.floor(now() / 60);
  const until = now() + 120;
  await db.prepare(
    "INSERT INTO auth_rate_limits (bucket,hits,expires_at) VALUES (?,1,?) " +
    "ON CONFLICT(bucket) DO UPDATE SET hits=hits+1"
  ).bind(bucket, until).run();
  const row = await db.prepare("SELECT hits FROM auth_rate_limits WHERE bucket=?").bind(bucket).first();
  if (row && row.hits > limit) bad(429, "Too many requests, retry later");
}
async function getSession(request, db) {
  const header = request.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9_-]{40,60}$/.test(header)) bad(401, "Authentication required");
  const token = header.slice(7);
  const tokenHash = await hash(token);
  const user = await db.prepare(
    "SELECT u.id,u.username,u.presence,u.custom_status,u.current_game,u.encryption_public_key " +
    "FROM auth_sessions s JOIN social_users u ON u.id=s.user_id " +
    "WHERE s.token_hash=? AND s.expires_at>?"
  ).bind(tokenHash, now()).first();
  if (!user) bad(401, "Session expired");
  return { ...user, tokenHash };
}
async function register(request, db) {
  const body = await parseBody(request);
  const username = normalName(body.username);
  if (!await verifySignature(body.public_key, body.signature,
    "VIS-SOCIAL-REGISTER-V1\n" + username)) bad(401, "Invalid device signature");
  const current = await db.prepare("SELECT username,signing_public_key FROM social_users WHERE username=?").bind(username).first();
  if (current) {
    if (current.signing_public_key !== body.public_key) bad(409, "Username already registered on another device");
    return reply({ ok: true, username, existing: true });
  }
  await rateLimit(db, request, "register", 8);
  const id = crypto.randomUUID();
  try {
    await db.prepare(
      "INSERT INTO social_users (id,username,display_name,signing_public_key) VALUES (?,?,?,?)"
    ).bind(id, username, username, body.public_key).run();
  } catch {
    bad(409, "Username already registered");
  }
  return reply({ ok: true, username, existing: false }, 201);
}
async function challenge(request, db) {
  await rateLimit(db, request, "challenge", 25);
  const { username: name } = await parseBody(request);
  const username = normalName(name);
  const user = await db.prepare("SELECT id FROM social_users WHERE username=?").bind(username).first();
  if (!user) bad(404, "Social account not found");
  const id = crypto.randomUUID();
  const nonce = randomToken();
  await db.prepare("INSERT INTO auth_challenges (id,user_id,nonce,expires_at) VALUES (?,?,?,?)")
    .bind(id, user.id, nonce, now() + 120).run();
  return reply({ id, nonce, expires_in: 120 });
}
async function session(request, db) {
  await rateLimit(db, request, "session", 15);
  const body = await parseBody(request);
  const username = normalName(body.username);
  if (typeof body.challenge_id !== "string" || body.challenge_id.length > 80) bad(400, "Invalid challenge ID");
  const row = await db.prepare(
    "SELECT c.id,c.nonce,c.expires_at,u.id AS user_id,u.signing_public_key " +
    "FROM auth_challenges c JOIN social_users u ON u.id=c.user_id " +
    "WHERE c.id=? AND u.username=? AND c.expires_at>?"
  ).bind(body.challenge_id, username, now()).first();
  if (!row) bad(401, "Invalid or expired challenge");
  const message = "VIS-SOCIAL-AUTH-V1\n" + username + "\n" + row.id + "\n" + row.nonce;
  if (!await verifySignature(row.signing_public_key, body.signature, message)) bad(401, "Invalid device signature");
  const claim = await db.prepare("DELETE FROM auth_challenges WHERE id=? AND user_id=? AND expires_at>?")
    .bind(row.id, row.user_id, now()).run();
  if (!claim.meta || claim.meta.changes !== 1) bad(401, "Challenge already used");
  const token = randomToken();
  const expiresAt = now() + 12 * HOUR;
  await db.prepare("INSERT INTO auth_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)")
    .bind(await hash(token), row.user_id, expiresAt).run();
  return reply({ token, expires_at: expiresAt, username });
}
async function setKey(request, db, user) {
  const body = await parseBody(request);
  if (typeof body.public_key !== "string" || body.public_key.length < 80 ||
      body.public_key.length > 200) bad(400, "Invalid encryption public key");
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "spki", unbase64(body.public_key), { name: "ECDH", namedCurve: "P-256" }, false, []
    );
    if (!cryptoKey) bad(400, "Invalid encryption key");
  } catch { bad(400, "Invalid encryption key"); }
  const current = await db.prepare("SELECT encryption_public_key FROM social_users WHERE id=?").bind(user.id).first();
  if (current?.encryption_public_key && current.encryption_public_key !== body.public_key) {
    bad(409, "Existing key differs; migration/recovery required");
  }
  await db.prepare("UPDATE social_users SET encryption_public_key=?,updated_at=? WHERE id=?")
    .bind(body.public_key, now(), user.id).run();
  return reply({ ok: true });
}
async function currentState(db, user) {
  const friends = await db.prepare(
    "SELECT u.id,u.username,u.presence,u.custom_status,u.current_game,u.encryption_public_key,u.last_seen_at," +
    "a.alias FROM social_users u LEFT JOIN friend_aliases a ON a.owner_id=? AND a.friend_id=u.id " +
    "WHERE u.id IN (SELECT user_b FROM friendships WHERE user_a=? UNION " +
    "SELECT user_a FROM friendships WHERE user_b=?) ORDER BY u.username LIMIT 500"
  ).bind(user.id, user.id, user.id).all();
  const visible = (friends.results || []).map(f => ({
    username: f.username, alias: f.alias || "",
    presence: f.presence !== "invisible" && f.last_seen_at >= now() - 150 ? f.presence : "offline",
    custom_status: f.presence !== "invisible" && f.last_seen_at >= now() - 150 ? f.custom_status : "",
    current_game: f.presence !== "invisible" && f.last_seen_at >= now() - 150 ? f.current_game : "",
    public_key: f.encryption_public_key
  }));
  const incoming = await db.prepare(
    "SELECT u.username FROM friend_requests r JOIN social_users u ON u.id=r.sender_id " +
    "WHERE r.recipient_id=? AND r.status='pending' ORDER BY r.created_at DESC LIMIT 100"
  ).bind(user.id).all();
  const outgoing = await db.prepare(
    "SELECT u.username FROM friend_requests r JOIN social_users u ON u.id=r.recipient_id " +
    "WHERE r.sender_id=? AND r.status='pending' ORDER BY r.created_at DESC LIMIT 100"
  ).bind(user.id).all();
  const queue = await db.prepare(
    "SELECT m.id,u.username AS sender,m.payload,m.created_at,m.client_message_id " +
    "FROM pending_messages m JOIN social_users u ON u.id=m.sender_id " +
    "WHERE m.recipient_id=? AND m.expires_at>? AND m.acknowledged_at IS NULL " +
    "ORDER BY m.created_at ASC LIMIT 100"
  ).bind(user.id, now()).all();
  return reply({
    username: user.username, presence: user.presence,
    custom_status: user.custom_status, current_game: user.current_game,
    public_key: user.encryption_public_key,
    friends: visible,
    incoming_requests: (incoming.results || []).map(x => x.username),
    outgoing_requests: (outgoing.results || []).map(x => x.username),
    pending_messages: (queue.results || []).map(x => ({
      id: x.id, from: x.sender, payload: x.payload, created_at: x.created_at,
      client_message_id: x.client_message_id
    })),
    server_time: now()
  });
}
async function lookupUser(db, username) {
  const user = await db.prepare("SELECT id,username FROM social_users WHERE username=?").bind(normalName(username)).first();
  if (!user) bad(404, "Account not found");
  return user;
}
async function friendRequest(request, db, user) {
  await rateLimit(db, request, "friend-request:" + user.id, 30);
  const { username } = await parseBody(request);
  const peer = await lookupUser(db, username);
  if (peer.id === user.id) bad(400, "Cannot add yourself");
  if (await areFriends(db, user.id, peer.id)) bad(409, "Already friends");
  const existing = await db.prepare(
    "SELECT id,status FROM friend_requests WHERE (sender_id=? AND recipient_id=?) " +
    "OR (sender_id=? AND recipient_id=?)"
  ).bind(user.id, peer.id, peer.id, user.id).first();
  if (existing && existing.status === "pending") bad(409, "Pending friend request exists");
  if (existing) {
    await db.prepare("DELETE FROM friend_requests WHERE id=?").bind(existing.id).run();
  }
  await db.prepare(
    "INSERT INTO friend_requests (id,sender_id,recipient_id,status) VALUES (?,?,?,'pending')"
  ).bind(crypto.randomUUID(), user.id, peer.id).run();
  return reply({ ok: true, to: peer.username }, 201);
}
async function friendAccept(request, db, user) {
  const { username } = await parseBody(request);
  const peer = await lookupUser(db, username);
  const pair = [user.id, peer.id].sort();
  const exists = await db.prepare(
    "SELECT id FROM friend_requests WHERE sender_id=? AND recipient_id=? AND status='pending'"
  ).bind(peer.id, user.id).first();
  if (!exists) bad(404, "Friend request not found");
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO friendships (user_a,user_b) " +
      "SELECT ?,? WHERE EXISTS (SELECT 1 FROM friend_requests WHERE id=? AND status='pending')")
      .bind(pair[0], pair[1], exists.id),
    db.prepare("UPDATE friend_requests SET status='accepted',updated_at=? WHERE id=? AND status='pending'")
      .bind(now(), exists.id)
  ]);
  return reply({ ok: true, friend: peer.username });
}
async function friendAlias(request, db, user) {
  const { username, alias } = await parseBody(request);
  const peer = await lookupUser(db, username);
  if (!await areFriends(db, user.id, peer.id)) bad(403, "Not friends");
  if (typeof alias !== "string" || alias.length > 80) bad(400, "Invalid alias");
  if (!alias.trim()) {
    await db.prepare("DELETE FROM friend_aliases WHERE owner_id=? AND friend_id=?").bind(user.id, peer.id).run();
  } else {
    await db.prepare("INSERT INTO friend_aliases (owner_id,friend_id,alias) VALUES (?,?,?) " +
      "ON CONFLICT(owner_id,friend_id) DO UPDATE SET alias=excluded.alias")
      .bind(user.id, peer.id, alias.trim()).run();
  }
  return reply({ ok: true });
}
async function presence(request, db, user) {
  const body = await parseBody(request);
  const status = body.presence;
  if (!["online", "away", "busy", "invisible", "offline"].includes(status)) bad(400, "Invalid status");
  const custom = typeof body.custom_status === "string" ? body.custom_status.trim() : "";
  const game = typeof body.current_game === "string" ? body.current_game.trim() : "";
  if (custom.length > 160 || game.length > 160) bad(400, "Invalid status text");
  await db.prepare(
    "UPDATE social_users SET presence=?,custom_status=?,current_game=?,last_seen_at=?,updated_at=? WHERE id=?"
  ).bind(status, custom, game, now(), now(), user.id).run();
  return reply({ ok: true });
}
async function sendMessage(request, db, user) {
  await rateLimit(db, request, "send:" + user.id, 60);
  const body = await parseBody(request);
  const peer = await lookupUser(db, body.to);
  if (!await areFriends(db, user.id, peer.id)) bad(403, "Messages require friendship");
  if (typeof body.client_message_id !== "string" ||
      !/^[a-zA-Z0-9_-]{12,90}$/.test(body.client_message_id)) bad(400, "Invalid message ID");
  const envelope = body.payload;
  if (typeof envelope !== "string" || te.encode(envelope).length > MAX_MESSAGE_BYTES) bad(413, "Message exceeds 2 KiB");
  let parsed;
  try { parsed = JSON.parse(envelope); } catch { bad(400, "Encrypted envelope required"); }
  if (parsed?.v !== 1 || typeof parsed.iv !== "string" || typeof parsed.ct !== "string" ||
      !/^[A-Za-z0-9+/]{16}$/.test(parsed.iv) || parsed.ct.length < 24 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(parsed.ct)) bad(400, "Invalid encrypted envelope");
  // The server cannot decrypt or read the message plaintext.
  const pending = await db.prepare(
    "SELECT count(*) AS n FROM pending_messages WHERE recipient_id=? AND expires_at>? AND acknowledged_at IS NULL"
  ).bind(peer.id, now()).first();
  if (pending && pending.n >= 500) bad(429, "Recipient inbox is full; retry later");
  await db.prepare(
    "INSERT OR IGNORE INTO pending_messages " +
    "(id,sender_id,recipient_id,client_message_id,payload,expires_at) VALUES (?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), user.id, peer.id, body.client_message_id, envelope, now() + 48 * HOUR).run();
  return reply({ ok: true, client_message_id: body.client_message_id });
}
async function ackMessages(request, db, user) {
  const body = await parseBody(request);
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length > 100 ||
      ids.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id))) bad(400, "Invalid acknowledgement");
  if (ids.length) {
    const holders = ids.map(() => "?").join(",");
    await db.prepare(
      "DELETE FROM pending_messages WHERE recipient_id=? AND id IN (" + holders + ")"
    ).bind(user.id, ...ids).run();
  }
  return reply({ ok: true });
}
async function cleanup(db) {
  const t = now();
  await db.batch([
    db.prepare("DELETE FROM auth_challenges WHERE expires_at<?").bind(t),
    db.prepare("DELETE FROM auth_sessions WHERE expires_at<?").bind(t),
    db.prepare("DELETE FROM auth_rate_limits WHERE expires_at<?").bind(t),
    db.prepare("DELETE FROM pending_messages WHERE expires_at<? OR acknowledged_at IS NOT NULL").bind(t)
  ]);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (!env?.DB) return reply({ service: "vis-social", status: "unavailable" }, 503);
    try {
      const db = env.DB;
      if (method === "GET" && path === "/health") {
        const tables = await db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN " +
          "('social_users','friend_requests','friendships','friend_aliases'," +
          "'pending_messages','auth_sessions','auth_challenges')"
        ).all();
        const ready = new Set((tables.results || []).map(x => x.name)).size === 7;
        return reply({ service: "vis-social", status: ready ? "ready" : "migration_required", schema: ready ? 2 : 0 },
          ready ? 200 : 503);
      }
      if (method === "POST" && path === "/v1/auth/register") return await register(request, db);
      if (method === "POST" && path === "/v1/auth/challenge") return await challenge(request, db);
      if (method === "POST" && path === "/v1/auth/session") return await session(request, db);
      if (!path.startsWith("/v1/")) return reply({ error: "Not found" }, 404);
      const user = await getSession(request, db);
      if (method === "GET" && path === "/v1/state") return await currentState(db, user);
      if (method === "POST" && path === "/v1/keys") return await setKey(request, db, user);
      if (method === "POST" && path === "/v1/friends/request") return await friendRequest(request, db, user);
      if (method === "POST" && path === "/v1/friends/accept") return await friendAccept(request, db, user);
      if (method === "POST" && path === "/v1/friends/alias") return await friendAlias(request, db, user);
      if (method === "POST" && path === "/v1/presence") return await presence(request, db, user);
      if (method === "POST" && path === "/v1/messages/send") return await sendMessage(request, db, user);
      if (method === "POST" && path === "/v1/messages/ack") return await ackMessages(request, db, user);
      if (method === "POST" && path === "/v1/auth/logout") {
        await db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(user.tokenHash).run();
        return reply({ ok: true });
      }
      return reply({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof HttpFailure) return reply({ error: error.message }, error.status);
      console.error("VIS Social request failed", path, error instanceof Error ? error.name : "error");
      return reply({ error: "Service unavailable" }, 503);
    }
  },
  async scheduled(_event, env) {
    if (env?.DB) await cleanup(env.DB);
  }
};
