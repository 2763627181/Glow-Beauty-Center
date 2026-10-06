// Corre todas las pruebas E2E (navegador real) una tras otra.
//
//   npm run build && npm start        ← en otra terminal (o `npm run dev`)
//   npm run e2e                        ← esta
//
// ⚠ Escriben y borran datos de prueba en la base de datos de .env.local y cambian (y restauran) algunos ajustes.
//   Úsalas con un proyecto de Supabase de pruebas, o con datos demo, nunca durante la operación real del salón.
// Requisitos: datos demo cargados (supabase/seed/02_demo.sql) y `npx playwright install chromium` la primera vez.
// Crea los usuarios temporales tmp-*@glow.test al empezar y los borra al terminar.
import { spawnSync } from "node:child_process";

const node = process.execPath;
const SUITES = ["public", "admin-a", "admin-b", "admin-c", "roles", "typing", "focus-audit", "buttons-audit", "exports", "realtime", "upload"];
const only = process.argv.slice(2);
const run = (args) => spawnSync(node, ["--env-file=.env.local", ...args], { stdio: "inherit" });

run(["scripts/tmp-user.mjs", "delete"]);
const created = run(["scripts/tmp-user.mjs", "create"]);
if (created.status !== 0) { console.error("No se pudieron crear los usuarios temporales."); process.exit(1); }

const results = [];
try {
  for (const s of SUITES.filter((x) => !only.length || only.includes(x))) {
    console.log(`\n████ ${s} ████`);
    results.push([s, run([`e2e/${s}.mjs`]).status]);
  }
} finally {
  run(["scripts/tmp-user.mjs", "delete"]);
}
console.log("\n══ RESUMEN E2E ══");
for (const [s, code] of results) console.log(`  ${code === 0 ? "✔" : "✘"} ${s}`);
process.exit(results.some(([, c]) => c !== 0) ? 1 : 0);
