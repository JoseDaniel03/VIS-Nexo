// Background synchronization updates state without success toasts or modal dialogs.
export async function refreshServices({state,command,render,notify,announce=false}){
 if(state.busy)return false;
 const identity=state.auth;state.busy=true;
 try{
  const health=await command('mobile_health').catch(()=>({reachable:false,ready:false}));
  if(state.auth!==identity)return false;
  state.network=health;
  if(!health.ready){
   state.account=null;state.social=null;state.projects=null;
   if(announce)notify(health.reachable?'VIS respondió, pero necesita actualizar su configuración o base de datos.':'No se pudo conectar con VIS.',true);
   return false;
  }
  if(!identity.signed_in){if(announce)notify('Conexión con VIS comprobada');return true;}
  const keys=['account','social','projects'];
  const results=await Promise.allSettled(keys.map(kind=>command('mobile_read',{kind})));
  if(state.auth!==identity)return false;
  results.forEach((result,i)=>{state[keys[i]]=result.status==='fulfilled'?result.value:null;});
  const failed=results.filter(r=>r.status==='rejected').length;
  if(announce)notify(failed?'No se pudieron sincronizar todos los servicios VIS.':'Datos de VIS actualizados',failed>0);
  return failed===0;
 }catch{
  if(state.auth===identity&&announce)notify('No se pudo completar la sincronización con VIS.',true);
  return false;
 }finally{state.busy=false;render();}
}
