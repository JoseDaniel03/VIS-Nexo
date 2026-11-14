// Account-scoped transport for Nexo and the native VIS Portals panel.
const encoder=new TextEncoder();
const clip=(value,max)=>String(value??'').slice(0,max);
const isOnline=social=>typeof social.online==='function'?social.online():social.connected();
const accountName=/^[a-z0-9_]{3,24}$/;
export function portalsSnapshot(state,social,voice,options={}){
 const connected=isOnline(social);
 const username=state.user?.username||'';
 const query=clip(options.query,64).toLowerCase();
 const friends=connected?(state.friends||[]).filter(f=>accountName.test(f.username)&&
  [f.username,f.alias,f.display_name,f.public_handle].join(' ').toLowerCase().includes(query))
  .sort((a,b)=>Number(b.presence==='online')-Number(a.presence==='online')||String(a.alias||a.display_name||a.username).localeCompare(String(b.alias||b.display_name||b.username)))
  .slice(0,40).map(f=>({username:f.username,name:clip(f.alias||f.display_name||f.username,64),handle:clip(f.public_handle||f.username,24),presence:['online','away','busy'].includes(f.presence)?f.presence:'offline',status:clip(f.custom_status,100)})):[];
 const selected=options.selected||'';
 const messages=connected?(state.messages||[]).filter(m=>(m.from===username||m.to===username)&&
  (!selected||m.from===selected||m.to===selected)).slice(-20).map(m=>({id:clip(m.id||m.created,80),from:clip(m.from,24),to:clip(m.to,24),body:clip(m.body,1300)})):[];
 const latest=connected?(state.messages||[]).filter(m=>m.to===username&&m.from!==username).at(-1):null;
 const snapshot={connected,account:{username,display_name:clip(social.state()?.display_name||username,64)},
  friends,messages,world_sharing:connected&&options.sharing===true,
  invitations:connected?social.worldInvitations().slice(0,2).map(i=>({id:clip(i.id,100),sender:clip(i.sender,24)})):[],
  auto_pause:options.autoPause!==false,hotkey:options.hotkey||'F8',quiet:social.state()?.presence==='busy',
  notice:latest?{id:clip(latest.id||latest.created,80),from:clip(latest.from,24)}:null,error:clip(options.error,150),
  voice:connected?voice.status():{connected:false,muted:true,deaf:false},presence:connected?(social.state()?.presence||'online'):'offline'};
 while(encoder.encode(JSON.stringify(snapshot)).length>11500&&snapshot.messages.length)snapshot.messages.shift();
 while(encoder.encode(JSON.stringify(snapshot)).length>11500&&snapshot.friends.length)snapshot.friends.pop();
 return snapshot;
}
export function createGamePortals(command,social,worlds,voice,view,onError,onSettings=()=>{},onGameState=()=>{}){
 let timer=null,busy=false,owner='',muted=false,deaf=false,lastError='',inflight=0,running=false,generation=0;
 const failures=new Map(),queries=new Map(),selections=new Map(),worldStatus=new Map();
 const current=(identity,epoch)=>generation===epoch&&view().user?.username===identity;
 function setRunning(value){if(running!==!!value){running=!!value;onGameState(running);}}
 function reset(){queries.clear();selections.clear();failures.clear();worldStatus.clear();lastError='';muted=false;deaf=false;}
 function dispatch(task,identity,epoch){if(inflight>=32)return;inflight++;void Promise.resolve().then(()=>{
  if(current(identity,epoch)&&isOnline(social))return task();
 }).catch(error=>{if(current(identity,epoch)){lastError=String(error);onError(lastError);}}).finally(()=>inflight--);}
 async function tick(){
  if(busy)return;busy=true;const epoch=generation;
  try{
   const state=view(),identity=state.user?.username||'';
   if(!identity){reset();owner='';social.setGameActive(false);setRunning(false);await voice.leave();return;}
   if(owner!==identity){reset();owner=identity;await voice.leave();}
   if(!current(identity,epoch))return;
   const games=await command('portals_games');
   if(!current(identity,epoch))return;
   setRunning(games.length>0);social.setGameActive(games.length>0);
   const active=new Set(games.map(g=>g.pid));
   for(const map of [worldStatus,failures,queries,selections])for(const pid of map.keys())if(!active.has(pid))map.delete(pid);
   if(!isOnline(social)){reset();await voice.leave();}
   for(const game of games){
    if(!current(identity,epoch))return;
    if(Date.now()<(failures.get(game.pid)||0))continue;
    try{
     if(isOnline(social)){
      const last=worldStatus.get(game.pid);
      if(!last||Date.now()-last.at>2500){
       try{const status=await command('portals_command',{pid:game.pid,action:'status',code:null});
        if(!current(identity,epoch))return;
        worldStatus.set(game.pid,{at:Date.now(),sharing:status.sharing===true});
       }catch{worldStatus.delete(game.pid);}
      }
     }
     if(!current(identity,epoch))return;
     const snapshot=portalsSnapshot(view(),social,voice,{query:queries.get(game.pid),selected:selections.get(game.pid),sharing:worldStatus.get(game.pid)?.sharing,
      autoPause:localStorage.getItem('vis-portals-autopause')!=='false',hotkey:localStorage.getItem('vis-portals-hotkey')||'F8',error:lastError});
     const result=await command('portals_exchange',{pid:game.pid,snapshot});
     if(!current(identity,epoch)||!isOnline(social))continue;
     lastError='';failures.delete(game.pid);
     for(const event of result.events||[]){
      const send=task=>dispatch(task,identity,epoch);
      if(event.type==='search')queries.set(game.pid,clip(event.query,64).toLowerCase());
      if(event.type==='select')selections.set(game.pid,clip(event.username,24));
      if(event.type==='send')send(()=>social.sendMessage(event.to,event.body));
      if(event.type==='invite')send(()=>worlds.invite(event.to,game.pid));
      if(event.type==='join')send(()=>worlds.join(event.id,game.pid));
      if(event.type==='decline')send(()=>social.declineWorld(event.id));
      if(event.type==='stop')send(async()=>{await worlds.stop(game.pid);worldStatus.delete(game.pid);});
      if(event.type==='presence')send(()=>social.setPresence(event.value,event.custom_status||''));
      if(event.type==='voice'){
       if(event.action==='join')send(()=>voice.join(game.project_id));
       if(event.action==='leave')send(()=>voice.leave());
       if(event.action==='mute'){muted=!muted;voice.setMute(muted);}
       if(event.action==='deafen'){deaf=!deaf;voice.setDeaf(deaf);}
       if(event.action==='ptt')voice.setPtt(event.pressed);
       if(event.action==='settings')onSettings();
       if(event.action==='mode')voice.setMode(event.value);
      }
     }
    }catch(error){if(current(identity,epoch)){lastError=String(error);failures.set(game.pid,Date.now()+10000);onError(lastError);}}
   }
   if(!games.length&&voice.status().connected)await voice.leave();
  }catch(error){if(epoch===generation){setRunning(false);onError(String(error));}}finally{busy=false;}
 }
 return {refresh:tick,start(){if(!timer){generation++;void tick();timer=setInterval(()=>void tick(),500);}},async stop(){generation++;if(timer)clearInterval(timer);timer=null;reset();owner='';await voice.leave();social.setGameActive(false);setRunning(false);}};
}
