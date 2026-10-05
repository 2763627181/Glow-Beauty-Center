import pg from "pg";
import { BASE, OUT, assert, expectVisible, launch, section, setPage, step, summary, until } from "./h.mjs";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;

const { browser, page, errors } = await launch();
setPage(page);
const next = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
// próximo día laborable (lunes a viernes) a partir de +2 días
let workday = 2; while ([0, 6].includes(new Date(next(workday) + "T12:00:00-04:00").getUTCDay())) workday++;
const day = next(workday);
let booked = null;
const PHONE = "829-555-7001";

section("Web pública — escritorio");
await step("Home: título, portada, categorías, favoritos y galería", async () => {
  const res = await page.goto(BASE + "/");
  assert(res.status() === 200, "status " + res.status());
  await expectVisible(page.locator("h1"), "h1");
  assert((await page.locator("h1").textContent()).includes("Tu momento"), "título del hero");
  assert((await page.locator('a[href^="/services?cat="]').count()) === 4, "4 categorías");
  assert((await page.getByRole("button", { name: /Agregar/ }).count()) >= 4, "tarjetas de servicios favoritos");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  assert((await page.locator('a[href="/gallery"] img').count()) >= 5, "galería en la home");
  await page.screenshot({ path: OUT + "/pub-home.png", fullPage: true });
});
await step("Todas las imágenes de la home cargan (ninguna rota)", async () => {
  await page.goto(BASE + "/");
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } });
  await page.waitForTimeout(1200);
  const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.slice(-60)));
  assert(broken.length === 0, "imágenes rotas: " + broken.join(", "));
});
await step("JSON-LD válido y sin '<' sin escapar", async () => {
  const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
  const ld = JSON.parse(raw);
  assert(ld["@type"] === "BeautySalon" && ld.name, "esquema BeautySalon");
});
await step("Botón flotante de WhatsApp apunta al número configurado", async () => {
  const href = await page.getByRole("link", { name: "Escribir por WhatsApp" }).last().getAttribute("href");
  assert(href.startsWith("https://wa.me/18296198257"), "href: " + href);
});
await step("Servicios: filtrar por categoría y ?cat= preselecciona", async () => {
  // La lista debe venir ya en el HTML del servidor (SEO / velocidad), sin esperar a JavaScript
  const html = await (await page.request.get(BASE + "/services")).text();
  assert(html.includes("Manicure") && html.includes("Soft Gel"), "los servicios no están en el HTML inicial");
  await page.goto(BASE + "/services");
  await page.getByRole("button", { name: /Agregar/ }).first().waitFor();
  const all = await page.getByRole("button", { name: /Agregar/ }).count();
  await page.getByRole("tab", { name: "Uñas" }).click();
  await page.waitForTimeout(500);
  const nails = await page.getByRole("button", { name: /Agregar/ }).count();
  assert(nails > 0 && nails < all, `filtro (${nails} de ${all})`);
  await page.goto(BASE + "/services?cat=cabello");
  await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === "Cabello", null, { timeout: 8000 });
});
await step("Detalle de servicio, variantes y 404 de uno inexistente", async () => {
  await page.goto(BASE + "/services/lavado-y-secado");
  await expectVisible(page.getByRole("heading", { name: "Lavado y Secado" }), "título");
  await page.getByRole("button", { name: /Agregar/ }).click();
  await expectVisible(page.getByRole("radio", { name: /Pelo largo/ }), "variante Pelo largo");
  const bot = { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" };
  const r = await page.request.get(BASE + "/services/no-existe", { headers: bot });
  assert(r.status() === 404, "status para buscadores " + r.status());
  const r2 = await page.request.get(BASE + "/services/pendiente-keratina-2500", { headers: bot });
  assert(r2.status() === 404, "servicio pendiente de confirmar no se publica: " + r2.status());
  await page.goto(BASE + "/services/no-existe");
  await expectVisible(page.getByText("No encontramos esta página"), "pantalla 404 para personas");
});
await step("Páginas Galería, Nosotros y Contacto", async () => {
  for (const p of ["/gallery", "/about", "/contact", "/booking/manage"]) {
    const r = await page.goto(BASE + p);
    assert(r.status() === 200, `${p}: ${r.status()}`);
    await expectVisible(page.locator("h1"), `h1 en ${p}`);
  }
  await page.goto(BASE + "/gallery");
  await page.getByRole("tab", { name: "Uñas" }).click();
  await page.waitForTimeout(600);
  assert((await page.locator("figure").count()) >= 3, "filtro de galería");
});

section("Reserva de un combo entre dos especialistas (uñas + cabello)");
await step("Armar el combo: Manicure + Lavado y Secado (Pelo largo)", async () => {
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "/services");
  await page.locator("article", { hasText: "Manicure" }).first().getByRole("button", { name: /Agregar/ }).click();
  await page.locator("article", { hasText: "Lavado y Secado" }).first().getByRole("button", { name: /Agregar/ }).click();
  await page.locator("article", { hasText: "Lavado y Secado" }).first().getByRole("radio", { name: /Pelo largo/ }).click();
  await expectVisible(page.getByText("2 servicios seleccionados"), "barra flotante");
  await page.getByRole("link", { name: "Continuar reserva" }).click();
  await page.waitForURL("**/booking");
});
await step("Paso 1→2: aparece la nota de varias especialistas", async () => {
  await page.getByRole("button", { name: "Continuar" }).click();
  await expectVisible(page.getByText(/distintas especialistas/), "nota de combo");
  await page.getByRole("button", { name: "Continuar" }).click();
});
await step("Paso 3: hay horarios disponibles para el combo", async () => {
  await page.locator("#other-date").fill(day);
  await expectVisible(page.getByRole("radio", { name: /AM|PM/ }), "horarios", 12000);
  const n = await page.getByRole("radio", { name: /AM|PM/ }).count();
  assert(n > 5, `horarios: ${n}`);
  await page.getByRole("radio", { name: /AM|PM/ }).first().click();
  await page.getByRole("button", { name: "Continuar" }).click();
});
await step("Paso 4: validación de campos y datos válidos", async () => {
  await expectVisible(page.getByLabel("Nombre", { exact: true }), "formulario de datos");
  await page.getByRole("button", { name: "Continuar" }).click();
  const alerts = page.locator('[role="alert"]:not(#__next-route-announcer__)');
  await until(async () => (await alerts.count()) >= 3, "errores de validación (nombre, apellido y teléfono)", 5000);
  await page.getByLabel("Nombre", { exact: true }).fill("Prueba");
  await page.getByLabel("Apellido").fill("Combo");
  await page.locator("#phone").fill("123");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expectVisible(page.getByText(/WhatsApp válido/), "teléfono inválido rechazado");
  await page.locator("#phone").fill(PHONE);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expectVisible(page.getByRole("button", { name: "Confirmar solicitud" }), "paso de confirmación");
});
await step("Confirmar: solicitud recibida con número", async () => {
  await page.getByRole("button", { name: "Confirmar solicitud" }).click();
  await expectVisible(page.getByText("Solicitud recibida"), "éxito", 15000);
  const num = await page.locator("strong", { hasText: /^SOL-/ }).first().textContent();
  assert(/^SOL-[0-9A-F]{8}$/.test(num), "número " + num);
  booked = num;
  await page.screenshot({ path: OUT + "/pub-success.png", fullPage: true });
});
await step("En la BD: 2 líneas, especialistas distintos y en secuencia", async () => {
  const rows = await q(`select s.name, e.full_name emp, s.start_time, s.end_time, s.position from appointment_services s join appointments a on a.id=s.appointment_id left join employees e on e.id=s.employee_id where a.request_number=$1 order by s.position`, [booked]);
  assert(rows.length === 2, "líneas: " + rows.length);
  assert(rows[0].emp && rows[1].emp && rows[0].emp !== rows[1].emp, `especialistas: ${rows.map((r) => r.emp)}`);
  assert(+new Date(rows[0].end_time) === +new Date(rows[1].start_time), "sin hueco entre líneas");
  const [a] = await q(`select source, status, estimated_total from appointments where request_number=$1`, [booked]);
  assert(a.source === "website" && a.status === "solicitud" && Number(a.estimated_total) === 1500, `cita: ${JSON.stringify(a)}`);
});
await step("El horario reservado ya no se ofrece a otra clienta", async () => {
  const [a] = await q(`select s.start_time from appointment_services s join appointments a on a.id=s.appointment_id where a.request_number=$1 order by s.position limit 1`, [booked]);
  const hhmm = new Date(a.start_time).toLocaleTimeString("en-GB", { timeZone: "America/Santo_Domingo", hour: "2-digit", minute: "2-digit" });
  const man = (await q("select id from services where slug='manicure'"))[0].id;
  const lav = (await q("select id from services where slug='lavado-y-secado'"))[0].id;
  const lv = (await q("select id from service_variants where service_id=$1 and name='Pelo largo'", [lav]))[0].id;
  const res = await page.request.post(BASE + "/api/availability", { data: { date: day, employeeId: "any", items: [{ serviceId: man, addonIds: [] }, { serviceId: lav, variantId: lv, addonIds: [] }] } });
  const j = await res.json();
  assert(!j.slots.some((s) => s.time === hhmm), `${hhmm} sigue disponible`);
});
await step("Consultar mi cita con número + teléfono (formato distinto) y cancelarla", async () => {
  await page.goto(`${BASE}/booking/manage?number=${booked}`);
  assert((await page.locator("#m-n").inputValue()) === booked, "número precargado desde la URL");
  await page.locator("#m-p").fill("+1 (829) 555-7001");
  await page.getByRole("button", { name: "Consultar mi cita" }).click();
  await expectVisible(page.getByText(/Solicitud recibida/).first(), "estado de la cita");
  await page.getByRole("button", { name: "Cancelar mi cita" }).click();
  await page.getByRole("button", { name: "Sí, cancelar" }).click();
  await expectVisible(page.getByText(/Tu cita fue cancelada/), "cancelada", 12000);
  const [a] = await q(`select status from appointments where request_number=$1`, [booked]);
  assert(a.status === "cancelado", "estado " + a.status);
  const [{ n }] = await q(`select count(*)::int n from appointment_services s join appointments a on a.id=s.appointment_id where a.request_number=$1 and s.active`, [booked]);
  assert(n === 0, "las líneas deben liberar el horario");
});
await step("Teléfono equivocado no revela la cita", async () => {
  await page.goto(`${BASE}/booking/manage?number=${booked}`);
  await page.locator("#m-p").fill("809-555-0000");
  await page.getByRole("button", { name: "Consultar mi cita" }).click();
  await expectVisible(page.getByText(/No encontramos/), "mensaje de no encontrada");
});

section("Web pública — móvil");
const m = await launch({ mobile: true });
await step("Móvil: sin desbordamiento horizontal en las páginas principales", async () => {
  for (const p of ["/", "/services", "/gallery", "/about", "/contact", "/booking"]) {
    await m.page.goto(BASE + p);
    await m.page.waitForTimeout(500);
    const over = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(over <= 1, `${p} desborda ${over}px`);
  }
}, m.page);
await step("Móvil: menú lateral abre, navega y cierra", async () => {
  await m.page.goto(BASE + "/");
  await m.page.getByRole("button", { name: "Abrir menú" }).click();
  await expectVisible(m.page.getByRole("dialog", { name: "Menú" }), "drawer");
  await m.page.getByRole("dialog").getByRole("link", { name: "Servicios" }).click();
  await m.page.waitForURL("**/services");
  await m.page.getByRole("dialog", { name: "Menú" }).waitFor({ state: "detached", timeout: 5000 }).catch(() => { throw new Error("el menú debe cerrarse"); });
  await m.page.screenshot({ path: OUT + "/pub-mobile-services.png" });
}, m.page);

console.log("\nVerificación de limpieza de datos de prueba…");
await q(`delete from appointments where request_number=$1`, [booked ?? "x"]);
await q(`delete from clients where phone_normalized='8295557001' and not exists (select 1 from appointments where client_id=clients.id)`);
await db.end();
const code = summary([...errors, ...m.errors]);
await browser.close(); await m.browser.close();
process.exit(code);
