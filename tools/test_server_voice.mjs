import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {serverVoice} from '../services/social/server-voice.mjs';
const sql=new DatabaseSync(':memory:');sql.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE social_users(id TEXT PRIMARY KEY,username TEXT,disabled_at INTEGER);
CREATE TABLE social_projects(id TEXT PRIMARY KEY,visibility TEXT);
CREATE TABLE project_subscriptions(project_id TEXT,user_id TEXT);
CREATE TABLE project_staff(project_id TEXT,user_id TEXT);
CREATE TABLE project_members(project_id TEXT,user_id TEXT,can_play INTEGER);
CREATE TABLE project_settings(project_id TEXT,play_access TEXT);`);
sql.exec(readFileSync(new URL('../services/social/migrations/0015_server_voice.sql',import.meta.url),'utf8'));
for(const name of ['alice','bob','eve'])sql.prepare('INSERT INTO social_users VALUES(?,?,NULL)').run(name,name);
for(const id of ['one','two'])sql.prepare("INSERT INTO social_projects VALUES(?,'published')").run(id);
for(const [project,user]of [['one','alice'],['one','bob'],['two','eve']])sql.prepare('INSERT INTO project_subscriptions VALUES(?,?)').run(project,user);
const db={prepare(text){return {args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(text).get(...this.args);},async all(){return {results:sql.prepare(text).all(...this.args)};},async run(){return {meta:{changes:sql.prepare(text).run(...this.args).changes}};}};}};
let time=1000;const api={parseBody:r=>r.json(),now:()=>time,reply:r=>r,bad:(status,message)=>{throw Object.assign(Error(message),{status});},env:{VOICE_GLOBAL_PROJECTS:'one,two'}};
async function call(action,user,body={}){if(action==='room')body={client_id:({alice:'a',bob:'b',eve:'e'}[user]||'f').repeat(32),...body};try{return {status:200,data:await serverVoice('/v1/voice/'+action,new Request('https://test',{method:'POST',body:JSON.stringify(body)}),db,{id:user},api)};}catch(error){if(!error.status)throw error;return {status:error.status};}}
assert.equal((await call('room','eve',{project_id:'one'})).status,403);
const alice=(await call('room','alice',{project_id:'one'})).data;
const bob=(await call('room','bob',{project_id:'one'})).data;
const eve=(await call('room','eve',{project_id:'two'})).data;
assert.equal(bob.peers[0].id,alice.id);assert.equal(bob.peers[0].username,'alice');
assert.equal((await call('signal','eve',{to:bob.id,payload:JSON.stringify({type:'offer',sdp:'x'})})).status,403);
assert.equal((await call('signal','alice',{to:bob.id,payload:JSON.stringify({type:'call'})})).status,400);
await call('signal','alice',{to:bob.id,payload:JSON.stringify({type:'offer',sdp:'x'})});
const message=(await call('poll','bob')).data.signals[0];assert.equal(message.sender,alice.id);
await call('poll','eve',{ack:[message.id]});assert.equal((await call('poll','bob')).data.signals.length,1);
await call('poll','bob',{ack:[message.id]});assert.equal((await call('poll','bob')).data.signals.length,0);
sql.prepare("DELETE FROM project_subscriptions WHERE user_id='alice'").run();
assert.equal((await call('poll','alice')).status,403);
time+=46;assert.equal((await call('poll','bob')).status,410);
assert.equal((await call('room','bob',{project_id:'one'})).data.peers.length,0);
console.log('Server voice authorization, room isolation, bounded signalling, owned ACKs, membership revocation and leases passed');
const {serverVoicePositions}=await import('../services/social/server-voice.mjs');
api.env={VOICE_POSITION_TOKEN:'s'.repeat(40),VOICE_POSITION_PROJECT:'one'};
db.batch=async statements=>{sql.exec('BEGIN');try{for(const query of statements)await query.run();sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}};
sql.prepare("INSERT INTO project_subscriptions VALUES('one','alice')").run();
async function positions(players,token='s'.repeat(40)){
 try{return {status:200,data:await serverVoicePositions(new Request('https://test',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({project_id:'one',players})}),db,api)};}catch(error){if(!error.status)throw error;return {status:error.status};}
}
const nearby=[{username:'alice',dimension:'overworld',x:0,y:64,z:0},{username:'bob',dimension:'overworld',x:10,y:64,z:0}];
assert.equal((await positions(nearby,'wrong-token')).status,403);
assert.equal((await positions(nearby)).status,200);
await call('room','alice',{project_id:'one'});
let neighbours=(await call('room','bob',{project_id:'one'})).data;
assert.equal(neighbours.peers.length,1);assert.equal(neighbours.peers[0].distance,10);
await positions([nearby[0],{...nearby[1],x:200}]);
assert.equal((await call('room','bob',{project_id:'one'})).data.peers.length,0);
await positions([nearby[0],{...nearby[1],dimension:'nether'}]);
assert.equal((await call('room','bob',{project_id:'one'})).data.peers.length,0);
await positions(nearby);time+=4;
assert.equal((await call('room','bob',{project_id:'one'})).data.peers.length,0,'stale positions fail closed');
console.log('Authoritative proximity: authenticated publisher, distance, dimensions and stale-position isolation passed');


// Joining the seventeenth participant must work on the default configuration.
api.env={VOICE_GLOBAL_PROJECTS:'one'};
for(let n=0;n<32;n++){
 const user='load_'+n;
 sql.prepare('INSERT INTO social_users VALUES(?,?,NULL)').run(user,user);
 sql.prepare("INSERT INTO project_subscriptions VALUES('one',?)").run(user);
 const joined=await call('room',user,{project_id:'one'});
 assert.equal(joined.status,200,'participant '+n);
 assert.equal(joined.data.capacity,null);
}
api.env.VOICE_MAX_PARTICIPANTS='2';
assert.equal((await call('room','eve',{project_id:'one'})).status,403);
sql.prepare("INSERT INTO project_subscriptions VALUES('one','eve')").run();
assert.equal((await call('room','eve',{project_id:'one'})).status,429);
api.env.VOICE_MAX_PARTICIPANTS='bad';
assert.equal((await call('room','bob',{project_id:'one'})).status,503);
api.env.VOICE_MAX_PARTICIPANTS='0';
sql.prepare("INSERT INTO project_settings VALUES('one','members')").run();
assert.equal((await call('room','bob',{project_id:'one'})).status,403,'subscription alone cannot bypass private play policy');
sql.prepare("INSERT INTO project_members VALUES('one','bob',1)").run();
assert.equal((await call('room','bob',{project_id:'one'})).status,200);
console.log('32+ participant admission, optional operator capacity and Android community play-policy compatibility passed');
