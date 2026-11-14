// Real Cloudflare smoke test: two independent ephemeral client identities.
// GitHub Actions must clean the exact test accounts from D1 in an always() step.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const base=(process.env.VIS_SOCIAL_TEST_URL || "https://vis-social.defreitascarranza-845.workers.dev").replace(/\/$/,"");
if (!/^https:\/\/[a-z0-9.-]+$/.test(base)) throw Error("Trusted HTTPS Worker URL required");
const suffix=crypto.randomUUID().replaceAll("-","").slice(0,12);
const names=["visci"+suffix+"a","visci"+suffix+"b","visci"+suffix+"c"];
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
assert.equal(health.schema,12);
// The actual launcher derives this Ed25519 key using Argon2id/password.
// The network protocol proves possession of the key, never transmits a PIN.
const cloudSigning=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
const cloudSalt=b64(crypto.getRandomValues(new Uint8Array(16)));
const cloudPublic=b64(await crypto.subtle.exportKey("raw",cloudSigning.publicKey));
const cloudRegistration={
 username:names[2],password_salt:cloudSalt,password_public_key:cloudPublic,
 registration_signature:await sign(cloudSigning.privateKey,
  "VIS-CLOUD-REGISTER-V2\n"+names[2]+"\n"+cloudSalt)
};
const online=await request("/v1/accounts/register",cloudRegistration);
assert.match(online.public_id,/^[a-f0-9]{24}$/);
assert.equal(online.username,names[2]);
async function loginCloud(identifier) {
 const challenge=await request("/v1/accounts/login/challenge",{identifier});
 assert.equal(challenge.salt,cloudSalt);
 const signature=await sign(cloudSigning.privateKey,
  "VIS-CLOUD-AUTH-V2\n"+names[2]+"\n"+challenge.challenge_id+"\n"+challenge.nonce);
 return request("/v1/accounts/login/verify",{
  identifier,challenge_id:challenge.challenge_id,signature
 });
}
const byId=await loginCloud(online.public_id);
const byName=await loginCloud(names[2]);
assert.equal(byId.username,names[2]);
assert.equal(byName.username,names[2]);
await request("/v1/accounts/login/challenge",{identifier:"accountdoesnotexist"},undefined,401);
const onlineInfo=await request("/v1/account",undefined,byId.token);
assert.equal(onlineInfo.account.role,"user");
assert.equal(onlineInfo.account.cloud_login_enabled,true);
const a=await identity(names[0]), b=await identity(names[1]);
const accountA=await request("/v1/account",undefined,a.token);
const accountB=await request("/v1/account",undefined,b.token);
assert.equal(accountA.account.role,"user","No account may self-bootstrap as admin");
assert.equal(accountB.account.role,"user");
const publicProjects=await request("/v1/projects",undefined,a.token);
assert(Array.isArray(publicProjects.projects));
await request("/v1/admin/projects/upsert",{
  id:"vis-sec-probe",title:"Unauthorized",visibility:"published"
},a.token,403);
await request("/v1/admin/accounts/role",{
  username:b.username,role:"super_admin"
},a.token,403);
await request("/v1/projects/subscribe",{
  project_id:"does-not-exist-security-probe"
},a.token,404);
const browserOrigin=await fetch(base+"/v1/state",{
  headers:{Origin:"https://untrusted.example",Authorization:"Bearer "+a.token},
  signal:AbortSignal.timeout(15000)
});
assert.equal(browserOrigin.status,403,"Browser-origin requests must be denied");

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
// A real 2x2 WebP thumbnail is stored and retrieved only by friends.
const tinyWebP="UklGRjYAAABXRUJQVlA4ICoAAACQAQCdASoCAAIAAkA4JaACdLoAA5gA/u921/5mj7zfZb1J/UREFJWwAAA=";
const uploaded=await request("/v1/avatar/upload",{
 mime:"image/webp",data:tinyWebP
},a.token);
assert.equal(uploaded.ok,true);
const friendAvatar=await request("/v1/avatar/get",{username:a.username},b.token);
assert.equal(friendAvatar.avatar,"data:image/webp;base64,"+tinyWebP);
assert(friendAvatar.avatar_version>0);
await request("/v1/avatar/upload",{
 mime:"image/svg+xml",data:"PHN2Zz48L3N2Zz4="
},a.token,400);
await request("/v1/avatar/get",{username:a.username},byId.token,403);
await request("/v1/auth/logout",{},online.token);
await request("/v1/auth/logout",{},byId.token);
await request("/v1/auth/logout",{},byName.token);
await request("/v1/auth/logout",{},a.token);
await request("/v1/auth/logout",{},b.token);
console.log("PASS: Cloudflare two-device bidirectional encrypted chat, ACK, friendship and presence");

