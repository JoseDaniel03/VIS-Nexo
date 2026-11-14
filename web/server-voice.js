// Voice for a project's server channel. Uses the platform's WebRTC Opus/SRTP
// implementation; credentials and signalling are handled by native VIS Social.
export function createServerVoice(rpc,onStatus=()=>{},runtime=globalThis){
 const clientId=globalThis.crypto.randomUUID().replace(/-/g,'');
 let joining=false;
 let outgoing=null,mix=null,destination=null,micSource=null;const sources=new Set();
 let stream=null,project='',session='',timer=null,polling=false,epoch=0,ack=[],muted=false,deaf=false,ptt=false,mode='ptt',renewed=0;
 let iceServers=[],audio=null,device='',output='',voiceMode='proximity',radius=48;
 const distanceGain=p=>voiceMode==='channel'?1:Math.max(0,1-(p.distance||0)/radius);
 const volumeFor=p=>deaf?0:(volumes.get(p.username)??1)*distanceGain(p);
 const peers=new Map(),volumes=new Map(),seen=new Set();
 const status=()=>({connected:!!stream,muted,deaf,mode,ptt,project,voiceMode,participants:[...peers.values()].map(p=>({id:p.id,username:p.username,state:p.pc.connectionState,volume:volumes.get(p.username)??1}))});
 function emit(){onStatus(status());}
 function gate(){for(const track of stream?.getAudioTracks()||[])track.enabled=!muted&&!deaf&&(mode==='open'||ptt);emit();}
 const call=(path,body)=>rpc('/v1/voice/'+path,'POST',{session_id:session,...body});
 async function signal(to,data){await call('signal',{to,payload:JSON.stringify(data)});}
 function remove(id){const p=peers.get(id);if(!p)return;p.pc.close();p.element?.pause();if(p.element)p.element.srcObject=null;p.gain?.disconnect();p.source?.disconnect();peers.delete(id);}
 async function peer(id,username){
  if(peers.has(id))return peers.get(id);
  const pc=new runtime.RTCPeerConnection({iceServers}),p={id,username,pc,candidates:[],element:null,gain:null};peers.set(id,p);
  for(const track of (outgoing||stream).getAudioTracks()){const sender=pc.addTrack(track,outgoing||stream);const parameters=sender.getParameters();parameters.encodings=parameters.encodings?.length?parameters.encodings:[{}];parameters.encodings[0].maxBitrate=32000;void sender.setParameters(parameters).catch(()=>{}); }
  const capabilities=runtime.RTCRtpReceiver?.getCapabilities?.('audio');
  const opus=capabilities?.codecs?.filter(c=>c.mimeType.toLowerCase()==='audio/opus');
  if(opus?.length)for(const transceiver of pc.getTransceivers())transceiver.setCodecPreferences?.(opus);
  pc.onicecandidate=e=>{if(e.candidate)void signal(id,{type:'ice',candidate:e.candidate.toJSON()}).catch(()=>{});};
  pc.onconnectionstatechange=()=>{emit();};
  pc.ontrack=event=>{
   // An element supports explicit output-device selection where the platform offers it.
   const element=runtime.document.createElement('audio');p.element=element;element.autoplay=true;
   element.srcObject=event.streams[0]||new runtime.MediaStream([event.track]);
   element.volume=volumeFor(p);
   if(output&&element.setSinkId)void element.setSinkId(output).catch(()=>{});
   void element.play().catch(()=>onStatus({...status(),error:'Habilitá la reproducción de audio en VIS Nexo'}));
  };
  return p;
 }
 async function roster(){
  const room=await call('room',{project_id:project,client_id:clientId});
  if(session&&session!==room.id){for(const id of peers.keys())remove(id);seen.clear();ack=[];}
  session=room.id;iceServers=room.iceServers||[];voiceMode=room.mode;radius=room.radius||48;renewed=Date.now();
  const ids=new Set(room.peers.map(p=>p.id));for(const id of peers.keys())if(!ids.has(id))remove(id);
  for(const remote of room.peers){
   const fresh=!peers.has(remote.id),p=await peer(remote.id,remote.username);p.distance=remote.distance||0;if(p.element)p.element.volume=volumeFor(p);
   // One deterministic offerer prevents negotiation glare.
   if(fresh&&session<remote.id){await p.pc.setLocalDescription(await p.pc.createOffer());await signal(remote.id,{type:'offer',sdp:p.pc.localDescription.sdp});}
  }
 }
 async function poll(){
  if(polling||!stream)return;polling=true;const current=epoch;
  try{
   if(Date.now()-renewed>1000)await roster();
   if(current!==epoch)return;
   const reply=await call('poll',{ack});ack=[];
   for(const item of reply.signals||[]){
    if(current!==epoch)return;
    if(seen.has(item.id)){ack.push(item.id);continue;}
    const p=peers.get(item.sender);if(!p)continue;
    const data=JSON.parse(item.payload);
    if(data.type==='ice'){
     if(p.pc.remoteDescription)await p.pc.addIceCandidate(data.candidate);else p.candidates.push(data.candidate);
    }else{
     await p.pc.setRemoteDescription({type:data.type,sdp:data.sdp});
     for(const candidate of p.candidates)await p.pc.addIceCandidate(candidate);p.candidates=[];
     if(data.type==='offer'){await p.pc.setLocalDescription(await p.pc.createAnswer());await signal(p.id,{type:'answer',sdp:p.pc.localDescription.sdp});}
    }
    seen.add(item.id);ack.push(item.id);if(seen.size>512)seen.delete(seen.values().next().value);
   }
  }catch(error){const fatal=/HTTP (401|403|410)/.test(String(error))||Date.now()-renewed>45000;if(fatal)await leave();onStatus({...status(),error:String(error)});}
  finally{polling=false;}
 }
 async function leave(){
  epoch++;const previousSession=session;session='';project='';
  for(const source of sources){source.input.disconnect();source.gain.disconnect();}sources.clear();
  micSource?.disconnect();micSource=null;for(const track of outgoing?.getTracks()||[])track.stop();outgoing=null;destination=null;if(mix)await mix.close().catch(()=>{});mix=null;
  if(timer)clearInterval(timer);timer=null;
  for(const track of stream?.getTracks()||[])track.stop();stream=null;ptt=false;
  for(const id of [...peers.keys()])remove(id);
  if(previousSession)await call('leave',{session_id:previousSession}).catch(()=>{});seen.clear();ack=[];emit();
 }
 async function join(projectId){
  if(joining)throw Error('El voicechat ya está preparando la conexión');joining=true;
  try{
   await leave();const current=epoch;
   if(!runtime.navigator?.mediaDevices?.getUserMedia||!runtime.RTCPeerConnection)throw Error('Este entorno no ofrece captura de micrófono/WebRTC.');
   project=projectId;
   const captured=await runtime.navigator.mediaDevices.getUserMedia({video:false,audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1,...(device?{deviceId:{exact:device}}:{})}});
   if(current!==epoch){captured.getTracks().forEach(t=>t.stop());return;}
   stream=captured;gate();
   const AudioContext=runtime.AudioContext||runtime.webkitAudioContext;
   if(AudioContext){mix=new AudioContext();destination=mix.createMediaStreamDestination();micSource=mix.createMediaStreamSource(stream);micSource.connect(destination);outgoing=destination.stream;await mix.resume();}
   await roster();if(current!==epoch)return;timer=setInterval(()=>void poll(),1000);emit();
  }catch(error){await leave();throw error;}finally{joining=false;}
 }
 async function devices(){return (await runtime.navigator.mediaDevices.enumerateDevices()).filter(d=>['audioinput','audiooutput'].includes(d.kind)).map(({deviceId,label,kind})=>({id:deviceId,label,kind}));}
 async function selectDevices(input, sink){
  device=input||'';output=sink||'';
  if(stream){const current=project;await join(current);}
 }
 function setVolume(username,value){const volume=Math.max(0,Math.min(1,Number(value)||0));volumes.set(username,volume);for(const p of peers.values())if(p.username===username&&p.element)p.element.volume=volumeFor(p);emit();}
 function setDeaf(value){deaf=!!value;for(const p of peers.values())if(p.element)p.element.volume=volumeFor(p);gate();}
 function attachMedia(mediaStream,volume=1){
  if(!mix||!destination)throw Error('Conectá primero el voicechat para emitir desde VSMedia');
  const input=mix.createMediaStreamSource(mediaStream),gain=mix.createGain();gain.gain.value=Math.max(0,Math.min(1,volume));input.connect(gain);gain.connect(destination);
  const source={input,gain};sources.add(source);
  return {setVolume(value){gain.gain.value=Math.max(0,Math.min(1,Number(value)||0));},stop(){input.disconnect();gain.disconnect();sources.delete(source);}};
 }
 return {attachMedia,join,leave,devices,selectDevices,setVolume,status,setMute:value=>{muted=!!value;gate();},setDeaf,setPtt:value=>{ptt=!!value;gate();},setMode:value=>{mode=value==='open'?'open':'ptt';gate();}};
}
