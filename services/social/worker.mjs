// VIS Ceibo/Humile: D1 holds identities, friendships and chat membership only.
// Message content is relayed via WebSockets and stored by each VIS Nexo client.
const enc = new TextEncoder();
const NOW = () => Date.now();
const ISO = () => new Date().toISOString();
const SESSION_MS = 7 * 86400 * 1000;
const PASS_ITERATIONS = 600000;
const WORD = /^[a-z0-9_]{3,24}$/;
const ID = /^[a-f0-9-]{36}$/i;
const MAX_JSON = 16384;

export function normalizeUsername(value) {
  const name = String(value || "").trim().toLowerCase();
  return WORD.test(name) ? name : "";
}
// Bound a transmitted message to fit a complete local 2 KiB chat record.
export const MAX_CHAT_MESSAGE_BYTES = 1536;
export const MAX_CHAT_JSON_TEXT_BYTES = 1750; // Reserve space for ID, sender and timestamp in 2 KiB log.
export function validMessage(value) {
  if (typeof value !== "string") return false;
  const body = value.trim();
  return body.length > 0 && [...body].length <= 1500 &&
    enc.encode(body).byteLength <= MAX_CHAT_MESSAGE_BYTES &&
    enc.encode(JSON.stringify(body)).byteLength <= MAX_CHAT_JSON_TEXT_BYTES;
}
export function validFriendNickname(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return text.length > 0 && [...text].length <= 40 &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text);
}
export function validCustomStatus(value) {
  return typeof value === "string" && [...value].length <= 80 &&
    !/[\u0000-\u001f\u007f]/.test(value) && !/[<>]/.test(value);
}
export function validGameProject(value) {
  return typeof value === "string" && [...value].length <= 64 &&
    !/[\u0000-\u001f\u007f]/.test(value) && !/[<>]/.test(value);
}
const GAME_TTL_MS = 4 * 60 * 1000; // Launcher refreshes activity while a game is active.

export function pair(a, b) {
  return [a, b].sort();
}
export function isAllowedOrigin(origin, configured) {
  if (!origin) return true; // Native CLI requests still require bearer authentication.
  return String(configured || "").split(",").map(x => x.trim()).includes(origin);
}
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function fail(status, message) { throw new ApiError(status, message); }
function hex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
function randomHex(n = 32) { return hex(crypto.getRandomValues(new Uint8Array(n))); }
async function digest(data) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(data))));
}
async function passwordHash(password, salt, iterations = PASS_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt: Uint8Array.from(salt.match(/../g), h => parseInt(h, 16)),
    iterations
  }, key, 256);
  return hex(new Uint8Array(bits));
}
function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let xor = 0;
  for (let i = 0; i < a.length; i++) xor |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return xor === 0;
}
function response(request, env, body, status = 200) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Vary": "Origin"
  };
  if (origin && isAllowedOrigin(origin, env.ALLOWED_ORIGINS)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Authorization,Content-Type";
    headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS";
    headers["Access-Control-Max-Age"] = "600";
  }
  return new Response(JSON.stringify(body), { status, headers });
}
async function json(request) {
  if (Number(request.headers.get("content-length") || 0) > MAX_JSON) fail(413, "Solicitud demasiado grande");
  const text = await request.text();
  if (text.length > MAX_JSON) fail(413, "Solicitud demasiado grande");
  try { const value = JSON.parse(text); if (!value || typeof value !== "object" || Array.isArray(value)) throw 0; return value; }
  catch { fail(400, "JSON inválido"); }
}
async function bearer(request, db) {
  const match = /^Bearer ([0-9a-f]{64})$/i.exec(request.headers.get("Authorization") || "");
  if (!match) fail(401, "Iniciá sesión en VIS Social");
  const tokenHash = await digest(match[1]);
  const account = await db.prepare(
    "SELECT a.id,a.username FROM ceibo_sessions s JOIN ceibo_accounts a ON a.id=s.account_id " +
    "WHERE s.token_hash=? AND s.expires_at>? AND s.revoked_at IS NULL AND a.disabled_at IS NULL"
  ).bind(tokenHash, NOW()).first();
  if (!account) fail(401, "Sesión vencida");
  return account;
}
async function rate(db, key, max, ms) {
  const now = NOW();
  await db.prepare("INSERT INTO ceibo_auth_attempts(key,failures,reset_at) VALUES(?,1,?) " +
    "ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN reset_at<? THEN 1 ELSE failures+1 END, " +
    "reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END")
    .bind(key, now + ms, now, now).run();
  const row = await db.prepare("SELECT failures FROM ceibo_auth_attempts WHERE key=?").bind(key).first();
  if (row.failures > max) fail(429, "Demasiados intentos. Probá más tarde.");
}
async function createSession(db, account) {
  const token = randomHex();
  await db.prepare("INSERT INTO ceibo_sessions(id,account_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)")
    .bind(crypto.randomUUID(), account.id, await digest(token), NOW() + SESSION_MS, NOW()).run();
  return { token, account: { id: account.id, username: account.username } };
}
async function register(request, env) {
  const body = await json(request);
  const name = normalizeUsername(body.username);
  if (!name) fail(400, "El usuario debe tener 3 a 24 letras, números o _");
  if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128)
    fail(400, "La contraseña debe tener entre 12 y 128 caracteres");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await rate(env.DB, "signup:" + await digest(ip), 5, 3600000);
  const salt = randomHex(16), hash = await passwordHash(body.password, salt);
  try {
    const account = { id: crypto.randomUUID(), username: name };
    await env.DB.prepare("INSERT INTO ceibo_accounts(id,username,password_salt,password_hash,password_iterations,created_at) VALUES(?,?,?,?,?,?)")
      .bind(account.id, name, salt, hash, PASS_ITERATIONS, ISO()).run();
    return response(request, env, await createSession(env.DB, account), 201);
  } catch (e) {
    if (String(e).includes("UNIQUE")) fail(409, "Nombre de usuario ocupado");
    throw e;
  }
}
async function login(request, env) {
  const body = await json(request);
  const name = normalizeUsername(body.username);
  if (!name || typeof body.password !== "string") fail(401, "Credenciales incorrectas");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await rate(env.DB, "signin:" + await digest(ip + ":" + name), 15, 3600000);
  const account = await env.DB.prepare("SELECT * FROM ceibo_accounts WHERE username=? AND disabled_at IS NULL").bind(name).first();
  if (!account) fail(401, "Credenciales incorrectas");
  const hash = await passwordHash(body.password, account.password_salt, account.password_iterations);
  if (!same(hash, account.password_hash)) fail(401, "Credenciales incorrectas");
  return response(request, env, await createSession(env.DB, account));
}
async function notify(env, accountId, payload) {
  const room = env.HUB.get(env.HUB.idFromName(accountId));
  try { await room.fetch("https://internal/publish", { method: "POST", body: JSON.stringify(payload) }); }
  catch { /* Notification failure must never roll back an already committed DB write. */ }
}
async function targetByName(db, name) {
  const username = normalizeUsername(name);
  if (!username) fail(400, "Usuario inválido");
  const account = await db.prepare("SELECT id,username FROM ceibo_accounts WHERE username=? AND disabled_at IS NULL")
    .bind(username).first();
  if (!account) fail(404, "Usuario no encontrado");
  return account;
}
async function blocked(db, a, b) {
  return !!await db.prepare("SELECT 1 AS found FROM humile_blocks WHERE (actor_id=? AND target_id=?) OR (actor_id=? AND target_id=?)")
    .bind(a, b, b, a).first();
}
async function friend(db, a, b) {
  const sorted = pair(a, b);
  return await db.prepare("SELECT * FROM humile_friendships WHERE user_a=? AND user_b=?")
    .bind(sorted[0], sorted[1]).first();
}
async function requireFriend(db, a, b) {
  if (a === b || await blocked(db, a, b) || (await friend(db, a, b))?.status !== "accepted")
    fail(403, "Primero deben ser amigos");
}
async function socialSnapshot(request, env, me) {
  const db = env.DB, id = me.id;
  const relationships = await db.prepare(
    "SELECT f.id,f.status,f.requester_id,a.id AS other_id,a.username AS username, " +
    "CASE WHEN f.status='accepted' THEN n.nickname ELSE NULL END AS nickname " +
    "FROM humile_friendships f JOIN ceibo_accounts a ON a.id=CASE WHEN f.user_a=? THEN f.user_b ELSE f.user_a END " +
    "LEFT JOIN humile_friend_nicknames n ON n.owner_id=? AND n.target_id=a.id " +
    "WHERE f.user_a=? OR f.user_b=? ORDER BY f.created_at DESC LIMIT 250"
  ).bind(id, id, id, id).all();
  const blocks = await db.prepare(
    "SELECT a.id,a.username FROM humile_blocks b JOIN ceibo_accounts a ON a.id=b.target_id WHERE b.actor_id=?"
  ).bind(id).all();
  const favorites = await db.prepare("SELECT target_id FROM humile_favorites WHERE actor_id=?").bind(id).all();
  const chats = await db.prepare(
    "SELECT c.id,c.kind,c.title,c.created_at,0 AS unread," +
    "(SELECT a.username FROM humile_chat_members cm JOIN ceibo_accounts a ON a.id=cm.account_id WHERE cm.chat_id=c.id AND cm.account_id<>? LIMIT 1) AS peer_username " +
    "FROM humile_chats c JOIN humile_chat_members m ON m.chat_id=c.id " +
    "WHERE m.account_id=? ORDER BY c.created_at DESC LIMIT 100"
  ).bind(id, id).all();
  const friends = relationships.results.filter(x => x.status === "accepted");
  const myPresence = await db.prepare("SELECT visibility,custom_status,share_game FROM humile_presence WHERE account_id=?")
    .bind(id).first();
  const mineActivity = await db.prepare(
    "SELECT engine,project FROM humile_game_activity WHERE account_id=? AND expires_at>?")
    .bind(id, NOW()).first();
  const visibleFriends = friends.slice(0, 40);
  const statuses = visibleFriends.length
    ? await db.prepare("SELECT account_id,visibility,custom_status,share_game FROM humile_presence WHERE account_id IN (" +
        visibleFriends.map(() => "?").join(",") + ")").bind(...visibleFriends.map(f => f.other_id)).all()
    : { results: [] };
  const gameRows = visibleFriends.length
    ? await db.prepare("SELECT account_id,engine,project FROM humile_game_activity WHERE expires_at>? AND account_id IN (" +
        visibleFriends.map(() => "?").join(",") + ")").bind(NOW(), ...visibleFriends.map(f => f.other_id)).all()
    : { results: [] };
  const preferences = new Map(statuses.results.map(x => [x.account_id, x]));
  const activities = new Map(gameRows.results.map(x => [x.account_id, { engine: x.engine, project: x.project }]));
  const enriched = await Promise.all(visibleFriends.map(async f => {
    const preference = preferences.get(f.other_id);
    const visibility = preference?.visibility || "online";
    if (visibility === "invisible") return { ...f, online: false, presence: "offline", custom_status: "", activity: null };
    try {
      const room = env.HUB.get(env.HUB.idFromName(f.other_id));
      const res = await room.fetch("https://internal/status");
      const online = !!(await res.json()).online;
      return { ...f, online, presence: online ? visibility : "offline",
        custom_status: online ? (preference?.custom_status || "") : "",
        activity: online && preference?.share_game !== 0 ? (activities.get(f.other_id) || null) : null };
    } catch { return { ...f, online: false, presence: "offline", custom_status: "", activity: null }; }
  }));
  return response(request, env, {
    me: { id, username: me.username, presence: myPresence?.visibility || "online",
      custom_status: myPresence?.custom_status || "", share_game: myPresence?.share_game !== 0,
      activity: mineActivity ? { engine: mineActivity.engine, project: mineActivity.project } : null },
    friends: enriched.concat(friends.slice(40).map(f => ({ ...f, online: false, presence: "offline", custom_status: "", activity: null }))),
    incoming: relationships.results.filter(x => x.status === "pending" && x.requester_id !== id),
    outgoing: relationships.results.filter(x => x.status === "pending" && x.requester_id === id),
    blocked: blocks.results, favorites: favorites.results.map(x => x.target_id), chats: chats.results
  });
}
async function requestFriend(request, env, me) {
  await rate(env.DB, "friend:" + me.id, 40, 3600000);
  const other = await targetByName(env.DB, (await json(request)).username);
  if (other.id === me.id) fail(400, "No podés agregarte a vos mismo");
  if (await blocked(env.DB, me.id, other.id)) fail(403, "Solicitud no permitida");
  const existing = await friend(env.DB, me.id, other.id);
  if (existing) fail(409, "Ya existe una solicitud o amistad");
  const sorted = pair(me.id, other.id);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM humile_friendships WHERE requester_id=? AND status='pending'")
    .bind(me.id).first();
  if (count.n >= 30) fail(429, "Tenés demasiadas solicitudes pendientes");
  try {
    await env.DB.prepare("INSERT INTO humile_friendships(id,user_a,user_b,requester_id,status,created_at) VALUES(?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), sorted[0], sorted[1], me.id, "pending", ISO()).run();
  } catch (e) { if (String(e).includes("UNIQUE")) fail(409, "Ya existe una solicitud"); throw e; }
  await notify(env, other.id, { type: "social:update" });
  return response(request, env, { ok: true }, 201);
}
async function answerFriend(request, env, me) {
  const body = await json(request);
  if (!ID.test(body.id || "") || !["accept", "reject", "cancel"].includes(body.action))
    fail(400, "Operación inválida");
  const db = env.DB, record = await db.prepare("SELECT * FROM humile_friendships WHERE id=? AND status='pending'").bind(body.id).first();
  if (!record) fail(404, "Solicitud no encontrada");
  const recipient = record.user_a === record.requester_id ? record.user_b : record.user_a;
  if (body.action === "cancel" ? record.requester_id !== me.id : recipient !== me.id) fail(403, "No tenés permisos");
  if (body.action === "accept") {
    if (await blocked(db, me.id, record.requester_id)) fail(403, "Usuario bloqueado");
    await db.prepare("UPDATE humile_friendships SET status='accepted',accepted_at=? WHERE id=? AND status='pending'")
      .bind(ISO(), record.id).run();
  } else {
    await db.prepare("DELETE FROM humile_friendships WHERE id=? AND status='pending'").bind(record.id).run();
  }
  await notify(env, record.requester_id, { type: "social:update" });
  await notify(env, recipient, { type: "social:update" });
  return response(request, env, { ok: true });
}
async function setFriendNickname(request, env, me, targetId, remove) {
  if (!ID.test(targetId) || targetId === me.id) fail(400, "Amigo inválido");
  await requireFriend(env.DB, me.id, targetId);
  await rate(env.DB, "friendnick:" + me.id, 60, 3600000);
  if (remove) {
    await env.DB.prepare("DELETE FROM humile_friend_nicknames WHERE owner_id=? AND target_id=?")
      .bind(me.id, targetId).run();
    return response(request, env, { nickname: "" });
  }
  const body = await json(request);
  if (!validFriendNickname(body.nickname)) fail(400, "Apodo inválido (entre 1 y 40 caracteres)");
  const nickname = body.nickname.trim();
  await env.DB.prepare("INSERT INTO humile_friend_nicknames(owner_id,target_id,nickname,updated_at) VALUES(?,?,?,?) " +
    "ON CONFLICT(owner_id,target_id) DO UPDATE SET nickname=excluded.nickname,updated_at=excluded.updated_at")
    .bind(me.id, targetId, nickname, ISO()).run();
  // Private to the nickname owner: do not broadcast a social update to the target.
  return response(request, env, { nickname });
}
async function changeFriend(request, env, me, targetId, operation) {
  if (!ID.test(targetId) || targetId === me.id) fail(400, "Usuario inválido");
  const db = env.DB, sorted = pair(me.id, targetId);
  if (operation === "remove") {
    await db.batch([
      db.prepare("DELETE FROM humile_friendships WHERE user_a=? AND user_b=? AND status='accepted'")
        .bind(sorted[0], sorted[1]),
      db.prepare("DELETE FROM humile_friend_nicknames WHERE (owner_id=? AND target_id=?) OR (owner_id=? AND target_id=?)")
        .bind(me.id, targetId, targetId, me.id)
    ]);
  } else if (operation === "block") {
    const other = await db.prepare("SELECT id FROM ceibo_accounts WHERE id=?").bind(targetId).first();
    if (!other) fail(404, "Usuario no encontrado");
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO humile_blocks(actor_id,target_id,created_at) VALUES(?,?,?)").bind(me.id, targetId, ISO()),
      db.prepare("DELETE FROM humile_friendships WHERE user_a=? AND user_b=?").bind(sorted[0], sorted[1]),
      db.prepare("DELETE FROM humile_favorites WHERE actor_id=? AND target_id=?").bind(me.id, targetId),
      db.prepare("DELETE FROM humile_friend_nicknames WHERE (owner_id=? AND target_id=?) OR (owner_id=? AND target_id=?)")
        .bind(me.id, targetId, targetId, me.id)
    ]);
  } else if (operation === "unblock") {
    await db.prepare("DELETE FROM humile_blocks WHERE actor_id=? AND target_id=?").bind(me.id, targetId).run();
  } else fail(400, "Operación inválida");
  await notify(env, targetId, { type: "social:update" });
  return response(request, env, { ok: true });
}
async function notifyFriends(env, accountId) {
  const contacts = await env.DB.prepare(
    "SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END AS peer FROM humile_friendships " +
    "WHERE status='accepted' AND (user_a=? OR user_b=?) LIMIT 250"
  ).bind(accountId, accountId, accountId).all();
  await Promise.all(contacts.results.map(x => notify(env, x.peer, { type: "social:update" })));
}
async function setPresence(request, env, me) {
  const body = await json(request);
  const old = await env.DB.prepare("SELECT visibility,custom_status,share_game FROM humile_presence WHERE account_id=?")
    .bind(me.id).first();
  const visibility = body.visibility === undefined ? (old?.visibility || "online") : body.visibility;
  const custom = body.custom_status === undefined ? (old?.custom_status || "") : body.custom_status;
  const shareGame = body.share_game === undefined ? old?.share_game !== 0 : body.share_game;
  if (!["online", "away", "busy", "invisible"].includes(visibility)) fail(400, "Estado inválido");
  if (!validCustomStatus(custom)) fail(400, "Estado personalizado inválido (máximo 80 caracteres)");
  if (typeof shareGame !== "boolean") fail(400, "Privacidad de actividad inválida");
  await rate(env.DB, "presence:" + me.id, 80, 3600000);
  await env.DB.prepare("INSERT INTO humile_presence(account_id,visibility,custom_status,share_game,updated_at) VALUES(?,?,?,?,?) " +
    "ON CONFLICT(account_id) DO UPDATE SET visibility=excluded.visibility,custom_status=excluded.custom_status, " +
    "share_game=excluded.share_game,updated_at=excluded.updated_at")
    .bind(me.id, visibility, custom.trim(), shareGame ? 1 : 0, ISO()).run();
  if (!shareGame) await env.DB.prepare("DELETE FROM humile_game_activity WHERE account_id=?").bind(me.id).run();
  await notifyFriends(env, me.id);
  return response(request, env, { visibility, custom_status: custom.trim(), share_game: shareGame });
}
async function setActivity(request, env, me) {
  const body = await json(request);
  if (body.engine !== null && !["java", "rust"].includes(body.engine))
    fail(400, "Solo se acepta Minecraft Java o Minecraft Rust Edition");
  if (body.engine !== null && !validGameProject(body.project ?? ""))
    fail(400, "Nombre de proyecto inválido");
  await rate(env.DB, "activity:" + me.id, 120, 3600000);
  const old = await env.DB.prepare("SELECT engine,project FROM humile_game_activity WHERE account_id=? AND expires_at>?")
    .bind(me.id, NOW()).first();
  const allowed = await env.DB.prepare("SELECT share_game FROM humile_presence WHERE account_id=?").bind(me.id).first();
  if (body.engine === null || allowed?.share_game === 0) {
    await env.DB.prepare("DELETE FROM humile_game_activity WHERE account_id=?").bind(me.id).run();
    if (old) await notifyFriends(env, me.id);
    return response(request, env, { activity: null });
  }
  const project = (body.project || "").trim();
  await env.DB.prepare("INSERT INTO humile_game_activity(account_id,engine,project,expires_at,updated_at) VALUES(?,?,?,?,?) " +
    "ON CONFLICT(account_id) DO UPDATE SET engine=excluded.engine,project=excluded.project," +
    "expires_at=excluded.expires_at,updated_at=excluded.updated_at")
    .bind(me.id, body.engine, project, NOW() + GAME_TTL_MS, ISO()).run();
  if (!old || old.engine !== body.engine || old.project !== project) await notifyFriends(env, me.id);
  return response(request, env, { activity: { engine: body.engine, project }, expires_in: GAME_TTL_MS / 1000 });
}
async function setFavorite(request, env, me, targetId, add) {
  if (!ID.test(targetId)) fail(400, "Usuario inválido");
  if (add) {
    await requireFriend(env.DB, me.id, targetId);
    await env.DB.prepare("INSERT OR IGNORE INTO humile_favorites(actor_id,target_id) VALUES(?,?)")
      .bind(me.id, targetId).run();
  } else {
    await env.DB.prepare("DELETE FROM humile_favorites WHERE actor_id=? AND target_id=?")
      .bind(me.id, targetId).run();
  }
  return response(request, env, { ok: true });
}
async function createDirect(request, env, me) {
  const other = await targetByName(env.DB, (await json(request)).username);
  await requireFriend(env.DB, me.id, other.id);
  const sorted = pair(me.id, other.id), key = "dm:" + sorted.join(":");
  const id = crypto.randomUUID(), time = ISO();
  const db = env.DB;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO humile_chats(id,kind,pair_key,created_at) VALUES(?,'direct',?,?)").bind(id, key, time)
  ]);
  const chat = await db.prepare("SELECT id FROM humile_chats WHERE pair_key=?").bind(key).first();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO humile_chat_members(chat_id,account_id,joined_at) VALUES(?,?,?)").bind(chat.id, me.id, time),
    db.prepare("INSERT OR IGNORE INTO humile_chat_members(chat_id,account_id,joined_at) VALUES(?,?,?)").bind(chat.id, other.id, time)
  ]);
  await notify(env, other.id, { type: "social:update" });
  return response(request, env, { id: chat.id });
}
async function createGroup(request, env, me) {
  await rate(env.DB, "groups:" + me.id, 10, 3600000);
  const body = await json(request);
  const title = String(body.title || "").trim();
  if (!title || title.length > 80 || !Array.isArray(body.members) || body.members.length < 1 || body.members.length > 9)
    fail(400, "Grupo inválido (2 a 10 integrantes)");
  const unique = Array.from(new Set(body.members.map(normalizeUsername)));
  if (unique.some(x => !x) || unique.length !== body.members.length) fail(400, "Miembros inválidos");
  const members = [];
  for (const username of unique) {
    const other = await targetByName(env.DB, username);
    await requireFriend(env.DB, me.id, other.id);
    members.push(other.id);
  }
  const id = crypto.randomUUID(), time = ISO(), db = env.DB;
  await db.batch([
    db.prepare("INSERT INTO humile_chats(id,kind,title,owner_id,created_at) VALUES(?,'group',?,?,?)").bind(id, title, me.id, time),
    ...[me.id, ...members].map(userId => db.prepare("INSERT INTO humile_chat_members(chat_id,account_id,joined_at) VALUES(?,?,?)").bind(id, userId, time))
  ]);
  await Promise.all(members.map(other => notify(env, other, { type: "social:update" })));
  return response(request, env, { id }, 201);
}
async function leaveGroup(request, env, me, chatId) {
  const group = await chatAccess(env.DB, me, chatId);
  if (group.kind !== "group") fail(400, "Solo se puede abandonar un grupo");
  const db = env.DB;
  const members = await db.prepare("SELECT account_id FROM humile_chat_members WHERE chat_id=? AND account_id<>?")
    .bind(chatId, me.id).all();
  await db.batch([
    db.prepare("UPDATE humile_chats SET owner_id=(" +
      "SELECT account_id FROM humile_chat_members WHERE chat_id=? AND account_id<>? " +
      "ORDER BY joined_at,account_id LIMIT 1) WHERE id=? AND owner_id=?")
      .bind(chatId, me.id, chatId, me.id),
    db.prepare("DELETE FROM humile_chat_members WHERE chat_id=? AND account_id=?")
      .bind(chatId, me.id),
    db.prepare("DELETE FROM humile_chats WHERE id=? AND NOT EXISTS (" +
      "SELECT 1 FROM humile_chat_members WHERE chat_id=?)").bind(chatId, chatId)
  ]);
  await Promise.all(members.results.map(row => notify(env, row.account_id, { type: "social:update" })));
  return response(request, env, { ok: true });
}
async function chatAccess(db, me, id, writing = false) {
  if (!ID.test(id)) fail(404, "Chat no encontrado");
  const chat = await db.prepare(
    "SELECT c.* FROM humile_chats c JOIN humile_chat_members m ON m.chat_id=c.id WHERE c.id=? AND m.account_id=?"
  ).bind(id, me.id).first();
  if (!chat) fail(404, "Chat no encontrado");
  if (chat.kind === "direct") {
    const peer = await db.prepare("SELECT account_id FROM humile_chat_members WHERE chat_id=? AND account_id<>?")
      .bind(id, me.id).first();
    if (!peer || await blocked(db, me.id, peer.account_id)) fail(403, "Conversación bloqueada");
    if (writing) await requireFriend(db, me.id, peer.account_id);
  }
  return chat;
}
// No message bodies or history are stored in D1. Messages are relayed only
// to authenticated, currently connected member sockets.
async function messages(request, env, me, chatId) {
  await chatAccess(env.DB, me, chatId);
  return response(request, env, { messages: [], before: null, storage: "device-only" });
}
async function relayToOnline(env, accountId, payload) {
  try {
    const room = env.HUB.get(env.HUB.idFromName(accountId));
    const result = await room.fetch("https://internal/publish", {
      method: "POST", body: JSON.stringify(payload)
    });
    if (!result.ok) return 0;
    const receipt = await result.json();
    return Number.isSafeInteger(receipt.delivered) ? receipt.delivered : 0;
  } catch { return 0; }
}
async function sendMessage(request, env, me, chatId) {
  await rate(env.DB, "messages:" + me.id, 300, 3600000);
  const chat = await chatAccess(env.DB, me, chatId, true), input = await json(request);
  if (!validMessage(input.body)) fail(400, "Mensaje demasiado largo para el log local de 2 KB");
  const id = crypto.randomUUID(), time = ISO(), content = input.body.trim();
  const members = await env.DB.prepare("SELECT account_id FROM humile_chat_members WHERE chat_id=? AND account_id<>?")
    .bind(chatId, me.id).all();
  const payload = {
    type: "chat:message", chat_id: chatId, id, sender_id: me.id,
    sender: me.username, body: content, created_at: time
  };
  const results = await Promise.all(members.results.map(x => relayToOnline(env, x.account_id, payload)));
  const online = results.filter(x => x > 0).length;
  if (!online) fail(409, "Sin destinatarios conectados: el chat local no tiene bandeja de mensajes offline");
  return response(request, env, {
    id, chat_id: chat.id, sender_id: me.id, sender: me.username,
    body: content, created_at: time, delivered_to: online, storage: "device-only"
  }, 201);
}
async function markRead(request, env, me, chatId) {
  await chatAccess(env.DB, me, chatId);
  return response(request, env, { ok: true, storage: "device-only" });
}
async function ticket(request, env, me) {
  const value = randomHex(), hash = await digest(value);
  await env.DB.prepare("INSERT INTO humile_ws_tickets(token_hash,account_id,expires_at) VALUES(?,?,?)")
    .bind(hash, me.id, NOW() + 30000).run();
  return response(request, env, { ticket: value, expires_in: 30 });
}
async function connectSocket(request, env) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") fail(426, "WebSocket requerido");
  const ticket = new URL(request.url).searchParams.get("ticket") || "";
  if (!/^[0-9a-f]{64}$/i.test(ticket)) fail(401, "Ticket inválido");
  const hash = await digest(ticket);
  const row = await env.DB.prepare("DELETE FROM humile_ws_tickets WHERE token_hash=? AND expires_at>? RETURNING account_id")
    .bind(hash, NOW()).first();
  if (!row) fail(401, "Ticket vencido o utilizado");
  return env.HUB.get(env.HUB.idFromName(row.account_id)).fetch("https://internal/join", {
    headers: { Upgrade: "websocket" }
  });
}
export class SocialHub {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/status") return Response.json({ online: this.state.getWebSockets().length > 0 });
    if (url.pathname === "/publish" && request.method === "POST") {
      const event = await request.text();
      if (event.length > 4096) return new Response("Too large", { status: 413 });
      for (const socket of this.state.getWebSockets()) {
        try { socket.send(event); } catch { /* Peer disconnected */ }
      }
      return Response.json({ ok: true, delivered: this.state.getWebSockets().length });
    }
    if (url.pathname === "/join" && request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "ready" }));
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Not found", { status: 404 });
  }
  webSocketMessage(socket, message) {
    if (message === "ping") { try { socket.send("pong"); } catch {} }
  }
  webSocketClose(socket) { try { socket.close(1000, "Bye"); } catch {} }
}
export default {
  async fetch(request, env) {
    try {
      if (!env.DB || !env.HUB) fail(503, "VIS Social no está configurado");
      const origin = request.headers.get("Origin");
      if (!isAllowedOrigin(origin, env.ALLOWED_ORIGINS)) fail(403, "Origen no autorizado");
      const url = new URL(request.url), path = url.pathname, method = request.method;
      if (method === "OPTIONS") return response(request, env, { ok: true });
      if (path === "/health" && method === "GET") return response(request, env, { service: "vis-social", status: "ok" });
      if (path === "/v1/auth/register" && method === "POST") return await register(request, env);
      if (path === "/v1/auth/login" && method === "POST") return await login(request, env);
      if (path === "/v1/rt" && method === "GET") return await connectSocket(request, env);
      const me = await bearer(request, env.DB);
      if (path === "/v1/auth/logout" && method === "POST") {
        const token = request.headers.get("Authorization").slice(7);
        await env.DB.prepare("UPDATE ceibo_sessions SET revoked_at=? WHERE token_hash=?")
          .bind(NOW(), await digest(token)).run();
        return response(request, env, { ok: true });
      }
      if (path === "/v1/me" && method === "GET") return response(request, env, { id: me.id, username: me.username });
      if (path === "/v1/social" && method === "GET") return await socialSnapshot(request, env, me);
      if (path === "/v1/presence" && method === "POST") return await setPresence(request, env, me);
      if (path === "/v1/activity" && method === "POST") return await setActivity(request, env, me);
      const favorites = /^\/v1\/favorites\/([a-f0-9-]{36})$/i.exec(path);
      if (favorites && ["POST", "DELETE"].includes(method))
        return await setFavorite(request, env, me, favorites[1], method === "POST");
      if (path === "/v1/users" && method === "GET") {
        const q = normalizeUsername(url.searchParams.get("q"));
        if (!q) fail(400, "Búsqueda inválida");
        const rows = await env.DB.prepare("SELECT id,username FROM ceibo_accounts WHERE username LIKE ? AND id<>? AND disabled_at IS NULL LIMIT 20")
          .bind(q + "%", me.id).all();
        return response(request, env, { users: rows.results });
      }
      if (path === "/v1/friends/requests" && method === "POST") return await requestFriend(request, env, me);
      if (path === "/v1/friends/answer" && method === "POST") return await answerFriend(request, env, me);
      const nicknameRoute = /^\/v1\/friends\/([a-f0-9-]{36})\/nickname$/i.exec(path);
      if (nicknameRoute && ["PUT", "DELETE"].includes(method))
        return await setFriendNickname(request, env, me, nicknameRoute[1], method === "DELETE");
      const relationship = /^\/v1\/friends\/([a-f0-9-]{36})$/i.exec(path);
      if (relationship && method === "DELETE") return await changeFriend(request, env, me, relationship[1], "remove");
      const blocks = /^\/v1\/blocks\/([a-f0-9-]{36})$/i.exec(path);
      if (blocks && method === "POST") return await changeFriend(request, env, me, blocks[1], "block");
      if (blocks && method === "DELETE") return await changeFriend(request, env, me, blocks[1], "unblock");
      if (path === "/v1/chats/direct" && method === "POST") return await createDirect(request, env, me);
      if (path === "/v1/chats/groups" && method === "POST") return await createGroup(request, env, me);
      if (path === "/v1/rt/ticket" && method === "POST") return await ticket(request, env, me);
      const groupLeave = /^\/v1\/chats\/([a-f0-9-]{36})\/leave$/i.exec(path);
      if (groupLeave && method === "POST") return await leaveGroup(request, env, me, groupLeave[1]);
      const chat = /^\/v1\/chats\/([a-f0-9-]{36})\/(messages|read)$/i.exec(path);
      if (chat && chat[2] === "messages" && method === "GET") return await messages(request, env, me, chat[1]);
      if (chat && chat[2] === "messages" && method === "POST") return await sendMessage(request, env, me, chat[1]);
      if (chat && chat[2] === "read" && method === "POST") return await markRead(request, env, me, chat[1]);
      fail(404, "Ruta no encontrada");
    } catch (err) {
      if (!(err instanceof ApiError)) console.error("VIS Social request failed", String(err));
      return response(request, env, { error: err instanceof ApiError ? err.message : "Error interno" }, err instanceof ApiError ? err.status : 500);
    }
  },
  // Daily, bounded cleanup for authentication metadata only. User messages
  // need an explicit retention/export policy before we automate deletion.
  async scheduled(_event, env, ctx) {
    if (!env.DB) return;
    ctx.waitUntil((async () => {
      const now = NOW();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM ceibo_sessions WHERE expires_at<? OR revoked_at IS NOT NULL").bind(now),
        env.DB.prepare("DELETE FROM humile_ws_tickets WHERE expires_at<?").bind(now),
        env.DB.prepare("DELETE FROM ceibo_auth_attempts WHERE reset_at<?").bind(now),
        env.DB.prepare("DELETE FROM humile_game_activity WHERE expires_at<?").bind(now)
      ]);
    })());
  }
};
