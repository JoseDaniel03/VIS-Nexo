// VIS Humile — rotating device-only conversation logs.
// Each chat/account/Worker gets at most 2048 UTF-8 bytes, expiring after 30 days.
// No chat bodies are uploaded to persistent cloud storage.
export const LOCAL_CHAT_LIMIT_BYTES = 2048;
export const LOCAL_CHAT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const LOCAL_MESSAGE_LIMIT_BYTES = 1536;
export const LOCAL_JSON_TEXT_LIMIT_BYTES = 1750;
const PREFIX = "vis-humile-local-v1:";
const encoder = new TextEncoder();
const bytes = value => encoder.encode(value).length;
const EMPTY = () => ({ v: 1, r: 0, m: [] });

export function localChatKey(endpoint, accountId, chatId) {
  const origin = new URL(endpoint).origin;
  if (!/^[0-9a-f-]{36}$/i.test(accountId) || !/^[0-9a-f-]{36}$/i.test(chatId)) {
    throw new Error("Identidad local de chat inválida");
  }
  return PREFIX + encodeURIComponent(origin) + ":" + accountId + ":" + chatId;
}

function toRow(message) {
  const time = typeof message.created_at === "string"
    ? Date.parse(message.created_at) : Number(message.created_at);
  const id = String(message.id || "");
  const senderId = String(message.sender_id || "");
  const sender = String(message.sender || "");
  const body = String(message.body || "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(senderId) ||
      !Number.isFinite(time) || !body.trim() || bytes(body) > LOCAL_MESSAGE_LIMIT_BYTES ||
      bytes(JSON.stringify(body)) > LOCAL_JSON_TEXT_LIMIT_BYTES ||
      !/^[a-z0-9_]{3,24}$/i.test(sender)) {
    throw new Error("El mensaje no cabe en el registro local de VIS Humile");
  }
  return [id, senderId, sender, time, body];
}
function validRow(row, now) {
  return Array.isArray(row) && row.length === 5 &&
    typeof row[0] === "string" && /^[0-9a-f-]{36}$/i.test(row[0]) &&
    typeof row[1] === "string" && /^[0-9a-f-]{36}$/i.test(row[1]) &&
    typeof row[2] === "string" && /^[a-z0-9_]{3,24}$/i.test(row[2]) &&
    Number.isFinite(row[3]) && row[3] > now - LOCAL_CHAT_RETENTION_MS &&
    row[3] <= now + 60000 && typeof row[4] === "string" &&
    !!row[4].trim() && bytes(row[4]) <= LOCAL_MESSAGE_LIMIT_BYTES;
}
function trim(store, now) {
  const clean = EMPTY();
  if (store && store.v === 1 && Number.isFinite(store.r) && Array.isArray(store.m)) {
    clean.r = Math.max(0, store.r);
    clean.m = store.m.filter(row => validRow(row, now));
  }
  clean.m.sort((a, b) => a[3] - b[3]);
  const seen = new Set();
  clean.m = clean.m.filter(row => !seen.has(row[0]) && seen.add(row[0]));
  while (clean.m.length && bytes(JSON.stringify(clean)) > LOCAL_CHAT_LIMIT_BYTES) clean.m.shift();
  return clean;
}
function readRaw(storage, key, now) {
  let raw = null, parsed = null;
  try {
    raw = storage.getItem(key);
    if (raw) parsed = JSON.parse(raw);
  } catch { parsed = null; }
  const clean = trim(parsed, now);
  const encoded = JSON.stringify(clean);
  // Real expiration removes the local bytes at next access/startup.
  if (raw !== null && raw !== encoded) {
    if (!clean.m.length) storage.removeItem(key);
    else storage.setItem(key, encoded);
  }
  return clean;
}
function toMessage(row) {
  return { id: row[0], sender_id: row[1], sender: row[2],
    created_at: new Date(row[3]).toISOString(), body: row[4], seq: row[3] };
}
export function loadLocalChat(storage, endpoint, accountId, chatId, now = Date.now()) {
  const log = readRaw(storage, localChatKey(endpoint, accountId, chatId), now);
  return {
    messages: log.m.map(toMessage),
    unread: log.m.filter(row => row[1] !== accountId && row[3] > log.r).length,
    bytes: bytes(JSON.stringify(log)),
    latest: log.m.at(-1)?.[3] || 0
  };
}
export function appendLocalChat(storage, endpoint, accountId, chatId, message, now = Date.now()) {
  const key = localChatKey(endpoint, accountId, chatId);
  const log = readRaw(storage, key, now);
  const row = toRow(message);
  if (row[3] < now - LOCAL_CHAT_RETENTION_MS || row[3] > now + 60000) {
    throw new Error("Fecha de mensaje fuera de la retención local");
  }
  if (!log.m.some(item => item[0] === row[0])) log.m.push(row);
  log.m.sort((a, b) => a[3] - b[3]);
  while (log.m.length && bytes(JSON.stringify(log)) > LOCAL_CHAT_LIMIT_BYTES) log.m.shift();
  if (!log.m.some(item => item[0] === row[0])) {
    throw new Error("El mensaje excede los 2 KB disponibles para este chat");
  }
  storage.setItem(key, JSON.stringify(log));
  return loadLocalChat(storage, endpoint, accountId, chatId, now);
}
export function markLocalChatRead(storage, endpoint, accountId, chatId, now = Date.now()) {
  const key = localChatKey(endpoint, accountId, chatId);
  const log = readRaw(storage, key, now);
  log.r = now;
  storage.setItem(key, JSON.stringify(log));
  return loadLocalChat(storage, endpoint, accountId, chatId, now);
}
export function eraseLocalChat(storage, endpoint, accountId, chatId) {
  storage.removeItem(localChatKey(endpoint, accountId, chatId));
}
export function purgeLocalChats(storage, endpoint, accountId, now = Date.now()) {
  const prefix = PREFIX + encodeURIComponent(new URL(endpoint).origin) + ":" + accountId + ":";
  let removed = 0;
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const before = storage.getItem(key);
    const log = readRaw(storage, key, now);
    if (!log.m.length && before !== null) { storage.removeItem(key); removed++; }
  }
  return removed;
}
