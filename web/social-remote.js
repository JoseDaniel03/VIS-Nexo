// VIS Social native bridge. No Cloudflare secrets, login PINs or bearer tokens
// are present in the WebView. IndexedDB stores client-side ECDH keys and a
// rolling 30-day local history. D1 receives ciphertext-only delivery envelopes.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DAY = 86400000;
const RETENTION = 30 * DAY;
const to64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const from64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

function openPrivateDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Almacenamiento seguro no disponible'));
    const req = indexedDB.open('vis-social-local-v1', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
      if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || Error('No se pudo abrir el historial local'));
  });
}
function store(db, name, type, value, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, type);
    const table = tx.objectStore(name);
    const req = value === undefined ? table.get(key) :
      name === 'messages' ? table.put(value) : table.put(value, key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || Error('Error de almacenamiento'));
  });
}
// The primary key already starts with "account:". Read only the current
// account's small bounded history instead of loading every stored profile.
function allMessages(db, username) {
  return new Promise((resolve, reject) => {
    const prefix = username + ':';
    const bounds = IDBKeyRange.bound(prefix, prefix + '\uffff');
    const req = db.transaction('messages', 'readonly').objectStore('messages').getAll(bounds);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || Error('Error leyendo mensajes'));
  });
}
function removeMessages(db, keys) {
  if (!keys.length) return Promise.resolve();
  return new Promise((resolve,reject) => {
    const tx = db.transaction('messages','readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || Error('No se pudo depurar el historial'));
    tx.onabort = () => reject(tx.error || Error('Depuración interrumpida'));
    const table = tx.objectStore('messages');
    for (const key of keys) table.delete(key);
  });
}
async function ecdhKeys(db, username) {
  let pair = await store(db, 'keys', 'readonly', undefined, username);
  if (!pair) {
    // Private CryptoKey is not extractable; it is structured-cloned to IndexedDB.
    pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' },
      false, ['deriveKey']);
    await store(db, 'keys', 'readwrite', pair, username);
  }
  const publicKey = to64(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { pair, publicKey };
}
async function sharedKey(ownPrivate, publicKey) {
  const remote = await crypto.subtle.importKey('spki', from64(publicKey),
    { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: remote }, ownPrivate,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function aad(from, to, id) {
  return encoder.encode('VIS-SOCIAL-MSG-V1\n' + from + '\n' + to + '\n' + id);
}
async function encrypt(body, from, to, id, aes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv, additionalData: aad(from, to, id)
  }, aes, encoder.encode(body));
  return JSON.stringify({ v: 1, iv: to64(iv), ct: to64(encrypted) });
}
async function decrypt(payload, from, to, id, aes) {
  const obj = JSON.parse(payload);
  if (obj?.v !== 1) throw Error('Mensaje cifrado incompatible');
  const clear = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: from64(obj.iv), additionalData: aad(from, to, id)
  }, aes, from64(obj.ct));
  return decoder.decode(clear);
}
// Trust-on-first-use pinning. Never silently replace the public encryption key
// recorded for an existing friend. A trusted recovery flow is still required.
export function validatePinnedPeerKey(pinned, incoming) {
  if (typeof incoming !== 'string' || incoming.length < 80 || incoming.length > 200)
    throw Error('Clave pública de contacto inválida');
  if (pinned != null && pinned !== incoming)
    throw Error('ALERTA: cambió la clave de cifrado del contacto. No se enviarán ni recibirán mensajes hasta verificar la identidad por otro canal.');
  return incoming;
}
// Adaptive polling: fast while talking, gentle when idle and exponentially
// backed off on network failures (never a tight retry loop).
export function socialPollDelay(chatOpen,failures=0){
  const base=chatOpen?2200:8500;
  const attempts=Math.min(4,Math.max(0,Number(failures)||0));
  return Math.min(45000,base*2**attempts);
}
export function createSocialRemote(command, onUpdate, onStatus) {
  let state = null, keys = null, privateDb = null, currentUser = '';
  let messages = [], busy = false, interval = null, lastHeartbeat = 0;
  let lastFingerprint = '', chatActive=false, sessionEpoch=0, consecutiveErrors=0;
  let gameActive=false;
  let historyRequest=0;
  let worldInvitations=[];
  let realtimeSocket=null,realtimeRetry=null,realtimeFailures=0;
  let realtimeConnecting=false,realtimeAttempt=0,realtimeOpenedAt=0;
  let wakeupQueued=false;
  // Cache only non-extractable derived AES CryptoKeys for this live identity.
  // A peer key change is still checked against its persisted TOFU pin.
  const pinnedPeers=new Map(), derivedKeys=new Map();
  const connected = () => !!(state && privateDb && keys);
  const status = (value, error = '') => onStatus?.(value, error);
  const rpc = (path, method = 'GET', body = null) => command('social_request',
    { path, method, body });
  function stopRealtime(){
    // Invalidate the request currently waiting for its one-use ticket, too.
    // Closing a WebSocket alone does not cancel a pending native HTTP request.
    realtimeAttempt++;realtimeConnecting=false;
    if(realtimeRetry){clearTimeout(realtimeRetry);realtimeRetry=null;}
    const ws=realtimeSocket;realtimeSocket=null;realtimeOpenedAt=0;
    realtimeFailures=0;wakeupQueued=false;
    if(ws){
      ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;
      try{ws.close(1000,'VIS Nexo session changed');}catch{}
    }
  }
  function scheduleRealtime(epoch){
    if(epoch!==sessionEpoch||!connected()||(document.hidden&&!gameActive)||!navigator.onLine
        ||realtimeRetry||realtimeSocket||realtimeConnecting)return;
    const delay=Math.min(60000,1000*Math.pow(2,Math.min(6,realtimeFailures++)));
    realtimeRetry=setTimeout(()=>{realtimeRetry=null;void connectRealtime(epoch);},delay);
  }
  async function connectRealtime(epoch){
    if(epoch!==sessionEpoch||!connected()||(document.hidden&&!gameActive)||!navigator.onLine
        ||realtimeSocket||realtimeConnecting)return;
    const attempt=++realtimeAttempt;
    realtimeConnecting=true;
    try{
      // The native bridge supplies only a single-use 20s notification ticket.
      // The long-lived authenticated VIS Social bearer remains inside Rust.
      const access=await command('social_realtime_ticket');
      if(epoch!==sessionEpoch||attempt!==realtimeAttempt
          ||!connected()||(document.hidden&&!gameActive))return;
      const target=new URL(access.ws_url);
      if(target.protocol!=='wss:'||target.username||target.password
          ||target.pathname!=='/v1/realtime/connect'
          ||!(/^[A-Za-z0-9_-]{43}$/.test(target.searchParams.get('ticket')||'')))
        throw Error('Endpoint de avisos no seguro');
      const ws=new WebSocket(target.href);
      realtimeSocket=ws;
      ws.onopen=()=>{
        if(epoch!==sessionEpoch||realtimeSocket!==ws){ws.close();return;}
        realtimeFailures=0;
        realtimeOpenedAt=Date.now();
        // A notification may have arrived between the initial state fetch
        // and upgrading the socket: fetch state once on successful connect.
        void sync();
      };
      ws.onmessage=event=>{
        if(epoch!==sessionEpoch||realtimeSocket!==ws||(document.hidden&&!gameActive))return;
        if(typeof event.data!=='string'||event.data.length>128)return;
        if(event.data==='pong')return;
        let message;try{message=JSON.parse(event.data);}catch{return;}
        if(message?.type==='wakeup'){
          if(busy)wakeupQueued=true;
          else void sync();
        }
      };
      ws.onclose=()=>{
        if(epoch!==sessionEpoch||realtimeSocket!==ws)return;
        realtimeSocket=null;
        realtimeOpenedAt=0;
        scheduleNext(epoch); // Immediate safe fallback to polling.
        scheduleRealtime(epoch);
      };
      ws.onerror=()=>{/* onclose handles retry and fallback */};
    }catch{
      if(epoch===sessionEpoch&&attempt===realtimeAttempt){
        realtimeSocket=null;
        realtimeConnecting=false;
        scheduleRealtime(epoch);
      }
    }finally{
      if(attempt===realtimeAttempt)realtimeConnecting=false;
    }
  }

  async function verifiedPeerKey(friend) {
    if (!privateDb || !currentUser || !friend?.username || !friend.public_key)
      throw Error('Identidad de amigo no disponible');
    const id='peer-key:'+currentUser+':'+friend.username;
    const saved=pinnedPeers.has(id)?pinnedPeers.get(id):
      await store(privateDb,'keys','readonly',undefined,id);
    const publicKey=validatePinnedPeerKey(saved,friend.public_key);
    if(saved==null)await store(privateDb,'keys','readwrite',publicKey,id);
    pinnedPeers.set(id,publicKey);
    if(pinnedPeers.size>128)pinnedPeers.delete(pinnedPeers.keys().next().value);
    return publicKey;
  }
  async function peerAesKey(username,publicKey){
    if(!keys?.pair?.privateKey||!currentUser)throw Error('Sesión de cifrado no disponible');
    const cacheId=currentUser+':'+username+':'+publicKey;
    if(derivedKeys.has(cacheId))return derivedKeys.get(cacheId);
    // Cache promises as well, so concurrent messages share key derivation.
    const pending=sharedKey(keys.pair.privateKey,publicKey);
    derivedKeys.set(cacheId,pending);
    if(derivedKeys.size>64)derivedKeys.delete(derivedKeys.keys().next().value);
    try{return await pending;}
    catch(error){derivedKeys.delete(cacheId);throw error;}
  }
  async function localHistory() {
    if (!privateDb || !currentUser) return [];
    const all = await allMessages(privateDb, currentUser);
    const fresh = [], expired = [];
    for (const item of all) {
      if (item.account !== currentUser) continue;
      const timestamp = Date.parse(item.created);
      if (!Number.isFinite(timestamp) || timestamp < Date.now() - RETENTION) {
        expired.push(item.key);
      } else fresh.push(item);
    }
    // Retain at most 2 KiB UTF-8 per conversation, counting message metadata.
    // Keep newest messages first, evict older records automatically.
    fresh.sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
    const usedByPeer = new Map(), kept = [];
    for (const item of fresh) {
      const peer = item.from === currentUser ? item.to : item.from;
      const size = encoder.encode(JSON.stringify({
        id: item.id, from: item.from, to: item.to, body: item.body, created: item.created
      })).length;
      const used = usedByPeer.get(peer) || 0;
      if (size <= 2048 && used + size <= 2048) {
        kept.push(item);
        usedByPeer.set(peer, used + size);
      } else expired.push(item.key);
    }
    // One transaction for all expired records: no N sequential disk commits.
    await removeMessages(privateDb, expired);
    kept.reverse();
    return kept.map(({ from, to, body, created, id }) =>
      ({ from, to, body, created, id }));
  }
  async function saveMessage(item) {
    await store(privateDb, 'messages', 'readwrite',
      { ...item, account: currentUser, key: currentUser + ':' + item.id });
  }
  async function refreshLocalMessages(){
    const request=++historyRequest;
    const fresh=await localHistory();
    // Sending and receiving can overlap; an older IndexedDB read must not
    // overwrite a newer one that already contains the new message.
    if(request===historyRequest)messages=fresh;
  }
  function notify(force = false) {
    if (!state) return;
    const fingerprint = JSON.stringify({
      friends: state.friends, incoming: state.incoming_requests,
      outgoing: state.outgoing_requests, messages: messages.map(m => m.id),
      status: state.presence, role: state.role, developer: state.developer,
      display_name:state.display_name,public_handle:state.public_handle,
      projects: state.projects
    });
    if (force || fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      onUpdate?.(state, messages);
    }
  }
  function scheduleNext(epoch) {
    if(epoch!==sessionEpoch||!connected()||(document.hidden&&!gameActive))return;
    if(interval)clearTimeout(interval);
    interval=setTimeout(()=>{interval=null;void sync();},
      (realtimeSocket?.readyState===WebSocket.OPEN)
        ? 45000 : socialPollDelay(chatActive,consecutiveErrors));
  }
  async function sync() {
    if (!connected() || busy || (document.hidden&&!gameActive)) return;
    const epoch=sessionEpoch,username=currentUser;
    if(interval){clearTimeout(interval);interval=null;}
    busy = true;
    const valid=()=>epoch===sessionEpoch&&username===currentUser&&connected();
    try {
      if (Date.now() - lastHeartbeat > 45000) {
        await rpc('/v1/presence', 'POST',
          { presence: state.presence === 'offline' ? 'online' : state.presence,
            custom_status: state.custom_status || '', current_game: state.current_game || '' });
        if(!valid())return;
        lastHeartbeat = Date.now();
      }
      const fresh = await rpc('/v1/state');
      if(!valid())return;
      const friendsByName=new Map((fresh.friends||[]).map(f=>[f.username,f]));
      const ack = [];
      let newMessages=false,securityError='';
      for (const incoming of fresh.pending_messages || []) {
        if(!valid())return;
        const friend = friendsByName.get(incoming.from);
        if (!friend?.public_key) continue;
        try {
          const pub=await verifiedPeerKey(friend);
          if(!valid())return;
          const aes=await peerAesKey(incoming.from,pub);
          if(!valid())return;
          const text = await decrypt(incoming.payload, incoming.from,
            username, incoming.client_message_id, aes);
          if(!valid())return;
          await saveMessage({
            id: incoming.client_message_id, from: incoming.from, to: username,
            body: text, created: new Date(incoming.created_at * 1000).toISOString()
          });
          if(!valid())return;
          ack.push(incoming.id);newMessages=true;
        } catch(error) {
          // Never acknowledge undecryptable messages or silently replace
          // pinned ECDH keys. The sender can retry after out-of-band recovery.
          if(String(error).includes('ALERTA:'))securityError=String(error);
        }
      }
      // Show decrypted, locally stored messages immediately. A slow ACK round
      // trip must not delay chat rendering; an ACK error leaves the pending
      // envelope on the server so it can be re-delivered safely.
      state = fresh;
      // An older service remains usable for chat until its migration is deployed.
      await refreshWorldInvitations().catch(()=>{worldInvitations=[];});
      if(newMessages)await refreshLocalMessages();
      if(!valid())return;
      consecutiveErrors=0;
      status(securityError?'security_warning':'connected',securityError);
      notify();
      if (ack.length) {
        await rpc('/v1/messages/ack', 'POST', { ids: ack });
        if(!valid())return;
      }
    } catch (error) {
      if(!valid())return;
      consecutiveErrors=Math.min(4,consecutiveErrors+1);
      const detail=String(error);
      if(/HTTP 401\b/.test(detail)){
        // Do not keep issuing unauthorized requests using an expired token.
        // A fresh, explicit authenticated login/reconnect is required.
        if(interval){clearTimeout(interval);interval=null;}
        stopRealtime();
        sessionEpoch++;
        worldInvitations=[];state=null;keys=null;messages=[];lastFingerprint='';currentUser='';
        historyRequest++;pinnedPeers.clear();derivedKeys.clear();
        if(privateDb){privateDb.close();privateDb=null;}
        status('disconnected','La sesión VIS Social expiró. Volvé a conectar la cuenta.');
      }else status('degraded',detail);
    } finally {
      if(epoch===sessionEpoch){
        busy = false;
        // Revalidate socket authorization at least every 14 minutes. The
        // server refuses notifications on leases older than 15 minutes.
        if(realtimeSocket?.readyState===WebSocket.OPEN&&realtimeOpenedAt
            &&Date.now()-realtimeOpenedAt>=14*60*1000){
          try{realtimeSocket.close(1000,'Refreshing notification ticket');}catch{}
        }
        if(wakeupQueued&&consecutiveErrors===0){
          wakeupQueued=false;
          if(interval){clearTimeout(interval);interval=null;}
          interval=setTimeout(()=>{interval=null;void sync();},180);
        }else{wakeupQueued=false;scheduleNext(epoch);}
      }
    }
  }
  async function start(username, reuseCloudSession=false) {
    await stop();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) throw Error('Usuario VIS Social inválido');
    const epoch=sessionEpoch;
    status('connecting');
    currentUser = username;
    try {
      const db=await openPrivateDb();
      if(epoch!==sessionEpoch){db.close();return false;}
      privateDb=db;
      keys = await ecdhKeys(privateDb, username);
      if(epoch!==sessionEpoch)return false;
      const remote = reuseCloudSession ? await rpc('/v1/state') : await command('social_connect');
      if(epoch!==sessionEpoch)return false;
      await rpc('/v1/keys', 'POST', { public_key: keys.publicKey });
      if(epoch!==sessionEpoch)return false;
      state = remote;
      await refreshLocalMessages();
      if(epoch!==sessionEpoch)return false;
      lastHeartbeat = 0; consecutiveErrors=0;
      notify(true);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('online', onOnline);
      await sync();
      if(epoch===sessionEpoch)void connectRealtime(epoch);
      return epoch===sessionEpoch;
    } catch (error) {
      if(epoch===sessionEpoch){
        await stop();
        status('disconnected',String(error));
      }
      throw error;
    }
  }
  function onVisibility() {
    if((document.hidden&&!gameActive)){
      if(interval){clearTimeout(interval);interval=null;}
      stopRealtime();
    }else if(connected()){
      void sync();void connectRealtime(sessionEpoch);
    }
  }
  function onOnline() {
    if(connected()){consecutiveErrors=0;void sync();void connectRealtime(sessionEpoch);}
  }
  function setChatActive(open) {
    chatActive=!!open;
    if(interval){clearTimeout(interval);interval=null;}
    if(chatActive){void sync();}
    else if(!busy)scheduleNext(sessionEpoch);
  }
  async function stop() {
    sessionEpoch++;
    stopRealtime();
    if (interval) { clearTimeout(interval); interval = null; }
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    const wasConnected=!!state;
    worldInvitations=[];state=null;keys=null;currentUser='';messages=[];lastFingerprint='';
    historyRequest++;pinnedPeers.clear();derivedKeys.clear();
    lastHeartbeat=0;consecutiveErrors=0;busy=false;
    if(privateDb){privateDb.close();privateDb=null;}
    if(wasConnected)await command('social_disconnect').catch(()=>{});
    status('disconnected');
  }
  async function friendRequest(username) {
    if (!connected()) throw Error('VIS Social no está conectado');
    await rpc('/v1/friends/request', 'POST', { username });
    await sync();
  }
  async function acceptFriend(username) {
    if (!connected()) throw Error('VIS Social no está conectado');
    await rpc('/v1/friends/accept', 'POST', { username });
    await sync();
  }
  async function setAlias(username, alias) {
    if (!connected()) throw Error('VIS Social no está conectado');
    await rpc('/v1/friends/alias', 'POST', { username, alias });
    await sync();
  }
  async function setPresence(presence, custom_status = state?.custom_status || '', current_game = state?.current_game || '') {
    if (!connected()) return;
    await rpc('/v1/presence', 'POST', { presence, custom_status, current_game });
    state.presence = presence;
    state.custom_status = custom_status;
    state.current_game = current_game;
    lastHeartbeat = Date.now();
    await sync();
  }
  async function sendMessage(to, body) {
    if (!connected()) throw Error('VIS Social no está conectado');
    const epoch=sessionEpoch,from=currentUser;
    const valid=()=>epoch===sessionEpoch&&from===currentUser&&connected();
    if (typeof body !== 'string' || !body.trim()) throw Error('Mensaje vacío');
    if (encoder.encode(body).length > 1300) throw Error('Mensaje demasiado largo (máximo 1300 bytes)');
    const friend = (state.friends || []).find(f => f.username === to);
    if (!friend?.public_key) throw Error('Tu amigo aún no configuró su identidad cifrada');
    const id = crypto.randomUUID().replace(/-/g, '');
    const pub=await verifiedPeerKey(friend);
    if(!valid())throw Error('Cambió la cuenta activa; reenviá el mensaje desde tu sesión actual');
    const aes=await peerAesKey(to,pub);
    if(!valid())throw Error('Cambió la cuenta activa; mensaje no enviado');
    const payload=await encrypt(body.trim(), from, to, id, aes);
    if(!valid())throw Error('Cambió la cuenta activa; mensaje no enviado');
    if (encoder.encode(payload).length > 2048) throw Error('Mensaje cifrado demasiado largo');
    await rpc('/v1/messages/send', 'POST', { to, client_message_id: id, payload });
    if(!valid())return; // A reply from a previous profile must not reach this one's local history.
    await saveMessage({
      id, from, to, body: body.trim(), created: new Date().toISOString()
    });
    if(!valid())return;
    await refreshLocalMessages();
    if(valid())notify(true);
  }
  async function hostWorld(roomId) {
    if(!connected())throw Error('Conectá VIS Portals para compartir');
    return rpc('/v1/worlds/host','POST',{room_id:roomId});
  }
  async function closeWorld(roomId) {
    if(connected())return rpc('/v1/worlds/close','POST',{room_id:roomId});
  }
  async function inviteWorld(to, roomId, code) {
    if(!connected())throw Error('Conectá VIS Portals para invitar');
    const epoch=sessionEpoch,from=currentUser;
    const friend=(state.friends||[]).find(f=>f.username===to);
    if(!friend?.public_key)throw Error('Tu amigo debe conectar VIS Portals');
    const id=crypto.randomUUID().replace(/-/g,'');
    const pub=await verifiedPeerKey(friend),aes=await peerAesKey(to,pub);
    const payload=await encrypt(JSON.stringify({v:1,room:roomId,code,minecraft:'26.3'}),from,to,id,aes);
    if(epoch!==sessionEpoch||from!==currentUser)throw Error('Cambió la cuenta activa');
    return rpc('/v1/worlds/invite','POST',{id,to,room_id:roomId,payload});
  }
  async function refreshWorldInvitations() {
    if(!connected())return;
    const epoch=sessionEpoch,username=currentUser;
    const inbox=await rpc('/v1/worlds/inbox');
    const invitations=[];
    for(const row of inbox.invitations||[]){
      const friend=(state?.friends||[]).find(f=>f.username===row.sender);
      if(!friend?.public_key)continue;
      const pub=await verifiedPeerKey(friend),aes=await peerAesKey(row.sender,pub);
      const value=JSON.parse(await decrypt(row.payload,row.sender,username,row.id,aes));
      if(value.v!==1||value.room!==row.room_id||value.minecraft!=='26.3'||
         typeof value.code!=='string'||!/^[a-zA-Z0-9-]{8,1000}$/.test(value.code))continue;
      invitations.push({...row,code:value.code});
    }
    if(epoch===sessionEpoch&&username===currentUser){worldInvitations=invitations;notify(true);}
  }
  async function acceptWorld(id) {
    const epoch=sessionEpoch;
    // Re-read the live lease and membership before consuming an invitation.
    await refreshWorldInvitations();
    const invite=worldInvitations.find(i=>i.id===id);
    if(!invite||epoch!==sessionEpoch)throw Error('La invitación venció o el mundo está cerrado');
    await rpc('/v1/worlds/accept','POST',{id});
    if(epoch!==sessionEpoch)throw Error('Cambió la cuenta activa');
    worldInvitations=worldInvitations.filter(i=>i.id!==id);notify(true);
    return invite.code;
  }
  async function declineWorld(id) {
    await rpc('/v1/worlds/decline','POST',{id});
    worldInvitations=worldInvitations.filter(i=>i.id!==id);notify(true);
  }
  async function getAvatar(username) {
    if (!connected()) throw Error('VIS Social no está conectado');
    if (typeof username!=='string'||!(/^[a-z0-9_]{3,24}$/.test(username)))
      throw Error('Usuario incorrecto');
    return rpc('/v1/avatar/get','POST',{username});
  }
  async function uploadAvatar(dataUrl) {
    if (!connected()) throw Error('VIS Social no está conectado');
    if (typeof dataUrl!=='string' || !/^data:image\/webp;base64,[A-Za-z0-9+/]*={0,2}$/.test(dataUrl))
      throw Error('La imagen debe ser WebP');
    const data=dataUrl.slice('data:image/webp;base64,'.length);
    if (data.length>32768) throw Error('Foto demasiado grande, usá una imagen más simple');
    const result=await rpc('/v1/avatar/upload','POST',{mime:'image/webp',data});
    await sync();
    return result;
  }
  async function getSkin(username){
    if(!connected())throw Error('VIS Social no está conectado');
    if(typeof username!=='string'||!/^[a-z0-9_]{3,24}$/.test(username))
      throw Error('Nombre de usuario VIS inválido');
    return rpc('/v1/skins/get','POST',{username});
  }
  async function uploadSkin(dataUrl){
    if(!connected())throw Error('VIS Social no está conectado');
    if(typeof dataUrl!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(dataUrl))
      throw Error('La skin VIS debe ser PNG');
    const data=dataUrl.slice('data:image/png;base64,'.length);
    if(data.length>87384||data.length<32)throw Error('La skin supera 64 KiB, optimizá el PNG');
    const reply=await rpc('/v1/skins/upload','POST',{mime:'image/png',data});
    await sync();
    return reply;
  }
  async function deleteSkin(){
    if(!connected())throw Error('Conectá VIS Social para quitar tu skin pública');
    const reply=await rpc('/v1/skins/delete','POST',{});
    await sync();
    return reply;
  }
  async function setDisplayName(displayName){
    if(!connected())throw Error('Conectá VIS Social para cambiar el nombre visible');
    if(typeof displayName!=='string'||displayName.trim().length<2||displayName.trim().length>32)
      throw Error('El nombre visible debe tener entre 2 y 32 caracteres');
    const reply=await rpc('/v1/account/display','POST',{display_name:displayName.trim()});
    if(state){state.display_name=reply.display_name;notify(true);}
    await sync();
    return reply;
  }
  async function setPublicHandle(handle){
    if(!connected())throw Error('Conectá VIS Social para elegir tu identificador');
    if(typeof handle!=='string'||!(/^[a-z0-9_]{3,24}$/.test(handle.trim().toLowerCase())))
      throw Error('El identificador debe tener de 3 a 24 letras, números o _');
    const saved=await rpc('/v1/account/handle','POST',{handle:handle.trim().toLowerCase()});
    if(state){state.public_handle=saved.public_handle;
      state.public_handle_updated_at=saved.next_change_at-7*24*60*60;
      notify(true);
    }
    await sync();
    return saved;
  }
  async function accountInfo() {
    if (!connected()) throw Error('Primero iniciá sesión en VIS Social');
    return rpc('/v1/account');
  }

  async function ceiboAccountEmail(email){
    if(!connected())throw Error('Iniciá sesión VIS Cloud para vincular tu correo');
    return rpc('/v1/account/email/request','POST',{email});
  }
  async function ceiboMfaStatus(){
    if(!connected())throw Error('VIS Cloud no está conectado');
    return rpc('/v1/account/mfa/status');
  }
  async function ceiboMfaSetup(){
    if(!connected())throw Error('VIS Cloud no está conectado');
    return rpc('/v1/account/mfa/setup','POST',{});
  }
  async function ceiboMfaConfirm(code){
    if(!connected())throw Error('VIS Cloud no está conectado');
    return rpc('/v1/account/mfa/confirm','POST',{code});
  }
  async function ceiboMfaVerify(value){
    if(!connected())throw Error('VIS Cloud no está conectado');
    return rpc('/v1/account/mfa/verify','POST',
      /^\d{6}$/.test(value)?{code:value}:{recovery_code:value});
  }
  async function ceiboMfaRotate(){
    if(!connected())throw Error('VIS Cloud no está conectado');
    return rpc('/v1/account/mfa/rotate-codes','POST',{});
  }
  async function ceiboSessions(){
    if(!connected())throw Error('VIS Cloud no está conectado');
    return rpc('/v1/account/sessions');
  }
  async function ceiboRevokeSession(sessionId=null){
    if(!connected())throw Error('VIS Cloud no está conectado');
    return rpc('/v1/account/sessions/revoke','POST',
      sessionId?{session_id:sessionId}:{all:true});
  }

  async function subscribeProject(projectId, subscribe = true) {
    if (!connected()) throw Error('VIS Social no está conectado');
    await rpc(subscribe?'/v1/projects/subscribe':'/v1/projects/unsubscribe','POST',
      { project_id: projectId });
    await sync();
  }
  async function manageProject(project) {
    if (!connected() || !state.developer) throw Error('Permiso de desarrollador requerido');
    await rpc('/v1/admin/projects/upsert','POST',project);
    await sync();
  }
  async function grantStaff(projectId, username, staffRole) {
    if (!connected() || !state.developer) throw Error('Permiso de desarrollador requerido');
    await rpc('/v1/admin/projects/staff','POST',{
      project_id:projectId, username, staff_role:staffRole
    });
    await sync();
  }
  async function projectCommunity(projectId){
    if(!connected())throw Error('Conectá tu cuenta VIS Cloud para ver los miembros');
    return rpc('/v1/projects/community','POST',{project_id:projectId});
  }
  async function requestProjectJoin(projectId,note=''){
    if(!connected())throw Error('Iniciá sesión VIS Cloud para pedir acceso');
    const result=await rpc('/v1/projects/request-join','POST',{project_id:projectId,note});
    await sync();return result;
  }
  async function projectMember(projectId,username,role,canPlay,action='grant'){
    if(!connected())throw Error('VIS Cloud no está conectado');
    return rpc('/v1/admin/projects/community-members','POST',{
      project_id:projectId,username,role,can_play:canPlay,action
    });
  }
  async function reviewProjectJoin(projectId,username,action){
    if(!connected())throw Error('VIS Cloud no está conectado');
    return rpc('/v1/admin/projects/review-join','POST',{project_id:projectId,username,action});
  }
  async function setProjectPolicy(projectId,admission,playAccess){
    if(!connected())throw Error('VIS Cloud no está conectado');
    return rpc('/v1/admin/projects/community-policy','POST',{
      project_id:projectId,admission,play_access:playAccess
    });
  }
  async function projectMedia(projectId,action,item={}){
    if(!connected())throw Error('VIS Cloud no está conectado');
    return rpc('/v1/admin/projects/community-media','POST',{project_id:projectId,action,...item});
  }
  async function globalAdmin(username,enabled){
    if(!connected()||state?.role!=='super_admin')throw Error('Solo la supercuenta puede dar permisos globales');
    return rpc('/v1/admin/accounts/global-admin','POST',{username,enabled});
  }

  async function setAccountRole(username, role) {
    if (!connected() || state.role !== 'super_admin') throw Error('Supercuenta requerida');
    return rpc('/v1/admin/accounts/role','POST',{username,role});
  }
  async function setAccountDisabled(username, disabled) {
    if (!connected() || state.role !== 'super_admin') throw Error('Supercuenta requerida');
    return rpc('/v1/admin/accounts/disable','POST',{username,disabled});
  }
  return { setGameActive:value=>{const changed=gameActive!==!!value;gameActive=!!value;if(changed&&gameActive)void sync();}, hostWorld, closeWorld, inviteWorld, acceptWorld, declineWorld, worldInvitations:()=>worldInvitations, start, stop, sync, connected, friendRequest, acceptFriend, setAlias,
    setPresence, sendMessage, setChatActive, subscribeProject, manageProject, grantStaff,
    setAccountRole, setAccountDisabled, accountInfo, setDisplayName, setPublicHandle, getAvatar, uploadAvatar, getSkin, uploadSkin, deleteSkin,
    projectCommunity,requestProjectJoin,projectMember,reviewProjectJoin,setProjectPolicy,projectMedia,globalAdmin,
    ceiboAccountEmail,ceiboMfaStatus,ceiboMfaSetup,ceiboMfaConfirm,ceiboMfaVerify,
    ceiboMfaRotate,ceiboSessions,ceiboRevokeSession,state: () => state };
}


