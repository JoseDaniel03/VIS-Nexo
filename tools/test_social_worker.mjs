import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import worker, { VisRealtimeRoom } from '../services/social/worker.mjs';

class D1Database {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON;');
    for (const path of [
      '../services/social/migrations/0001_social_core.sql',
      '../services/social/migrations/0002_device_auth.sql',
      '../services/social/migrations/0003_roles_projects.sql',
      '../services/social/migrations/0004_cloud_credentials.sql',
      '../services/social/migrations/0005_avatars.sql',
      '../services/social/migrations/0006_super_developer.sql',
      '../services/social/migrations/0007_public_skins.sql',
      '../services/social/migrations/0008_fix_cloud_device_key_unique.sql',
       '../services/social/migrations/0009_realtime_tickets.sql',
       '../services/social/migrations/0010_public_handles.sql',
       '../services/social/migrations/0011_project_community.sql',
       '../services/social/migrations/0012_ceibo_recovery.sql'
    ]) this.sqlite.exec(readFileSync(new URL(path, import.meta.url), 'utf8'));
  }
  prepare(sql) {
    const parent = this;
    return {
      sql, parameters: [],
      bind(...values) { this.parameters = values; return this; },
      async first() { return parent.sqlite.prepare(this.sql).get(...this.parameters) || null; },
      async all() { return { results: parent.sqlite.prepare(this.sql).all(...this.parameters) }; },
      async run() {
        const result = parent.sqlite.prepare(this.sql).run(...this.parameters);
        return { meta: { changes: Number(result.changes) } };
      }
    };
  }
  async batch(queries) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = [];
      for (const query of queries) result.push(await query.run());
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
const DB = new D1Database();
const notifications=[],revocations=[];
const env={
  DB,DEBUG_ERRORS:true,
  REALTIME:{
    idFromName:id=>id,
    get:id=>({fetch:async(url,opts)=>{
      if(String(url).endsWith('/_vis/notify'))notifications.push(id);
      if(String(url).endsWith('/_vis/revoke'))revocations.push(id);
      // Only the Cloudflare runtime can return HTTP 101; the mock verifies
      // authorization and one-time consumption independently of upgrade I/O.
      return new Response(null,{status:204});
    }})
  }
};
const recoveryDeliveries=[];
env.RESEND_API_KEY='re_test_unit_only_not_a_real_secret';
env.CEIBO_FROM_EMAIL='cuentas@example.org';
env.CEIBO_MFA_ENCRYPTION_KEY=Buffer.alloc(32,113).toString('base64');
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.resend.com/emails'){
    recoveryDeliveries.push(JSON.parse(options.body));
    return new Response(JSON.stringify({id:'test-mail'}),{status:200});
  }
  return realFetch(url,options);
};
function lastRecoveryCode(){
  const mail=recoveryDeliveries.at(-1);
  const match=mail?.text?.match(/[A-Za-z0-9_-]{43}/);
  assert(match,'a one-time email recovery code is expected');
  return match[0];
}
function decodeBase32(input){
  const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let value=0,bits=0;const out=[];
  for(const char of input){value=(value<<5)|letters.indexOf(char);bits+=5;
    if(bits>=8){bits-=8;out.push((value>>>bits)&255);}}
  return Buffer.from(out);
}
function otpFromSecret(secret){
  const counter=Math.floor(Date.now()/30000);
  const msg=Buffer.alloc(8);msg.writeUInt32BE(Math.floor(counter/2**32),0);
  msg.writeUInt32BE(counter>>>0,4);
  const mac=createHmac('sha1',decodeBase32(secret)).update(msg).digest();
  const off=mac[19]&15;
  return String((mac.readUInt32BE(off)&0x7fffffff)%1000000).padStart(6,'0');
}
async function enrollMfa(user){
  const start=await call('/v1/account/mfa/setup',{},user.token);
  assert.equal(start.status,200,JSON.stringify(start));
  assert.match(start.data.secret,/^[A-Z2-7]{32}$/);
  const confirm=await call('/v1/account/mfa/confirm',{code:otpFromSecret(start.data.secret)},user.token);
  assert.equal(confirm.status,200,JSON.stringify(confirm));
  assert.equal(confirm.data.recovery_codes.length,8);
  assert.equal((await call('/v1/account/mfa/status',undefined,user.token)).data.enrolled,true);
  return confirm.data.recovery_codes;
}
const origin = 'https://vis-social.example';
const to64 = bytes => Buffer.from(bytes).toString('base64');
async function call(path, body, token) {
  const method = body === undefined ? 'GET' : 'POST';
  const headers = { ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(token ? { authorization: 'Bearer ' + token } : {}) };
  const res = await worker.fetch(new Request(origin + path, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), env);
  return { status: res.status, data: await res.json() };
}
const registerText = username => 'VIS-SOCIAL-REGISTER-V1\n' + username;
const authText = (username, challenge) => 'VIS-SOCIAL-AUTH-V1\n' + username +
  '\n' + challenge.id + '\n' + challenge.nonce;
const sign = (key, text) => crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(text));

async function account(username) {
  const signing = await crypto.subtle.generateKey('Ed25519', true, ['sign','verify']);
  const public_key = to64(await crypto.subtle.exportKey('raw', signing.publicKey));
  let response = await call('/v1/auth/register', {
    username, public_key, signature: to64(await sign(signing.privateKey, registerText(username)))
  });
  assert.equal(response.status, 201, JSON.stringify(response));
  response = await call('/v1/auth/challenge', { username });
  assert.equal(response.status, 200);
  const challenge = response.data;
  response = await call('/v1/auth/session', {
    username, challenge_id: challenge.id,
    signature: to64(await sign(signing.privateKey, authText(username, challenge)))
  });
  assert.equal(response.status, 200, JSON.stringify(response));
  const token = response.data.token;
  assert.equal((await call('/v1/auth/session', {
    username, challenge_id: challenge.id,
    signature: to64(await sign(signing.privateKey, authText(username, challenge)))
  })).status, 401, 'single-use login challenges');
  const ecdh = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const encryptionPublic = to64(await crypto.subtle.exportKey('spki', ecdh.publicKey));
  response = await call('/v1/keys', { public_key: encryptionPublic }, token);
  assert.equal(response.status, 200, JSON.stringify(response));
  return { username, token, signing, ecdh, encryptionPublic };
}
let response = await call('/health');
assert.equal(response.status, 200, JSON.stringify(response));
assert.equal(response.data.schema, 12);
assert.equal((await call('/v1/state')).status, 401);

const alice = await account('alice');
const bob = await account('bob');
// A bearer is required only when issuing the short-lived read-only ticket.
// The WebView gets NO social authentication token and cannot call other APIs.
assert.equal((await call('/v1/realtime/ticket',{})).status,401);
const issued=await call('/v1/realtime/ticket',{},alice.token);
assert.equal(issued.status,200);
assert.match(issued.data.ticket,/^[A-Za-z0-9_-]{43}$/);
assert.equal(issued.data.expires_in,20);
assert.equal((await call('/v1/realtime/ticket',{},bob.token)).status,200);
const wsTicket=issued.data.ticket;
async function wsRequest(ticket,originHeader='tauri://localhost'){
  return worker.fetch(new Request(origin+'/v1/realtime/connect?ticket='+ticket,{
    method:'GET',
    headers:{Upgrade:'websocket',Origin:originHeader}
  }),env);
}
assert.equal((await wsRequest(wsTicket,'https://evil.example')).status,403);
assert.equal((await wsRequest(wsTicket)).status,204,'valid ticket forwards to account DO');
assert.equal((await wsRequest(wsTicket)).status,401,'ticket must never be replayed');
assert.equal((await wsRequest('A'.repeat(43))).status,401,'forged ticket rejected');
assert.equal((await call('/v1/realtime/connect?ticket='+wsTicket)).status,400,
  'no websocket protocol downgrade');
assert.equal((await call('/v1/account/display',{display_name:'Mi Cuenta Premium'},alice.token)).status,200);
assert.equal((await call('/v1/account/display',{display_name:'  '},alice.token)).status,400);
// A mutable @handle never changes the account's internal identity or E2EE.
assert.equal((await call('/v1/account/handle',{handle:'alice_new'})).status,401);
assert.equal((await call('/v1/account/handle',{handle:'admin'},alice.token)).status,409);
assert.equal((await call('/v1/account/handle',{handle:'bob'},alice.token)).status,409);
assert.equal((await call('/v1/account/handle',{handle:'bad handle'},alice.token)).status,400);
const aliceBefore=await call('/v1/account',undefined,alice.token);
assert.equal((await call('/v1/account/handle',{handle:'alice_new'},alice.token)).status,200);
const aliceAfter=await call('/v1/account',undefined,alice.token);
assert.equal(aliceAfter.data.account.username,'alice');
assert.equal(aliceAfter.data.account.public_handle,'alice_new');
assert.equal(aliceAfter.data.account.public_id,aliceBefore.data.account.public_id);
assert.equal((await call('/v1/account/handle',{handle:'alice_second'},alice.token)).status,429);
assert.equal((await call('/v1/account/handle',{handle:'alice_new'},bob.token)).status,409);
assert.equal((await call('/v1/account/handle',{handle:'bob_public'},bob.token)).status,200);
const bobId=(await call('/v1/account',undefined,bob.token)).data.account.public_id;
// Advance the test fixture beyond the cooldown before checking collisions:
// a normal user must wait seven days before attempting another change.
DB.sqlite.prepare("UPDATE social_users SET public_handle_updated_at=1 WHERE username='alice'").run();
assert.equal((await call('/v1/account/handle',{handle:bobId},alice.token)).status,409);
assert.equal((await call('/v1/state',undefined,alice.token)).data.public_handle,'alice_new');
// Renaming after the cooldown must NOT permit impersonation via the old handle.
DB.sqlite.prepare("UPDATE social_users SET public_handle_updated_at=1 WHERE username='alice'").run();
assert.equal((await call('/v1/account/handle',{handle:'alice_next'},alice.token)).status,200);
DB.sqlite.prepare("UPDATE social_users SET public_handle_updated_at=1 WHERE username='bob'").run();
assert.equal((await call('/v1/account/handle',{handle:'alice_new'},bob.token)).status,409);
const oldAliasLookup=await call('/v1/skins/get',{username:'alice_new'},bob.token);
assert.equal(oldAliasLookup.status,200);
assert.equal(oldAliasLookup.data.username,'alice','old aliases resolve to the same stable account');
assert.equal((await call('/v1/state',undefined,alice.token)).data.display_name,'Mi Cuenta Premium');
assert.equal((await call('/v1/keys', {public_key: 'not_a_key'}, alice.token)).status, 400);
assert.equal((await call('/v1/friends/request', {username: 'bob_public'}, alice.token)).status, 201);
response = await call('/v1/state', undefined, bob.token);
assert.deepEqual(response.data.incoming_requests, ['alice']);
assert.equal((await call('/v1/friends/accept', {username: 'alice'}, alice.token)).status, 404);
assert.equal((await call('/v1/friends/accept', {username: 'alice'}, bob.token)).status, 200);

const avatarBytes=Buffer.alloc(64);
avatarBytes.write('RIFF',0,'ascii');
avatarBytes.writeUInt32LE(avatarBytes.length-8,4);
avatarBytes.write('WEBP',8,'ascii');
avatarBytes.write('VP8 ',12,'ascii');
const avatarEncoded=avatarBytes.toString('base64');
assert.equal((await call('/v1/avatar/upload',{
  mime:'image/png',data:avatarEncoded
},bob.token)).status,400,'refuse non-WebP avatar');
assert.equal((await call('/v1/avatar/upload',{
  mime:'image/webp',data:avatarEncoded
},bob.token)).status,200,'save bounded server avatar');
const avatarRead=await call('/v1/avatar/get',{username:'bob'},alice.token);
assert.equal(avatarRead.status,200);
assert.equal(avatarRead.data.avatar,'data:image/webp;base64,'+avatarEncoded);
assert.equal(avatarRead.data.avatar_version,1);

// Real 64x64 PNG texture, not a mock header; any authenticated VIS account
// can view the uploaded skin, even when the two users are not friends.
function pngChunk(type,data) {
  const payload=Buffer.concat([Buffer.from(type,'ascii'),data]);
  let crc=0xffffffff;
  for(const byte of payload) {
    crc^=byte;
    for(let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  const chunk=Buffer.alloc(payload.length+8);
  chunk.writeUInt32BE(data.length,0);
  payload.copy(chunk,4);
  chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
  return chunk;
}
const ihdr=Buffer.alloc(13);
ihdr.writeUInt32BE(64,0);ihdr.writeUInt32BE(64,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([
  Buffer.from('89504e470d0a1a0a','hex'),
  pngChunk('IHDR',ihdr),
  pngChunk('IDAT',deflateSync(Buffer.alloc(64*(1+64*4)))),
  pngChunk('IEND',Buffer.alloc(0))
]);
const png64=png.toString('base64');
assert.equal((await call('/v1/skins/upload',{mime:'image/webp',data:png64},bob.token)).status,400);
assert.equal((await call('/v1/skins/upload',{mime:'image/png',data:png64},bob.token)).status,200);
const charlie=await account('charlie');
const publicSkin=await call('/v1/skins/get',{username:'bob'},charlie.token);
assert.equal(publicSkin.status,200,'public to authenticated non-friend');
assert.equal(publicSkin.data.skin,'data:image/png;base64,'+png64);
assert.equal(publicSkin.data.skin_version,1);
const visibleSkinState=await call('/v1/state',undefined,alice.token);
assert.equal(visibleSkinState.data.friends[0].skin_version,1);
assert.equal((await call('/v1/skins/get',{username:'bob'})).status,401,'reject anonymous lookup');
assert.equal((await call('/v1/skins/delete',{},bob.token)).status,200);
assert.equal((await call('/v1/skins/get',{username:'bob'},charlie.token)).data.skin,null);
assert.equal((await call('/v1/skins/get',{username:'bob'},charlie.token)).data.skin_version,2);
response = await call('/v1/state', undefined, alice.token);
assert.equal(response.data.friends[0].username, 'bob');
assert.equal(response.data.friends[0].public_key, bob.encryptionPublic);
assert.equal(response.data.friends[0].public_handle,'bob_public');
assert.equal((await call('/v1/friends/alias', {username:'bob',alias:'Best friend'}, alice.token)).status,200);
assert.equal((await call('/v1/state',undefined,alice.token)).data.friends[0].alias, 'Best friend');

await call('/v1/presence', {presence:'online',custom_status:'Available',current_game:'Minecraft'},bob.token);
response = await call('/v1/state', undefined, alice.token);
assert.equal(response.data.friends[0].presence, 'online');
await call('/v1/presence', {presence:'invisible'},bob.token);
response = await call('/v1/state', undefined, alice.token);
assert.equal(response.data.friends[0].presence, 'offline');
assert.equal(response.data.friends[0].custom_status, '');

const id = crypto.randomUUID().replaceAll('-', '');
const iv = crypto.getRandomValues(new Uint8Array(12));
const bobPublic = await crypto.subtle.importKey('spki',Buffer.from(bob.encryptionPublic,'base64'),
  {name:'ECDH',namedCurve:'P-256'},false,[]);
const aes = await crypto.subtle.deriveKey({name:'ECDH',public:bobPublic},
  alice.ecdh.privateKey,{name:'AES-GCM',length:256},false,['encrypt']);
const aad = new TextEncoder().encode('VIS-SOCIAL-MSG-V1\nalice\nbob\n' + id);
const ct = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},
  aes,new TextEncoder().encode('hello encrypted chat'));
const envelope = JSON.stringify({v:1,iv:to64(iv),ct:to64(ct)});
assert.equal((await call('/v1/messages/send', {
  to:'bob',client_message_id:id,payload:envelope
})).status,401);
notifications.length=0;
response = await call('/v1/messages/send', {
  to:'bob',client_message_id:id,payload:envelope
},alice.token);
assert.equal(response.status,200,JSON.stringify(response));
const bobUserId=DB.sqlite.prepare("SELECT id FROM social_users WHERE username='bob'").get().id;
assert.deepEqual(notifications,[bobUserId],
  'Encrypted message event must notify only the intended recipient DO');
response = await call('/v1/state',undefined,bob.token);
assert.equal(response.data.pending_messages.length,1);
assert(!JSON.stringify(response.data).includes('hello encrypted chat'));
assert.equal(response.data.pending_messages[0].from, 'alice');
// Two independently generated device ECDH keypairs must decrypt the same
// ciphertext delivered through D1, without the Worker seeing plaintext.
const bobSecret = await crypto.subtle.importKey('spki',
  Buffer.from(alice.encryptionPublic,'base64'),
  {name:'ECDH',namedCurve:'P-256'},false,[]);
const bobAes = await crypto.subtle.deriveKey({name:'ECDH',public:bobSecret},
  bob.ecdh.privateKey,{name:'AES-GCM',length:256},false,['decrypt']);
const cleartext = await crypto.subtle.decrypt({
  name:'AES-GCM',iv,additionalData:aad
},bobAes,Buffer.from(JSON.parse(response.data.pending_messages[0].payload).ct,'base64'));
assert.equal(new TextDecoder().decode(cleartext),'hello encrypted chat');
const pendingID = response.data.pending_messages[0].id;
assert.equal((await call('/v1/messages/ack',{ids:[pendingID]},alice.token)).status,200);
assert.equal((await call('/v1/state',undefined,bob.token)).data.pending_messages.length,1);
assert.equal((await call('/v1/messages/ack',{ids:[pendingID]},bob.token)).status,200);
assert.equal((await call('/v1/state',undefined,bob.token)).data.pending_messages.length,0);
assert.equal((await call('/v1/keys',{public_key:alice.encryptionPublic},bob.token)).status,409);
// Server-owned roles. The first online signup MUST remain a normal user.
assert.equal((await call('/v1/account',undefined,alice.token)).data.account.role,'user');
assert.equal((await call('/v1/admin/projects/upsert',{
  id:'virgoland',title:'Virgoland',visibility:'published'
},alice.token)).status,403,'local identity cannot claim administrator authority');
assert.equal((await call('/v1/admin/accounts/role',{
  username:'bob',role:'super_admin'
},alice.token)).status,403);

// Simulate the separate, protected GitHub/D1 operator provision.
// No public API endpoint provides this promotion.
DB.sqlite.prepare("UPDATE social_users SET role='super_admin' WHERE username='alice'").run();
assert.equal((await call('/v1/account',undefined,alice.token)).data.account.role,'super_admin');
assert.equal((await call('/v1/admin/projects/upsert',{
  id:'virgoland',title:'Unauthorized',visibility:'published'
},alice.token)).status,403,'super administrators must enroll MFA before acting');
const aliceRecoveryCodes=await enrollMfa(alice);
assert.equal((await call('/v1/admin/projects/upsert',{
  id:'virgoland',title:'Virgoland',summary:'Project catalog',visibility:'published'
},alice.token)).status,200);
let projects=await call('/v1/projects',undefined,bob.token);
assert.equal(projects.data.projects[0].title,'Virgoland');
assert.equal(projects.data.projects[0].subscribed,false);
assert.equal((await call('/v1/projects/subscribe',{
  project_id:'virgoland'
},bob.token)).status,200);
projects=await call('/v1/projects',undefined,bob.token);
assert.equal(projects.data.projects[0].subscribed,true);
assert.equal((await call('/v1/admin/projects/upsert',{
  id:'virgoland',title:'Stolen',visibility:'published'
},bob.token)).status,403);
assert.equal((await call('/v1/admin/projects/staff',{
  project_id:'virgoland',username:'bob',staff_role:'editor'
},alice.token)).status,200);

// Community permissions must remain on the server, not in the editable launcher.
let community=await call('/v1/projects/community',{project_id:'virgoland'},bob.token);
assert.equal(community.status,200,JSON.stringify(community));
assert.equal(community.data.can_manage,false);
assert.equal(community.data.admission,'request');
assert.equal((await call('/v1/admin/projects/community-policy',{
 project_id:'virgoland',admission:'request',play_access:'members'
},bob.token)).status,403,'regular accounts cannot change admission');
assert.equal((await call('/v1/admin/projects/community-policy',{
 project_id:'virgoland',admission:'request',play_access:'members'
},alice.token)).status,200);
assert.equal((await call('/v1/projects/request-join',{
 project_id:'virgoland',note:'Me gustaría participar'
},bob.token)).data.status,'pending');
community=await call('/v1/projects/community',{project_id:'virgoland'},alice.token);
assert.equal(community.data.pending.length,1,'manager sees pending join request');
assert.equal((await call('/v1/admin/projects/review-join',{
 project_id:'virgoland',username:'bob',action:'approve'
},bob.token)).status,403);
assert.equal((await call('/v1/admin/projects/review-join',{
 project_id:'virgoland',username:'bob',action:'approve'
},alice.token)).status,200);
community=await call('/v1/projects/community',{project_id:'virgoland'},bob.token);
assert.equal(community.data.role,'participant');
assert.equal(community.data.can_play,true);
assert.equal((await call('/v1/admin/projects/community-members',{
 project_id:'virgoland',username:'bob',role:'creator',can_play:true,action:'grant'
},bob.token)).status,403);
assert.equal((await call('/v1/admin/projects/community-members',{
 project_id:'virgoland',username:'bob',role:'content_creator',can_play:false,action:'grant'
},alice.token)).status,200);
community=await call('/v1/projects/community',{project_id:'virgoland'},bob.token);
assert.equal(community.data.role,'content_creator');
assert.equal(community.data.can_play,false);
assert.equal((await call('/v1/admin/projects/community-media',{
 project_id:'virgoland',action:'add',title:'Video inseguro',kind:'video',
 url:'https://example.com/fake'
},bob.token)).status,400,'block arbitrary media origins');
assert.equal((await call('/v1/admin/projects/community-media',{
 project_id:'virgoland',action:'add',title:'Presentación del proyecto',kind:'video',
 url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
},bob.token)).status,200);
community=await call('/v1/projects/community',{project_id:'virgoland'},alice.token);
assert.equal(community.data.media.length,1);
assert.equal((await call('/v1/admin/accounts/global-admin',{
 username:'bob',enabled:true
},bob.token)).status,403,'global admin cannot self-promote');
assert.equal((await call('/v1/admin/accounts/global-admin',{
 username:'bob',enabled:true
},alice.token)).status,200);
assert.equal((await call('/v1/account',undefined,bob.token)).data.account.global_admin,true);
assert.equal((await call('/v1/admin/accounts/global-admin',{
 username:'bob',enabled:false
},alice.token)).status,200);
assert.equal((await call('/v1/account',undefined,bob.token)).data.account.global_admin,false);
// Regression: a delegated project manager must never revoke a creator by lying
// about the creator's old role in the request body.
const role_guard_user=await account('role_guard_user');
assert.equal((await call('/v1/admin/projects/community-members',{
 project_id:'virgoland',username:'role_guard_user',role:'creator',can_play:false,action:'grant'
},alice.token)).status,200);
assert.equal((await call('/v1/admin/projects/staff',{
 project_id:'virgoland',username:'bob',staff_role:'manager'
},alice.token)).status,200);
assert.equal((await call('/v1/admin/projects/community-members',{
 project_id:'virgoland',username:'role_guard_user',role:'participant',action:'revoke'
},bob.token)).status,403,'manager cannot revoke creator by forging the role field');
assert.equal((await call('/v1/admin/projects/community-members',{
 project_id:'virgoland',username:'role_guard_user',role:'creator',action:'revoke'
},alice.token)).status,200);


assert.equal((await call('/v1/admin/accounts/role',{
  username:'bob',role:'super_admin'
},alice.token)).status,400,'super_admin elevation must not be exposed by HTTP');
assert.equal((await call('/v1/admin/accounts/role',{
  username:'bob',role:'moderator'
},alice.token)).status,200);
assert.equal((await call('/v1/account',undefined,bob.token)).data.account.role,'moderator');
assert.equal((await call('/v1/admin/accounts/disable',{
  username:'alice',disabled:true
},alice.token)).status,403,'cannot disable self');
assert.equal((await call('/v1/admin/accounts/disable',{
  username:'bob',disabled:true
},alice.token)).status,200);
assert.equal((await call('/v1/state',undefined,bob.token)).status,401,
 'revoked sessions should not survive disable');
assert.equal(DB.sqlite.prepare("SELECT count(*) AS n FROM admin_audit").get().n>=4,true);
assert.equal((await call('/v1/auth/logout',{},alice.token)).status,200);
assert.equal((await call('/v1/state',undefined,alice.token)).status,401);

// Cloud identities use public IDs and one-way verifiers; local PINs cannot log in.
const cloudKey=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const otherKey=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const cloudSalt=to64(crypto.getRandomValues(new Uint8Array(16)));
const cloudPub=to64(await crypto.subtle.exportKey('raw',cloudKey.publicKey));
const cloudReg={
  username:'clouduser',password_salt:cloudSalt,password_public_key:cloudPub,
  registration_signature:to64(await sign(cloudKey.privateKey,
    'VIS-CLOUD-REGISTER-V2\nclouduser\n'+cloudSalt))
};
assert.equal((await call('/v1/accounts/register',{
  ...cloudReg,registration_signature:'invalid'
})).status,400);
const cloud=await call('/v1/accounts/register',cloudReg);
assert.equal(cloud.status,200,JSON.stringify(cloud));
assert.match(cloud.data.public_id,/^[0-9a-f]{24}$/);
assert.equal((await call('/v1/accounts/register',cloudReg)).status,409);

// Cloud-only accounts have no device key yet. A partial unique index must
// permit many of them without weakening the uniqueness of actual device keys.
const secondCloudKey=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const secondCloudSalt=to64(crypto.getRandomValues(new Uint8Array(16)));
const secondCloudPub=to64(await crypto.subtle.exportKey('raw',secondCloudKey.publicKey));
const secondCloud=await call('/v1/accounts/register',{
  username:'cloudsecond',password_salt:secondCloudSalt,password_public_key:secondCloudPub,
  registration_signature:to64(await sign(secondCloudKey.privateKey,
    'VIS-CLOUD-REGISTER-V2\ncloudsecond\n'+secondCloudSalt))
});
assert.equal(secondCloud.status,200,'independent cloud-only accounts must coexist');
assert.notEqual(secondCloud.data.public_id,cloud.data.public_id);
// A known immutable public ID cannot be stolen as a new login username.
const claimedIdRegistration={
  username:bobId,password_salt:cloudSalt,password_public_key:cloudPub,
  registration_signature:to64(await sign(cloudKey.privateKey,
    'VIS-CLOUD-REGISTER-V2\n'+bobId+'\n'+cloudSalt))
};
assert.equal((await call('/v1/accounts/register',claimedIdRegistration)).status,409,
  'new usernames must not impersonate another account public ID');
// Existing VIS device accounts once used case-sensitive base64url public IDs.
// They must continue to authenticate after the public @handle migration.
const legacyPublicId='AbCdEfGhIjKlMnOpQrStUv_-';
assert.equal(legacyPublicId.length,24);
DB.sqlite.prepare("UPDATE social_users SET public_id=? WHERE username='cloudsecond'")
  .run(legacyPublicId);
const legacyChallenge=await call('/v1/accounts/login/challenge',{identifier:legacyPublicId});
assert.equal(legacyChallenge.status,200);
assert.equal(legacyChallenge.data.username,'cloudsecond');
const legacyProof='VIS-CLOUD-AUTH-V2\ncloudsecond\n'+legacyChallenge.data.challenge_id+
  '\n'+legacyChallenge.data.nonce;
assert.equal((await call('/v1/accounts/login/verify',{
  identifier:legacyPublicId,challenge_id:legacyChallenge.data.challenge_id,
  signature:to64(await sign(secondCloudKey.privateKey,legacyProof))
})).status,200,'legacy public IDs remain usable without changing their spelling');

const challenge=await call('/v1/accounts/login/challenge',{
  identifier:cloud.data.public_id
});
assert.equal(challenge.status,200);
assert.equal(challenge.data.salt,cloudSalt);
assert.equal(challenge.data.kdf,'argon2id-19m-t2');
const proofMessage='VIS-CLOUD-AUTH-V2\nclouduser\n'+challenge.data.challenge_id+'\n'+challenge.data.nonce;
assert.equal((await call('/v1/accounts/login/verify',{
  identifier:cloud.data.public_id,challenge_id:challenge.data.challenge_id,
  signature:to64(await sign(otherKey.privateKey,proofMessage))
})).status,401);
const cloudLogin=await call('/v1/accounts/login/verify',{
  identifier:cloud.data.public_id,challenge_id:challenge.data.challenge_id,
  signature:to64(await sign(cloudKey.privateKey,proofMessage))
});
assert.equal(cloudLogin.status,200,JSON.stringify(cloudLogin));
assert.equal(cloudLogin.data.username,'clouduser');
assert.equal((await call('/v1/accounts/login/verify',{
  identifier:cloud.data.public_id,challenge_id:challenge.data.challenge_id,
  signature:to64(await sign(cloudKey.privateKey,proofMessage))
})).status,401,'cloud challenge must be single-use');
const cloudByNameChallenge=await call('/v1/accounts/login/challenge',{identifier:'clouduser'});
assert.equal(cloudByNameChallenge.status,200);
assert.equal((await call('/v1/accounts/login/verify',{
  identifier:'clouduser',challenge_id:cloudByNameChallenge.data.challenge_id,
  signature:to64(await sign(cloudKey.privateKey,
    'VIS-CLOUD-AUTH-V2\nclouduser\n'+cloudByNameChallenge.data.challenge_id+
    '\n'+cloudByNameChallenge.data.nonce))
})).status,200);
// Login accepts a mutable public @handle but still signs the IMMUTABLE
// internal username: renaming must never change the identity proof.
assert.equal((await call('/v1/account/handle',{handle:'cloudhero'},cloudLogin.data.token)).status,200);
const aliasChallenge=await call('/v1/accounts/login/challenge',{identifier:'cloudhero'});
assert.equal(aliasChallenge.status,200);
assert.equal(aliasChallenge.data.username,'clouduser');
assert.equal((await call('/v1/accounts/login/verify',{
  identifier:'cloudhero',challenge_id:aliasChallenge.data.challenge_id,
  signature:to64(await sign(cloudKey.privateKey,
    'VIS-CLOUD-AUTH-V2\nclouduser\n'+aliasChallenge.data.challenge_id+
    '\n'+aliasChallenge.data.nonce))
})).status,200,'cloud sign-in accepts @handle while retaining stable key binding');
const cloudAccount=(await call('/v1/account',undefined,cloudLogin.data.token)).data.account;
assert.equal(cloudAccount.role,'user');
assert.equal(cloudAccount.cloud_login_enabled,true);
assert.equal((await call('/v1/admin/projects/upsert',{
  id:'cloud-super',title:'No permissions',visibility:'published'
},cloudLogin.data.token)).status,403);
assert.equal((await call('/v1/avatar/get',{username:'alice'},cloudLogin.data.token)).status,403,
 'only friends may retrieve protected avatars');
const stored=DB.sqlite.prepare("SELECT password_hash,password_salt FROM social_users WHERE username='clouduser'").get();
assert.equal(stored.password_hash,'ed25519:'+cloudPub);
assert.equal(stored.password_salt,cloudSalt);
assert.equal(cloudAccount.developer,false);
assert.equal((await call('/v1/admin/accounts/disable',{
  username:'alice',disabled:true
},cloudLogin.data.token)).status,403);
const newDev=DB.sqlite.prepare("SELECT id FROM social_users WHERE username='clouduser'").get();
DB.sqlite.prepare("INSERT INTO developer_grants(user_id) VALUES (?)").run(newDev.id);
assert.equal((await call('/v1/account',undefined,cloudLogin.data.token)).data.account.developer,true);
assert.equal((await call('/v1/state',undefined,cloudLogin.data.token)).data.developer,true);
assert.equal((await call('/v1/admin/projects/upsert',{
  id:'dev-test-project',title:'Developer testing',visibility:'draft'
},cloudLogin.data.token)).status,200);
assert.equal((await call('/v1/admin/projects/staff',{
  project_id:'dev-test-project',username:'clouduser',staff_role:'manager'
},cloudLogin.data.token)).status,200);
assert.equal((await call('/v1/admin/accounts/role',{
  username:'clouduser',role:'moderator'
},cloudLogin.data.token)).status,403,'developer must not administer users');
assert.equal((await call('/v1/admin/accounts/disable',{
  username:'alice',disabled:true
},cloudLogin.data.token)).status,403,'developer must not suspend accounts');
DB.sqlite.prepare("DELETE FROM developer_grants WHERE user_id=?").run(newDev.id);
assert.equal((await call('/v1/admin/projects/upsert',{
  id:'dev-test-project',title:'Revoked',visibility:'published'
},cloudLogin.data.token)).status,403,'grant revocation must be immediately enforced');

DB.sqlite.exec("UPDATE auth_sessions SET expires_at=1");
DB.sqlite.exec("UPDATE auth_challenges SET expires_at=1");
DB.sqlite.exec("UPDATE auth_rate_limits SET expires_at=1");
await worker.scheduled({},env);
assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM auth_sessions').get().n,0);
assert(notifications.includes(bobUserId),'Encrypted message delivery must notify recipient DO');
assert(revocations.length>=1,'Explicit logout or account disabling should revoke old notification channels');
DB.sqlite.exec("UPDATE realtime_tickets SET expires_at=1");
await worker.scheduled({},env);
assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM realtime_tickets').get().n,0);
// Simulated Cloudflare WebSocket Hibernation runtime: Node's standard Response
// forbids HTTP 101, so only this isolated section substitutes the DO primitives.
// The actual edge upgrade/hibernation still requires Wrangler/Cloudflare tests.
{
  const originalPair=globalThis.WebSocketPair, originalResponse=globalThis.Response;
  const accepted=[];
  const state={
    getWebSockets:()=>accepted,
    acceptWebSocket:socket=>accepted.push(socket)
  };
  const room=new VisRealtimeRoom(state);
  try{
    globalThis.WebSocketPair=class {
      constructor(){
        const endpoint=()=>({
          sent:[],closed:[],attachment:null,
          send(value){this.sent.push(value);},
          close(code,reason){this.closed.push({code,reason});},
          serializeAttachment(value){this.attachment=value;},
          deserializeAttachment(){return this.attachment;}
        });
        this[0]=endpoint();
        this[1]=endpoint();
      }
    };
    globalThis.Response=class {
      constructor(body,options={}) {
        this.status=options.status??200;
        this.body=body;
        this.webSocket=options.webSocket;
      }
    };
    const upgrade=()=>new Request(origin+'/_vis/subscribe',{
      headers:{Upgrade:'websocket'}
    });
    assert.equal((await room.fetch(new Request(origin+'/_vis/subscribe'))).status,404,
      'Durable Object rejects non-WebSocket requests');
    const first=await room.fetch(upgrade());
    assert.equal(first.status,101,'DO must return a WebSocket upgrade');
    assert(first.webSocket,'WebSocket client endpoint returned by DO');
    assert.equal(accepted.length,1);
    assert.deepEqual(accepted[0].sent,['{"type":"ready"}']);
    assert(accepted[0].deserializeAttachment().expiresAt>Date.now(),
      'WebSocket authorization lease must persist through DO hibernation');
    room.webSocketMessage(accepted[0],'ping');
    assert(accepted[0].sent.includes('pong'),'heartbeat acknowledged');
    assert.equal((await room.fetch(new Request(origin+'/_vis/notify',{method:'POST'}))).status,204);
    assert(accepted[0].sent.includes('{"type":"wakeup"}'),
      'DO sends notification only, no sender identity or ciphertext');
    accepted[0].serializeAttachment({expiresAt:1});
    const delivered=accepted[0].sent.filter(x=>x==='{"type":"wakeup"}').length;
    await room.fetch(new Request(origin+'/_vis/notify',{method:'POST'}));
    assert(accepted[0].closed.some(x=>x.code===1008),
      'Expired authorization must close the WebSocket');
    assert.equal(accepted[0].sent.filter(x=>x==='{"type":"wakeup"}').length,delivered,
      'Expired socket must not receive additional notifications');
    for(let i=1;i<6;i++)assert.equal((await room.fetch(upgrade())).status,101);
    assert.equal((await room.fetch(upgrade())).status,429,'per-user socket cap');
    assert.equal((await room.fetch(new Request(origin+'/_vis/revoke',{method:'POST'}))).status,204);
    assert(accepted.every(ws=>ws.closed.some(entry=>entry.code===1008)),
      'Explicit account revocation must terminate every old WebSocket');
    room.webSocketMessage(accepted[0],JSON.stringify({type:'message',body:'plaintext'}));
    assert(accepted[0].closed.some(entry=>entry.code===1008),
      'DO must never accept chat text or application commands');
  }finally{
    globalThis.WebSocketPair=originalPair;
    globalThis.Response=originalResponse;
  }
}
// VIS Ceibo Recovery — end-to-end account ownership and old-device revocation.
const recoverAccount=await account('recover_me');
const oldPasswordKey=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const oldSalt=to64(crypto.getRandomValues(new Uint8Array(16)));
const oldPub=to64(await crypto.subtle.exportKey('raw',oldPasswordKey.publicKey));
assert.equal((await call('/v1/accounts/upgrade',{
  username:'recover_me',password_salt:oldSalt,password_public_key:oldPub,
  registration_signature:to64(await sign(oldPasswordKey.privateKey,
    'VIS-CLOUD-REGISTER-V2\nrecover_me\n'+oldSalt))
},recoverAccount.token)).status,200);
assert.equal((await call('/v1/account/email/request',{
  email:'Recover.Me@Example.org'
},recoverAccount.token)).status,200);
const emailCode=lastRecoveryCode();
assert.equal((await call('/v1/recovery/email/verify',{code:emailCode})).data.verified,true);
assert.equal((await call('/v1/recovery/email/verify',{code:emailCode})).status,400,
 'email confirmation codes are single use');
assert.equal((await call('/v1/account',undefined,recoverAccount.token)).data.account.verified_email,
 'recover.me@example.org');
const activeSessions=await call('/v1/account/sessions',undefined,recoverAccount.token);
assert.equal(activeSessions.status,200);
assert(activeSessions.data.sessions.some(s=>s.current===true),'sessions should be visible');
assert.equal((await call('/v1/account/sessions/revoke',{
  session_id:activeSessions.data.sessions[0].session_id
},bob.token)).status,404,'a user must not revoke another account session');
const unknown=await call('/v1/recovery/start',{kind:'password',identity:'unknown@example.org'});
const known=await call('/v1/recovery/start',{kind:'password',identity:'recover_me'});
assert.equal(unknown.status,200);
assert.deepEqual(unknown.data,known.data,'forgot-password must not enumerate accounts');
const resetToken=lastRecoveryCode();
const newerKey=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const newerSalt=to64(crypto.getRandomValues(new Uint8Array(16)));
const newerPub=to64(await crypto.subtle.exportKey('raw',newerKey.publicKey));
const newProof={
  code:resetToken,password_salt:newerSalt,password_public_key:newerPub,
  registration_signature:to64(await sign(newerKey.privateKey,
    'VIS-CLOUD-REGISTER-V2\nrecover_me\n'+newerSalt))
};
assert.equal((await call('/v1/recovery/reset',{...newProof,registration_signature:'invalid'})).status,400);
assert.equal((await call('/v1/recovery/reset',newProof)).status,200);
assert.equal((await call('/v1/recovery/reset',newProof)).status,400,
 'reset code replay must be rejected');
assert.equal((await call('/v1/state',undefined,recoverAccount.token)).status,401,
 'old sessions must expire after recovery');
const oldDeviceChallenge=await call('/v1/auth/challenge',{username:'recover_me'});
assert.equal(oldDeviceChallenge.status,200);
assert.equal((await call('/v1/auth/session',{
  username:'recover_me',challenge_id:oldDeviceChallenge.data.id,
  signature:to64(await sign(recoverAccount.signing.privateKey,
    authText('recover_me',oldDeviceChallenge.data)))
})).status,401,'old device keys must stop working after password reset');
const newChallenge=await call('/v1/accounts/login/challenge',{identifier:'recover_me'});
assert.equal(newChallenge.status,200);
const newLogin=await call('/v1/accounts/login/verify',{
  identifier:'recover_me',challenge_id:newChallenge.data.challenge_id,
  signature:to64(await sign(newerKey.privateKey,
    'VIS-CLOUD-AUTH-V2\nrecover_me\n'+newChallenge.data.challenge_id+'\n'+newChallenge.data.nonce))
});
assert.equal(newLogin.status,200,JSON.stringify(newLogin));
const emailReminder=await call('/v1/recovery/start',{
  kind:'username',identity:'recover.me@example.org'
});
assert.equal(emailReminder.status,200);
assert(recoveryDeliveries.at(-1).text.includes('recover_me'));
assert(!recoveryDeliveries.some(d=>JSON.stringify(d).includes(oldSalt)),
 'email must never contain password verifier salts');
assert.equal((await call('/v1/account/mfa/verify',{code:'000000'},newLogin.data.token)).status,409,
 'MFA verifies only after enrollment');
console.log('VIS Ceibo email, recovery, MFA and session tests passed');

console.log('VIS Social authentication, encrypted delivery and D1 migrations passed');
