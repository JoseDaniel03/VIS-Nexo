import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {worldInvites} from '../services/social/world-invites.mjs';
const sqlite=new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE social_users(id TEXT PRIMARY KEY,username TEXT,disabled_at INTEGER);');
sqlite.exec(readFileSync(new URL('../services/social/migrations/0014_world_invites.sql',import.meta.url),'utf8'));
for(const name of ['alice','bob','charlie'])sqlite.prepare('INSERT INTO social_users(id,username) VALUES(?,?)').run(name,name);
const db={prepare(sql){return {args:[],bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...this.args);},async all(){return {results:sqlite.prepare(sql).all(...this.args)};},async run(){return {meta:{changes:sqlite.prepare(sql).run(...this.args).changes}};}};}};
let time=1000,friends=true;
const notifications=[];
const api={now:()=>time,parseBody:r=>r.json(),bad:(status,message)=>{throw Object.assign(Error(message),{status});},reply:value=>value,
 areFriends:async(_db,a,b)=>friends&&[a,b].sort().join(',')==='alice,bob',
 lookupUser:async(_db,name)=>({id:name==='bob_public'?'bob':name}),wakeRealtime:(_env,id)=>notifications.push(id)};
async function call(action,user,body){try{return {status:200,data:await worldInvites('/v1/worlds/'+action,new Request('https://test',{method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})}),db,{id:user},api)};}catch(error){if(!error.status)throw error;return {status:error.status};}}
const envelope=JSON.stringify({v:1,iv:'a'.repeat(16),ct:'a'.repeat(24)});
const room='a'.repeat(32),id='b'.repeat(32);
assert.equal((await call('host','alice',{room_id:room})).status,200);
assert.equal((await call('host','bob',{room_id:room})).status,409);
assert.equal((await call('invite','alice',{room_id:room,id,to:'charlie',payload:envelope})).status,403);
assert.equal((await call('invite','alice',{room_id:room,id,to:'bob_public',payload:envelope})).status,200);
assert.equal(notifications[0],'bob');
assert.equal((await call('inbox','charlie')).data.invitations.length,0);
assert.equal((await call('inbox','bob')).data.invitations[0].payload,envelope);
assert.equal((await call('accept','charlie',{id})).status,410);
friends=false;assert.equal((await call('accept','bob',{id})).status,403);friends=true;
assert.equal((await call('accept','bob',{id})).status,200);
assert.equal((await call('accept','bob',{id})).status,410);
const id2='c'.repeat(32);
await call('invite','alice',{room_id:room,id:id2,to:'bob',payload:envelope});
await call('close','bob',{room_id:room});
assert.equal((await call('inbox','bob')).data.invitations.length,1);
await call('close','alice',{room_id:room});
assert.equal((await call('accept','bob',{id:id2})).status,410);
assert.equal((await call('host','alice',{room_id:room})).status,409);
const room2='d'.repeat(32),id3='e'.repeat(32);
await call('host','alice',{room_id:room2});
await call('invite','alice',{room_id:room2,id:id3,to:'bob',payload:envelope});
time+=91;
assert.equal((await call('inbox','bob')).data.invitations.length,0);
assert.equal((await call('accept','bob',{id:id3})).status,410);
assert.equal((await call('host','alice',{room_id:room2})).status,409);
console.log('World invitations: membership, stable handles, encryption envelopes, one-use acceptance, ownership, closure and crash leases passed');

