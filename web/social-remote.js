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
  // Cache only non-extractable derived AES CryptoKeys for this live identity.
  // A peer key change is still checked against its persisted TOFU pin.
  const pinnedPeers=new Map(), derivedKeys=new Map();
  const connected = () => !!(state && privateDb && keys);
  const status = (value, error = '') => onStatus?.(value, error);
  const rpc = (path, method = 'GET', body = null) => command('social_request',
    { path, method, body });

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
  function notify(force = false) {
    if (!state) return;
    const fingerprint = JSON.stringify({
      friends: state.friends, incoming: state.incoming_requests,
      outgoing: state.outgoing_requests, messages: messages.map(m => m.id),
      status: state.presence, role: state.role, developer: state.developer,display_name:state.display_name,
      projects: state.projects
    });
    if (force || fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      onUpdate?.(state, messages);
    }
  }
  function scheduleNext(epoch) {
    if(epoch!==sessionEpoch||!connected()||document.hidden)return;
    if(interval)clearTimeout(interval);
    interval=setTimeout(()=>{interval=null;void sync();},
      socialPollDelay(chatActive,consecutiveErrors));
  }
  async function sync() {
    if (!connected() || busy || document.hidden) return;
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
      if(newMessages)messages = await localHistory();
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
        sessionEpoch++;
        state=null;keys=null;messages=[];lastFingerprint='';currentUser='';
        pinnedPeers.clear();derivedKeys.clear();
        if(privateDb){privateDb.close();privateDb=null;}
        status('disconnected','La sesión VIS Social expiró. Volvé a conectar la cuenta.');
      }else status('degraded',detail);
    } finally {
      if(epoch===sessionEpoch){
        busy = false;
        scheduleNext(epoch);
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
      messages = await localHistory();
      if(epoch!==sessionEpoch)return false;
      lastHeartbeat = 0; consecutiveErrors=0;
      notify(true);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('online', onOnline);
      await sync();
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
    if(document.hidden){if(interval){clearTimeout(interval);interval=null;}}
    else if(connected())void sync();
  }
  function onOnline() {
    if(connected()){consecutiveErrors=0;void sync();}
  }
  function setChatActive(open) {
    chatActive=!!open;
    if(interval){clearTimeout(interval);interval=null;}
    if(chatActive){void sync();}
    else if(!busy)scheduleNext(sessionEpoch);
  }
  async function stop() {
    sessionEpoch++;
    if (interval) { clearTimeout(interval); interval = null; }
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    const wasConnected=!!state;
    state=null;keys=null;currentUser='';messages=[];lastFingerprint='';
    pinnedPeers.clear();derivedKeys.clear();
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
    if (typeof body !== 'string' || !body.trim()) throw Error('Mensaje vacío');
    if (encoder.encode(body).length > 1300) throw Error('Mensaje demasiado largo (máximo 1300 bytes)');
    const friend = (state.friends || []).find(f => f.username === to);
    if (!friend?.public_key) throw Error('Tu amigo aún no configuró su identidad cifrada');
    const id = crypto.randomUUID().replace(/-/g, '');
    const pub=await verifiedPeerKey(friend);
    const aes=await peerAesKey(to,pub);
    const payload = await encrypt(body.trim(), currentUser, to, id, aes);
    if (encoder.encode(payload).length > 2048) throw Error('Mensaje cifrado demasiado largo');
    await rpc('/v1/messages/send', 'POST', { to, client_message_id: id, payload });
    await saveMessage({
      id, from: currentUser, to, body: body.trim(), created: new Date().toISOString()
    });
    messages = await localHistory();
    notify(true);
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
  async function accountInfo() {
    if (!connected()) throw Error('Primero iniciá sesión en VIS Social');
    return rpc('/v1/account');
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
  async function setAccountRole(username, role) {
    if (!connected() || state.role !== 'super_admin') throw Error('Supercuenta requerida');
    return rpc('/v1/admin/accounts/role','POST',{username,role});
  }
  async function setAccountDisabled(username, disabled) {
    if (!connected() || state.role !== 'super_admin') throw Error('Supercuenta requerida');
    return rpc('/v1/admin/accounts/disable','POST',{username,disabled});
  }
  return { start, stop, sync, connected, friendRequest, acceptFriend, setAlias,
    setPresence, sendMessage, setChatActive, subscribeProject, manageProject, grantStaff,
    setAccountRole, setAccountDisabled, accountInfo, setDisplayName, getAvatar, uploadAvatar, getSkin, uploadSkin, deleteSkin, state: () => state };
}
