import pg from "pg";
import { BASE, assert, expectVisible, launch, login, section, setPage, step, summary } from "./h.mjs";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;
const { browser, page, errors } = await launch();
setPage(page);
const nextDay = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
let n = 3; while ([0, 6].includes(new Date(nextDay(n) + "T12:00:00-04:00").getUTCDay())) n++;
const DAY = nextDay(n);
const toast = (t) => page.getByText(t, { exact: false }).first();
const PHONE = "829-555-7100";
const dialog = () => page.getByRole("dialog");
/** Arrastra una tarjeta del tablero a otra columna (desplazando el tablero hasta que la columna sea visible). */
async function dragCard(card, columnLabel) {
  const col = page.locator(`section[aria-label="${columnLabel}"]`);
  await card.scrollIntoViewIfNeeded();
  const g = await card.getByRole("button", { name: /Arrastrar/ }).boundingBox();
  const vw = page.viewportSize().width;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 25, g.y + 25, { steps: 6 });
  // Como haría una persona: acercar el cursor al borde para que el tablero se desplace solo hasta ver la columna
  for (let i = 0; i < 60; i++) {
    const c = await col.boundingBox();
    if (c.x + 80 < vw - 40) break;
    await page.mouse.move(vw - 12 - (i % 2), g.y + 30);
    await page.waitForTimeout(100);
  }
  const c = await col.boundingBox();
  await page.mouse.move(Math.min(c.x + c.width / 2, vw - 60), c.y + Math.min(120, c.height / 2), { steps: 15 });
  await page.mouse.up();
}
let apptId = null;

await login(page, "tmp-admin@glow.test");

section("Dashboard y navegación");
await step("Dashboard: KPIs con tamaño legible (no diminutos)", async () => {
  await page.goto(BASE + "/admin");
  await expectVisible(page.getByRole("heading", { name: "Dashboard" }), "dashboard");
  await page.waitForTimeout(1200);
  const size = await page.locator("strong").filter({ hasText: /RD\$/ }).first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  assert(size >= 24, "tamaño de KPI " + size);
});
await step("Todos los enlaces del menú cargan sin error", async () => {
  const links = await page.locator('nav[aria-label="Panel"] a').evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute("href")]));
  assert(links.length >= 14, "enlaces: " + links.length);
  for (const [label, href] of links) {
    const r = await page.goto(BASE + href);
    assert(r.status() === 200, `${label}: ${r.status()}`);
    await expectVisible(page.locator("h1"), `h1 en ${label}`);
  }
});
await step("Buscador global: encuentra una clienta y navega a su ficha", async () => {
  await page.goto(BASE + "/admin");
  await page.locator("#gsearch").fill("María");
  await expectVisible(page.getByRole("link", { name: /María Pérez/ }), "resultado", 8000);
  await page.getByRole("link", { name: /María Pérez/ }).first().click();
  await page.waitForURL("**/admin/clients/**");
  await expectVisible(page.getByRole("heading", { name: /María Pérez/ }), "ficha del cliente");
});

section("Crear, editar, reprogramar y cancelar citas");
await step("Nueva cita desde recepción (dos servicios, especialista Ana)", async () => {
  await page.goto(BASE + "/admin/appointments");
  await page.getByRole("button", { name: "+ Nueva cita" }).click();
  await expectVisible(dialog(), "diálogo");
  await page.locator("#n-phone").fill(PHONE);
  await page.locator("#n-fn").fill("E2E");
  await page.locator("#n-ln").fill("Cliente");
  await page.locator("#n-when").fill(`${DAY}T14:00`);
  await page.locator("#n-emp").selectOption({ label: "Ana (demo)" });
  await dialog().locator("label", { hasText: /^Manicure\s*RD\$/ }).locator("input").check();
  await dialog().locator("label", { hasText: /^Pintura de manos Gel\s*RD\$/ }).locator("input").check();
  await page.getByRole("button", { name: "Crear cita" }).click();
  await expectVisible(toast("Cita creada"), "toast", 10000);
  const [a] = await q(`select a.id, a.status, a.source, a.estimated_total, (select count(*) from appointment_services where appointment_id=a.id) lines from appointments a join clients c on c.id=a.client_id where c.phone_normalized='8295557100'`);
  assert(a && a.status === "confirmado" && a.source === "phone" && a.lines === "2" && Number(a.estimated_total) === 1300, JSON.stringify(a));
  apptId = a.id;
});
await step("Teléfono existente reutiliza el cliente (sin duplicar)", async () => {
  await page.getByRole("button", { name: "+ Nueva cita" }).click();
  await page.locator("#n-phone").fill("+1 (829) 555-7100");
  await page.locator("#n-fn").click();
  await expectVisible(page.getByText(/Cliente existente: E2E Cliente/), "aviso de cliente existente");
  await page.keyboard.press("Escape");
  const [{ c }] = await q(`select count(*)::int c from clients where phone_normalized='8295557100'`);
  assert(c === 1, "clientes: " + c);
});
await step("Abrir la cita desde la lista (búsqueda por nombre)", async () => {
  await page.goto(BASE + "/admin/appointments?q=E2E");
  await expectVisible(page.getByText("E2E Cliente"), "fila");
  await page.getByRole("button", { name: "Abrir" }).first().click();
  await expectVisible(dialog().getByRole("heading", { name: /E2E Cliente/ }), "ficha de la cita");
});
await step("Editar: precio final, producto libre, descuento y especialista", async () => {
  await dialog().getByRole("button", { name: "Editar", exact: true }).click();
  await expectVisible(page.getByRole("heading", { name: /Editar cita/ }), "editor");
  await page.getByLabel("Precio de Manicure").fill("650");
  await page.locator("#le-cn").fill("Crema hidratante");
  await page.locator("#le-cp").fill("250");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.locator("#ea-disc").fill("100");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expectVisible(toast("Cita actualizada"), "toast", 10000);
  const [a] = await q(`select estimated_total, discount from appointments where id=$1`, [apptId]);
  assert(Number(a.estimated_total) === 650 + 700 + 250 - 100 && Number(a.discount) === 100, JSON.stringify(a));
});
await step("Editar: no deja quitar el último servicio con horario ni guardar precios negativos", async () => {
  await page.goto(BASE + "/admin/appointments?q=E2E");
  await page.getByRole("button", { name: "Abrir" }).first().click();
  await dialog().getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByRole("button", { name: "Quitar Pintura de manos Gel" }).click();
  assert(await page.getByRole("button", { name: "Quitar Manicure" }).isDisabled(), "quitar el último servicio debe estar deshabilitado");
  await page.keyboard.press("Escape");
});
await step("Reprogramar mueve la cita; si coincide con otra de la misma especialista avisa pero la deja", async () => {
  await page.goto(BASE + "/admin/appointments?q=E2E");
  await page.getByRole("button", { name: "Abrir" }).first().click();
  await dialog().getByRole("button", { name: "Reprogramar" }).click();
  await page.locator("#rs-when").fill(`${DAY}T16:00`);
  await dialog().getByRole("button", { name: "Guardar nueva hora" }).click();
  await expectVisible(toast("Cita reprogramada"), "toast", 10000);
  const [a] = await q(`select to_char(start_time at time zone 'America/Santo_Domingo','HH24:MI') h from appointments where id=$1`, [apptId]);
  assert(a.h === "16:00", "hora " + a.h);
  // Crear otra cita de Ana a las 10:00 y mover la primera encima: avisa, pero se permite (citas simultáneas)
  await q(`select create_booking(jsonb_build_object('first_name','Choque','last_name','E2E','phone','8295557101','status','confirmado','start_time',$1::text,'services',jsonb_build_array(jsonb_build_object('service_id',(select id from services where slug='manicure'),'employee_id',(select id from employees where full_name like 'Ana%')))))`, [new Date(`${DAY}T10:00:00-04:00`).toISOString()]);
  await page.goto(BASE + "/admin/appointments?q=E2E Cliente");
  await page.getByRole("button", { name: "Abrir" }).first().click();
  await dialog().getByRole("button", { name: "Reprogramar" }).click();
  await page.locator("#rs-when").fill(`${DAY}T10:15`);
  await expectVisible(dialog().getByText("ya tiene otra cita a esa hora"), "aviso previo de coincidencia", 10000);
  await dialog().getByRole("button", { name: "Guardar nueva hora" }).click();
  await expectVisible(toast("Cita reprogramada"), "toast", 10000);
  const [ov] = await q(`select count(*)::int n from appointment_services l join appointments a on a.id=l.appointment_id where l.active and l.employee_id=(select id from employees where full_name like 'Ana%') and a.id<>$1 and l.start_time < (select end_time from appointments where id=$1) and l.end_time > (select start_time from appointments where id=$1)`, [apptId]);
  assert(ov.n >= 1, "la cita debe quedar coincidiendo con la otra");
});
await step("Cancelar (con confirmación) libera el horario y se puede reabrir", async () => {
  await page.goto(BASE + "/admin/appointments?q=E2E Cliente");
  await page.getByRole("button", { name: "Abrir" }).first().click();
  await dialog().getByRole("button", { name: "Cancelar cita" }).click();
  await page.getByRole("button", { name: "Cancelar cita" }).last().click();
  await expectVisible(toast("Cita cancelada"), "toast", 10000);
  const [a] = await q(`select status, (select count(*) from appointment_services where appointment_id=a.id and active)::int act from appointments a where id=$1`, [apptId]);
  assert(a.status === "cancelado" && a.act === 0, JSON.stringify(a));
  await page.goto(BASE + "/admin/appointments?range=all&q=E2E Cliente");
  await page.getByRole("button", { name: "Abrir" }).first().click();
  await dialog().getByRole("button", { name: "Reabrir como solicitud" }).click();
  await expectVisible(toast("Cita reabierta"), "toast", 10000);
  const [b] = await q(`select status from appointments where id=$1`, [apptId]);
  assert(b.status === "solicitud", b.status);
});

section("Tablero (Kanban)");
await step("Botón de siguiente paso mueve la tarjeta y queda en el historial", async () => {
  await page.goto(BASE + "/admin/appointments/board");
  const card = page.locator("article", { hasText: "E2E" }).first();
  await expectVisible(card, "tarjeta E2E");
  await card.getByRole("button", { name: "Contactando" }).click();
  await expectVisible(toast("Movida a Contactando"), "toast", 10000);
  const [h] = await q(`select string_agg(new_status::text,'>' order by changed_at) s from appointment_status_history where appointment_id=$1`, [apptId]);
  assert(h.s.endsWith("solicitud>contactando"), h.s);
});
await step("Arrastrar y soltar cambia el estado (drag & drop con el mouse)", async () => {
  await page.goto(BASE + "/admin/appointments/board");
  await dragCard(page.locator("article", { hasText: "E2E Cliente" }).first(), "Contactado");
  await expectVisible(toast("Movida a Contactado"), "toast tras soltar", 10000);
  const [a] = await q(`select status from appointments where id=$1`, [apptId]);
  assert(a.status === "contactado", a.status);
});
await step("Soltar en 'Cancelados' pide confirmación y cancela; 'Reabrir' la recupera", async () => {
  await page.goto(BASE + "/admin/appointments/board");
  await dragCard(page.locator("article", { hasText: "E2E Cliente" }).first(), "Cancelado");
  await expectVisible(page.getByRole("heading", { name: "¿Cancelar la cita?" }), "confirmación");
  await dialog().getByRole("button", { name: "Confirmar" }).click();
  await expectVisible(toast("Movida a Cancelado"), "toast", 10000);
  assert((await q(`select status from appointments where id=$1`, [apptId]))[0].status === "cancelado", "no se canceló");
  await page.locator("article", { hasText: "E2E Cliente" }).first().getByRole("button", { name: "Reabrir" }).click();
  await expectVisible(toast("Movida a Solicitud"), "reabierta", 10000);
});

section("Cobro, venta y pagos");
await step("Cobrar con pago dividido (efectivo + tarjeta) y completar → genera la venta", async () => {
  await q(`update appointments set status='en_servicio' where id=$1`, [apptId]);
  await page.goto(BASE + "/admin/appointments/board");
  const card = page.locator("article", { hasText: "E2E Cliente" }).first();
  await card.getByRole("button", { name: "Cobrar" }).click();
  await expectVisible(page.getByRole("heading", { name: /Cobrar · E2E/ }), "modal de cobro");
  const total = (await q(`select estimated_total from appointments where id=$1`, [apptId]))[0].estimated_total;
  await page.getByLabel("Monto").first().fill("1000");
  await page.getByRole("button", { name: "+ Dividir pago" }).click();
  await page.getByLabel("Monto").nth(1).fill(String(Number(total) - 1000));
  await page.getByLabel("Método de pago").nth(1).selectOption("tarjeta");
  await page.getByRole("button", { name: /^Cobrar RD\$/ }).click();
  await expectVisible(toast("venta GBC-"), "venta", 15000);
  const [s] = await q(`select s.id, s.sale_number, s.total, s.payment_status, (select count(*) from payments where sale_id=s.id and status='pagado')::int pays from sales s where s.appointment_id=$1`, [apptId]);
  assert(s && s.payment_status === "pagado" && s.pays === 2 && Number(s.total) === Number(total), JSON.stringify(s));
});
await step("Completar con pago parcial deja saldo; cobrar el saldo desde la venta", async () => {
  const [e] = await q(`select id from employees where full_name like 'Ana%'`);
  const r = (await q(`select create_booking(jsonb_build_object('first_name','Parcial','last_name','E2E','phone','8295557102','status','en_servicio','source','walk_in','start_time',$1::text,'employee_id',$2::text,'services',jsonb_build_array(jsonb_build_object('service_id',(select id from services where slug='pedicure'))))) r`, [new Date(`${DAY}T11:00:00-04:00`).toISOString(), e.id]))[0].r;
  await page.goto(BASE + "/admin/appointments/board");
  await page.locator("article", { hasText: "Parcial" }).first().getByRole("button", { name: "Cobrar" }).click();
  await page.getByLabel("Monto").first().fill("300");
  await page.getByRole("button", { name: /^Cobrar RD\$ 300/ }).click();
  await expectVisible(toast("venta GBC-"), "venta", 15000);
  const [s] = await q(`select id, payment_status from sales where appointment_id=$1`, [r.id]);
  assert(s.payment_status === "parcial", s.payment_status);
  await page.goto(`${BASE}/admin/sales/${s.id}`);
  await page.getByRole("button", { name: /Registrar pago/ }).click();
  await expectVisible(dialog().getByRole("heading", { name: "Registrar pago" }), "modal de pago");
  await dialog().getByRole("button", { name: "Registrar pago" }).click();
  await expectVisible(toast("Pago registrado"), "toast", 10000);
  assert((await q(`select payment_status from sales where id=$1`, [s.id]))[0].payment_status === "pagado", "debe quedar pagada");
  // Anular (admin) con motivo
  await page.goto(`${BASE}/admin/sales/${s.id}`);
  await page.getByRole("button", { name: "Anular venta" }).click();
  assert(await dialog().getByRole("button", { name: "Anular venta" }).isDisabled(), "anular exige motivo");
  await dialog().getByLabel(/Motivo/).fill("Prueba E2E");
  await dialog().getByRole("button", { name: "Anular venta" }).click();
  await expectVisible(toast("Venta anulada"), "toast", 10000);
  const [v] = await q(`select payment_status, voided_at, void_reason from sales where id=$1`, [s.id]);
  assert(v.payment_status === "reembolsado" && v.voided_at && v.void_reason === "Prueba E2E", JSON.stringify(v));
  await expectVisible(page.getByText("VENTA ANULADA"), "marca de anulada en el recibo");
});
await step("Ventas: filtros por estado, búsqueda por número y exportación CSV", async () => {
  await page.goto(BASE + "/admin/sales?status=pagado");
  await expectVisible(page.locator("tbody tr"), "ventas pagadas");
  await page.goto(BASE + "/admin/sales?q=GBC-");
  await expectVisible(page.locator("tbody tr"), "búsqueda por número");
  const r = await page.request.get(BASE + "/admin/reports/export?range=30d&type=ventas");
  assert(r.status() === 200 && (r.headers()["content-type"] ?? "").includes("text/csv"), "csv ventas " + r.status());
  const r2 = await page.request.get(BASE + "/admin/appointments/export?range=all");
  assert(r2.status() === 200, "csv citas " + r2.status());
  const r3 = await page.request.get(BASE + "/admin/clients/export");
  assert(r3.status() === 200, "csv clientes " + r3.status());
});

console.log("\nLimpieza de datos de prueba…");
await q(`delete from payments where sale_id in (select id from sales where appointment_id in (select a.id from appointments a join clients c on c.id=a.client_id where c.phone_normalized in ('8295557100','8295557101','8295557102')))`);
await q(`delete from sales where appointment_id in (select a.id from appointments a join clients c on c.id=a.client_id where c.phone_normalized in ('8295557100','8295557101','8295557102'))`);
await q(`delete from appointments where client_id in (select id from clients where phone_normalized in ('8295557100','8295557101','8295557102'))`);
await q(`delete from clients where phone_normalized in ('8295557100','8295557101','8295557102')`);
await db.end();
const code = summary(errors);
await browser.close();
process.exit(code);
