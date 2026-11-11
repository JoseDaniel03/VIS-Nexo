// Real Cloudflare smoke test: two independent ephemeral client identities.
// GitHub Actions must clean the exact test accounts from D1 in an always() step.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const base=(process.env.VIS_SOCIAL_TEST_URL || "https://vis-social.defreitascarranza-845.workers.dev").replace(/\/$/,"");
if (!/^https:\/\/[a-z0-9.-]+$/.test(base)) throw Error("Trusted HTTPS Worker URL required");
const suffix=crypto.randomUUID().replaceAll("-","").slice(0,12);
const names=["visci"+suffix+"a","visci"+suffix+"b"];
assert(names.every(n=>/^[a-z0-9_]{3,24}$/.test(n)));
writeFileSync(new URL("../services/social/.vis-ci-live-users.sql",import.meta.url),
  "DELETE FROM social_users WHERE username IN ("+names.map(n=>"'"+n+"'").join(",")+");\n");
const b64 = data=>Buffer.from(data).toString("base64");
async function request(path,body,token,expected=200){
 const r=await fetch(base+path,{
  method:body===undefined?"GET":"POST",
  headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),
           ...(token?{"Authorization":"Bearer "+token}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
  signal:AbortSignal.timeout(15000)
 });
 const data=await r.json();
 assert.equal(r.status,expected,path+" HTTP "+r.status+" "+JSON.stringify(data));
 return data;
}
async function sign(k,text){
 return b64(await crypto.subtle.sign("Ed25519",k,new TextEncoder().encode(text)));
}
async function identity(username){
 const signing=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const public_key=b64(await crypto.subtle.exportKey("raw",signing.publicKey));
 await request("/v1/auth/register",{
  username,public_key,signature:await sign(signing.privateKey,"VIS-SOCIAL-REGISTER-V1\n"+username)
 },undefined,201);
 const challenge=await request("/v1/auth/challenge",{username});
 const session=await request("/v1/auth/session",{
  username,challenge_id:challenge.id,
  signature:await sign(signing.privateKey,"VIS-SOCIAL-AUTH-V1\n"+username+"\n"+challenge.id+"\n"+challenge.nonce)
 });
 const token=session.token;
 assert.match(token,/^[A-Za-z0-9_-]{40,60}$/);
 const ecdh=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},false,["deriveKey"]);
 const pub=b64(await crypto.subtle.exportKey("spki",ecdh.publicKey));
 await request("/v1/keys",{public_key:pub},token);
 return {username,token,ecdh,pub};
}
async function shared(privateKey,publicB64){
 const pub=await crypto.subtle.importKey("spki",Buffer.from(publicB64,"base64"),
  {name:"ECDH",namedCurve:"P-256"},false,[]);
 return crypto.subtle.deriveKey({name:"ECDH",public:pub},privateKey,
  {name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function deliver(from,to,phrase){
 const id=crypto.randomUUID().replaceAll("-","");
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const aad=new TextEncoder().encode("VIS-SOCIAL-MSG-V1\n"+from.username+"\n"+to.username+"\n"+id);
 const aes=await shared(from.ecdh.privateKey,to.pub);
 const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad},
  aes,new TextEncoder().encode(phrase));
 const payload=JSON.stringify({v:1,iv:b64(iv),ct:b64(ct)});
 await request("/v1/messages/send",{to:to.username,client_message_id:id,payload},from.token);
 const state=await request("/v1/state",undefined,to.token);
 const entry=state.pending_messages.find(m=>m.client_message_id===id);
 assert(entry,"Message missing at recipient");
 assert.equal(entry.from,from.username);
 assert(!JSON.stringify(state).includes(phrase),"Remote response leaked plaintext");
 const obj=JSON.parse(entry.payload);
 const other=await shared(to.ecdh.privateKey,from.pub);
 const clear=await crypto.subtle.decrypt({
  name:"AES-GCM",iv:Buffer.from(obj.iv,"base64"),additionalData:aad
 },other,Buffer.from(obj.ct,"base64"));
 assert.equal(new TextDecoder().decode(clear),phrase);
 await request("/v1/messages/ack",{ids:[entry.id]},to.token);
 const after=await request("/v1/state",undefined,to.token);
 assert(!after.pending_messages.some(m=>m.id===entry.id),"ACK did not clear message");
}
const health=await request("/health");
assert.equal(health.status,"ready");
assert.equal(health.schema,2);
const a=await identity(names[0]), b=await identity(names[1]);
await request("/v1/friends/request",{username:b.username},a.token,201);
const incoming=await request("/v1/state",undefined,b.token);
assert(incoming.incoming_requests.includes(a.username),"Recipient must see friend request");
await request("/v1/friends/accept",{username:a.username},b.token);
const alice=await request("/v1/state",undefined,a.token);
const bob=await request("/v1/state",undefined,b.token);
assert(alice.friends.some(f=>f.username===b.username));
assert(bob.friends.some(f=>f.username===a.username));
await request("/v1/presence",{presence:"online",custom_status:"VIS CI test"},b.token);
const visible=await request("/v1/state",undefined,a.token);
assert(visible.friends.some(f=>f.username===b.username&&f.presence==="online"));
await deliver(a,b,"VIS Social live A -> B");
await deliver(b,a,"VIS Social live B -> A");
await request("/v1/auth/logout",{},a.token);
await request("/v1/auth/logout",{},b.token);
console.log("PASS: Cloudflare two-device bidirectional encrypted chat, ACK, friendship and presence");
