// Levanta un Google Calendar SIMULADO (e2e/mock-google.mjs, puerto 4010) y una copia de la web (puerto 3100) conectada a él,
// ejecuta el comando indicado y lo apaga todo. Se usa para probar la sincronización sin credenciales reales:
//   npm run build && npm run e2e:gcal        (el e2e:gcal necesita usuarios tmp-*: `node --env-file=.env.local scripts/tmp-user.mjs create`)
import { spawn } from "node:child_process";

const PORT = 3100;
const env = {
  ...process.env,
  GOOGLE_CLIENT_ID: "cliente-prueba", GOOGLE_CLIENT_SECRET: "secreto-prueba", GOOGLE_REFRESH_TOKEN: "refresh-prueba",
  GOOGLE_CALENDAR_ID: "calendario-prueba@example.com",
  GOOGLE_API_BASE: "http://127.0.0.1:4010", GOOGLE_OAUTH_URL: "http://127.0.0.1:4010/token",
  NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
};
const [cmd, ...args] = process.argv.slice(2);
if (!cmd) { console.error("Uso: node e2e/with-mock-google.mjs <comando> [argumentos]"); process.exit(1); }

const mock = spawn(process.execPath, ["e2e/mock-google.mjs"], { stdio: "inherit" });
const web = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env, stdio: "inherit" });
const stop = () => { mock.kill(); web.kill(); };
process.on("SIGINT", () => { stop(); process.exit(130); });

for (let i = 0; ; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* aún no responde */ }
  if (i > 60) { stop(); console.error("La web no arrancó (¿falta `npm run build`?)."); process.exit(1); }
  await new Promise((r) => setTimeout(r, 500));
}
const child = spawn(cmd, args, { env: { ...env, BASE: `http://localhost:${PORT}` }, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => { stop(); process.exit(code ?? 1); });
