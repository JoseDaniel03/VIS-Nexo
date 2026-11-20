// Shared VIS Nexo diagnostic UI for desktop and Android.
// Keep report data short, local and copy-on-demand; never send logs to a server.
export function redactDiagnostic(value){
  let s=String(value??'Error desconocido').slice(0,8192);
  // Redact secrets BEFORE rendering or copying. Never include stack dumps.
  s=s.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi,'Bearer [OCULTO]');
  s=s.replace(/\b(?:token|access_token|refresh_token|password|secret|authorization|api[_-]?key|ticket|device_code)\s*[:=]\s*["']?[^"'\s&,;}]+/gi,'credencial=[OCULTA]');
  s=s.replace(/\b(?:eyJ[A-Za-z0-9_-]{12,}\.){2}[A-Za-z0-9_-]+/g,'[JWT OCULTO]');
  s=s.replace(/\b(?:[A-Fa-f0-9]{64,}|[A-Za-z0-9_-]{90,})\b/g,'[VALOR OCULTO]');
  s=s.replace(/(?:\/home\/|\/Users\/|\/data\/user\/\d+\/|C:\\Users\\)[^\s,;"']+/gi,'[RUTA PRIVADA]');
  s=s.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,'[CORREO PRIVADO]');
  s=s.replace(/([?&](?:token|ticket|code|auth|key|signature)=)[^&#\s]+/gi,'$1[OCULTO]');
  return s.slice(0,2400);
}
export function buildDiagnostic({platform='VIS Nexo',system='Launcher',stage='operación',error='Error desconocido',code='',release=''}={}){
  const field=v=>redactDiagnostic(String(v).slice(0,300));
  const lines=[
    'VIS NEXO · DIAGNÓSTICO LOCAL',
    'Plataforma: '+field(platform),
    'Sistema: '+field(system),
    'Etapa: '+field(stage),
    'Error: '+redactDiagnostic(error),
  ];
  if(code!==''&&code!=null)lines.push('Código: '+field(code));
  if(release)lines.push('Versión: '+field(release));
  lines.push('Nota: no incluye contraseñas, sesiones ni rutas privadas.');
  return lines.join('\n');
}
export function createDiagnosticDialog(doc=document){
  let dialog=null,report='',dispose=()=>{};
  const el=(tag,cls,text)=>{
    const node=doc.createElement(tag);
    if(cls)node.className=cls;
    if(text!=null)node.textContent=text;
    return node;
  };
  function close(){
    if(!dialog)return;
    const active=dialog;
    dialog=null;report='';
    try{if(typeof active.close==='function'&&active.open)active.close();}catch{}
    active.remove();
    dispose();
  }
  function open(details){
    close();
    const trigger=doc.activeElement;
    report=buildDiagnostic(details||{});
    const root=el('dialog','vis-error-dialog');
    root.setAttribute('aria-label','Diagnóstico VIS Nexo');
    const header=el('div','vis-error-heading');
    header.append(el('strong','', 'Ocurrió un error'),el('p','', 'Este informe se puede copiar y compartir con soporte. No se envía automáticamente.'));
    root.append(header);
    const area=el('textarea','vis-error-report',report);
    area.readOnly=true;
    area.setAttribute('aria-label','Informe de diagnóstico');
    area.setAttribute('spellcheck','false');
    root.append(area);
    const actions=el('div','vis-error-actions');
    const copy=el('button','vis-error-copy','Copiar diagnóstico');
    copy.type='button';
    copy.addEventListener('click',async()=>{
      try{
        if(globalThis.navigator?.clipboard?.writeText){
          await globalThis.navigator.clipboard.writeText(report);
        }else{
          area.focus();area.select();
          if(!doc.execCommand?.('copy'))throw Error('Sin portapapeles');
        }
        copy.textContent='Copiado';
      }catch{
        area.focus();area.select();
        copy.textContent='Seleccioná el texto y copialo';
      }
    });
    const download=el('a','vis-error-download','Guardar informe');
    const reportUrl=URL.createObjectURL(new Blob([report],{type:'text/plain;charset=utf-8'}));
    download.href=reportUrl;
    download.download='vis-nexo-diagnostico.txt';
    const dismiss=el('button','vis-error-close','Cerrar');
    dismiss.type='button';
    dismiss.addEventListener('click',close);
    actions.append(copy,download,dismiss);
    root.append(actions);
    root.addEventListener('close',()=>{
      if(dialog && dialog!==root)return;
      if(dialog===root)close();
      trigger?.focus?.();
    },{once:true});
    doc.body.append(root);
    dialog=root;
    dispose=()=>URL.revokeObjectURL(reportUrl);
    if(typeof root.showModal==='function')root.showModal();
    else root.setAttribute('open','');
    return report;
  }
  return {open,close,getReport:()=>report};
}
