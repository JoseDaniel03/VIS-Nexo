// VIS Social: cloud panel for the existing launcher sidebar. No local nickname is trusted by the API.
const endpointKey = "vis-social-worker-url";
let endpoint = "";
try { endpoint = localStorage.getItem(endpointKey) || ""; } catch {}
let localOwner = "", account = null, token = "", snapshot = null, chatId = "", chatMessages = [];
let loading = false, error = "", socket = null, mounted = null, reconnect = null;
let poll = null, chatBefore = null, connected = false;
const chatDrafts = new Map();
let renderedChatId = "", olderScroll = null;
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
function stopSocket() {
  if (socket) { socket.onclose = null; try { socket.close(); } catch {} }
  socket = null; connected = false;
  if (reconnect) clearTimeout(reconnect);
  reconnect = null;
}
function stopPolling() { if (poll) clearInterval(poll); poll = null; }
export function suspendSocialCloud() { stopSocket(); stopPolling(); }
export function resumeSocialCloud() { if (token && endpointReady() && !socket) startLive(); }
export function syncSocialOwner(name, guest = false) {
  const next = guest ? "" : String(name || "").toLowerCase();
  if (localOwner === next) return;
  localOwner = next; token = ""; account = null; snapshot = null; chatId = ""; chatMessages = [];
  chatDrafts.clear(); renderedChatId = ""; olderScroll = null;
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
  token = ""; account = null; snapshot = null; chatId = ""; chatMessages = []; chatBefore = null;
  chatDrafts.clear(); renderedChatId = ""; olderScroll = null;
  stopSocket(); stopPolling(); if (drawAfter) draw();
}
async function refresh() {
  if (!token) return;
  try {
    const data = await api("/v1/social");
    snapshot = data; error = "";
    if (chatId) {
      const messages = await api("/v1/chats/" + encodeURIComponent(chatId) + "/messages");
      const recent = messages.messages || [];
      if (chatMessages.length) {
        const found = new Map(chatMessages.concat(recent).map(msg => [msg.id, msg]));
        chatMessages = [...found.values()].sort((a,b) => a.seq - b.seq).slice(-250);
      } else {
        chatMessages = recent;
        chatBefore = messages.before;
      }
      await api("/v1/chats/" + encodeURIComponent(chatId) + "/read", "POST", {});
      const active = data.chats?.find(c => c.id === chatId);
      if (active) active.unread = 0;
    }
    draw();
  } catch (err) { showError(err.message); }
}
async function connect() {
  stopSocket();
  if (!token || !endpointReady()) return;
  try {
    const data = await api("/v1/rt/ticket", "POST", {});
    const url = endpoint.replace(/^https:/, "wss:") + "/v1/rt?ticket=" + encodeURIComponent(data.ticket);
    socket = new WebSocket(url);
    socket.onopen = () => { connected = true; draw(); };
    socket.onmessage = event => {
      if (event.data === "pong") return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "social:update" || payload.type === "chat:message") void refresh();
      } catch {}
    };
    socket.onclose = () => {
      connected = false;
      if (token) reconnect = setTimeout(() => void connect(), 4500);
      draw();
    };
    socket.onerror = () => { connected = false; };
  } catch {
    if (token) reconnect = setTimeout(() => void connect(), 9000);
  }
}
function startLive() {
  stopPolling();
  poll = setInterval(() => { if (token && mounted?.isConnected) void refresh(); }, 45000);
  void connect();
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
function friendList() {
  const favorites = new Set(snapshot?.favorites || []);
  const friends = [...(snapshot?.friends || [])].sort((a,b) =>
    Number(favorites.has(b.other_id)) - Number(favorites.has(a.other_id)) ||
    a.username.localeCompare(b.username));
  const incoming = snapshot?.incoming || [], outgoing = snapshot?.outgoing || [];
  let markup = '<section class="vis-social-block"><h4>Amigos <small>' + friends.length + '</small></h4>';
  markup += '<form data-cloud-form="friend" class="vis-cloud-inline"><input name="username" maxlength="24" placeholder="Agregar por usuario" required>' +
    '<button aria-label="Enviar solicitud">+</button></form>';
  for (const friend of friends) {
    markup += '<div class="vis-social-row"><span class="vis-presence-dot ' + (friend.online ? "is-online" : "") + '"></span>' +
      '<button data-cloud="chat-friend" data-name="' + key(friend.username) + '">' + esc(friend.username) +
      '<small>' + stateLabel(friend) + '</small></button>' +
      '<button class="vis-cloud-mini" data-cloud="favorite" data-id="' + key(friend.other_id) +
      '" aria-label="' + (favorites.has(friend.other_id) ? 'Quitar favorito' : 'Marcar favorito') +
      '" title="' + (favorites.has(friend.other_id) ? 'Quitar favorito' : 'Marcar favorito') + '">' +
      (favorites.has(friend.other_id) ? '★' : '☆') + '</button>' +
      '<button class="vis-cloud-mini" data-cloud="remove-friend" data-id="' + key(friend.other_id) + '" title="Eliminar amigo">×</button>' +
      '<button class="vis-cloud-mini" data-cloud="block" data-id="' + key(friend.other_id) + '" title="Bloquear">⊘</button></div>';
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
  for (const chat of snapshot?.chats || []) {
    const label = chat.kind === "group" ? chat.title : (chat.peer_username || "Chat privado");
    markup += '<button class="vis-cloud-chatitem ' + (chatId === chat.id ? "selected" : "") +
      '" data-cloud="open-chat" data-id="' + key(chat.id) + '">' + esc(label) +
      (chat.unread ? '<b class="vis-cloud-unread">' + Number(chat.unread) + '</b>' : "") + '</button>';
  }
  markup += '<form data-cloud-form="group" class="vis-cloud-form"><label>Nuevo grupo<input name="title" maxlength="80" placeholder="Nombre del grupo" required></label>' +
    '<label>Amigos (separados por comas)<input name="members" placeholder="ana, pepe" required></label><button>Crear grupo</button></form>';
  return markup + '</section>';
}
function thread() {
  const chat = snapshot?.chats?.find(item => item.id === chatId);
  let markup = '<section class="vis-cloud-thread"><div class="vis-cloud-thread-head"><b>' +
    esc(chat?.kind === "group" ? chat.title : "Conversación") +
    '</b>' + (chat?.kind === "group" ? '<button class="vis-cloud-mini" data-cloud="leave-group" title="Salir del grupo">Salir del grupo</button>' : '') +
    '<button data-cloud="close-chat" aria-label="Cerrar conversación">×</button></div>' +
    '<div class="vis-cloud-messages">';
  if (chatBefore) markup += '<button data-cloud="older">Ver mensajes anteriores</button>';
  if (!chatMessages.length) markup += '<p class="vis-social-note">Todavía no hay mensajes.</p>';
  for (const msg of chatMessages) markup += '<div class="vis-cloud-bubble ' +
    (msg.sender_id === account?.id ? "mine" : "") + '"><b>' + esc(msg.sender) +
    '</b><span>' + esc(msg.body) + '</span><small>' + esc(new Date(msg.created_at).toLocaleString("es-AR")) + '</small></div>';
  markup += '</div><form data-cloud-form="message" class="vis-cloud-inline">' +
    '<input name="body" maxlength="2000" placeholder="Escribí un mensaje..." required>' +
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
      '<label class="vis-cloud-presence-label">Estado visible para tus amigos' +
      '<select data-cloud-presence aria-label="Estado de presencia">' +
      ['online','away','busy','invisible'].map(value =>
        '<option value="' + value + '"' + ((snapshot?.me?.presence || 'online') === value ? ' selected' : '') +
        '>' + presenceNames[value] + '</option>').join('') + '</select></label>';
    markup += loading && !snapshot ? '<p class="vis-social-note">Cargando…</p>' : friendList() + chatList();
    if (chatId) markup += thread();
  }
  captureChatDraft();
  const previousRegion = host.querySelector(".vis-cloud-messages");
  const sameThread = !!chatId && renderedChatId === chatId;
  const wasAtBottom = !previousRegion || previousRegion.scrollHeight - previousRegion.scrollTop - previousRegion.clientHeight < 36;
  const previousTop = previousRegion?.scrollTop || 0;
  host.innerHTML = markup;
  renderedChatId = chatId;
  const input = host.querySelector('form[data-cloud-form="message"] input[name="body"]');
  if (input && chatDrafts.has(chatId)) input.value = chatDrafts.get(chatId);
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
      await refresh(); startLive();
    } else if (action === "friend") {
      await api("/v1/friends/requests", "POST", { username: String(data.get("username") || "") }); await refresh();
    } else if (action === "group") {
      const members = String(data.get("members") || "").split(",").map(x => x.trim()).filter(Boolean);
      const created = await api("/v1/chats/groups", "POST", { title: String(data.get("title") || ""), members });
      chatId = created.id; await refresh();
    } else if (action === "message") {
      if (!chatId) return;
      await api("/v1/chats/" + encodeURIComponent(chatId) + "/messages", "POST", { body: String(data.get("body") || "") });
      chatDrafts.set(chatId, "");
      const field = form.querySelector('input[name="body"]'); if (field) field.value = "";
      await refresh();
    }
  });
}
async function onClick(event) {
  const button = event.target.closest("[data-cloud]");
  if (!button) return;
  event.preventDefault(); event.stopPropagation();
  const action = button.dataset.cloud, id = button.dataset.id;
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
      chatId = result.id; chatMessages = []; chatBefore = null; await refresh();
    } else if (action === "open-chat") { chatId = id; chatMessages = []; chatBefore = null; await refresh(); }
    else if (["accept", "reject", "cancel"].includes(action)) {
      await api("/v1/friends/answer", "POST", { id, action }); await refresh();
    } else if (["block", "unblock", "remove-friend"].includes(action)) {
      if (action === "block" && !confirm("¿Bloquear a este usuario?")) return;
      const path = action === "remove-friend" ? "/v1/friends/" + id : "/v1/blocks/" + id;
      await api(path, action === "block" ? "POST" : "DELETE"); await refresh();
    } else if (action === "favorite") {
      const favorites = new Set(snapshot?.favorites || []);
      await api("/v1/favorites/" + id, favorites.has(id) ? "DELETE" : "POST"); await refresh();
    } else if (action === "older" && chatId && chatBefore) {
      const region = mounted?.querySelector(".vis-cloud-messages");
      olderScroll = region ? { height: region.scrollHeight, top: region.scrollTop } : null;
      const result = await api("/v1/chats/" + chatId + "/messages?before=" + chatBefore);
      chatMessages = (result.messages || []).concat(chatMessages);
      chatBefore = result.before; draw();
    }
  });
}
async function onChange(event) {
  const select = event.target.closest("[data-cloud-presence]");
  if (!select) return;
  const visibility = select.value;
  await perform(async () => {
    const result = await api("/v1/presence", "POST", { visibility });
    if (snapshot?.me) snapshot.me.presence = result.visibility;
  });
}
function mount() {
  const next = document.querySelector("#vis-social-root");
  if (!next || next === mounted) return;
  captureChatDraft();
  mounted = next;
  next.addEventListener("submit", onSubmit);
  next.addEventListener("click", onClick);
  next.addEventListener("change", onChange);
  draw();
}
const observer = new MutationObserver(mount);
observer.observe(document.documentElement, { childList: true, subtree: true });
mount();
