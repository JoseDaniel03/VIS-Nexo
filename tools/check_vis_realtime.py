#!/usr/bin/env python3
"""VIS Portals real-time source contracts. Does not replace Cloudflare/Tauri tests."""
from pathlib import Path
root=Path(__file__).resolve().parent.parent
def source(path):return (root/path).read_text(encoding="utf-8")
ui=source("web/social-remote.js")
host=source("src-tauri/src/social.rs")
main=source("src-tauri/src/main.rs")
worker=source("services/social/worker.mjs")
wrangler=source("services/social/wrangler.toml")
schema=source("services/social/migrations/0009_realtime_tickets.sql")
config=source("src-tauri/tauri.conf.json")
unit=source("tools/test_social_worker.mjs")
checks={
    "DO hibernation with SQLite":
        "class VisRealtimeRoom" in worker and "this.ctx.acceptWebSocket(server)" in worker
        and "new_sqlite_classes" in wrangler and "REALTIME" in wrangler,
    "One-use 20s ticket, hash only":
        "REALTIME_TICKET_SECONDS=20" in worker
        and "DELETE FROM realtime_tickets WHERE token_hash=? AND expires_at>? RETURNING user_id" in worker
        and "token_hash TEXT PRIMARY KEY" in schema,
    "No WebSocket endpoint without authenticated ephemeral ticket":
        "consumeRealtimeTicket(request,db,env)" in worker
        and "ALLOWED_WS_ORIGINS.has(origin)" in worker
        and "new URL(request.url)" in worker,
    "No chat content on socket":
        '''ws.send('{"type":"wakeup"}')''' in worker
        and "Notifications only" in worker,
    "Messages remain authenticated and encrypted in D1":
        "const user = await getSession(request, db)" in worker
        and "await notifyUser(env,ctx,peer.id)" in worker
        and "INSERT OR IGNORE INTO pending_messages" in worker,
    "Rust session bearer never enters JavaScript":
        "social_realtime_ticket(" in host
        and 'Some(&token)' in host
        and 'Ok(json!({"ws_url":ws_url,"expires_in":20}))' in host
        and '"token":token' not in host,
    "Tauri command and CSP registered":
        "social::social_realtime_ticket" in main
        and "wss://vis-social.defreitascarranza-845.workers.dev" in config,
    "Client uses only read-only wake-up signals":
        "command('social_realtime_ticket')" in ui
        and "message?.type==='wakeup'" in ui
        and "if(busy)wakeupQueued=true" in ui,
    "Resilient polling fallback":
        "scheduleRealtime(epoch)" in ui
        and "scheduleNext(epoch); // Immediate safe fallback to polling." in ui
        and "socialPollDelay(chatActive,consecutiveErrors)" in ui,
    "Session changes close socket":
        "stopRealtime();" in ui
        and "sessionEpoch++" in ui
        and "if(epoch!==sessionEpoch||realtimeSocket!==ws)" in ui,
    "Server schema 15 preserves realtime tickets and hides the bearer":
        "schema: ready ? 15 : 0" in worker
        and "realtime_tickets" in worker
        and "account_mfa_login_tickets" in worker
        and "reqwest::blocking::Client" in host,
    "One active native ticket request per session":
        "realtimeConnecting=true" in ui
        and "realtimeAttempt++" in ui
        and "attempt!==realtimeAttempt" in ui,
    "Socket leases expire and reauthenticate":
        "REALTIME_SOCKET_LIFETIME_MS=15*60*1000" in worker
        and "server.serializeAttachment({expiresAt:Date.now()+REALTIME_SOCKET_LIFETIME_MS})" in worker
        and "ws.deserializeAttachment()" in worker
        and "Refreshing notification ticket" in ui,
    "Logout and disabling revoke persistent sockets":
        "await revokeRealtime(env,user.id)" in worker
        and "await revokeRealtime(env,target.id)" in worker
        and "/_vis/revoke" in worker,
    "Test suite covers replay, Origin and correct recipient":
        "ticket must never be replayed" in unit
        and "https://evil.example" in unit
        and "notifications.includes(bobUserId)" in unit,
    "Test suite checks real DO logic under controlled mock":
        "new VisRealtimeRoom(state)" in unit
        and "per-user socket cap" in unit
        and "Expired authorization must close the WebSocket" in unit,
}
for title,ok in checks.items():print(("OK  " if ok else "FAIL"),title)
if not all(checks.values()):raise SystemExit("VIS Portals realtime contracts failed")
print(f"VIS Portals realtime checks: {sum(checks.values())}/{len(checks)}")


