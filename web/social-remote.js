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
function allMessages(db) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('messages', 'readonly').objectStore('messages').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || Error('Error leyendo mensajes'));
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
async function encrypt(body, from, to, id, ownPrivate, peerPublic) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await sharedKey(ownPrivate, peerPublic);
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv, additionalData: aad(from, to, id)
  }, aes, encoder.encode(body));
  return JSON.stringify({ v: 1, iv: to64(iv), ct: to64(encrypted) });
}
async function decrypt(payload, from, to, id, ownPrivate, peerPublic) {
  const obj = JSON.parse(payload);
  if (obj?.v !== 1) throw Error('Mensaje cifrado incompatible');
  const aes = await sharedKey(ownPrivate, peerPublic);
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
export function createSocialRemote(command, onUpdate, onStatus) {
  let state = null, keys = null, privateDb = null, currentUser = '';
  let messages = [], busy = false, interval = null, lastHeartbeat = 0;
  let lastFingerprint = '';
  const connected = () => !!(state && privateDb && keys);
  const status = (value, error = '') => onStatus?.(value, error);
  const rpc = (path, method = 'GET', body = null) => command('social_request',
    { path, method, body });

  async function verifiedPeerKey(friend) {
    if (!privateDb || !currentUser || !friend?.username || !friend.public_key)
      throw Error('Identidad de amigo no disponible');
    const id='peer-key:'+currentUser+':'+friend.username;
    const pinned=await store(privateDb,'keys','readonly',undefined,id);
    const publicKey=validatePinnedPeerKey(pinned,friend.public_key);
    if (pinned == null) await store(privateDb,'keys','readwrite',publicKey,id);
    return publicKey;
  }
  async function localHistory() {
    if (!privateDb || !currentUser) return [];
    const all = await allMessages(privateDb);
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
    for (const key of expired) {
      await new Promise((resolve, reject) => {
        const req = privateDb.transaction('messages', 'readwrite')
          .objectStore('messages').delete(key);
        req.onsuccess = resolve;
        req.onerror = () => reject(req.error);
      });
    }
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
      status: state.presence, role: state.role,
      projects: state.projects
    });
    if (force || fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      onUpdate?.(state, messages);
    }
  }
  async function sync() {
    if (!connected() || busy) return;
    busy = true;
    try {
      if (Date.now() - lastHeartbeat > 45000) {
        await rpc('/v1/presence', 'POST',
          { presence: state.presence === 'offline' ? 'online' : state.presence,
            custom_status: state.custom_status || '', current_game: state.current_game || '' });
        lastHeartbeat = Date.now();
      }
      const fresh = await rpc('/v1/state');
      const ack = [];
      let securityError='';
      for (const incoming of fresh.pending_messages || []) {
        const friend = (fresh.friends || []).find(f => f.username === incoming.from);
        if (!friend?.public_key) continue;
        try {
          const pub=await verifiedPeerKey(friend);
          const text = await decrypt(incoming.payload, incoming.from,
            currentUser, incoming.client_message_id, keys.pair.privateKey, pub);
          await saveMessage({
            id: incoming.client_message_id, from: incoming.from, to: currentUser,
            body: text, created: new Date(incoming.created_at * 1000).toISOString()
          });
          ack.push(incoming.id);
        } catch(error) {
          // No ACK for unverifiable messages. Never replace a pinned key.
          if(String(error).includes('ALERTA:')) securityError=String(error);
        }
      }
      if (ack.length) await rpc('/v1/messages/ack', 'POST', { ids: ack });
      state = fresh;
      messages = await localHistory();
      status(securityError?'security_warning':'connected',securityError);
      notify();
    } catch (error) {
      status('degraded', String(error));
    } finally {
      busy = false;
    }
  }
  async function start(username) {
    await stop();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) throw Error('Usuario VIS Social inválido');
    status('connecting');
    currentUser = username;
    try {
      privateDb = await openPrivateDb();
      keys = await ecdhKeys(privateDb, username);
      const remote = await command('social_connect');
      await rpc('/v1/keys', 'POST', { public_key: keys.publicKey });
      state = remote;
      messages = await localHistory();
      lastHeartbeat = 0;
      notify(true);
      await sync();
      interval = setInterval(() => { void sync(); }, 6500);
      document.addEventListener('visibilitychange', onVisibility);
      return true;
    } catch (error) {
      await stop();
      status('disconnected', String(error));
      throw error;
    }
  }
  function onVisibility() { if (!document.hidden) void sync(); }
  async function stop() {
    if (interval) { clearInterval(interval); interval = null; }
    document.removeEventListener('visibilitychange', onVisibility);
    const wasConnected = !!state;
    state = null; keys = null; currentUser = ''; messages = []; lastFingerprint = '';
    lastHeartbeat = 0;
    if (privateDb) { privateDb.close(); privateDb = null; }
    if (wasConnected) await command('social_disconnect').catch(() => {});
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
    const payload = await encrypt(body.trim(), currentUser, to, id,
      keys.pair.privateKey, pub);
    if (encoder.encode(payload).length > 2048) throw Error('Mensaje cifrado demasiado largo');
    await rpc('/v1/messages/send', 'POST', { to, client_message_id: id, payload });
    await saveMessage({
      id, from: currentUser, to, body: body.trim(), created: new Date().toISOString()
    });
    messages = await localHistory();
    notify(true);
  }
  async function subscribeProject(projectId, subscribe = true) {
    if (!connected()) throw Error('VIS Social no está conectado');
    await rpc(subscribe?'/v1/projects/subscribe':'/v1/projects/unsubscribe','POST',
      { project_id: projectId });
    await sync();
  }
  async function manageProject(project) {
    if (!connected() || state.role !== 'super_admin') throw Error('Supercuenta requerida');
    await rpc('/v1/admin/projects/upsert','POST',project);
    await sync();
  }
  async function grantStaff(projectId, username, staffRole) {
    if (!connected() || state.role !== 'super_admin') throw Error('Supercuenta requerida');
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
    setPresence, sendMessage, subscribeProject, manageProject, grantStaff,
    setAccountRole, setAccountDisabled, state: () => state };
}
