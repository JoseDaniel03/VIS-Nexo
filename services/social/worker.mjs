// VIS Social edge service: D1 connectivity and migration readiness only.
// Do not add write endpoints without authenticated user sessions, authorization,
// abuse limits and end-to-end encrypted message transport.
function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/health") {
      return respond({ error: "Not found" }, 404);
    }
    if (!env?.DB || typeof env.DB.prepare !== "function") {
      return respond({ service: "vis-social", status: "unavailable" }, 503);
    }
    try {
      const required = ["social_users", "friend_requests", "friendships",
        "friend_aliases", "pending_messages"];
      const result = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' " +
        "AND name IN ('social_users', 'friend_requests', 'friendships', " +
        "'friend_aliases', 'pending_messages')"
      ).all();
      const found = new Set((result.results || []).map(row => row.name));
      const ready = required.every(name => found.has(name));
      return respond({
        service: "vis-social",
        status: ready ? "ready" : "migration_required",
        database: "vis-social-db",
        schema: ready ? 1 : 0,
      }, ready ? 200 : 503);
    } catch {
      return respond({ service: "vis-social", status: "database_error" }, 503);
    }
  },
};
