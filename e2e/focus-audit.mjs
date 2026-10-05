import pg from "pg";
import { BASE, assert, launch, login, section, setPage, step, summary } from "./h.mjs";

/* Auditoría de foco: en CADA campo de texto de los formularios del panel se escribe con teclado real y se comprueba que
   el campo no se vuelve a crear (perdería el foco) ni pierde letras. Detecta toda la clase de errores «solo se escribe 1 letra». */
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;
const nextDay = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
let wd = 6; while ([0, 6].includes(new Date(nextDay(wd) + "T12:00:00-04:00").getUTCDay())) wd++;
const PHONE = "8295557801";
const man = (await q(`select id from services where slug='manicure'`))[0].id;
const svc = (await q(`select id from services where slug='lavado-y-secado'`))[0].id;
const emp = (await q(`select id from employees order by display_order limit 1`))[0].id;
await q(`delete from appointments where client_id in (select id from clients where phone_normalized=$1)`, [PHONE]);
await q(`delete from clients where phone_normalized=$1`, [PHONE]);
await q(`select create_booking(jsonb_build_object('first_name','Foco','last_name','Auditoria','phone',$1::text,'status','confirmado','start_time',$2::text,'services',jsonb_build_array(jsonb_build_object('service_id',$3::uuid)))) r`, [PHONE, `${nextDay(wd)}T10:00:00-04:00`, man]);
const apptId = (await q(`select a.id from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1`, [PHONE]))[0].id;
const clientId = (await q(`select id from clients where phone_normalized=$1`, [PHONE]))[0].id;

const { browser, page, errors } = await launch();
setPage(page);
await login(page, "tmp-admin@glow.test");

const SEL = 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]):not([type="date"]):not([type="time"]):not([type="datetime-local"]):not([type="submit"]):not([type="button"]):not([type="password"]):not([type="color"]):not([tabindex="-1"]), textarea';
let totalFields = 0;

/** Escribe en todos los campos visibles de `scope` (el diálogo si hay uno abierto, si no la página) y devuelve los que fallan. */
async function audit(label) {
  const bad = [];
  const dialog = page.getByRole("dialog");
  const scope = (await dialog.count()) ? dialog.last() : page.locator("main");
  const handles = await scope.locator(SEL).elementHandles();
  let n = 0;
  for (const h of handles) {
    if (!(await h.isVisible()) || (await h.isDisabled()) || (await h.getAttribute("readonly")) !== null) continue;
    // Los títulos de las fotos de la galería se GUARDAN solos al salir del campo: escribir ahí cambiaría datos reales
    if (await h.evaluate((el) => !!el.closest("article"))) continue;
    const desc = await h.evaluate((el) => el.id || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.name || el.tagName);
    const isNum = (await h.getAttribute("type")) === "number";
    const typed = isNum ? "12" : "ab";
    await h.scrollIntoViewIfNeeded().catch(() => {});
    await h.click({ timeout: 4000 }).catch(() => {});
    await h.evaluate((el) => { el.dataset.focusAudit = "1"; });
    await page.keyboard.press("Control+A");
    await page.keyboard.type(typed, { delay: 70 });
    const r = await h.evaluate((el, t) => ({ same: document.activeElement === el && el.dataset.focusAudit === "1", val: el.value.endsWith(t), connected: el.isConnected }), typed);
    n++;
    if (!r.connected || !r.same || !r.val) bad.push(`${desc} (${!r.connected ? "se volvió a crear" : !r.same ? "perdió el foco" : "perdió letras"})`);
  }
  totalFields += n;
  if (n === 0) console.log(`       (${label}: sin campos de texto)`);
  assert(bad.length === 0, `${label}: ${bad.join("; ")}`);
}
const openAndAudit = async (url, opener, label) => {
  await page.goto(BASE + url);
  await page.waitForLoadState("networkidle");
  if (opener) {
    await page.getByRole("button", { name: opener, exact: typeof opener === "string" }).first().click();
    await page.getByRole("dialog").first().waitFor();
    await page.waitForTimeout(400);
  }
  await audit(label);
};

section("Páginas con formularios");
for (const [label, url] of [
  ["Configuración · Negocio", "/admin/settings?tab=negocio"], ["Configuración · Sitio web", "/admin/settings?tab=sitio"], ["Configuración · Reservas", "/admin/settings?tab=reservas"],
  ["Configuración · WhatsApp", "/admin/settings?tab=whatsapp"], ["Nuevo servicio", "/admin/services/new"], ["Servicio existente (con variantes)", `/admin/services/${svc}`],
  ["Nuevo especialista", "/admin/staff/new"], [`Especialista existente`, `/admin/staff/${emp}`], ["Mi cuenta", "/admin/account"], ["Ficha de cliente (notas)", `/admin/clients/${clientId}`],
  ["Ficha de cita (nota)", `/admin/appointments/${apptId}`], ["Galería", "/admin/gallery"],
]) await step(label, () => openAndAudit(url, null, label));

section("Ventanas (modales)");
for (const [label, url, opener] of [
  ["Nueva cita", "/admin/appointments", "+ Nueva cita"], ["Cliente sin cita", "/admin/appointments", "Cliente sin cita"],
  ["Nuevo cliente", "/admin/clients", "+ Nuevo cliente"], ["Nueva venta", "/admin/sales", "+ Nueva venta"], ["Nueva promoción", "/admin/promotions", "+ Nueva promoción"],
  ["Nueva categoría", "/admin/services?tab=categorias", "+ Nueva categoría"], ["Nuevo producto", "/admin/services?tab=productos", "+ Nuevo producto"],
  ["Nuevo método de pago", "/admin/settings?tab=pagos", "+ Agregar método"], ["Nuevo usuario", "/admin/users", "+ Nuevo usuario"],
]) await step(label, () => openAndAudit(url, opener, label));

await step("Ficha de cita → Editar", async () => {
  await page.goto(BASE + "/admin/appointments?q=Foco%20Auditoria"); await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Abrir", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Editar", exact: true }).click();
  await page.waitForTimeout(500); await audit("Editar cita");
});
await step("Ficha de cita → Cobrar", async () => {
  await page.goto(BASE + "/admin/appointments?q=Foco%20Auditoria"); await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Abrir", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Cobrar", exact: true }).click();
  await page.waitForTimeout(500); await audit("Cobrar");
});
await step("Cliente → Editar y Fusionar", async () => {
  await page.goto(`${BASE}/admin/clients/${clientId}`); await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Editar", exact: true }).first().click(); await page.getByRole("dialog").waitFor(); await page.waitForTimeout(300); await audit("Editar cliente");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Fusionar/ }).first().click(); await page.getByRole("dialog").waitFor(); await page.waitForTimeout(300); await audit("Fusionar cliente");
});
await step("Usuarios → Editar y Contraseña", async () => {
  await page.goto(BASE + "/admin/users"); await page.waitForLoadState("networkidle");
  await page.locator("tr", { hasText: "tmp-manager@glow.test" }).getByRole("button", { name: "Editar" }).click(); await page.getByRole("dialog").waitFor(); await page.waitForTimeout(300); await audit("Editar usuario");
  await page.keyboard.press("Escape");
});

console.log(`\n${totalFields} campos de texto probados con teclado real.`);
await q(`delete from appointments where client_id in (select id from clients where phone_normalized=$1)`, [PHONE]);
await q(`delete from clients where phone_normalized=$1`, [PHONE]);
await db.end();
const code = summary(errors);
await browser.close();
process.exit(code);
