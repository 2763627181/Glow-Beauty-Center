// Uso: node --env-file=.env.local scripts/db.mjs archivo.sql [...]
import { readFileSync } from "node:fs";
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
for (const f of process.argv.slice(2)) {
  try { await c.query(readFileSync(f, "utf8")); console.log("OK ", f); }
  catch (e) { console.error("ERR", f, e.message); process.exitCode = 1; break; }
}
await c.end();
