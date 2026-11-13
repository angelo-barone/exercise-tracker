/* Logbook sync Worker (Cloudflare Workers, free tier).
   The phone app sends a copy of its data here after every save. Claude reads it back.
   Holds no secrets in this file: the two keys are set as secrets in the Cloudflare dashboard.

   Needs, in the dashboard:
     KV namespace binding   LOGBOOK
     Secret                 WRITE_KEY   (the phone uses it to send)
     Secret                 READ_KEY    (Claude uses it to read)
     Variable (optional)    ALLOWED_ORIGIN   default https://angelo-barone.github.io

   POST /sync    Authorization: Bearer WRITE_KEY   body: the app's backup format
   GET  /data    Authorization: Bearer READ_KEY    returns the latest copy
   GET  /status  Authorization: Bearer READ_KEY    returns counts and times only
*/

const MAX_BYTES = 4 * 1024 * 1024;
const COLLECTIONS = ["custom", "progress", "notes", "sessions", "meta"];
const DEFAULT_ORIGIN = "https://angelo-barone.github.io";

function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || DEFAULT_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function reply(env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, cors(env))
  });
}

// Compare two strings without stopping at the first difference.
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function bearer(request) {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function summary(rec) {
  const d = (rec && rec.data) || {};
  const sessions = d.sessions || {};
  const dates = Object.keys(sessions).map(k => k.split("_")[0]).filter(Boolean).sort();
  return {
    sessions: dates.length,
    firstSession: dates[0] || null,
    lastSession: dates[dates.length - 1] || null,
    exercises: Object.keys(d.custom || {}).length,
    notes: Object.keys(d.notes || {}).length
  };
}

function check(body) {
  if (!body || typeof body !== "object") return "Body is not an object.";
  if (body.app !== "pplx2-logbook") return "Not a Logbook payload.";
  if (!body.data || typeof body.data !== "object") return "No data.";
  for (const c of COLLECTIONS) {
    if (!body.data[c] || typeof body.data[c] !== "object" || Array.isArray(body.data[c])) return "Missing collection " + c + ".";
  }
  return "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });

    if (request.method === "POST" && url.pathname === "/sync") {
      if (!sameSecret(bearer(request), env.WRITE_KEY)) return reply(env, 401, { ok: false, error: "unauthorized" });
      const len = Number(request.headers.get("Content-Length") || 0);
      if (len > MAX_BYTES) return reply(env, 413, { ok: false, error: "too large" });
      const text = await request.text();
      if (text.length > MAX_BYTES) return reply(env, 413, { ok: false, error: "too large" });
      let body;
      try { body = JSON.parse(text); } catch (e) { return reply(env, 400, { ok: false, error: "not JSON" }); }
      const problem = check(body);
      if (problem) return reply(env, 400, { ok: false, error: problem });

      const rec = {
        receivedAt: new Date().toISOString(),
        sentAt: typeof body.sentAt === "string" ? body.sentAt : null,
        appVersion: typeof body.appVersion === "string" ? body.appVersion : null,
        data: body.data
      };

      // If the new copy has fewer workouts than the one we hold (a wipe, an old restore),
      // keep the bigger one aside as "previous" so nothing is ever lost by a bad send.
      let kept = false;
      const old = await env.LOGBOOK.get("latest", "json");
      if (old && summary(old).sessions > summary(rec).sessions) {
        await env.LOGBOOK.put("previous", JSON.stringify(old));
        kept = true;
      }
      await env.LOGBOOK.put("latest", JSON.stringify(rec));
      return reply(env, 200, { ok: true, receivedAt: rec.receivedAt, keptPrevious: kept, summary: summary(rec) });
    }

    if (request.method === "GET" && (url.pathname === "/data" || url.pathname === "/status")) {
      if (!sameSecret(bearer(request), env.READ_KEY)) return reply(env, 401, { ok: false, error: "unauthorized" });
      const which = url.searchParams.get("copy") === "previous" ? "previous" : "latest";
      const rec = await env.LOGBOOK.get(which, "json");
      if (!rec) return reply(env, 404, { ok: false, error: "nothing stored yet" });
      if (url.pathname === "/status") {
        return reply(env, 200, { ok: true, receivedAt: rec.receivedAt, sentAt: rec.sentAt, appVersion: rec.appVersion, summary: summary(rec) });
      }
      return reply(env, 200, { ok: true, receivedAt: rec.receivedAt, sentAt: rec.sentAt, appVersion: rec.appVersion, summary: summary(rec), data: rec.data });
    }

    return reply(env, 404, { ok: false, error: "not found" });
  }
};
