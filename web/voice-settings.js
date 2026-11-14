// Device and per-person audio controls live in Nexo; the game has quick toggles.
export async function openVoiceSettings(voice){
 document.querySelector('#vis-voice-settings')?.remove();
 const dialog=document.createElement('dialog');dialog.id='vis-voice-settings';
 dialog.innerHTML='<form method="dialog"><h2>Audio del servidor</h2><p>V para hablar · F8 para abrir VIS Portals</p><label>Micrófono <select name="input"></select></label><label>Salida <select name="output"></select></label><label>Activación <select name="mode"><option value="ptt">Pulsar para hablar</option><option value="open">Micrófono abierto</option></select></label><label>Abrir panel <select name="hotkey"><option>F6</option><option>F7</option><option>F8</option><option>F9</option><option>F10</option></select></label><label>Pausar mi mundo al abrir el panel <input name="autopause" type="checkbox"></label><section class="voice-people"></section><p class="voice-device-error" role="status"></p><button value="close">Cerrar</button><button type="button" class="voice-disconnect">Salir del canal</button></form>';
 const style=document.createElement('style');style.textContent='#vis-voice-settings{background:#1b1429;color:#eee;border:1px solid #665183;border-radius:14px;padding:24px;max-width:540px}#vis-voice-settings label{display:flex;justify-content:space-between;gap:18px;margin:16px 0}#vis-voice-settings select{max-width:280px}#vis-voice-settings::backdrop{background:#0009}';dialog.append(style);
 const form=dialog.querySelector('form'),inputs=form.elements;
 inputs.autopause.checked=localStorage.getItem('vis-portals-autopause')!=='false';inputs.autopause.addEventListener('change',()=>localStorage.setItem('vis-portals-autopause',String(inputs.autopause.checked)));
 inputs.mode.value=voice.status().mode;inputs.hotkey.value=localStorage.getItem('vis-portals-hotkey')||'F8';
 inputs.mode.addEventListener('change',()=>voice.setMode(inputs.mode.value));
 inputs.hotkey.addEventListener('change',()=>localStorage.setItem('vis-portals-hotkey',inputs.hotkey.value));
 for(const field of ['input','output']){const option=document.createElement('option');option.value='';option.textContent='Predeterminado del sistema';inputs[field].append(option);}
 try{for(const device of await voice.devices()){
  const option=document.createElement('option');option.value=device.id;option.textContent=device.label||device.id;
  inputs[device.kind==='audioinput'?'input':'output'].append(option);
 }}catch{dialog.querySelector('.voice-device-error').textContent='Los dispositivos se mostrarán después de autorizar el micrófono.';}
 for(const field of ['input','output'])inputs[field].addEventListener('change',()=>void voice.selectDevices(inputs.input.value,inputs.output.value).catch(error=>dialog.querySelector('.voice-device-error').textContent=String(error)));
 for(const peer of voice.status().participants){const label=document.createElement('label');label.textContent=peer.username;const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='1';slider.step='.05';slider.value=peer.volume;slider.setAttribute('aria-label','Volumen de '+peer.username);slider.addEventListener('input',()=>voice.setVolume(peer.username,Number(slider.value)));label.append(slider);dialog.querySelector('.voice-people').append(label);}
 dialog.querySelector('.voice-disconnect').addEventListener('click',()=>void voice.leave().then(()=>dialog.close()));
 dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
