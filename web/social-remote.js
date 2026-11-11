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
    const req = value === undefined ? table.get(key) : table.put(value, key);
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
export function createSocialRemote(command, onUpdate, onStatus) {
  let state = null, keys = null, privateDb = null, currentUser = '';
  let messages = [], busy = false, interval = null, lastHeartbeat = 0;
  let lastFingerprint = '';
  const connected = () => !!(state && privateDb && keys);
  const status = (value, error = '') => onStatus?.(value, error);
  const rpc = (path, method = 'GET', body = null) => command('social_request',
    { path, method, body });

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
    for (const key of expired) {
      await new Promise((resolve, reject) => {
        const req = privateDb.transaction('messages', 'readwrite')
          .objectStore('messages').delete(key);
        req.onsuccess = resolve;
        req.onerror = () => reject(req.error);
      });
    }
    fresh.sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
    return fresh.slice(-5000).map(({ from, to, body, created, id }) =>
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
      status: state.presence
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
      for (const incoming of fresh.pending_messages || []) {
        const friend = (fresh.friends || []).find(f => f.username === incoming.from);
        if (!friend?.public_key) continue;
        try {
          const text = await decrypt(incoming.payload, incoming.from,
            currentUser, incoming.client_message_id, keys.pair.privateKey, friend.public_key);
          await saveMessage({
            id: incoming.client_message_id, from: incoming.from, to: currentUser,
            body: text, created: new Date(incoming.created_at * 1000).toISOString()
          });
          ack.push(incoming.id);
        } catch {
          // No ACK for undecryptable messages; they remain available until expiry.
        }
      }
      if (ack.length) await rpc('/v1/messages/ack', 'POST', { ids: ack });
      state = fresh;
      messages = await localHistory();
      status('connected');
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
    if (wasConnected) void command('social_disconnect').catch(() => {});
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
  async function setPresence(presence, custom_status = '', current_game = '') {
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
    const payload = await encrypt(body.trim(), currentUser, to, id,
      keys.pair.privateKey, friend.public_key);
    if (encoder.encode(payload).length > 2048) throw Error('Mensaje cifrado demasiado largo');
    await rpc('/v1/messages/send', 'POST', { to, client_message_id: id, payload });
    await saveMessage({
      id, from: currentUser, to, body: body.trim(), created: new Date().toISOString()
    });
    messages = await localHistory();
    notify(true);
  }
  return { start, stop, sync, connected, friendRequest, acceptFriend, setAlias,
    setPresence, sendMessage, state: () => state };
}
