// Servidor simulado de Google (OAuth + Calendar) para probar la sincronización sin credenciales reales.
//   Control:  GET /_log → llamadas recibidas · POST /_reset · POST /_gone/<id> (ese evento «ya no existe» → 404)
//             POST /_fail/on|off (todas las llamadas a Calendar responden 500)
import http from "node:http";

let log = [];
let n = 0;
const events = new Map();
const gone = new Set();
let failing = false;
const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/_log") return send(res, 200, log);
  if (p === "/_reset") { log = []; events.clear(); gone.clear(); failing = false; n = 0; return send(res, 200, { ok: true }); }
  if (p.startsWith("/_gone/")) { gone.add(p.slice(7)); return send(res, 200, { ok: true }); }
  if (p === "/_fail/on" || p === "/_fail/off") { failing = p.endsWith("on"); return send(res, 200, { failing }); }
  if (p === "/token" && req.method === "POST") {
    const form = new URLSearchParams(raw);
    log.push({ kind: "token", grant: form.get("grant_type"), client: form.get("client_id"), refresh: form.get("refresh_token") });
    return send(res, 200, { access_token: "mock-token", expires_in: 3600 });
  }
  const m = p.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
  if (!m) return send(res, 404, { error: "no existe" });
  const auth = req.headers.authorization;
  const body = raw ? JSON.parse(raw) : null;
  const entry = { kind: "event", method: req.method, calendar: decodeURIComponent(m[1]), id: m[2] ?? null, auth, body };
  log.push(entry);
  if (auth !== "Bearer mock-token") return send(res, 401, { error: "no autorizado" });
  if (failing) return send(res, 500, { error: "falla simulada" });
  if (req.method === "POST") { const id = `evt-${++n}`; events.set(id, body); return send(res, 200, { id, ...body }); }
  const id = m[2];
  if (gone.has(id) || !events.has(id)) return send(res, 404, { error: "not found" });
  if (req.method === "PATCH") { events.set(id, { ...events.get(id), ...body }); return send(res, 200, { id, ...events.get(id) }); }
  if (req.method === "DELETE") { events.delete(id); return send(res, 204); }
  return send(res, 405, {});
}).listen(4010, "127.0.0.1", () => console.log("mock google en :4010"));
