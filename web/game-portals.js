// One bridge shared by the native game panel and VIS Nexo's social session.
export function createGamePortals(command,social,worlds,voice,view,onError,onSettings=()=>{}){
 let timer=null,busy=false,owner='',muted=false,deaf=false,lastError='',inflight=0;
 function dispatch(task){if(inflight>=32)return;const identity=owner;inflight++;void Promise.resolve().then(()=>{if(view().user?.username===identity)return task();}).catch(error=>{lastError=String(error);onError(lastError);}).finally(()=>inflight--);}
 const failures=new Map(),queries=new Map();
 async function tick(){
  if(busy)return;busy=true;
  try{
   const state=view();
   if(!state.user||!social.connected()){social.setGameActive(false);if(owner){owner='';await voice.leave();}return;}
   if(owner&&owner!==state.user.username){queries.clear();await voice.leave();}owner=state.user.username;
   const games=await command('portals_games');social.setGameActive(games.length>0);
   for(const game of games){
    if(Date.now()<(failures.get(game.pid)||0))continue;
    try{
     const notice=(state.messages||[]).filter(m=>m.from!==state.user.username).at(-1);
     const snapshot={invitations:social.worldInvitations().slice(0,3).map(i=>({id:i.id,sender:i.sender})),auto_pause:localStorage.getItem("vis-portals-autopause")!=="false",hotkey:localStorage.getItem("vis-portals-hotkey")||"F8",quiet:social.state()?.presence==='busy',notice:notice?{id:notice.id||notice.created,from:notice.from}:null,friends:(state.friends||[]).filter(f=>!queries.get(game.pid)||[f.username,f.alias,f.display_name].join(" ").toLowerCase().includes(queries.get(game.pid))).slice(0,40).map(f=>({username:f.username,name:f.alias||f.display_name||f.username,presence:f.presence})),messages:(state.messages||[]).slice(-12).map(m=>({...m,body:m.body})),error:lastError.slice(0,150),voice:voice.status(),presence:social.state()?.presence||'online'};
     // Keep the wire bounded independently of history retention policy.
     while(new TextEncoder().encode(JSON.stringify(snapshot)).length>11500&&snapshot.messages.length)snapshot.messages.shift();
     const result=await command('portals_exchange',{pid:game.pid,snapshot});
     if(view().user?.username!==owner)return;
     for(const event of result.events||[]){
      if(event.type==='search')queries.set(game.pid,String(event.query||'').toLowerCase().slice(0,64));
      if(event.type==='send')dispatch(()=>social.sendMessage(event.to,event.body));
      if(event.type==='invite')dispatch(()=>worlds.invite(event.to,game.pid));
      if(event.type==='join')dispatch(()=>worlds.join(event.id,game.pid));
      if(event.type==='decline')dispatch(()=>social.declineWorld(event.id));
      if(event.type==='presence')dispatch(()=>social.setPresence(event.value,event.custom_status||''));
      if(event.type==='voice'){
       if(event.action==='join')dispatch(()=>voice.join(game.project_id));
       if(event.action==='leave')dispatch(()=>voice.leave());
       if(event.action==='mute'){muted=!muted;voice.setMute(muted);}
       if(event.action==='deafen'){deaf=!deaf;voice.setDeaf(deaf);}
       if(event.action==='ptt')voice.setPtt(event.pressed);
       if(event.action==='settings')onSettings();
       if(event.action==='mode')voice.setMode(event.value);
      }
     }
    }catch(error){failures.set(game.pid,Date.now()+10000);onError(String(error));}
   }
   if(!games.length&&voice.status().connected)await voice.leave();
  }catch(error){onError(String(error));}finally{busy=false;}
 }
 return {start(){if(!timer)timer=setInterval(()=>void tick(),250);},async stop(){if(timer)clearInterval(timer);timer=null;await voice.leave();social.setGameActive(false);}};
}

