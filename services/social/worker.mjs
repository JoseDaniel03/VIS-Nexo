// VIS Social, authenticated Cloudflare Worker. The launcher PIN never leaves the PC.
// Ed25519 proof-of-possession authenticates a local device. D1 stores only hashes of
// temporary bearer sessions and opaque ECDH/AES-GCM encrypted message envelopes.
const te = new TextEncoder();
const USERNAME = /^[a-z0-9_]{3,24}$/;
const MAX_BODY = 8192;
const MAX_MESSAGE_BYTES = 2048;
const HOUR = 3600;
const PASSWORD_ARGON2_PASSES = 2;
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
function unbase64(value, size, maxEncodedLength = 512) {
  if (typeof value !== "string" || value.length > maxEncodedLength || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) bad(400, "Invalid encoded key");
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
async function parseBody(request, maxSize = MAX_BODY) {
  if (Number(request.headers.get("content-length") || 0) > maxSize) bad(413, "Request too large");
  const reader = request.body?.getReader();
  if (!reader) bad(400, "JSON body required");
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxSize) { await reader.cancel(); bad(413, "Request too large"); }
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
    "SELECT u.id,u.username,u.public_handle,u.public_handle_updated_at,u.display_name,u.public_id,u.avatar_version,u.skin_version,u.presence,u.custom_status,u.current_game,u.encryption_public_key,u.role,u.disabled_at, " +
    "CASE WHEN u.password_hash!=\'\' THEN 1 ELSE 0 END AS cloud_login_enabled " +
    "FROM auth_sessions s JOIN social_users u ON u.id=s.user_id " +
    "WHERE s.token_hash=? AND s.expires_at>?"
  ).bind(tokenHash, now()).first();
  if (!user) bad(401, "Session expired");
  if (user.disabled_at !== null && user.disabled_at !== undefined) bad(403, "Account disabled");
  return { ...user, tokenHash };
}
async function register(request, db) {
  const body = await parseBody(request);
  const username = normalName(body.username);
  if (!await verifySignature(body.public_key, body.signature,
    "VIS-SOCIAL-REGISTER-V1\n" + username)) bad(401, "Invalid device signature");
  const current = await db.prepare("SELECT username,signing_public_key,disabled_at FROM social_users WHERE username=?").bind(username).first();
  if (current) {
    if (current.disabled_at !== null && current.disabled_at !== undefined) bad(403, "Account disabled");
    if (current.signing_public_key !== body.public_key) bad(409, "Username already registered on another device");
    return reply({ ok: true, username, existing: true });
  }
  await rateLimit(db, request, "register", 8);
  const historicallyClaimed=await db.prepare(
    "SELECT user_id FROM public_handle_history WHERE handle=?"
  ).bind(username).first();
  if(historicallyClaimed)bad(409,"Este usuario está reservado por una identidad VIS");
  const takenHandle=await db.prepare(
    "SELECT id FROM social_users WHERE public_handle=?"
  ).bind(username).first();
  if(takenHandle)bad(409,"Este usuario público ya está ocupado");
  const id = crypto.randomUUID();
  try {
    await db.prepare(
      "INSERT INTO social_users (id,username,public_id,display_name,signing_public_key) VALUES (?,?,?,?,?)"
    ).bind(id, username, randomToken().slice(0,24), username, body.public_key).run();
  } catch {
    bad(409, "Username already registered");
  }
  return reply({ ok: true, username, existing: false }, 201);
}
async function challenge(request, db) {
  await rateLimit(db, request, "challenge", 25);
  const { username: name } = await parseBody(request);
  const username = normalName(name);
  const user = await db.prepare("SELECT id FROM social_users WHERE username=? AND disabled_at IS NULL").bind(username).first();
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
    "WHERE c.id=? AND u.username=? AND u.disabled_at IS NULL AND c.expires_at>?"
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
// The Rust client derives an Ed25519 credential from the account password
// using Argon2id (19 MiB, t=2). The password/seed never leaves the launcher.
// Workers Free has a 10-ms CPU limit, so the Worker verifies signatures only.
function cloudVerifier(body, username) {
  const salt = body.password_salt, pub = body.password_public_key;
  try {unbase64(salt, 16);}catch {bad(400,"Invalid cloud salt");}
  try {unbase64(pub, 32);}catch {bad(400,"Invalid cloud public verifier");}
  return { salt, pub, text: "VIS-CLOUD-REGISTER-V2\n"+username+"\n"+salt };
}
async function startCloudSession(db, user) {
  const token = randomToken();
  const expiresAt = now() + 12 * HOUR;
  await db.prepare("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)")
    .bind(await hash(token), user.id, expiresAt).run();
  return reply({ok:true,token,expires_at:expiresAt,username:user.username,
    public_id:user.public_id});
}
async function cloudRegister(request, db) {
  await rateLimit(db,request,"cloud-register",5);
  const body=await parseBody(request);
  const username=normalName(body.username);
  const { salt, pub, text }=cloudVerifier(body,username);
  let valid=false;
  try { valid=await verifySignature(pub,body.registration_signature,text); }
  catch { bad(400,"Invalid cloud registration signature"); }
  if (!valid) bad(401,"Invalid password credential proof");
  const existing=await db.prepare("SELECT id FROM social_users WHERE username=?")
    .bind(username).first();
  if (existing) bad(409,"Username already taken; sign in or migrate existing device account");
  const reserved=await db.prepare("SELECT user_id FROM public_handle_history WHERE handle=?")
    .bind(username).first();
  const assigned=await db.prepare("SELECT id FROM social_users WHERE public_handle=?")
    .bind(username).first();
  if(reserved||assigned)bad(409,"Este nombre ya pertenece a una identidad VIS");
  const publicId=crypto.randomUUID().replaceAll("-","").slice(0,24);
  const id=crypto.randomUUID();
  try {
    await db.prepare(
      "INSERT INTO social_users(id,username,public_id,display_name,"+
      "password_hash,password_salt,password_iterations) VALUES (?,?,?,?,?,?,?)"
    ).bind(id,username,publicId,username,"ed25519:"+pub,salt,PASSWORD_ARGON2_PASSES).run();
  } catch {bad(409,"Username already taken");}
  return startCloudSession(db,{id,username,public_id:publicId});
}
async function cloudChallenge(request, db) {
  await rateLimit(db,request,"cloud-login-challenge",20);
  const body=await parseBody(request);
  const identifier=typeof body.identifier==="string"?body.identifier.trim().toLowerCase():"";
  if(!/^[a-z0-9_]{3,24}$/.test(identifier))
    bad(401,"Invalid username/ID or password");
  await rateLimit(db,request,"cloud-identifier:"+identifier,9);
  const user=await db.prepare(
    "SELECT id,username,public_id,password_hash,password_salt,password_iterations "+
    "FROM social_users WHERE (username=? OR public_id=? OR public_handle=?) AND disabled_at IS NULL"
  ).bind(identifier,identifier,identifier).first();
  if(!user || !user.password_hash?.startsWith("ed25519:") ||
     user.password_iterations!==PASSWORD_ARGON2_PASSES)
    bad(401,"Invalid username/ID or password");
  const id=crypto.randomUUID(),nonce=randomToken();
  await db.prepare(
    "INSERT INTO auth_challenges(id,user_id,nonce,expires_at) VALUES (?,?,?,?)"
  ).bind(id,user.id,nonce,now()+120).run();
  return reply({challenge_id:id,nonce,username:user.username,
    salt:user.password_salt,kdf:"argon2id-19m-t2",expires_in:120});
}
async function cloudVerify(request, db) {
  await rateLimit(db,request,"cloud-login-verify",15);
  const body=await parseBody(request);
  const identifier=typeof body.identifier==="string"?body.identifier.trim().toLowerCase():"";
  if(!/^[a-z0-9_]{3,24}$/.test(identifier) ||
     typeof body.challenge_id!=="string" || body.challenge_id.length>80)
    bad(401,"Invalid username/ID or password");
  const row=await db.prepare(
    "SELECT c.id,c.nonce,u.id AS user_id,u.username,u.public_id,u.password_hash "+
    "FROM auth_challenges c JOIN social_users u ON u.id=c.user_id "+
    "WHERE c.id=? AND (u.username=? OR u.public_id=? OR u.public_handle=?) "+
    "AND u.disabled_at IS NULL AND c.expires_at>?"
  ).bind(body.challenge_id,identifier,identifier,identifier,now()).first();
  if(!row || !row.password_hash?.startsWith("ed25519:"))
    bad(401,"Invalid username/ID or password");
  const proof="VIS-CLOUD-AUTH-V2\n"+row.username+"\n"+row.id+"\n"+row.nonce;
  if(!await verifySignature(row.password_hash.slice(8),body.signature,proof))
    bad(401,"Invalid username/ID or password");
  const claimed=await db.prepare(
    "DELETE FROM auth_challenges WHERE id=? AND user_id=? AND expires_at>?"
  ).bind(row.id,row.user_id,now()).run();
  if(claimed.meta?.changes!==1)bad(401,"Challenge already used");
  return startCloudSession(db,{id:row.user_id,username:row.username,public_id:row.public_id});
}
async function upgradeCloudLogin(request, db, user) {
  await rateLimit(db,request,"cloud-upgrade:"+user.id,3);
  const body=await parseBody(request);
  const { salt,pub,text }=cloudVerifier(body,user.username);
  if(!await verifySignature(pub,body.registration_signature,text))
    bad(401,"Invalid credential proof");
  const changed=await db.prepare(
    "UPDATE social_users SET password_hash=?,password_salt=?,password_iterations=?,"+
    "updated_at=unixepoch() WHERE id=? AND password_hash=''"
  ).bind("ed25519:"+pub,salt,PASSWORD_ARGON2_PASSES,user.id).run();
  if(changed.meta?.changes!==1)bad(409,"Online password already configured");
  return reply({ok:true,public_id:user.public_id});
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
// A one-use WebSocket ticket (20s) only allows read-only wakeups; the actual
// authenticated VIS Social bearer remains private in native Rust.
const REALTIME_TICKET_SECONDS=20;
const REALTIME_SOCKET_LIFETIME_MS=15*60*1000;
const ALLOWED_WS_ORIGINS=new Set([
  "tauri://localhost","http://tauri.localhost","https://tauri.localhost",
  "http://127.0.0.1:1420","http://localhost:1420"
]);
async function createRealtimeTicket(request,db,user,env){
  if(!env.REALTIME)bad(503,"Notificaciones en tiempo real no disponibles");
  await rateLimit(db,request,"realtime-ticket:"+user.id,30);
  const ticket=randomToken();
  await db.prepare("INSERT INTO realtime_tickets(token_hash,user_id,expires_at) VALUES (?,?,?)")
    .bind(await hash(ticket),user.id,now()+REALTIME_TICKET_SECONDS).run();
  return reply({ticket,expires_in:REALTIME_TICKET_SECONDS});
}
async function consumeRealtimeTicket(request,db,env){
  if(!env.REALTIME)bad(503,"Notificaciones en tiempo real no disponibles");
  if(request.headers.get("Upgrade")?.toLowerCase()!=="websocket")
    bad(400,"WebSocket upgrade required");
  const origin=request.headers.get("Origin");
  if(!origin||!ALLOWED_WS_ORIGINS.has(origin))
    bad(403,"Only the VIS Nexo desktop client may open realtime notifications");
  const url=new URL(request.url),ticket=url.searchParams.get("ticket");
  if(!ticket||!(/^[A-Za-z0-9_-]{43}$/.test(ticket))||url.searchParams.size!==1)
    bad(401,"Invalid or expired notification ticket");
  const row=await db.prepare(
    "DELETE FROM realtime_tickets WHERE token_hash=? AND expires_at>? RETURNING user_id"
  ).bind(await hash(ticket),now()).first();
  if(!row)bad(401,"Invalid or expired notification ticket");
  return env.REALTIME.get(env.REALTIME.idFromName(row.user_id)).fetch(
    "https://vis-realtime.internal/_vis/subscribe",{method:"GET",headers:{Upgrade:"websocket"}});
}
async function revokeRealtime(env,userId){
  if(!env.REALTIME||!userId)return;
  // Unlike best-effort wakeups, revocation is a security boundary: wait for
  // the Durable Object before reporting logout or disable as completed.
  await env.REALTIME.get(env.REALTIME.idFromName(userId))
    .fetch("https://vis-realtime.internal/_vis/revoke",{method:"POST"}).catch(()=>{});
}
async function notifyUser(env,ctx,userId){
  if(!env.REALTIME||!userId)return;
  const stub=env.REALTIME.get(env.REALTIME.idFromName(userId));
  const task=stub.fetch("https://vis-realtime.internal/_vis/notify",{method:"POST"}).catch(()=>{});
  if(ctx?.waitUntil)ctx.waitUntil(task);
  else await task;
}
export class VisRealtimeRoom {
  constructor(ctx){this.ctx=ctx;}
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path==="/_vis/notify"&&request.method==="POST"){
      for(const ws of this.ctx.getWebSockets()){
        try{
          const lease=ws.deserializeAttachment();
          if(!lease||lease.expiresAt<=Date.now()){
            ws.close(1008,"Connection authorization expired");
            continue;
          }
          ws.send('{"type":"wakeup"}');
        }catch{try{ws.close(1011,"Delivery failed");}catch{}}
      }
      return new Response(null,{status:204});
    }
    if(path==="/_vis/revoke"&&request.method==="POST"){
      for(const ws of this.ctx.getWebSockets()){
        try{ws.close(1008,"Account session revoked");}catch{}
      }
      return new Response(null,{status:204});
    }
    if(path!=="/_vis/subscribe"||request.headers.get("Upgrade")?.toLowerCase()!=="websocket")
      return reply({error:"Not found"},404);
    if(this.ctx.getWebSockets().length>=6)return reply({error:"Too many active devices"},429);
    const pair=new WebSocketPair(),client=pair[0],server=pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({expiresAt:Date.now()+REALTIME_SOCKET_LIFETIME_MS});
    server.send('{"type":"ready"}');
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws,message){
    if(message==="ping"){ws.send("pong");return;}
    try{ws.close(1008,"Notifications only");}catch{}
  }
  webSocketClose(ws,code,reason){try{ws.close(code||1000,reason||"Closed");}catch{}}
}
async function currentState(db, user) {
  const friends = await db.prepare(
    "SELECT u.id,u.username,u.public_handle,u.display_name,u.presence,u.custom_status,u.current_game,u.encryption_public_key,u.avatar_version,u.skin_version,u.last_seen_at," +
    "a.alias FROM social_users u LEFT JOIN friend_aliases a ON a.owner_id=? AND a.friend_id=u.id " +
    "WHERE u.id IN (SELECT user_b FROM friendships WHERE user_a=? UNION " +
    "SELECT user_a FROM friendships WHERE user_b=?) ORDER BY u.username LIMIT 500"
  ).bind(user.id, user.id, user.id).all();
  const visible = (friends.results || []).map(f => ({
    username: f.username, public_handle:f.public_handle||f.username,
    display_name: f.display_name || f.username, alias: f.alias || "", avatar_version:f.avatar_version, skin_version:f.skin_version,
    presence: f.presence !== "invisible" && f.last_seen_at >= now() - 150 ? f.presence : "offline",
    custom_status: f.presence !== "invisible" && f.last_seen_at >= now() - 150 ? f.custom_status : "",
    current_game: f.presence !== "invisible" && f.last_seen_at >= now() - 150 ? f.current_game : "",
    public_key: f.encryption_public_key
  }));
  const incomingRequest = db.prepare(
    "SELECT u.username FROM friend_requests r JOIN social_users u ON u.id=r.sender_id " +
    "WHERE r.recipient_id=? AND r.status='pending' ORDER BY r.created_at DESC LIMIT 100"
  ).bind(user.id).all();
  const outgoingRequest = db.prepare(
    "SELECT u.username FROM friend_requests r JOIN social_users u ON u.id=r.recipient_id " +
    "WHERE r.sender_id=? AND r.status='pending' ORDER BY r.created_at DESC LIMIT 100"
  ).bind(user.id).all();
  const queueRequest = db.prepare(
    "SELECT m.id,u.username AS sender,m.payload,m.created_at,m.client_message_id " +
    "FROM pending_messages m JOIN social_users u ON u.id=m.sender_id " +
    "WHERE m.recipient_id=? AND m.expires_at>? AND m.acknowledged_at IS NULL " +
    "ORDER BY m.created_at ASC LIMIT 100"
  ).bind(user.id, now()).all();
  // Independent D1 reads run concurrently instead of serially waiting for
  // contacts, invitations and the encrypted inbox. No access controls change.
  const developerRequest=canDevelop(db,user);
  const projectsRequest=developerRequest.then(allowed=>getProjects(db,user,allowed));
  const [incoming,outgoing,queue,projects,memberships,developer] = await Promise.all([
    incomingRequest,outgoingRequest,queueRequest,
    projectsRequest,sharedProjectMemberships(db,user),developerRequest
  ]);
  const idsByFriend=new Map();
  const userIds=new Map((friends.results||[]).map(f=>[f.id,f.username]));
  for (const membership of memberships) {
    const username=userIds.get(membership.user_id);
    if (!username) continue;
    if (!idsByFriend.has(username)) idsByFriend.set(username,[]);
    idsByFriend.get(username).push(membership.project_id);
  }
  for (const friend of visible) friend.shared_projects=idsByFriend.get(friend.username)||[];
  return reply({
    projects,
    username: user.username, public_handle:user.public_handle||user.username,
    public_handle_updated_at:user.public_handle_updated_at||0,
    display_name: user.display_name || user.username,
    public_id: user.public_id, avatar_version:user.avatar_version, skin_version:user.skin_version,
    cloud_login_enabled: !!user.cloud_login_enabled,
    developer, presence: user.presence, role: user.role,
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
  const user = await db.prepare("SELECT id,username FROM social_users WHERE " +
    "(username=? OR public_id=? OR public_handle=? OR " +
    "id=(SELECT user_id FROM public_handle_history WHERE handle=?)) " +
    "AND disabled_at IS NULL ORDER BY CASE WHEN username=? THEN 0 ELSE 1 END LIMIT 1").bind(...Array(5).fill(normalName(username))).first();
  if (!user) bad(404, "Account not found");
  return user;
}
async function friendRequest(request, db, user, env, ctx) {
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
  await notifyUser(env,ctx,peer.id);
  return reply({ ok: true, to: peer.username }, 201);
}
async function friendAccept(request, db, user, env, ctx) {
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
  await notifyUser(env,ctx,peer.id);
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
async function sendMessage(request, db, user, env, ctx) {
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
  await notifyUser(env,ctx,peer.id);
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

const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{2,47}$/;
function projectId(value) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!PROJECT_ID.test(id)) bad(400, "Invalid project ID");
  return id;
}
function isSuper(user) { return user.role === "super_admin"; }
async function canDevelop(db, user) {
  if (isSuper(user)) return true;
  const grant=await db.prepare("SELECT user_id FROM developer_grants WHERE user_id=?")
    .bind(user.id).first();
  return !!grant;
}
async function requireDeveloper(db,user) {
  if (!await canDevelop(db,user)) bad(403,"Super developer permission required");
}
function requireSuper(user) {
  if (!isSuper(user)) bad(403, "Super administrator permission required");
}
function auditStatement(db, actorId, operation, target) {
  return db.prepare(
    "INSERT INTO admin_audit(id,actor_id,operation,target) VALUES (?,?,?,?)"
  ).bind(crypto.randomUUID(), actorId, operation, target);
}
async function accountInfo(db, user) {
  const row = await db.prepare(
    "SELECT id,username,public_handle,public_handle_updated_at,display_name,public_id,avatar_version,role,signing_public_key,disabled_at,created_at,password_hash FROM social_users WHERE id=?"
  ).bind(user.id).first();
  if (!row || row.disabled_at !== null) bad(403, "Account disabled");
  return reply({ account: {
    username: row.username, public_handle:row.public_handle||row.username,
    public_handle_updated_at:row.public_handle_updated_at||0,
    display_name: row.display_name || row.username,
    public_id: row.public_id, avatar_version:row.avatar_version, role: row.role,
    cloud_login_enabled: !!row.password_hash,
    cloud_credential_public_key: row.password_hash?.startsWith("ed25519:")
      ? row.password_hash.slice(8) : null,
    developer: await canDevelop(db,user),
    signing_public_key: row.signing_public_key, created_at: row.created_at
  } });
}
// Display names are cosmetic only; usernames, public IDs, signing keys and
// friend relationships are immutable and cannot be impersonated by renaming.
async function updateDisplayName(request,db,user){
  await rateLimit(db,request,"display-name:"+user.id,20);
  const payload=await parseBody(request,1024);
  const name=typeof payload.display_name==="string"?payload.display_name.trim():"";
  if(name.length<2||name.length>32||!/^[\p{L}\p{N} ._-]+$/u.test(name)){
    bad(400,"Display name must have 2-32 readable characters");
  }
  await db.prepare("UPDATE social_users SET display_name=?,updated_at=unixepoch() WHERE id=?")
    .bind(name,user.id).run();
  return reply({ok:true,display_name:name});
}
// @handle is a mutable public address, never an authentication principal.
// All friendships, messages, encrypted AAD and moderator grants remain on the
// immutable social_users.id / legacy username. Previously used handles stay
// reserved to their original owner to prevent identity impersonation.
const HANDLE_COOLDOWN=7*24*60*60;
const RESERVED_HANDLES=new Set([
  "admin","administrator","support","staff","system","official","moderator",
  "minecraft","microsoft","mojang","visstudios","vis_studios","visnexo",
  "vis_nexo","visceibo","visportals","visuniverse","virgoland"
]);
async function changePublicHandle(request,db,user){
  await rateLimit(db,request,"public-handle:"+user.id,8);
  const payload=await parseBody(request,512);
  const handle=typeof payload.handle==="string"?payload.handle.trim().toLowerCase():"";
  if(!/^[a-z0-9_]{3,24}$/.test(handle))bad(400,"Usá entre 3 y 24 letras, números o _");
  if(RESERVED_HANDLES.has(handle))bad(409,"Este identificador está reservado");
  const current=await db.prepare(
    "SELECT username,public_handle,public_handle_updated_at FROM social_users WHERE id=? AND disabled_at IS NULL"
  ).bind(user.id).first();
  if(!current)bad(403,"Cuenta inhabilitada");
  if(current.public_handle===handle)
    return reply({ok:true,public_handle:handle,next_change_at:Math.max(0,current.public_handle_updated_at+HANDLE_COOLDOWN)});
  if(current.public_handle_updated_at&&now()-current.public_handle_updated_at<HANDLE_COOLDOWN)
    bad(429,"Podés cambiar tu @usuario una vez cada siete días");
  const other=await db.prepare(
    "SELECT id FROM social_users WHERE id<>? AND (username=? OR public_id=? OR public_handle=?)"
  ).bind(user.id,handle,handle,handle).first();
  if(other)bad(409,"Este identificador pertenece a otra cuenta");
  const used=await db.prepare("SELECT user_id FROM public_handle_history WHERE handle=?")
    .bind(handle).first();
  if(used&&used.user_id!==user.id)bad(409,"Este identificador estuvo registrado por otra cuenta");
  const history=await db.prepare(
    "SELECT count(*) AS n FROM public_handle_history WHERE user_id=?"
  ).bind(user.id).first();
  if(!used&&history.n>=5)bad(429,"Alcanzaste el límite de cinco identificadores históricos");
  // Both statements execute in one D1 transaction. The second statement can
  // update only if the handle was reserved for this same immutable account.
  const results=await db.batch([
    db.prepare(
      "INSERT OR IGNORE INTO public_handle_history(handle,user_id) VALUES (?,?)"
    ).bind(handle,user.id),
    db.prepare(
      "UPDATE social_users SET public_handle=?,public_handle_updated_at=?,updated_at=? "+
      "WHERE id=? AND disabled_at IS NULL "+
      "AND (public_handle_updated_at=0 OR public_handle_updated_at<=?) "+
      "AND EXISTS(SELECT 1 FROM public_handle_history WHERE handle=? AND user_id=?) "+
      "AND NOT EXISTS(SELECT 1 FROM social_users WHERE id<>? AND (username=? OR public_id=? OR public_handle=?))"
    ).bind(handle,now(),now(),user.id,now()-HANDLE_COOLDOWN,
      handle,user.id,user.id,handle,handle,handle)
  ]);
  if(results[1]?.meta?.changes!==1)bad(409,"Identificador ocupado o modificación simultánea; volvé a intentar");
  return reply({ok:true,public_handle:handle,next_change_at:now()+HANDLE_COOLDOWN});
}
async function getProjects(db, user, knownDeveloper=null) {
  const projects = await db.prepare(
    "SELECT p.id,p.title,p.summary,p.visibility,p.updated_at," +
    "CASE WHEN s.user_id IS NULL THEN 0 ELSE 1 END AS subscribed," +
    "COALESCE(st.staff_role,'') AS staff_role " +
    "FROM social_projects p " +
    "LEFT JOIN project_subscriptions s ON s.project_id=p.id AND s.user_id=? " +
    "LEFT JOIN project_staff st ON st.project_id=p.id AND st.user_id=? " +
    "WHERE p.visibility='published' OR (?=1 AND p.visibility!='published') " +
    "OR st.user_id IS NOT NULL " +
    "ORDER BY p.updated_at DESC LIMIT 200"
  ).bind(user.id,user.id,(knownDeveloper??await canDevelop(db,user))?1:0).all();
  return (projects.results || []).map(p=>({
    id:p.id,title:p.title,summary:p.summary,visibility:p.visibility,
    subscribed:!!p.subscribed,staff_role:p.staff_role,updated_at:p.updated_at
  }));
}
async function sharedProjectMemberships(db, user) {
  const rows = await db.prepare(
    "SELECT a.user_id,a.project_id FROM project_subscriptions a " +
    "JOIN project_subscriptions mine ON mine.project_id=a.project_id AND mine.user_id=? " +
    "JOIN social_projects p ON p.id=a.project_id AND p.visibility='published' " +
    "WHERE a.user_id IN (SELECT user_b FROM friendships WHERE user_a=? " +
    "UNION SELECT user_a FROM friendships WHERE user_b=?) LIMIT 1500"
  ).bind(user.id,user.id,user.id).all();
  return rows.results || [];
}
async function projectSubscription(request, db, user, action) {
  await rateLimit(db, request, "project-subscribe:" + user.id, 25);
  const { project_id } = await parseBody(request);
  const id = projectId(project_id);
  const project = await db.prepare(
    "SELECT id FROM social_projects WHERE id=? AND visibility='published'"
  ).bind(id).first();
  if (!project) bad(404, "Published project not found");
  if (action === "subscribe") {
    await db.prepare(
      "INSERT OR IGNORE INTO project_subscriptions(project_id,user_id) VALUES (?,?)"
    ).bind(id,user.id).run();
  } else {
    await db.prepare(
      "DELETE FROM project_subscriptions WHERE project_id=? AND user_id=?"
    ).bind(id,user.id).run();
  }
  return reply({ok:true,project_id:id,subscribed:action==="subscribe"});
}
async function adminProjectUpsert(request, db, user) {
  await requireDeveloper(db,user);
  await rateLimit(db, request, "admin-project:" + user.id, 40);
  const data = await parseBody(request);
  const id=projectId(data.id);
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  const visibility = data.visibility;
  if (title.length < 1 || title.length > 100 || summary.length > 500 ||
      !["draft","published","archived"].includes(visibility)) {
    bad(400,"Invalid project metadata");
  }
  await db.batch([
    db.prepare(
      "INSERT INTO social_projects(id,title,summary,visibility,created_by,updated_by) " +
      "VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET " +
      "title=excluded.title,summary=excluded.summary,visibility=excluded.visibility," +
      "updated_by=excluded.updated_by,updated_at=unixepoch()"
    ).bind(id,title,summary,visibility,user.id,user.id),
    auditStatement(db,user.id,"project.upsert",id)
  ]);
  return reply({ok:true,project_id:id,visibility});
}
async function adminProjectStaff(request, db, user) {
  await requireDeveloper(db,user);
  const data = await parseBody(request);
  const id=projectId(data.project_id);
  const username=normalName(data.username);
  const staffRole=data.staff_role;
  if (!["editor","manager","none"].includes(staffRole)) bad(400,"Invalid staff role");
  const existing=await db.prepare("SELECT id FROM social_projects WHERE id=?").bind(id).first();
  if (!existing) bad(404,"Project not found");
  const peer=await db.prepare(
    "SELECT id FROM social_users WHERE username=? AND disabled_at IS NULL"
  ).bind(username).first();
  if (!peer) bad(404,"Account not found");
  const update=staffRole==="none" ?
    db.prepare("DELETE FROM project_staff WHERE project_id=? AND user_id=?")
      .bind(id,peer.id) :
    db.prepare(
      "INSERT INTO project_staff(project_id,user_id,staff_role,granted_by) VALUES (?,?,?,?) " +
      "ON CONFLICT(project_id,user_id) DO UPDATE SET staff_role=excluded.staff_role," +
      "granted_by=excluded.granted_by,updated_at=unixepoch()"
    ).bind(id,peer.id,staffRole,user.id);
  await db.batch([
    update,auditStatement(db,user.id,"project.staff",id+":"+username+":"+staffRole)
  ]);
  return reply({ok:true,project_id:id,username,staff_role:staffRole});
}
async function adminAccountRole(request, db, user) {
  requireSuper(user);
  await rateLimit(db, request, "admin-account:" + user.id, 15);
  const data=await parseBody(request);
  const username=normalName(data.username);
  const role=data.role;
  // super_admin can ONLY be granted through the protected CI operation.
  if (!["user","moderator","project_manager"].includes(role)) bad(400,"Invalid grant");
  const target=await db.prepare(
    "SELECT id,role FROM social_users WHERE username=? AND disabled_at IS NULL"
  ).bind(username).first();
  if (!target) bad(404,"Active account not found");
  if (target.role==="super_admin") bad(403,"Cannot change super administrator");
  await db.batch([
    db.prepare(
      "UPDATE social_users SET role=?,updated_at=unixepoch() WHERE id=? AND role!='super_admin'"
    ).bind(role,target.id),
    auditStatement(db,user.id,"account.role",username+":"+role)
  ]);
  return reply({ok:true,username,role});
}
async function adminAccountDisable(request, db, user, env, ctx) {
  requireSuper(user);
  await rateLimit(db, request, "admin-account:" + user.id, 15);
  const data=await parseBody(request);
  const username=normalName(data.username);
  const target=await db.prepare("SELECT id,role FROM social_users WHERE username=?").bind(username).first();
  if (!target) bad(404,"Account not found");
  if (target.id===user.id || target.role==="super_admin") bad(403,"Cannot disable super administrator");
  const disabled=!!data.disabled;
  await db.batch([
    db.prepare("UPDATE social_users SET disabled_at=?,updated_at=unixepoch() WHERE id=? AND role!='super_admin'")
      .bind(disabled?now():null,target.id),
    db.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(target.id),
    auditStatement(db,user.id,"account.disabled",username+":"+(disabled?"yes":"no"))
  ]);
  if(disabled)await revokeRealtime(env,target.id);
  return reply({ok:true,username,disabled});
}

// Profile pictures stay on the server while per-project installations stay local.
// Limit D1 thumbnails to 24 KiB WebP; never accept SVG or HTML.
async function uploadAvatar(request, db, user) {
  await rateLimit(db,request,"avatar-upload:"+user.id,8);
  const body = await parseBody(request, 40000);
  if (body.mime !== "image/webp" || typeof body.data !== "string" ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data) || body.data.length > 32768) {
    bad(400,"Only WebP thumbnails up to 24 KiB are accepted");
  }
  const bytes=unbase64(body.data,undefined,32768);
  if (bytes.length<24 || bytes.length>24576 ||
      String.fromCharCode(...bytes.slice(0,4))!=="RIFF" ||
      String.fromCharCode(...bytes.slice(8,12))!=="WEBP") {
    bad(400,"Invalid WebP image");
  }
  // Validate RIFF container byte length. Discard misleading headers.
  const size = bytes[4] | (bytes[5]<<8) | (bytes[6]<<16) | (bytes[7]<<24);
  if ((size>>>0) !== bytes.length-8) bad(400,"Malformed WebP container");
  await db.batch([
    db.prepare(
      "INSERT INTO social_avatars(user_id,mime,data_base64,byte_size) VALUES (?,'image/webp',?,?) " +
      "ON CONFLICT(user_id) DO UPDATE SET data_base64=excluded.data_base64," +
      "byte_size=excluded.byte_size,updated_at=unixepoch()"
    ).bind(user.id,body.data,bytes.length),
    db.prepare(
      "UPDATE social_users SET avatar_version=avatar_version+1,updated_at=unixepoch() WHERE id=?"
    ).bind(user.id)
  ]);
  return reply({ok:true,byte_size:bytes.length});
}
async function getAvatar(request, db, user) {
  await rateLimit(db,request,"avatar-get:"+user.id,120);
  const body=await parseBody(request);
  const resolved=await lookupUser(db,body.username);
  const peer=await db.prepare(
    "SELECT id,username,avatar_version FROM social_users WHERE id=? AND disabled_at IS NULL"
  ).bind(resolved.id).first();
  if (!peer) bad(404,"Account not found");
  const username=peer.username;
  if (peer.id!==user.id && !await areFriends(db,user.id,peer.id)) {
    bad(403,"Profile picture visible to friends only");
  }
  const data=await db.prepare(
    "SELECT data_base64 FROM social_avatars WHERE user_id=?"
  ).bind(peer.id).first();
  if (!data) return reply({username,avatar_version:peer.avatar_version,avatar:null});
  return reply({username,avatar_version:peer.avatar_version,
    avatar:"data:image/webp;base64,"+data.data_base64});
}


// Public VIS skin sheets, never a Minecraft Services entitlement or cape.
// Available only to authenticated launcher accounts; keep per-account storage
// bounded, reject oversized payloads, and verify the PNG dimensions server-side.
async function uploadSkin(request,db,user){
  await rateLimit(db,request,"skin-upload:"+user.id,8);
  const body=await parseBody(request,90000);
  if(body.mime!=="image/png"||typeof body.data!=="string"
    ||body.data.length<32||body.data.length>87384
    ||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)){
    bad(400,"Only bounded 64x64 or 64x32 PNG skins are accepted");
  }
  const bytes=unbase64(body.data,undefined,87384);
  const sig=[137,80,78,71,13,10,26,10];
  if(bytes.length<33||bytes.length>65536||!sig.every((v,i)=>bytes[i]===v)
    ||bytes[12]!==73||bytes[13]!==72||bytes[14]!==68||bytes[15]!==82){
    bad(400,"Invalid Minecraft PNG");
  }
  const u32=index=>((bytes[index]*0x1000000)+(bytes[index+1]<<16)+(bytes[index+2]<<8)+bytes[index+3])>>>0;
  if(u32(8)!==13||u32(16)!==64||![32,64].includes(u32(20))
    ||bytes[24]!==8||![2,6].includes(bytes[25])
    ||bytes[26]!==0||bytes[27]!==0||bytes[28]!==0){
    bad(400,"Minecraft skin must be 64x64 or 64x32 RGB/RGBA PNG");
  }
  await db.batch([
    db.prepare("INSERT INTO social_skins(user_id,mime,data_base64,byte_size) "+
      "VALUES (?,'image/png',?,?) ON CONFLICT(user_id) DO UPDATE SET "+
      "data_base64=excluded.data_base64,byte_size=excluded.byte_size,updated_at=unixepoch()")
      .bind(user.id,body.data,bytes.length),
    db.prepare("UPDATE social_users SET skin_version=skin_version+1,updated_at=unixepoch() WHERE id=?").bind(user.id)
  ]);
  return reply({ok:true,byte_size:bytes.length});
}
async function getSkin(request,db,user){
  await rateLimit(db,request,"skin-get:"+user.id,120);
  const body=await parseBody(request);
  const resolved=await lookupUser(db,body.username);
  const owner=await db.prepare(
    "SELECT id,username,skin_version FROM social_users WHERE id=? AND disabled_at IS NULL"
  ).bind(resolved.id).first();
  if(!owner)bad(404,"VIS user not found");
  const username=owner.username;
  const skin=await db.prepare("SELECT data_base64 FROM social_skins WHERE user_id=?")
    .bind(owner.id).first();
  return reply({username,skin_version:owner.skin_version,
    skin:skin?"data:image/png;base64,"+skin.data_base64:null});
}
async function deleteSkin(request,db,user){
  await rateLimit(db,request,"skin-delete:"+user.id,12);
  await db.batch([
    db.prepare("DELETE FROM social_skins WHERE user_id=?").bind(user.id),
    db.prepare("UPDATE social_users SET skin_version=skin_version+1,updated_at=unixepoch() WHERE id=?").bind(user.id)
  ]);
  return reply({ok:true});
}

async function cleanup(db) {
  const t = now();
  await db.batch([
    db.prepare("DELETE FROM auth_challenges WHERE expires_at<?").bind(t),
    db.prepare("DELETE FROM auth_sessions WHERE expires_at<?").bind(t),
    db.prepare("DELETE FROM auth_rate_limits WHERE expires_at<?").bind(t),
    db.prepare("DELETE FROM pending_messages WHERE expires_at<? OR acknowledged_at IS NOT NULL").bind(t),
    db.prepare("DELETE FROM realtime_tickets WHERE expires_at<?").bind(t)
  ]);
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // The Worker has no CORS grants: native Rust is the supported client.
    // Browser-origin requests are rejected to reduce CSRF/XSS exposure.
    if (request.headers.has("origin") && new URL(request.url).pathname!=="/v1/realtime/connect")
      return reply({error:"Browser origins are not authorized"},403);
    const path = url.pathname;
    const method = request.method;
    if (!env?.DB) return reply({ service: "vis-social", status: "unavailable" }, 503);
    try {
      const db = env.DB;
      if (method === "GET" && path === "/health") {
        const tables = await db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN " +
          "('social_users','friend_requests','friendships','friend_aliases'," +
          "'pending_messages','auth_sessions','auth_challenges','social_projects','project_subscriptions','admin_audit','social_avatars','social_skins','developer_grants','realtime_tickets','public_handle_history')"
        ).all();
        const columns=await db.prepare(
          "SELECT name FROM pragma_table_info('social_users') "+
          "WHERE name IN ('public_id','password_hash','password_salt','password_iterations','avatar_version','skin_version','public_handle','public_handle_updated_at')"
        ).all();
        const ready = new Set((tables.results || []).map(x => x.name)).size === 15 &&
          new Set((columns.results || []).map(x=>x.name)).size === 8;
        return reply({ service: "vis-social", status: ready ? "ready" : "migration_required", schema: ready ? 10 : 0 },
          ready ? 200 : 503);
      }
      if (method === "GET" && path === "/v1/realtime/connect")return await consumeRealtimeTicket(request,db,env);
      if (method === "POST" && path === "/v1/accounts/register") return await cloudRegister(request, db);
      if (method === "POST" && path === "/v1/accounts/login/challenge") return await cloudChallenge(request, db);
      if (method === "POST" && path === "/v1/accounts/login/verify") return await cloudVerify(request, db);
      if (method === "POST" && path === "/v1/auth/register") return await register(request, db);
      if (method === "POST" && path === "/v1/auth/challenge") return await challenge(request, db);
      if (method === "POST" && path === "/v1/auth/session") return await session(request, db);
      if (!path.startsWith("/v1/")) return reply({ error: "Not found" }, 404);
      const user = await getSession(request, db);
      if (method === "POST" && path === "/v1/realtime/ticket")return await createRealtimeTicket(request,db,user,env);
      if (method === "GET" && path === "/v1/state") return await currentState(db, user);
      if (method === "POST" && path === "/v1/accounts/upgrade") return await upgradeCloudLogin(request,db,user);
      if (method === "GET" && path === "/v1/account") return await accountInfo(db,user);
      if (method === "POST" && path === "/v1/account/display") return await updateDisplayName(request,db,user);
      if (method === "POST" && path === "/v1/account/handle") return await changePublicHandle(request,db,user);
      if (method === "GET" && path === "/v1/projects") return reply({projects:await getProjects(db,user)});
      if (method === "POST" && path === "/v1/projects/subscribe") return await projectSubscription(request,db,user,"subscribe");
      if (method === "POST" && path === "/v1/projects/unsubscribe") return await projectSubscription(request,db,user,"unsubscribe");
      if (method === "POST" && path === "/v1/admin/projects/upsert") return await adminProjectUpsert(request,db,user);
      if (method === "POST" && path === "/v1/admin/projects/staff") return await adminProjectStaff(request,db,user);
      if (method === "POST" && path === "/v1/admin/accounts/role") return await adminAccountRole(request,db,user);
      if (method === "POST" && path === "/v1/admin/accounts/disable") return await adminAccountDisable(request,db,user,env,ctx);
      if (method === "POST" && path === "/v1/avatar/upload") return await uploadAvatar(request,db,user);
      if (method === "POST" && path === "/v1/avatar/get") return await getAvatar(request,db,user);
      if (method === "POST" && path === "/v1/skins/upload") return await uploadSkin(request,db,user);
      if (method === "POST" && path === "/v1/skins/get") return await getSkin(request,db,user);
      if (method === "POST" && path === "/v1/skins/delete") return await deleteSkin(request,db,user);
      if (method === "POST" && path === "/v1/keys") return await setKey(request, db, user);
      if (method === "POST" && path === "/v1/friends/request") return await friendRequest(request, db, user,env,ctx);
      if (method === "POST" && path === "/v1/friends/accept") return await friendAccept(request, db, user,env,ctx);
      if (method === "POST" && path === "/v1/friends/alias") return await friendAlias(request, db, user);
      if (method === "POST" && path === "/v1/presence") return await presence(request, db, user);
      if (method === "POST" && path === "/v1/messages/send") return await sendMessage(request, db, user,env,ctx);
      if (method === "POST" && path === "/v1/messages/ack") return await ackMessages(request, db, user);
      if (method === "POST" && path === "/v1/auth/logout") {
        await db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(user.tokenHash).run();
        // A different signed-in device can transparently reconnect with a
        // fresh ticket. Revoke all old socket leases immediately on logout.
        await revokeRealtime(env,user.id);
        return reply({ ok: true });
      }
      return reply({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof HttpFailure) return reply({ error: error.message }, error.status);
      console.error("VIS Social request failed", path, error instanceof Error ? error.name : "error");
      if (env?.DEBUG_ERRORS === true) console.error("VIS Social local test detail",error);
      return reply({ error: "Service unavailable" }, 503);
    }
  },
  async scheduled(_event, env) {
    if (env?.DB) await cleanup(env.DB);
  }
};
