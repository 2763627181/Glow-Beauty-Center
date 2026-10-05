import { BASE, launch, login, section, setPage, step, summary } from "./h.mjs";

/* Auditoría de botones y enlaces: recorre las pantallas de la web y del panel y comprueba que
     · todo enlace tiene destino y responde (las direcciones internas no devuelven error),
     · todo botón habilitado HACE algo al pulsarlo (cambia la dirección, abre una ventana, cambia la pantalla o llama al servidor).
   No pulsa los botones que crean, borran, cobran o cierran sesión: esos los cubren las demás pruebas E2E. */
const RISKY = /guardar|crear|confirmar|cobrar|completar|anular|eliminar|borrar|reembols|cerrar sesi|cancelar cita|cancelar mi|no asisti|enviar|sincroniz|subir imagen|quitar|fusionar cliente|restablecer|reabrir|marcar|^s[ií],|aplicar|agregar bloqueo|agregar ausencia|ingresar|cambiar contrase|dividir|pagar todo|continuar|reservar|solicitar|consultar|descargar|exportar|^\+|^✕|^×|^←|^→|^↑|^↓|mover|portada|ocultar|mostrar|activar|desactivar|duplicar/i;
const { browser, page, errors } = await launch();
setPage(page);
const problems = [];
let buttonsChecked = 0, linksChecked = 0;

let requests = 0;
page.on("request", (r) => { if (r.method() !== "GET" || /_rsc=/.test(r.url())) requests++; });
await page.addInitScript(() => {
  window.__mut = 0;
  new MutationObserver((m) => { window.__mut += m.length; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
});

async function audit(label, url, { clickButtons = true } = {}) {
  await page.goto(BASE + url);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);

  // ─ enlaces
  const links = await page.locator("a[href]:visible").evaluateAll((els) => els.map((a) => ({ href: a.getAttribute("href"), text: (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 40) })));
  const seen = new Set();
  for (const l of links) {
    if (seen.has(l.href)) continue; seen.add(l.href); linksChecked++;
    if (!l.href || l.href === "#") { problems.push(`${label}: enlace «${l.text}» sin destino`); continue; }
    if (/^(tel:|mailto:)/.test(l.href)) { if (l.href.replace(/^(tel:|mailto:)/, "").length < 5) problems.push(`${label}: enlace «${l.text}» con ${l.href} vacío`); continue; }
    if (/^https?:\/\//.test(l.href)) { if (!/^https:\/\//.test(l.href) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(l.href)) problems.push(`${label}: enlace externo sin https «${l.href}»`); continue; }
    const path = l.href.startsWith("#") ? null : l.href;
    if (!path) { if (!(await page.locator(l.href).count())) problems.push(`${label}: el ancla ${l.href} no existe en la página`); continue; }
    const res = await page.request.get(BASE + path, { maxRedirects: 5 });
    if (res.status() >= 400) problems.push(`${label}: «${l.text}» → ${l.href} responde ${res.status()}`);
  }
  if (!clickButtons) return;

  // ─ botones
  const names = await page.locator("main button:visible, header button:visible, button[aria-label]:visible").evaluateAll((els) => els.map((b, i) => ({ i, disabled: b.disabled || b.getAttribute("aria-disabled") === "true", type: b.type, name: (b.getAttribute("aria-label") || b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50) })));
  const uniq = [];
  for (const b of names) if (!uniq.some((u) => u.name === b.name)) uniq.push(b);
  for (const b of uniq) {
    if (b.disabled || b.type === "submit" || !b.name || RISKY.test(b.name)) continue;
    const loc = page.locator("main button:visible, header button:visible, button[aria-label]:visible").filter({ hasText: b.name.length > 1 ? b.name.slice(0, 20) : /./ }).first();
    const target = (await loc.count()) ? loc : page.getByRole("button", { name: b.name, exact: true }).first();
    if (!(await target.count()) || !(await target.isVisible())) continue;
    buttonsChecked++;
    const before = { url: page.url(), mut: await page.evaluate(() => window.__mut), req: requests, dialogs: await page.getByRole("dialog").count() };
    await target.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(450);
    const after = { url: page.url(), mut: await page.evaluate(() => window.__mut).catch(() => -1), req: requests, dialogs: await page.getByRole("dialog").count() };
    const reacted = after.url !== before.url || after.mut !== before.mut || after.req !== before.req || after.dialogs !== before.dialogs;
    if (!reacted) problems.push(`${label}: el botón «${b.name}» no hace nada al pulsarlo`);
    // volver al estado inicial
    if (after.dialogs > before.dialogs) await page.keyboard.press("Escape");
    if (after.url !== before.url) { await page.goto(BASE + url); await page.waitForLoadState("networkidle"); }
  }
}

section("Web pública");
for (const [label, url] of [["Inicio", "/"], ["Servicios", "/services"], ["Detalle de servicio", "/services/manicure"], ["Galería", "/gallery"], ["Nosotros", "/about"], ["Contacto", "/contact"], ["Reservar", "/booking"], ["Mi cita", "/booking/manage"]]) {
  await step(label, async () => { const n = problems.length; await audit(label, url); if (problems.length > n) throw new Error(problems.slice(n).join(" | ")); });
}
await step("Menú móvil de la web (celular)", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + "/"); await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /menú/i }).first().click();
  await page.waitForTimeout(500);
  const links = await page.locator("nav a:visible").allTextContents();
  if (links.length < 4) throw new Error("el menú móvil no muestra enlaces: " + links.join(","));
  await page.setViewportSize({ width: 1366, height: 850 });
});

section("Panel (super administrador)");
await login(page, "tmp-admin@glow.test");
for (const [label, url] of [
  ["Dashboard", "/admin"], ["Agenda", "/admin/calendar"], ["Solicitudes y citas", "/admin/appointments"], ["Tablero", "/admin/appointments/board"], ["Clientes", "/admin/clients"],
  ["Servicios", "/admin/services"], ["Categorías", "/admin/services?tab=categorias"], ["Productos", "/admin/services?tab=productos"], ["Nuevo servicio", "/admin/services/new"],
  ["Especialistas", "/admin/staff"], ["Nuevo especialista", "/admin/staff/new"], ["Ventas", "/admin/sales"], ["Cobros", "/admin/payments"], ["Reportes", "/admin/reports"],
  ["Promociones", "/admin/promotions"], ["Galería", "/admin/gallery"], ["Config · Negocio", "/admin/settings?tab=negocio"], ["Config · Sitio", "/admin/settings?tab=sitio"],
  ["Config · Horarios", "/admin/settings?tab=horarios"], ["Config · Reservas", "/admin/settings?tab=reservas"], ["Config · Pagos", "/admin/settings?tab=pagos"],
  ["Config · WhatsApp", "/admin/settings?tab=whatsapp"], ["Config · Integraciones", "/admin/settings?tab=integraciones"], ["Auditoría", "/admin/audit"], ["Usuarios", "/admin/users"], ["Mi cuenta", "/admin/account"],
]) {
  await step(label, async () => { const n = problems.length; await audit(label, url); if (problems.length > n) throw new Error(problems.slice(n).join(" | ")); });
}

console.log(`\n${linksChecked} enlaces y ${buttonsChecked} botones comprobados.`);
const code = summary(errors);
await browser.close();
process.exit(code);
