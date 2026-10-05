import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { BASE, launch, login } from "./h.mjs";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const { browser, page } = await launch();
const seen = new Map();

async function scan(label, setup) {
  if (setup) await setup();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(AXE);
  const r = await page.evaluate(async () => {
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(" ") + " :: " + (n.any[0]?.message ?? n.all[0]?.message ?? n.none[0]?.message ?? "").slice(0, 140)) }));
  });
  console.log(`\n${label}: ${r.length ? r.length + " tipo(s) de problema" : "sin problemas ✔"}`);
  for (const v of r) {
    console.log(`  [${v.impact}] ${v.id} ×${v.nodes} — ${v.help}`);
    for (const s of v.sample) console.log(`       ${s}`);
    const k = v.id + ":" + v.impact; seen.set(k, (seen.get(k) ?? 0) + v.nodes);
  }
}
const go = (p) => () => page.goto(BASE + p);

console.log("══ SITIO PÚBLICO ══");
for (const p of ["/", "/services", "/services/manicure", "/gallery", "/about", "/contact", "/booking/manage", "/booking"]) await scan(p, go(p));
await scan("/booking (con servicios, paso 2)", async () => {
  await page.goto(BASE + "/services");
  await page.locator("article", { hasText: "Manicure" }).first().getByRole("button", { name: /Agregar/ }).click();
  await page.getByRole("link", { name: "Continuar reserva" }).click();
  await page.waitForURL("**/booking");
  await page.getByRole("button", { name: "Continuar" }).click();
});
await scan("/booking (paso 3: fecha y hora)", async () => { await page.getByRole("button", { name: "Continuar" }).click(); });
await scan("/404", go("/no-existe-xyz"));
await scan("/admin/login", go("/admin/login"));

console.log("\n══ PANEL ══");
await login(page, "tmp-admin@glow.test");
for (const p of ["/admin", "/admin/calendar", "/admin/appointments", "/admin/appointments/board", "/admin/clients", "/admin/services", "/admin/services?tab=categorias", "/admin/services?tab=productos", "/admin/services/new",
  "/admin/staff", "/admin/staff/new", "/admin/sales", "/admin/payments", "/admin/reports", "/admin/promotions", "/admin/gallery",
  "/admin/settings?tab=negocio", "/admin/settings?tab=sitio", "/admin/settings?tab=horarios", "/admin/settings?tab=reservas", "/admin/settings?tab=pagos", "/admin/settings?tab=whatsapp", "/admin/settings?tab=integraciones",
  "/admin/audit", "/admin/users", "/admin/account"]) await scan(p, go(p));
await scan("modal: ficha de cita", async () => { await page.goto(BASE + "/admin/appointments"); await page.waitForLoadState("networkidle"); await page.getByRole("button", { name: "Abrir", exact: true }).first().click(); await page.getByRole("dialog").waitFor(); await page.waitForTimeout(500); });
await scan("modal: nueva cita", async () => { await page.goto(BASE + "/admin/appointments"); await page.waitForLoadState("networkidle"); await page.getByRole("button", { name: "+ Nueva cita" }).click(); await page.getByRole("dialog").waitFor(); await page.waitForTimeout(500); });
await scan("modal: nueva venta", async () => { await page.goto(BASE + "/admin/sales"); await page.waitForLoadState("networkidle"); await page.getByRole("button", { name: "+ Nueva venta" }).click(); await page.getByRole("dialog").waitFor(); await page.waitForTimeout(500); });

console.log("\n══ RESUMEN (tipo:impacto → nodos) ══");
for (const [k, n] of [...seen].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${k} → ${n}`);
await browser.close();
