// Runtime-only shared worlds. Plaintext tunnel codes are never written to chat,
// localStorage, logs or a server; only the recipient's encrypted inbox carries them.
export function createWorldsPortals(command,social,account,choose,onError){
  const rooms=new Map();
  let timer=null,busy=false;
  const owner=()=>account();
  async function game(preferredPid){
    const games=await command('portals_games');
    if(preferredPid){const selected=games.find(g=>g.pid===preferredPid);if(!selected)throw Error('La partida ya no está disponible');return selected;}
    if(!games.length)throw Error('Iniciá una instancia Horizon actualizada desde VIS Nexo. Abrí un mundo para invitar, o quedate en el menú para unirte.');
    return games.length===1?games[0]:choose(games);
  }
  async function close(pid,room){
    rooms.delete(pid);
    if(room.owner===owner())await social.closeWorld(room.id);
    if(!rooms.size&&timer){clearInterval(timer);timer=null;}
  }
  async function renew(){
    if(busy)return;busy=true;
    try{
      for(const [pid,room] of rooms){
        if(room.owner!==owner()||!social.connected()){rooms.delete(pid);continue;}
        try{
          const status=await command('portals_command',{pid,action:'status',code:null});
          if(!status.sharing||status.code!==room.code){await close(pid,room);continue;}
          await social.hostWorld(room.id);
        }catch(error){await close(pid,room).catch(()=>{});onError(error);}
      }
    }finally{
      busy=false;
      if(!rooms.size&&timer){clearInterval(timer);timer=null;}
    }
  }
  async function invite(to,preferredPid){
    if(!social.connected())throw Error('Conectá VIS Portals antes de invitar');
    const identity=owner(),selected=await game(preferredPid);
    if(!selected)return;
    await command('portals_command',{pid:selected.pid,action:'host',code:null});
    let status;
    for(let attempt=0;attempt<30;attempt++){
      if(identity!==owner())throw Error('Cambió la cuenta activa');
      status=await command('portals_command',{pid:selected.pid,action:'status',code:null});
      if(status.sharing&&status.code)break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!status?.code)throw Error('El mundo aún está preparando la conexión. Volvé a invitar en unos segundos.');
    let room=rooms.get(selected.pid);
    if(room&&(room.code!==status.code||room.owner!==identity)){await close(selected.pid,room);room=null;}
    if(!room){room={id:crypto.randomUUID().replace(/-/g,''),code:status.code,owner:identity};rooms.set(selected.pid,room);}
    await social.hostWorld(room.id);
    if(identity!==owner())throw Error('Cambió la cuenta activa');
    await social.inviteWorld(to,room.id,room.code);
    if(!timer)timer=setInterval(()=>void renew(),30000);
  }
  async function join(id,preferredPid){
    const identity=owner(),selected=await game(preferredPid);
    if(!selected)return;
    // Check the game bridge before consuming a one-use invitation.
    const status=await command('portals_command',{pid:selected.pid,action:'status',code:null});
    if(status.can_join!==true)throw Error('Guardá y cerrá tu mundo antes de aceptar la invitación.');
    if(identity!==owner())throw Error('Cambió la cuenta activa');
    const code=await social.acceptWorld(id);
    if(identity!==owner())throw Error('Cambió la cuenta activa');
    await command('portals_command',{pid:selected.pid,action:'join',code});
  }
  async function stop(preferredPid){
    const selected=await game(preferredPid);if(!selected)return;
    await command('portals_command',{pid:selected.pid,action:'stop',code:null});
    const room=rooms.get(selected.pid);if(room)await close(selected.pid,room);
  }
  return {invite,join,stop};
}

