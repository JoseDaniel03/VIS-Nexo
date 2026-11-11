// VIS Social: Cloudflare relays live messages; content lives in small device-only logs.
import { loadLocalChat, appendLocalChat, markLocalChatRead, eraseLocalChat, purgeLocalChats,
  LOCAL_CHAT_LIMIT_BYTES, LOCAL_CHAT_RETENTION_MS } from "./humile-local-log.js";
const endpointKey = "vis-social-worker-url";
let endpoint = "";
try { endpoint = localStorage.getItem(endpointKey) || ""; } catch {}
let localOwner = "", account = null, token = "", snapshot = null, chatId = "", chatMessages = [];
let loading = false, error = "", socket = null, mounted = null, reconnect = null;
let poll = null, socketPing = null, chatBefore = null, connected = false;
const chatDrafts = new Map();
let renderedChatId = "", olderScroll = null;
let statusDraft = null;
let contextMenu = null, nicknameEditor = null;
let cloudActive = false;
const runningGames = new Map(); // pid => { engine, project }; never supplied by user input.
const exitedBeforeLaunchAck = new Set(); // A fast crash can arrive before the launch promise resolves.
let activityHeartbeat = null;
let activityGeneration = 0;
const gameName = engine => engine === "rust" ? "Minecraft Rust Edition" : "Minecraft Java";
function currentGame() {
  const games = Array.from(runningGames.values());
  return games.length ? games[games.length - 1] : null;
}
async function publishGameActivity() {
  if (!cloudActive || !token || !endpointReady() || snapshot?.me?.share_game === false) return;
  const epoch = ++activityGeneration;
  const playing = currentGame();
  try {
    const result = await api("/v1/activity", "POST", playing || { engine: null });
    if (epoch === activityGeneration && snapshot?.me) {
      snapshot.me.activity = result.activity;
      draw();
    }
  } catch (err) { if (epoch === activityGeneration && token) console.warn("[VIS Humile] Estado del juego:", String(err)); }
}
export function socialGameStarted({ pid, engine, project = "" }) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !["java", "rust"].includes(engine)) return;
  if (exitedBeforeLaunchAck.has(pid)) return; // Do not report a crashed game as running.
  runningGames.set(pid, { engine, project: String(project).slice(0, 64) });
  void publishGameActivity();
}
export function socialGameStopped(pid) {
  const gamePid = Number(pid);
  if (!Number.isSafeInteger(gamePid) || gamePid <= 0) return;
  exitedBeforeLaunchAck.add(gamePid);
  setTimeout(() => exitedBeforeLaunchAck.delete(gamePid), 30000);
  if (!runningGames.delete(gamePid)) return;
  void publishGameActivity();
}
function captureCustomDraft() {
  const input = mounted?.querySelector("[data-cloud-custom-status]");
  if (input && document.activeElement === input) statusDraft = input.value;
}

function captureChatDraft() {
  if (!renderedChatId || !mounted?.isConnected) return;
  const input = mounted.querySelector('form[data-cloud-form="message"] input[name="body"]');
  if (input) chatDrafts.set(renderedChatId, input.value);
}

const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const key = value => esc(value);
const safeEndpoint = value => {
  try {
    const parsed = new URL(String(value).trim());
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".workers.dev") || parsed.username ||
        parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) return "";
    return parsed.origin;
  } catch { return ""; }
};
const showError = value => { error = String(value || "Error"); draw(); };
const endpointReady = () => !!safeEndpoint(endpoint);

function logOf(id) {
  if (!account || !endpointReady()) return { messages: [], unread: 0, bytes: 0, latest: 0 };
  return loadLocalChat(localStorage, endpoint, account.id, id);
}
function isThreadVisible() {
  return !!chatId && !!mounted?.isConnected &&
    !mounted.closest(".vis-cloud-pane")?.classList.contains("is-hidden") &&
    !document.hidden && document.hasFocus();
}
function activateChat(id) {
  chatId = id; chatBefore = null;
  // Never mark messages read while VIS is minimized or the social pane is hidden.
  const visible = isThreadVisible();
  const log = visible
    ? markLocalChatRead(localStorage, endpoint, account.id, id)
    : logOf(id);
  chatMessages = log.messages;
  const active = snapshot?.chats?.find(c => c.id === id);
  if (active) active.unread = log.unread;
}
function localInboxSnapshot(data) {
  if (!account) return;
  purgeLocalChats(localStorage, endpoint, account.id);
  for (const chat of data.chats || []) {
    const log = logOf(chat.id);
    chat.unread = log.unread;
    chat.latest_local = log.latest;
  }
}
async function receiveLiveChat(payload) {
  if (!cloudActive || !account || !token || !payload || typeof payload !== "object") return;
  if (!/^[a-f0-9-]{36}$/i.test(payload.chat_id || "") ||
      !/^[a-f0-9-]{36}$/i.test(payload.id || "") ||
      typeof payload.body !== "string" || typeof payload.sender !== "string") return;
  const requestToken = token, recipientId = account.id;
  if (!snapshot?.chats?.some(c => c.id === payload.chat_id)) await refresh();
  if (token !== requestToken || account?.id !== recipientId ||
      !snapshot?.chats?.some(c => c.id === payload.chat_id)) return;
  try {
    const log = appendLocalChat(localStorage, endpoint, recipientId, payload.chat_id, payload);
    const active = snapshot.chats.find(c => c.id === payload.chat_id);
    if (active) {
      active.unread = log.unread;
      active.latest_local = log.latest;
    }
    if (chatId === payload.chat_id) activateChat(chatId);
    draw();
  } catch (err) {
    showError("No se pudo guardar el mensaje en este equipo: " + String(err.message || err));
  }
}

function stopSocket() {
  if (socketPing) clearInterval(socketPing);
  socketPing = null;
  if (socket) { socket.onclose = null; try { socket.close(); } catch {} }
  socket = null; connected = false;
  if (reconnect) clearTimeout(reconnect);
  reconnect = null;
}
function stopPolling() {
  if (poll) clearInterval(poll);
  if (activityHeartbeat) clearInterval(activityHeartbeat);
  poll = null; activityHeartbeat = null;
}
export function suspendSocialCloud() {
  // Switching back to local mode must not leave a visible online game status.
  if (token && endpointReady() && cloudActive) void api("/v1/activity", "POST", { engine: null }).catch(() => {});
  cloudActive = false;
  stopSocket(); stopPolling();
}
export function resumeSocialCloud() { if (token && endpointReady() && !socket) startLive(); }
export function syncSocialOwner(name, guest = false) {
  const next = guest ? "" : String(name || "").toLowerCase();
  if (localOwner === next) return;
  if (cloudActive && token && endpointReady()) void api("/v1/activity", "POST", { engine: null }).catch(() => {});
  cloudActive = false; activityGeneration++; runningGames.clear();
  localOwner = next; token = ""; account = null; snapshot = null; chatId = ""; chatMessages = [];
  chatDrafts.clear(); renderedChatId = ""; olderScroll = null; statusDraft = null;
  contextMenu = null; nicknameEditor = null;
  stopSocket(); stopPolling();
}
export function socialOnlinePanel(visible) {
  captureChatDraft();
  return '<aside class="social-pane vis-cloud-pane ' + (visible ? "" : "is-hidden") +
    '" aria-label="VIS Social"><div class="social-top"><div class="social-brand">' +
    '<span class="social-title">VIS HUMILE</span><small>Amigos y chats en línea</small></div>' +
    '<button class="vis-cloud-mini vis-switch-local" data-action="social-local" title="Volver a amigos locales">Local</button>' +
    '<button class="icon-btn" data-action="toggle-social" title="Ocultar panel" aria-label="Ocultar panel">×</button></div>' +
    '<div id="vis-social-root"></div></aside>';
}
async function api(path, method = "GET", body = undefined, needsAuth = true) {
  if (!endpointReady()) throw new Error("Configurá primero tu Worker de VIS Social.");
  const headers = { "Content-Type": "application/json" };
  if (needsAuth) {
    if (!token) throw new Error("Iniciá sesión en VIS Social.");
    headers.Authorization = "Bearer " + token;
  }
  const response = await fetch(endpoint + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store"
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && needsAuth) signOut(false);
    throw new Error(result.error || "Error del servicio (" + response.status + ")");
  }
  return result;
}
function signOut(drawAfter = true) {
  cloudActive = false; activityGeneration++;
  token = ""; account = null; snapshot = null; chatId = ""; chatMessages = []; chatBefore = null;
  chatDrafts.clear(); renderedChatId = ""; olderScroll = null; statusDraft = null;
  stopSocket(); stopPolling(); if (drawAfter) draw();
}
// Never let an old response overwrite a different account or active conversation.
async function refresh() {
  if (!token || !account) return;
  const requestToken = token, requestAccount = account.id, opening = chatId;
  const stillCurrent = () => token === requestToken && account?.id === requestAccount;
  try {
    const data = await api("/v1/social");
    if (!stillCurrent()) return;
    snapshot = data;
    error = "";
    localInboxSnapshot(data);
    if (opening && chatId === opening && data.chats?.some(c => c.id === opening)) {
      activateChat(opening);
    }
    draw();
  } catch (err) {
    if (stillCurrent()) showError(err.message);
  }
}
async function connect() {
  stopSocket();
  if (!cloudActive || !token || !endpointReady()) return;
  const credentials = token, connectingAccount = account?.id;
  try {
    const data = await api("/v1/rt/ticket", "POST", {});
    // A sign-out, owner switch or local-mode switch while requesting a
    // one-use ticket must not reopen an authenticated private connection.
    if (!cloudActive || token !== credentials || account?.id !== connectingAccount) return;
    const url = endpoint.replace(/^https:/, "wss:") + "/v1/rt?ticket=" + encodeURIComponent(data.ticket);
    socket = new WebSocket(url);
    socket.onopen = () => {
      connected = true;
      if (socketPing) clearInterval(socketPing);
      socketPing = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          try { socket.send("ping"); } catch { /* WebSocket close will reconnect. */ }
        }
      }, 45000);
      draw();
    };
    socket.onmessage = event => {
      if (event.data === "pong") return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "chat:message") void receiveLiveChat(payload);
        else if (payload.type === "ready" || payload.type === "social:update") void refresh();
      } catch {}
    };
    socket.onclose = () => {
      if (socketPing) clearInterval(socketPing);
      socketPing = null;
      connected = false;
      if (cloudActive && token) reconnect = setTimeout(() => void connect(), 4500);
      draw();
    };
    socket.onerror = () => { connected = false; };
  } catch {
    if (cloudActive && token) reconnect = setTimeout(() => void connect(), 9000);
  }
}
function startLive() {
  cloudActive = true;
  stopPolling();
  poll = setInterval(() => { if (token && mounted?.isConnected) void refresh(); }, 45000);
  activityHeartbeat = setInterval(() => {
    if (token && currentGame()) void publishGameActivity();
  }, 75000);
  void connect();
  void publishGameActivity(); // Also clears an old activity after a launcher crash.
}
function banner(title, detail) {
  return '<div class="vis-cloud-intro"><b>' + esc(title) + '</b><small>' + esc(detail) + '</small></div>';
}
function configForm() {
  return banner("Conectar VIS Social", "Usá la dirección HTTPS del Worker vis-social desplegado en Cloudflare.") +
    '<form data-cloud-form="endpoint" class="vis-cloud-form"><label>URL del Worker' +
    '<input name="endpoint" type="url" placeholder="https://vis-social.tu-cuenta.workers.dev" value="' +
    esc(endpoint) + '" required></label><button>Conectar</button></form>';
}
function accountForm() {
  return banner("VIS Ceibo", "La cuenta social online requiere contraseña; el nickname offline no autentica en la nube.") +
    '<form data-cloud-form="auth" class="vis-cloud-form">' +
    '<label>Usuario<input name="username" maxlength="24" minlength="3" autocomplete="username" value="' + esc(localOwner) + '" required placeholder="Tu usuario VIS"></label>' +
    '<label>Contraseña<input name="password" type="password" autocomplete="current-password" minlength="12" required placeholder="12 caracteres o más"></label>' +
    '<div class="vis-cloud-actions"><button name="mode" value="login">Entrar</button>' +
    '<button name="mode" value="register" class="secondary">Crear cuenta online</button></div></form>' +
    '<button class="vis-cloud-link" data-cloud="reset-endpoint">Cambiar Worker</button>';
}
const presenceNames = { online: "Conectado", away: "Ausente", busy: "Ocupado", invisible: "Invisible", offline: "Desconectado" };
const stateLabel = friend => friend?.online ? (presenceNames[friend.presence] || "Conectado") : "Desconectado";
function gameLabel(activity) {
  if (!activity || !["rust", "java"].includes(activity.engine)) return "";
  return gameName(activity.engine) + (activity.project ? " · " + activity.project : "");
}
function friendById(id) {
  return snapshot?.friends?.find(friend => friend.other_id === id && friend.status === "accepted");
}
function friendByUsername(username) {
  return snapshot?.friends?.find(friend => friend.username === username && friend.status === "accepted");
}
function displayFriend(friend) {
  return friend?.nickname || friend?.username || "";
}
function contextButton(label, action, id, username = "") {
  return '<button type="button" role="menuitem" data-cloud="' + esc(action) +
    '" data-id="' + key(id) + '" data-name="' + key(username) + '">' + esc(label) + '</button>';
}
function menuMarkup() {
  if (!contextMenu) return "";
  let options = "";
  let title = "Acciones";
  if (contextMenu.type === "friend") {
    const friend = friendById(contextMenu.id);
    if (!friend) return "";
    const favorites = new Set(snapshot?.favorites || []);
    title = displayFriend(friend);
    options += contextButton("Enviar mensaje", "chat-friend", friend.other_id, friend.username);
    options += contextButton("Cambiar apodo", "edit-nickname", friend.other_id);
    if (friend.nickname) options += contextButton("Quitar apodo", "clear-nickname", friend.other_id);
    options += contextButton(favorites.has(friend.other_id) ? "Quitar favorito" : "Marcar favorito", "favorite", friend.other_id);
    options += '<div class="vis-cloud-menu-divider" role="separator"></div>';
    options += contextButton("Eliminar amigo", "remove-friend", friend.other_id);
    options += contextButton("Bloquear usuario", "block", friend.other_id);
  } else if (contextMenu.type === "chat") {
    const chat = snapshot?.chats?.find(c => c.id === contextMenu.id);
    if (!chat) return "";
    title = chat.kind === "group" ? chat.title : (displayFriend(friendByUsername(chat.peer_username)) || chat.peer_username || "Conversación");
    options += contextButton("Abrir conversación", "open-chat", chat.id);
    options += contextButton("Marcar como leído", "mark-chat-read", chat.id);
    options += contextButton("Borrar historial en este equipo", "erase-chat-local", chat.id);
    if (chat.kind === "group") {
      options += '<div class="vis-cloud-menu-divider" role="separator"></div>' +
        contextButton("Salir del grupo", "leave-group-menu", chat.id);
    } else {
      const friend = friendByUsername(chat.peer_username);
      if (friend) options += contextButton("Cambiar apodo", "edit-nickname", friend.other_id);
    }
  }
  const x = Math.max(8, Math.min(window.innerWidth - 224, contextMenu.x));
  const y = Math.max(8, Math.min(window.innerHeight - 306, contextMenu.y));
  return '<nav class="vis-cloud-context-menu" role="menu" aria-label="Acciones para ' +
    esc(title) + '" style="left:' + x + 'px;top:' + y + 'px">' + options + '</nav>';
}
function openContext(type, id, x, y) {
  if (type === "friend" && !friendById(id)) return;
  if (type === "chat" && !snapshot?.chats?.some(chat => chat.id === id)) return;
  contextMenu = { type, id, x, y };
  draw();
  mounted?.querySelector(".vis-cloud-context-menu [role=menuitem]")?.focus({ preventScroll: true });
}
function friendList() {
  const favorites = new Set(snapshot?.favorites || []);
  const friends = [...(snapshot?.friends || [])].sort((a,b) =>
    Number(favorites.has(b.other_id)) - Number(favorites.has(a.other_id)) ||
    displayFriend(a).localeCompare(displayFriend(b), "es", { sensitivity: "base" }));
  const incoming = snapshot?.incoming || [], outgoing = snapshot?.outgoing || [];
  let markup = '<section class="vis-social-block"><h4>Amigos <small>' + friends.length + '</small></h4>';
  markup += '<form data-cloud-form="friend" class="vis-cloud-inline"><input name="username" maxlength="24" placeholder="Agregar por usuario" required>' +
    '<button aria-label="Enviar solicitud">+</button></form>';
  if (nicknameEditor && !friendById(nicknameEditor.id)) nicknameEditor = null;
  if (nicknameEditor) {
    markup += '<form data-cloud-form="nickname" class="vis-cloud-nickname-form">' +
      '<label>Apodo privado para @' + esc(nicknameEditor.username) +
      '<input data-cloud-nickname name="nickname" maxlength="40" minlength="1" required ' +
      'placeholder="Cómo querés llamar a tu amigo" value="' + esc(nicknameEditor.draft) + '"></label>' +
      '<div class="vis-cloud-nickname-actions"><button type="submit">Guardar</button>' +
      '<button type="button" class="secondary" data-cloud="cancel-nickname">Cancelar</button></div></form>';
  }
  for (const friend of friends) {
    markup += '<div class="vis-social-row vis-cloud-friend-row" data-cloud-context="friend" data-id="' +
      key(friend.other_id) + '"><span class="vis-presence-dot ' +
      (friend.online ? (friend.presence === "away" ? "is-away" : friend.presence === "busy" ? "is-busy" : "is-online") : "") +
      '"></span><button data-cloud="chat-friend" data-name="' + key(friend.username) + '">' +
      esc(displayFriend(friend)) +
      (friend.nickname ? '<small class="vis-cloud-real-name">@' + esc(friend.username) + '</small>' : '') +
      '<small>' + esc(stateLabel(friend)) + '</small>' +
      (friend.online && friend.custom_status ? '<small class="vis-cloud-custom">' + esc(friend.custom_status) + '</small>' : '') +
      (friend.online && friend.activity ? '<small class="vis-cloud-playing">' + esc('Jugando ' + gameLabel(friend.activity)) + '</small>' : '') + '</button>' +
      '<button type="button" class="vis-cloud-mini vis-cloud-menu-button" data-cloud-menu="friend" data-id="' +
      key(friend.other_id) + '" aria-haspopup="menu" aria-label="Más acciones para ' +
      esc(displayFriend(friend)) + '" title="Más acciones">⋯</button></div>';
  }
  if (!friends.length) markup += '<p class="vis-social-note">Todavía no tenés amigos online.</p>';
  if (incoming.length) {
    markup += '<h4>Solicitudes recibidas</h4>';
    for (const item of incoming) markup += '<div class="vis-social-row"><span>' + esc(item.username) +
      '</span><button class="vis-cloud-mini" data-cloud="accept" data-id="' + key(item.id) + '">Aceptar</button>' +
      '<button class="vis-cloud-mini" data-cloud="reject" data-id="' + key(item.id) + '">Rechazar</button></div>';
  }
  if (outgoing.length) {
    markup += '<h4>Enviadas</h4>';
    for (const item of outgoing) markup += '<div class="vis-social-row"><span>' + esc(item.username) +
      '</span><button class="vis-cloud-mini" data-cloud="cancel" data-id="' + key(item.id) + '">Cancelar</button></div>';
  }
  const blocked = snapshot?.blocked || [];
  if (blocked.length) {
    markup += '<h4>Bloqueados</h4>';
    for (const item of blocked) markup += '<div class="vis-social-row"><span>' + esc(item.username) +
      '</span><button class="vis-cloud-mini" data-cloud="unblock" data-id="' + key(item.id) + '">Desbloquear</button></div>';
  }
  return markup + '</section>';
}
function chatList() {
  let markup = '<section class="vis-social-block"><h4>Conversaciones</h4>';
  const conversations = [...(snapshot?.chats || [])].sort((a, b) =>
    (b.latest_local || Date.parse(b.created_at) || 0) - (a.latest_local || Date.parse(a.created_at) || 0));
  for (const chat of conversations) {
    const friend = chat.kind === "direct" ? friendByUsername(chat.peer_username) : null;
    const label = chat.kind === "group" ? chat.title : (displayFriend(friend) || chat.peer_username || "Chat privado");
    markup += '<div class="vis-cloud-chat-row" data-cloud-context="chat" data-id="' + key(chat.id) + '">' +
      '<button class="vis-cloud-chatitem ' + (chatId === chat.id ? "selected" : "") +
      '" data-cloud="open-chat" data-id="' + key(chat.id) + '">' +
      '<span>' + esc(label) +
      (friend?.nickname ? '<small class="vis-cloud-real-name">@' + esc(chat.peer_username) + '</small>' : '') +
      '</span>' +
      (chat.unread ? '<b class="vis-cloud-unread">' + Number(chat.unread) + '</b>' : "") + '</button>' +
      '<button type="button" class="vis-cloud-mini vis-cloud-menu-button" data-cloud-menu="chat" data-id="' +
      key(chat.id) + '" aria-haspopup="menu" aria-label="Más opciones para ' +
      esc(label) + '" title="Opciones del chat">⋯</button></div>';
  }
  markup += '<form data-cloud-form="group" class="vis-cloud-form"><label>Nuevo grupo<input name="title" maxlength="80" placeholder="Nombre del grupo" required></label>' +
    '<label>Amigos (separados por comas)<input name="members" placeholder="ana, pepe" required></label><button>Crear grupo</button></form>';
  return markup + '</section>';
}
function thread() {
  const chat = snapshot?.chats?.find(item => item.id === chatId);
  let markup = '<section class="vis-cloud-thread"><div class="vis-cloud-thread-head"><b>' +
    esc(chat?.kind === "group" ? chat.title : (displayFriend(friendByUsername(chat?.peer_username)) || chat?.peer_username || "Conversación")) +
    '</b>' + (chat?.kind === "group" ? '<button class="vis-cloud-mini" data-cloud="leave-group" title="Salir del grupo">Salir del grupo</button>' : '') +
    '<button data-cloud="close-chat" aria-label="Cerrar conversación">×</button></div>' +
    '<p class="vis-cloud-local-hint">Historial local · ' +
      Math.floor(LOCAL_CHAT_RETENTION_MS / 86400000) + ' días · máximo ' +
      Math.round(LOCAL_CHAT_LIMIT_BYTES / 1024) + ' KB por chat · sin sincronización entre equipos</p>' +
    '<div class="vis-cloud-messages">';
  // The current device contains all retained history. No remote page is queried.
  if (!chatMessages.length) markup += '<p class="vis-social-note">Todavía no hay mensajes.</p>';
  for (const msg of chatMessages) markup += '<div class="vis-cloud-bubble ' +
    (msg.sender_id === account?.id ? "mine" : "") + '"><b>' +
    esc(displayFriend(friendById(msg.sender_id)) || msg.sender) +
    '</b><span>' + esc(msg.body) + '</span><small>' + esc(new Date(msg.created_at).toLocaleString("es-AR")) + '</small></div>';
  markup += '</div><form data-cloud-form="message" class="vis-cloud-inline">' +
    '<input name="body" maxlength="1500" placeholder="Mensaje breve (máx. 1536 bytes)" required>' +
    '<button aria-label="Enviar mensaje">➤</button></form></section>';
  return markup;
}
function draw() {
  const host = mounted;
  if (!host?.isConnected) return;
  if (!localOwner) { host.innerHTML = '<p class="vis-social-note">Iniciá una sesión local para entrar a VIS Social.</p>'; return; }
  let markup = error ? '<div role="alert" class="vis-cloud-error">' + esc(error) + '</div>' : "";
  if (!endpointReady()) markup += configForm();
  else if (!token || !account) markup += accountForm();
  else {
    markup += '<div class="vis-cloud-identity"><span>● ' + esc(account.username) + '</span>' +
      '<small>' + (connected ? "Tiempo real activo" : "Reconectando…") + '</small>' +
      '<button data-cloud="logout">Salir</button></div>' +
      '<label class="vis-cloud-presence-label">Tu estado' +
      '<select data-cloud-presence aria-label="Estado de presencia">' +
      ['online','away','busy','invisible'].map(value =>
        '<option value="' + value + '"' + ((snapshot?.me?.presence || 'online') === value ? ' selected' : '') +
        '>' + presenceNames[value] + '</option>').join('') + '</select></label>' +
      '<form data-cloud-form="custom-status" class="vis-cloud-custom-form">' +
      '<label>Estado personalizado (máximo 80 caracteres)<input data-cloud-custom-status name="custom" maxlength="80" ' +
      'placeholder="Ej. Construyendo Virgoland…" value="' +
      esc(statusDraft ?? snapshot?.me?.custom_status ?? '') + '"></label><button>Guardar estado</button></form>' +
      '<label class="vis-cloud-share-game"><input type="checkbox" data-cloud-share-game ' +
      (snapshot?.me?.share_game !== false ? 'checked' : '') + '> Mostrar el juego a mis amigos</label>' +
      (snapshot?.me?.activity && snapshot?.me?.share_game !== false ?
        '<p class="vis-cloud-self-game">' + esc('Jugando ' + gameLabel(snapshot.me.activity)) + '</p>' : '');
    markup += loading && !snapshot ? '<p class="vis-social-note">Cargando…</p>' : friendList() + chatList();
    if (chatId) markup += thread();
    markup += menuMarkup();
  }
  captureChatDraft();
  captureCustomDraft();
  // Realtime events redraw the sidebar. Preserve chat/status input focus and
  // caret so receiving a message doesn't interrupt someone typing.
  const focused = document.activeElement;
  const focusSelector = focused?.matches?.('[data-cloud-custom-status]') ?
    '[data-cloud-custom-status]' : focused?.matches?.('form[data-cloud-form="message"] input[name="body"]') ?
    'form[data-cloud-form="message"] input[name="body"]' : focused?.matches?.('[data-cloud-nickname]') ?
    '[data-cloud-nickname]' : null;
  const caret = focusSelector && focused ? [focused.selectionStart, focused.selectionEnd] : null;
  const previousRegion = host.querySelector(".vis-cloud-messages");
  const sameThread = !!chatId && renderedChatId === chatId;
  const wasAtBottom = !previousRegion || previousRegion.scrollHeight - previousRegion.scrollTop - previousRegion.clientHeight < 36;
  const previousTop = previousRegion?.scrollTop || 0;
  host.innerHTML = markup;
  renderedChatId = chatId;
  const input = host.querySelector('form[data-cloud-form="message"] input[name="body"]');
  if (input && chatDrafts.has(chatId)) input.value = chatDrafts.get(chatId);
  if (focusSelector) {
    const restored = host.querySelector(focusSelector);
    if (restored) {
      restored.focus({ preventScroll: true });
      if (caret?.every(Number.isInteger)) restored.setSelectionRange(caret[0], caret[1]);
    }
  }
  const region = host.querySelector(".vis-cloud-messages");
  if (region) {
    if (olderScroll && sameThread) region.scrollTop = olderScroll.top + region.scrollHeight - olderScroll.height;
    else region.scrollTop = sameThread && !wasAtBottom ? previousTop : region.scrollHeight;
  }
  olderScroll = null;
}
async function perform(fn) {
  if (loading) return;
  loading = true;
  try { await fn(); error = ""; }
  catch (err) { error = String(err.message || err); }
  finally { loading = false; draw(); }
}
async function onSubmit(event) {
  const form = event.target.closest("form[data-cloud-form]");
  if (!form) return;
  event.preventDefault(); event.stopPropagation();
  const data = new FormData(form), action = form.dataset.cloudForm;
  const submitter = event.submitter;
  if (action === "endpoint") {
    const value = safeEndpoint(data.get("endpoint"));
    if (!value) { showError("Usá una URL HTTPS de tu Worker (*.workers.dev)."); return; }
    endpoint = value; try { localStorage.setItem(endpointKey, endpoint); } catch {}
    signOut(); return;
  }
  await perform(async () => {
    if (action === "auth") {
      const username = String(data.get("username") || ""), password = String(data.get("password") || "");
      const mode = submitter?.value === "register" ? "register" : "login";
      const result = await api("/v1/auth/" + mode, "POST", { username, password }, false);
      token = result.token; account = result.account; snapshot = null;
      purgeLocalChats(localStorage, endpoint, account.id);
      await refresh(); startLive();
    } else if (action === "custom-status") {
      const result = await api("/v1/presence", "POST", { custom_status: String(data.get("custom") || "") });
      statusDraft = null;
      if (snapshot?.me) snapshot.me.custom_status = result.custom_status;
    } else if (action === "nickname") {
      if (!nicknameEditor || !friendById(nicknameEditor.id)) throw new Error("El amigo ya no está disponible.");
      const name = String(data.get("nickname") || "").trim();
      if (!name || [...name].length > 40) throw new Error("Ingresá un apodo de 1 a 40 caracteres.");
      await api("/v1/friends/" + nicknameEditor.id + "/nickname", "PUT", { nickname: name });
      nicknameEditor = null;
      await refresh();
    } else if (action === "friend") {
      await api("/v1/friends/requests", "POST", { username: String(data.get("username") || "") }); await refresh();
    } else if (action === "group") {
      const members = String(data.get("members") || "").split(",").map(x => x.trim()).filter(Boolean);
      const created = await api("/v1/chats/groups", "POST", { title: String(data.get("title") || ""), members });
      chatId = created.id; await refresh();
    } else if (action === "message") {
      if (!chatId) return;
      const sent = await api("/v1/chats/" + encodeURIComponent(chatId) + "/messages", "POST",
        { body: String(data.get("body") || "") });
      const log = appendLocalChat(localStorage, endpoint, account.id, chatId, sent);
      chatMessages = log.messages;
      const active = snapshot?.chats?.find(c => c.id === chatId);
      if (active) { active.unread = log.unread; active.latest_local = log.latest; }
      chatDrafts.set(chatId, "");
      const field = form.querySelector('input[name="body"]'); if (field) field.value = "";
      // Only sockets accepted the relay. The recipient may still fail to store it.
      if (sent.relayed_to < 1) showError("No se pudo retransmitir el mensaje a ningún jugador conectado.");
    }
  });
}
async function onClick(event) {
  const menuButton = event.target.closest("[data-cloud-menu]");
  if (menuButton && mounted?.contains(menuButton)) {
    event.preventDefault(); event.stopPropagation();
    const rect = menuButton.getBoundingClientRect();
    openContext(menuButton.dataset.cloudMenu, menuButton.dataset.id, rect.left, rect.bottom + 4);
    return;
  }
  const button = event.target.closest("[data-cloud]");
  if (!button) {
    if (contextMenu) { contextMenu = null; draw(); }
    return;
  }
  event.preventDefault(); event.stopPropagation();
  const action = button.dataset.cloud, id = button.dataset.id;
  contextMenu = null;
  if (action === "cancel-nickname") { nicknameEditor = null; draw(); return; }
  if (action === "edit-nickname") {
    const friend = friendById(id);
    if (!friend) return showError("El usuario ya no es tu amigo.");
    nicknameEditor = { id, username: friend.username, draft: friend.nickname || "" };
    draw();
    mounted?.querySelector("[data-cloud-nickname]")?.focus({ preventScroll: true });
    return;
  }
  if (action === "clear-nickname") {
    await perform(async () => {
      await api("/v1/friends/" + id + "/nickname", "DELETE");
      if (nicknameEditor?.id === id) nicknameEditor = null;
      await refresh();
    });
    return;
  }
  if (action === "mark-chat-read") {
    await perform(async () => {
      const local = markLocalChatRead(localStorage, endpoint, account.id, id);
      const chat = snapshot?.chats?.find(c => c.id === id);
      if (chat) chat.unread = 0;
      if (chatId === id) chatMessages = local.messages;
    });
    return;
  }
  if (action === "erase-chat-local") {
    if (!confirm("¿Borrar los mensajes de esta conversación guardados en este equipo?")) return;
    eraseLocalChat(localStorage, endpoint, account.id, id);
    const chat = snapshot?.chats?.find(c => c.id === id);
    if (chat) { chat.unread = 0; chat.latest_local = 0; }
    if (chatId === id) chatMessages = [];
    draw();
    return;
  }
  if (action === "leave-group-menu") {
    if (!confirm("¿Querés salir de este grupo?")) return;
    await perform(async () => {
      await api("/v1/chats/" + id + "/leave", "POST", {});
      if (chatId === id) { chatId = ""; chatMessages = []; chatBefore = null; }
      await refresh();
    });
    return;
  }
  if (action === "logout") {
    if (token) { try { await api("/v1/auth/logout", "POST", {}); } catch {} }
    signOut(); return;
  }
  if (action === "reset-endpoint") { endpoint = ""; signOut(); return; }
  if (action === "close-chat") { chatId = ""; chatMessages = []; chatBefore = null; draw(); return; }
  if (action === "leave-group") {
    if (!chatId || !confirm("¿Querés salir de este grupo?")) return;
    await perform(async () => {
      await api("/v1/chats/" + chatId + "/leave", "POST", {});
      chatId = ""; chatMessages = []; chatBefore = null; await refresh();
    });
    return;
  }
  await perform(async () => {
    if (action === "chat-friend") {
      const result = await api("/v1/chats/direct", "POST", { username: button.dataset.name });
      activateChat(result.id); await refresh();
    } else if (action === "open-chat") { activateChat(id); await refresh(); }
    else if (["accept", "reject", "cancel"].includes(action)) {
      await api("/v1/friends/answer", "POST", { id, action }); await refresh();
    } else if (["block", "unblock", "remove-friend"].includes(action)) {
      if (action === "block" && !confirm("¿Bloquear a este usuario?")) return;
      if (action === "remove-friend" && !confirm("¿Eliminar a este amigo de tus contactos?")) return;
      const path = action === "remove-friend" ? "/v1/friends/" + id : "/v1/blocks/" + id;
      await api(path, action === "block" ? "POST" : "DELETE"); await refresh();
    } else if (action === "favorite") {
      const favorites = new Set(snapshot?.favorites || []);
      await api("/v1/favorites/" + id, favorites.has(id) ? "DELETE" : "POST"); await refresh();
    }
  });
}
async function onChange(event) {
  const select = event.target.closest("[data-cloud-presence]");
  const share = event.target.closest("[data-cloud-share-game]");
  if (!select && !share) return;
  const payload = select ? { visibility: select.value } : { share_game: share.checked };
  await perform(async () => {
    const result = await api("/v1/presence", "POST", payload);
    if (snapshot?.me) {
      snapshot.me.presence = result.visibility;
      snapshot.me.custom_status = result.custom_status;
      snapshot.me.share_game = result.share_game;
      if (!result.share_game) snapshot.me.activity = null;
      else if (share && currentGame()) await publishGameActivity();
    }
  });
}
function onInput(event) {
  const field = event.target.closest("[data-cloud-custom-status]");
  if (field) statusDraft = field.value;
  const nickname = event.target.closest("[data-cloud-nickname]");
  if (nickname && nicknameEditor) nicknameEditor.draft = nickname.value;
}
function onContextMenu(event) {
  const row = event.target.closest("[data-cloud-context]");
  if (!row || !mounted?.contains(row)) return;
  event.preventDefault(); event.stopPropagation();
  openContext(row.dataset.cloudContext, row.dataset.id, event.clientX, event.clientY);
}
function onMenuKeydown(event) {
  if (event.key === "Escape") {
    if (contextMenu) { event.preventDefault(); contextMenu = null; draw(); }
    return;
  }
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  const row = event.target.closest("[data-cloud-context]");
  if (!row || !mounted?.contains(row)) return;
  event.preventDefault();
  const rect = row.getBoundingClientRect();
  openContext(row.dataset.cloudContext, row.dataset.id, rect.left + 16, rect.bottom + 4);
}
function mount() {
  const next = document.querySelector("#vis-social-root");
  if (!next || next === mounted) return;
  captureChatDraft();
  mounted = next;
  next.addEventListener("submit", onSubmit);
  next.addEventListener("click", onClick);
  next.addEventListener("change", onChange);
  next.addEventListener("input", onInput);
  next.addEventListener("contextmenu", onContextMenu);
  next.addEventListener("keydown", onMenuKeydown);
  draw();
}
// A production build supplies the public Worker URL at compile time.
// Fall back to manual configuration in development and older portable builds.
async function discoverEndpoint() {
  try {
    const invoke = globalThis.__TAURI__?.core?.invoke;
    if (typeof invoke !== "function" || endpointReady()) return;
    const fromBuild = safeEndpoint(await invoke("social_endpoint"));
    if (!fromBuild || endpointReady()) return;
    endpoint = fromBuild;
    draw();
  } catch { /* Keep manual Worker URL configuration available. */ }
}
document.addEventListener("pointerdown", event => {
  if (contextMenu && mounted && !mounted.contains(event.target)) {
    contextMenu = null;
    draw();
  }
});
function readVisibleThread() {
  if (!account || !token || !isThreadVisible()) return;
  try { activateChat(chatId); draw(); }
  catch (err) { showError("No se pudo actualizar el chat local: " + String(err.message || err)); }
}
document.addEventListener("visibilitychange", readVisibleThread);
window.addEventListener("focus", readVisibleThread);
const observer = new MutationObserver(mount);
observer.observe(document.documentElement, { childList: true, subtree: true });
mount();
void discoverEndpoint();
