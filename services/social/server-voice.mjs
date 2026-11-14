// Server/project voice channels only: no person-to-person call routes.
export async function serverVoice(path,request,db,user,api){
 const {parseBody,bad,reply,now,rateLimit,env}=api;
 if(rateLimit)await rateLimit(db,request,'voice:'+user.id,300);
 const body=await parseBody(request);
 const globalChannel=(project)=>(env?.VOICE_GLOBAL_PROJECTS||'').split(',').includes(project);
 // Zero (default) means no fixed participant-count cap. Operators may opt in.
 const capacity=Number(env?.VOICE_MAX_PARTICIPANTS||0);
 if(!Number.isSafeInteger(capacity)||capacity<0)bad(503,'Invalid voice capacity configuration');
 const radius=Math.max(4,Math.min(128,Number(env?.VOICE_RADIUS)||48));
 const authorized=async project=>{
  const row=await db.prepare("SELECT p.id FROM social_projects p WHERE p.id=? AND p.visibility='published' AND (EXISTS (SELECT 1 FROM project_subscriptions s WHERE s.project_id=p.id AND s.user_id=?) OR EXISTS (SELECT 1 FROM project_staff s WHERE s.project_id=p.id AND s.user_id=?))").bind(project,user.id,user.id).first();
  if(!row)bad(403,'Subscribe to this published project to use its voice channel');
 };
 if(path==='/v1/voice/room'){
  if(typeof body.project_id!=='string'||!(/^[a-zA-Z0-9_-]{3,48}$/.test(body.project_id)))bad(400,'Invalid project');
  await authorized(body.project_id);
  if(typeof body.client_id!=='string'||!/^[a-f0-9]{32}$/.test(body.client_id))bad(400,'Invalid voice device');
  const own=await db.prepare('SELECT * FROM voice_sessions WHERE user_id=?').bind(user.id).first();
  if(own&&own.expires_at>now()&&own.client_id!==body.client_id)bad(409,'Voice is active on another device');
  const same=own&&own.project_id===body.project_id&&own.expires_at>now();
  if(!same&&capacity){
   const count=await db.prepare('SELECT count(*) AS n FROM voice_sessions WHERE project_id=? AND expires_at>?').bind(body.project_id,now()).first();
   if(count.n>=capacity)bad(429,'Server voice capacity reached');
  }
  const id=same?own.id:crypto.randomUUID().replace(/-/g,'');
  if(own&&!same)await db.prepare('DELETE FROM voice_sessions WHERE user_id=?').bind(user.id).run();
  await db.prepare('INSERT INTO voice_sessions(id,user_id,project_id,client_id,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at').bind(id,user.id,body.project_id,body.client_id,now()+45).run();
  const peers=await db.prepare('SELECT s.id,s.user_id,u.username FROM voice_sessions s JOIN social_users u ON u.id=s.user_id WHERE s.project_id=? AND s.expires_at>? AND s.id<>? AND u.disabled_at IS NULL AND (EXISTS (SELECT 1 FROM project_subscriptions m WHERE m.project_id=s.project_id AND m.user_id=s.user_id) OR EXISTS (SELECT 1 FROM project_staff m WHERE m.project_id=s.project_id AND m.user_id=s.user_id))').bind(body.project_id,now(),id).all();
  const visible=[];
  for(const peer of peers.results||[]){
   const distance=globalChannel(body.project_id)?0:await near(db,body.project_id,user.id,peer.user_id,now(),radius);
   if(distance!==null)visible.push({id:peer.id,username:peer.username,distance});
  }
  const iceServers=[];
  if(env?.VOICE_TURN_URL&&env?.VOICE_TURN_SECRET){
   if(!/^turns?:[a-zA-Z0-9.:[\]-]+(?:\?transport=(?:tcp|udp))?$/.test(env.VOICE_TURN_URL))bad(503,'TURN configuration invalid');
   const username=(now()+600)+':'+user.id;
   const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.VOICE_TURN_SECRET),{name:'HMAC',hash:'SHA-1'},false,['sign']);
   const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(username)));
   iceServers.push({urls:env.VOICE_TURN_URL,username,credential:btoa(String.fromCharCode(...signature))});
  }
  return reply({id,capacity:capacity||null,peers:visible,iceServers,mode:globalChannel(body.project_id)?'channel':'proximity',radius});
 }
 const own=await db.prepare('SELECT * FROM voice_sessions WHERE user_id=? AND expires_at>?').bind(user.id,now()).first();
 if(!own)bad(410,'Voice session ended');
 await authorized(own.project_id);
 if(path==='/v1/voice/leave'){if(body.session_id!==own.id)bad(409,'Voice session changed');await db.prepare('DELETE FROM voice_sessions WHERE id=?').bind(own.id).run();return reply({ok:true});}
 if(path==='/v1/voice/signal'){
  if(typeof body.to!=='string'||!/^[a-f0-9]{32}$/.test(body.to))bad(400,'Invalid voice peer');
  const target=await db.prepare('SELECT s.id,s.user_id FROM voice_sessions s JOIN social_users u ON u.id=s.user_id WHERE s.id=? AND s.project_id=? AND s.expires_at>? AND u.disabled_at IS NULL AND (EXISTS (SELECT 1 FROM project_subscriptions m WHERE m.project_id=s.project_id AND m.user_id=s.user_id) OR EXISTS (SELECT 1 FROM project_staff m WHERE m.project_id=s.project_id AND m.user_id=s.user_id))').bind(body.to,own.project_id,now()).first();
  if(!target||target.id===own.id)bad(403,'Peer not in this channel');
  if(!globalChannel(own.project_id)&&await near(db,own.project_id,user.id,target.user_id,now(),radius)===null)bad(403,'Peer outside proximity');
  if(typeof body.payload!=='string'||body.payload.length>7000)bad(400,'Signal too large');
  let signal;try{signal=JSON.parse(body.payload);}catch{bad(400,'Invalid signal');}
  if(!['offer','answer','ice'].includes(signal.type))bad(400,'Invalid signal type');
  const queued=await db.prepare('SELECT count(*) AS n FROM voice_signals WHERE recipient=? AND expires_at>?').bind(target.id,now()).first();
  if(queued.n>=128)bad(429,'Voice signal queue full');
  await db.prepare('INSERT INTO voice_signals(id,sender,recipient,payload,expires_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),own.id,target.id,body.payload,now()+30).run();
  return reply({ok:true});
 }
 if(path==='/v1/voice/poll'){
  for(const id of (Array.isArray(body.ack)?body.ack:[]).slice(0,100))if(typeof id==='string')await db.prepare('DELETE FROM voice_signals WHERE id=? AND recipient=?').bind(id,own.id).run();
  const signals=await db.prepare('SELECT v.id,v.sender,v.payload,s.user_id FROM voice_signals v JOIN voice_sessions s ON s.id=v.sender JOIN social_users u ON u.id=s.user_id WHERE v.recipient=? AND v.expires_at>? AND s.expires_at>? AND s.project_id=? AND u.disabled_at IS NULL ORDER BY v.rowid LIMIT 100').bind(own.id,now(),now(),own.project_id).all();
  const delivered=[];
  for(const message of signals.results||[]){
   if(!globalChannel(own.project_id)&&await near(db,own.project_id,user.id,message.user_id,now(),radius)===null){await db.prepare('DELETE FROM voice_signals WHERE id=? AND recipient=?').bind(message.id,own.id).run();continue;}
   delivered.push({id:message.id,sender:message.sender,payload:message.payload});
  }
  return reply({signals:delivered});
 }
 bad(404,'Unknown voice route');
}

// Called by the game-server/VSMedia adapter, never by a player's launcher.
export async function serverVoicePositions(request,db,api){
 const {env,parseBody,bad,reply,now}=api;
 if(!env.VOICE_POSITION_TOKEN||!env.VOICE_POSITION_PROJECT)bad(503,'Voice position publisher not configured');
 const supplied=request.headers.get('authorization')||'';
 const digest=async text=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
 const a=await digest(supplied),b=await digest('Bearer '+env.VOICE_POSITION_TOKEN);
 let different=0;for(let i=0;i<a.length;i++)different|=a[i]^b[i];if(different)bad(403,'Invalid server publisher');
 const body=await parseBody(request);
 if(body.project_id!==env.VOICE_POSITION_PROJECT||!Array.isArray(body.players)||body.players.length>100)bad(400,'Invalid server positions');
 const statements=[db.prepare('DELETE FROM voice_positions WHERE project_id=?').bind(body.project_id)];
 for(const p of body.players){
  if(typeof p.username!=='string'||typeof p.dimension!=='string'||p.dimension.length>80||![p.x,p.y,p.z].every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=32000000))bad(400,'Invalid player position');
  statements.push(db.prepare('INSERT OR REPLACE INTO voice_positions(project_id,user_id,dimension,x,y,z,updated_at) SELECT ?,id,?,?,?,?,? FROM social_users WHERE username=? AND disabled_at IS NULL').bind(body.project_id,p.dimension,p.x,p.y,p.z,now(),p.username));
 }
 await db.batch(statements);return reply({ok:true});
}
async function near(db,project,a,b,time,radius){
 const rows=await db.prepare('SELECT user_id,dimension,x,y,z FROM voice_positions WHERE project_id=? AND user_id IN (?,?) AND updated_at>?').bind(project,a,b,time-3).all();
 const players=rows.results||[];
 if(players.length!==2||players[0].dimension!==players[1].dimension)return null;
 const distance=Math.hypot(players[0].x-players[1].x,players[0].y-players[1].y,players[0].z-players[1].z);
 return distance<=radius?distance:null;
}
