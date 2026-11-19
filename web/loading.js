/** VIS Nexo - loading de operaciones. No simular porcentajes ni forzar demoras. */
const operations=Object.freeze({
  login:['Iniciando sesión','Verificando tu cuenta local','atmosphere'],
  register:['Creando tu cuenta','Preparando tu identidad VIS','atmosphere'],
  login_offline:['Preparando modo offline','Cargando instancias locales','atmosphere'],
  social_cloud_login:['Conectando con VIS Ceibo','Verificando tu sesión','atmosphere'],
  social_cloud_register:['Registrando tu cuenta','Creando tu identidad en VIS Ceibo','atmosphere'],
  install_minecraft:['Instalando Minecraft','Preparando los archivos de la instancia','forest'],
  launch_minecraft:['Iniciando Minecraft Java','Preparando el juego y la sesión','forest'],
  launch_horizon:['Iniciando Minecraft Rust','Preparando Horizon y la instancia','forest'],
  sync_project_mods:['Sincronizando proyecto','Verificando los mods instalados','forest'],
  install_modrinth:['Instalando contenido','Descargando recursos compatibles','forest'],
  import_worlds_instance:['Importando VIS Worlds','Verificando archivos y rutas','forest'],
  export_worlds_instance:['Exportando VIS Worlds','Creando paquete portátil','forest'],
  apply_team_project:['Actualizando proyecto','Aplicando recursos compartidos','forest'],
  publish_team_project:['Publicando VIS Team','Preparando recursos del proyecto','forest'],
  publish_universe:['Publicando VIS Universe','Sincronizando proyectos','atmosphere']
});
const tasks=[];
let view=null,showTimer=null,hideTimer=null,focusBefore=null;
const delay=260;
function createView(){
 if(view)return view;
 view=document.createElement('section');
 view.id='vis-operation-overlay';
 view.className='vis-operation-overlay';
 view.hidden=true;
 view.tabIndex=-1;
 view.setAttribute('role','dialog');
 view.setAttribute('aria-modal','true');
 view.setAttribute('aria-labelledby','vis-operation-title');
 view.setAttribute('aria-describedby','vis-operation-detail');
 view.innerHTML=
 '<div class="vis-operation__shade" aria-hidden="true"></div>'+
 '<div class="vis-operation__identity">'+
 '<div class="vis-operation__mark"><img src="./assets/vis-nexo-mark.svg" alt=""></div>'+
 '<div class="vis-operation__eyebrow">VIS NEXO</div>'+
 '<h2 id="vis-operation-title"></h2>'+
 '<p id="vis-operation-detail" aria-live="polite"></p></div>'+
 '<div class="vis-operation__footer"><div class="vis-operation__meta">'+
 '<span>CARGANDO</span><span id="vis-operation-percentage"></span></div>'+
 '<div class="vis-operation__track" role="progressbar" aria-label="Progreso de la operación">'+
 '<span class="vis-operation__bar"></span></div>'+
 '<span class="vis-operation__help">No cierres VIS Nexo durante esta operación</span></div>';
 document.body.append(view);
 return view;
}
function paint(){
 const item=tasks[tasks.length-1];
 if(!item)return;
 const node=createView();
 if(hideTimer!==null){clearTimeout(hideTimer);hideTimer=null;}
 const opening=node.hidden;
 node.hidden=false;
 node.dataset.scene=item.scene;
 node.querySelector('#vis-operation-title').textContent=item.title;
 node.querySelector('#vis-operation-detail').textContent=item.detail;
 const track=node.querySelector('.vis-operation__track');
 const bar=node.querySelector('.vis-operation__bar');
 const label=node.querySelector('#vis-operation-percentage');
 const real=Number.isFinite(item.percent);
 track.classList.toggle('is-determinate',real);
 if(real){
   track.setAttribute('aria-valuemin','0');
   track.setAttribute('aria-valuemax','100');
   track.setAttribute('aria-valuenow',String(item.percent));
   bar.style.width=item.percent+'%';
   label.textContent=item.percent+'%';
 }else{
   track.removeAttribute('aria-valuemin');
   track.removeAttribute('aria-valuemax');
   track.removeAttribute('aria-valuenow');
   bar.style.removeProperty('width');
   label.textContent='';
 }
 node.classList.add('is-visible');
 if(opening){
   focusBefore=document.activeElement;
   const app=document.querySelector('#app');
   app?.setAttribute('inert','');
   app?.setAttribute('aria-busy','true');
   node.focus({preventScroll:true});
 }
}
function schedule(){
 if(!tasks.length)return;
 if(view&&!view.hidden){paint();return;}
 if(showTimer!==null)return;
 showTimer=setTimeout(()=>{showTimer=null;if(tasks.length)paint();},delay);
}
function finish(item){
 const index=tasks.indexOf(item);
 if(index>=0)tasks.splice(index,1);
 if(tasks.length){schedule();return;}
 if(showTimer!==null){clearTimeout(showTimer);showTimer=null;}
 if(!view||view.hidden)return;
 view.classList.remove('is-visible');
 const app=document.querySelector('#app');
 app?.removeAttribute('inert');
 app?.removeAttribute('aria-busy');
 if(focusBefore?.isConnected&&typeof focusBefore.focus==='function')
   focusBefore.focus({preventScroll:true});
 focusBefore=null;
 hideTimer=setTimeout(()=>{hideTimer=null;if(!tasks.length&&view)view.hidden=true;},220);
}
export async function withOperationLoading(name,run){
 const definition=operations[name];
 if(!definition)return run();
 const [title,detail,scene]=definition;
 const item={name,title,detail,scene,percent:null};
 tasks.push(item);
 schedule();
 try{return await run();}
 finally{finish(item);}
}
/** Progreso: únicamente los valores reales recibidos del backend. */
export function reportMinecraftProgress(payload){
 const item=[...tasks].reverse().find(x=>x.name==='install_minecraft'||x.name==='sync_project_mods');
 if(!item||!payload||typeof payload!=='object')return;
 if(typeof payload.detail==='string'&&payload.detail.trim())
   item.detail=payload.detail.trim().slice(0,170);
 const total=Number(payload.total),done=Number(payload.completed);
 item.percent=Number.isFinite(total)&&Number.isFinite(done)&&total>0&&done>=0&&done<=total
   ? Math.round(done/total*100) : null;
 if(view&&!view.hidden&&tasks[tasks.length-1]===item)paint();
}
