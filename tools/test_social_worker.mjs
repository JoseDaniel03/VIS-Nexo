import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../services/social/worker.mjs';

class D1Database {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON;');
    for (const path of [
      '../services/social/migrations/0001_social_core.sql',
      '../services/social/migrations/0002_device_auth.sql'
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
const env = { DB };
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
assert.equal(response.data.schema, 2);
assert.equal((await call('/v1/state')).status, 401);

const alice = await account('alice');
const bob = await account('bob');
assert.equal((await call('/v1/keys', {public_key: 'not_a_key'}, alice.token)).status, 400);
assert.equal((await call('/v1/friends/request', {username: 'bob'}, alice.token)).status, 201);
response = await call('/v1/state', undefined, bob.token);
assert.deepEqual(response.data.incoming_requests, ['alice']);
assert.equal((await call('/v1/friends/accept', {username: 'alice'}, alice.token)).status, 404);
assert.equal((await call('/v1/friends/accept', {username: 'alice'}, bob.token)).status, 200);
response = await call('/v1/state', undefined, alice.token);
assert.equal(response.data.friends[0].username, 'bob');
assert.equal(response.data.friends[0].public_key, bob.encryptionPublic);
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
response = await call('/v1/messages/send', {
  to:'bob',client_message_id:id,payload:envelope
},alice.token);
assert.equal(response.status,200,JSON.stringify(response));
response = await call('/v1/state',undefined,bob.token);
assert.equal(response.data.pending_messages.length,1);
assert(!JSON.stringify(response.data).includes('hello encrypted chat'));
assert.equal(response.data.pending_messages[0].from, 'alice');
const pendingID = response.data.pending_messages[0].id;
assert.equal((await call('/v1/messages/ack',{ids:[pendingID]},alice.token)).status,200);
assert.equal((await call('/v1/state',undefined,bob.token)).data.pending_messages.length,1);
assert.equal((await call('/v1/messages/ack',{ids:[pendingID]},bob.token)).status,200);
assert.equal((await call('/v1/state',undefined,bob.token)).data.pending_messages.length,0);
assert.equal((await call('/v1/keys',{public_key:alice.encryptionPublic},bob.token)).status,409);
assert.equal((await call('/v1/auth/logout',{},bob.token)).status,200);
assert.equal((await call('/v1/state',undefined,bob.token)).status,401);

DB.sqlite.exec("UPDATE auth_sessions SET expires_at=1");
DB.sqlite.exec("UPDATE auth_challenges SET expires_at=1");
DB.sqlite.exec("UPDATE auth_rate_limits SET expires_at=1");
await worker.scheduled({},env);
assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM auth_sessions').get().n,0);
console.log('VIS Social authentication, encrypted delivery and D1 migrations passed');
