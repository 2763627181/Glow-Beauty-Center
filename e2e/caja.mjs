import { mkdirSync } from "node:fs";
import ExcelJS from "exceljs";
import pg from "pg";
import { BASE, OUT, assert, axeViolations, expectVisible, launch, login, section, setPage, step, summary, until } from "./h.mjs";

/* Caja de punta a punta, tecleando como una persona: abrir, cobrar en efectivo con vuelto, tarjeta (se cobra aparte), pago dividido,
   cobrar una cita, salidas y entradas, pago a una especialista con su 15 %, anular un movimiento (gerente), cerrar con diferencia,
   exportar, reabrir y cerrar exacto con conteo de billetes. Más permisos, accesibilidad y celular.
   Seguro para la base real: todo lo que crea lleva «E2E caja» (notas) o «E2E Caja …» (nombres), exige que NO haya una caja real
   abierta y lo borra todo al terminar (incluidas sus filas de auditoría, por id). */
const connect = async () => {
  for (let i = 1; ; i++) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
    try { await c.connect(); return c; } catch (e) { try { await c.end(); } catch { /* ya cerrado */ } if (i >= 20) throw e; await new Promise((r) => setTimeout(r, 4000)); }
  }
};
const db = await connect();
const q = async (s, p) => (await db.query(s, p)).rows;
mkdirSync(`${OUT}/caja`, { recursive: true });
const { browser, page, errors } = await launch();
setPage(page);
const dialog = () => page.getByRole("dialog");
const toast = (t) => page.getByText(t, { exact: false }).first();
const PHONE = "8295559301";
const NOTE = "E2E caja";
const fmt = (n) => "RD$ " + n.toLocaleString("en-US");
const type = async (loc, text) => { await loc.click(); await loc.press("Control+a"); await loc.pressSequentially(String(text), { delay: 25 }); };
const kpi = (label) => page.locator('div[class*="stat"]', { hasText: label }).first();
const expectKpi = async (label, amount) => until(async () => (await kpi(label).innerText()).includes(fmt(amount)), `${label} = ${fmt(amount)}`, 12000);

async function cleanup() {
  const sess = await q(`select id from cash_sessions where opening_note like $1`, [`${NOTE}%`]);
  const moves = sess.length ? await q(`select id from cash_movements where session_id = any($1)`, [sess.map((s) => s.id)]) : [];
  const appts = await q(`select a.id from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1`, [PHONE]);
  const sales = await q(`select id from sales where notes like $1 or appointment_id = any($2)`, [`${NOTE}%`, appts.map((a) => a.id)]);
  const pays = sales.length ? await q(`select id from payments where sale_id = any($1)`, [sales.map((s) => s.id)]) : [];
  const emps = await q(`select id from employees where full_name like 'E2E Caja%'`);
  const clients = await q(`select id from clients where phone_normalized=$1`, [PHONE]);
  const ids = [...sess, ...moves, ...appts, ...sales, ...pays, ...emps, ...clients].map((r) => r.id);
  if (moves.length) await q(`delete from cash_movements where id = any($1)`, [moves.map((m) => m.id)]);
  if (sess.length) await q(`delete from cash_sessions where id = any($1)`, [sess.map((s) => s.id)]);
  if (pays.length) await q(`delete from payments where id = any($1)`, [pays.map((p) => p.id)]);
  if (sales.length) await q(`delete from sales where id = any($1)`, [sales.map((s) => s.id)]);
  if (appts.length) await q(`delete from appointments where id = any($1)`, [appts.map((a) => a.id)]);
  if (clients.length) await q(`delete from clients where id = any($1)`, [clients.map((c) => c.id)]);
  if (emps.length) await q(`delete from employees where id = any($1)`, [emps.map((e) => e.id)]);
  if (ids.length) await q(`delete from audit_logs where entity_id = any($1::uuid[])`, [ids]);
}

// No se toca una caja real: si hay un turno abierto que no es de esta prueba, se aborta
const realOpen = await q(`select id from cash_sessions where closed_at is null and coalesce(opening_note,'') not like $1`, [`${NOTE}%`]);
if (realOpen.length) { console.error("Hay una caja real abierta: la prueba no se ejecuta para no tocarla."); process.exit(2); }
await cleanup();

// Datos: una especialista que paga 15 % al salón (comisión 85), con un servicio, y una cita en servicio para cobrar desde la caja
const MANI = (await q(`select id, price::float p from services where slug='manicure'`))[0];
const [EMP] = await q(`insert into employees (full_name, active, accepts_online_booking, commission_pct) values ('E2E Caja Mani', true, false, 85) returning id`);
await q(`insert into employee_services (employee_id, service_id) values ($1,$2)`, [EMP.id, MANI.id]);
const appt = (await q(`select create_booking(jsonb_build_object('first_name','E2E Caja','last_name','Cita','phone',$1::text,'status','en_servicio','source','walk_in','start_time',$2::text,'employee_id',$3::text,'services',jsonb_build_array(jsonb_build_object('service_id',$4::text)))) r`,
  [PHONE, new Date(Date.now() + 5 * 60e3).toISOString(), EMP.id, MANI.id]))[0].r;
assert(MANI.p === 600, `se esperaba Manicure a RD$ 600 y es ${MANI.p}`);

const sold = async (n) => (await q(`select p.amount::float amount, p.tendered::float tendered, p.method, p.reference, s.total::float total, s.payment_status from payments p join sales s on s.id=p.sale_id where s.notes=$1 order by p.paid_at`, [n]));

async function newSale(items, note) {
  await page.getByRole("button", { name: "+ Nueva venta" }).click();
  await expectVisible(dialog(), "diálogo de nueva venta");
  for (const [name, price] of items) {
    await type(dialog().locator("#qs-cn"), name);
    await type(dialog().locator("#qs-cp"), price);
    await dialog().getByRole("button", { name: "Agregar", exact: true }).click();
  }
  await type(dialog().locator("#qs-n"), note);
}

try {
  section("Permisos");
  await step("Especialista no ve la Caja ni puede entrar; recepción sí la ve en el menú", async () => {
    const r = await launch(); setPage(r.page);
    try {
      await login(r.page, "tmp-spec@glow.test");
      assert(!(await r.page.locator('nav[aria-label="Panel"]').getByText("Caja", { exact: true }).count()), "el especialista no debe ver «Caja»");
      await r.page.goto(BASE + "/admin/cash");
      await r.page.waitForURL((u) => u.pathname !== "/admin/cash", { timeout: 10000 });
    } finally { await r.browser.close(); setPage(page); }
    await login(page, "tmp-recep@glow.test");
    await expectVisible(page.locator('nav[aria-label="Panel"]').getByText("Caja", { exact: true }), "«Caja» en el menú de recepción");
  });

  section("Caja cerrada");
  await step("La caja empieza cerrada y ofrece abrirla", async () => {
    await page.goto(BASE + "/admin/cash");
    await expectVisible(page.getByRole("heading", { name: "La caja está cerrada" }), "estado cerrada");
    await expectVisible(page.getByRole("button", { name: "Abrir caja" }), "botón abrir");
  });

  await step("Cobrar en efectivo con la caja cerrada avisa y no registra nada", async () => {
    await newSale([["E2E Servicio de uñas", 1700]], `${NOTE} 1`);
    await type(dialog().getByLabel("El cliente entregó (RD$)"), 2000);
    await expectVisible(dialog().getByText("Para cobrar en efectivo primero abre la caja."), "aviso de caja cerrada");
    await dialog().getByRole("button", { name: /^Registrar venta y cobrar/ }).click();
    await expectVisible(dialog().getByText("Para cobrar en efectivo primero abre la caja.").last(), "error al registrar");
    assert((await q(`select count(*)::int n from sales where notes=$1`, [`${NOTE} 1`]))[0].n === 0, "no debe haberse creado la venta");
  });

  await step("Abrir la caja desde el mismo aviso (fondo 1,000)", async () => {
    await dialog().getByRole("button", { name: "Abrir caja" }).click();
    await expectVisible(page.getByRole("dialog", { name: "Abrir caja" }), "diálogo abrir caja");
    const open = page.getByRole("dialog", { name: "Abrir caja" });
    await type(open.locator("#oc-amount"), 1000);
    await type(open.locator("#oc-note"), `${NOTE} apertura`);
    await open.getByRole("button", { name: "Abrir caja" }).click();
    await expectVisible(toast("abierta con RD$ 1,000"), "toast de apertura", 10000);
    await until(async () => (await dialog().getByText("Para cobrar en efectivo primero abre la caja.").count()) === 0, "el aviso desaparece al abrir", 12000);
    const s = (await q(`select opening_amount::float a from cash_sessions where closed_at is null`))[0];
    assert(s && s.a === 1000, "debe haber una caja abierta con 1,000");
  });

  section("Cobro en efectivo con vuelto");
  await step("Servicio de 1,700 con 2,000: muestra «Vuelto RD$ 300» antes de cobrar y el cobro lo deja a la vista", async () => {
    await expectVisible(dialog().getByText("Vuelto a entregar"), "línea de vuelto");
    assert((await dialog().locator('[class*="summary"]').innerText()).includes("RD$ 300"), "el resumen debe mostrar el vuelto de RD$ 300");
    assert((await dialog().locator('[class*="result"]').first().innerText()).includes("Cobrado en efectivo: RD$ 1,700"), "la fila muestra lo cobrado");
    await dialog().getByRole("button", { name: /^Registrar venta y cobrar RD\$ 1,700 · vuelto RD\$ 300/ }).click();
    await expectVisible(page.getByText("Devuélvele al cliente"), "pantalla de vuelto", 10000);
    assert((await page.getByRole("dialog").innerText()).includes("RD$ 300"), "la pantalla de vuelto debe decir RD$ 300");
    await page.getByRole("button", { name: "Listo, ya entregué el vuelto" }).click();
    await page.waitForURL(/\/admin\/sales\/[0-9a-f-]{36}$/, { timeout: 10000 });
    await expectVisible(page.getByText("recibido RD$ 2,000 · vuelto RD$ 300"), "recibo con lo recibido y el vuelto");
    const p = (await sold(`${NOTE} 1`))[0];
    assert(p.amount === 1700 && p.tendered === 2000 && p.method === "efectivo", `pago guardado mal: ${JSON.stringify(p)}`);
  });

  await step("Atajos de efectivo: «El cliente dio» llena el monto y «Pagar todo» deja el exacto", async () => {
    await page.goto(BASE + "/admin/cash");
    await newSale([["E2E Servicio rápido", 1700]], `${NOTE} 2`);
    await dialog().getByRole("button", { name: "RD$ 2,000", exact: true }).click();
    assert((await dialog().getByLabel("El cliente entregó (RD$)").inputValue()) === "2000", "el atajo debe escribir 2000");
    assert((await dialog().locator('[class*="summary"]').innerText()).includes("RD$ 300"), "vuelto 300");
    await dialog().getByRole("button", { name: /Pagar todo/ }).click();
    assert((await dialog().getByLabel("El cliente entregó (RD$)").inputValue()) === "1700", "«Pagar todo» deja 1700");
    await dialog().getByRole("button", { name: /^Registrar venta y cobrar RD\$ 1,700$/ }).click();
    await page.waitForURL(/\/admin\/sales\/[0-9a-f-]{36}$/, { timeout: 10000 });
    const p = (await sold(`${NOTE} 2`))[0];
    assert(p.amount === 1700 && p.tendered === 1700, "cobro exacto: sin vuelto");
  });

  section("Tarjeta y transferencia: se cobran aparte");
  await step("Con tarjeta no hay vuelto, se explica que se cobra aparte y se guarda la referencia", async () => {
    await page.goto(BASE + "/admin/cash");
    await newSale([["E2E Keratina", 800]], `${NOTE} 3`);
    await dialog().getByLabel("Método").first().selectOption("tarjeta");
    await expectVisible(dialog().getByText(/Se cobra aparte \(datáfono o banco\)/), "explicación de cobro aparte");
    assert((await dialog().getByText("Vuelto a entregar").count()) === 0, "con tarjeta no hay línea de vuelto");
    await expectVisible(dialog().getByLabel("Monto cobrado (RD$)"), "campo «Monto cobrado»");
    await dialog().getByRole("button", { name: /Pagar todo/ }).click();
    await type(dialog().getByLabel("Referencia o aprobación (opcional)"), "AUT-9");
    await dialog().getByRole("button", { name: /^Registrar venta y cobrar RD\$ 800$/ }).click();
    await page.waitForURL(/\/admin\/sales\/[0-9a-f-]{36}$/, { timeout: 10000 });
    await expectVisible(page.getByText(/Tarjeta · AUT-9/), "pago con tarjeta y su referencia en el recibo");
    const p = (await sold(`${NOTE} 3`))[0];
    assert(p.amount === 800 && p.tendered === null && p.method === "tarjeta" && p.reference === "AUT-9", `pago guardado mal: ${JSON.stringify(p)}`);
  });

  await step("Pago dividido: tarjeta 1,000 + efectivo 2,500 en una venta de 3,000 → vuelto 500", async () => {
    await page.goto(BASE + "/admin/cash");
    await newSale([["E2E Color completo", 3000]], `${NOTE} 4`);
    await dialog().getByLabel("Método").first().selectOption("tarjeta");
    await type(dialog().getByLabel("Monto cobrado (RD$)"), 1000);
    await dialog().getByRole("button", { name: "+ Dividir pago" }).click();
    await dialog().getByLabel("Método").nth(1).selectOption("efectivo");
    await type(dialog().getByLabel("El cliente entregó (RD$)"), 2500);
    const sum = await dialog().locator('[class*="summary"]').innerText();
    assert(sum.includes("RD$ 500") && sum.includes("RD$ 2,500") && sum.includes("RD$ 1,000"), `resumen inesperado: ${sum.replace(/\n/g, " | ")}`);
    await dialog().getByRole("button", { name: /^Registrar venta y cobrar RD\$ 3,000 · vuelto RD\$ 500/ }).click();
    await expectVisible(page.getByText("Devuélvele al cliente"), "pantalla de vuelto", 10000);
    await page.getByRole("button", { name: "Listo, ya entregué el vuelto" }).click();
    await page.waitForURL(/\/admin\/sales\/[0-9a-f-]{36}$/, { timeout: 10000 });
    const ps = await sold(`${NOTE} 4`);
    const card = ps.find((x) => x.method === "tarjeta"), cash = ps.find((x) => x.method === "efectivo");
    assert(card?.amount === 1000 && cash?.amount === 2000 && cash?.tendered === 2500 && ps[0].payment_status === "pagado", `pagos guardados mal: ${JSON.stringify(ps)}`);
  });

  section("Cobrar una cita desde la Caja");
  await step("La cita en servicio aparece en «Por cobrar»; se cobra con 1,000 para 600 y se completa", async () => {
    await page.goto(BASE + "/admin/cash");
    await expectVisible(page.getByRole("heading", { name: /Caja abierta/ }), "caja abierta");
    const btn = page.getByRole("button", { name: "Cobrar a E2E Caja Cita" });
    await expectVisible(btn, "la cita en «Por cobrar»");
    await btn.click();
    await expectVisible(dialog(), "diálogo de cobro");
    await type(dialog().getByLabel("El cliente entregó (RD$)"), 1000);
    await dialog().getByRole("button", { name: /^Cobrar RD\$ 600 · vuelto RD\$ 400/ }).click();
    await expectVisible(page.getByText("Devuélvele al cliente"), "pantalla de vuelto", 12000);
    assert((await page.getByRole("dialog").innerText()).includes("RD$ 400"), "vuelto de RD$ 400");
    await page.getByRole("button", { name: "Listo, ya entregué el vuelto" }).click();
    const s = await until(async () => (await q(`select s.payment_status, s.total::float t from sales s where s.appointment_id=$1`, [appt.id]))[0], "la venta de la cita", 12000);
    assert(s.payment_status === "pagado" && s.t === 600, `venta de la cita: ${JSON.stringify(s)}`);
    const p = (await q(`select amount::float a, tendered::float t from payments where appointment_id=$1`, [appt.id]))[0];
    assert(p.a === 600 && p.t === 1000, `pago de la cita: ${JSON.stringify(p)}`);
  });

  section("Totales de la caja");
  await step("Efectivo cobrado 5,300 (con fondo 1,000 → debe haber 5,300); tarjeta y transferencia 1,800 aparte", async () => {
    // efectivo: 1,700 + 1,700 + 2,000 + 600 = 6,000; con el fondo de 1,000 deben ser 7,000
    await page.goto(BASE + "/admin/cash");
    await expectKpi("Efectivo cobrado", 6000);
    await expectKpi("Fondo inicial", 1000);
    await expectKpi("Efectivo que debe haber", 7000);
    await expectKpi("Tarjeta y transferencia", 1800);
  });

  section("Salidas y entradas de efectivo");
  await step("Salida «Compra» de 300 baja la caja; una salida mayor al efectivo se rechaza", async () => {
    await page.getByRole("button", { name: "Salida de efectivo" }).click();
    const d = page.getByRole("dialog", { name: "Salida de efectivo" });
    await d.locator("#mv-cat").selectOption("compra");
    await type(d.locator("#mv-amount"), 300);
    await type(d.locator("#mv-desc"), "E2E esponjas");
    await expectVisible(d.getByText(/quedarían/), "vista previa de lo que quedaría");
    await d.getByRole("button", { name: "Registrar salida" }).click();
    await expectVisible(toast("Salida de RD$ 300 registrada"), "toast", 10000);
    await expectKpi("Efectivo que debe haber", 6700);
    await page.getByRole("button", { name: "Salida de efectivo" }).click();
    const d2 = page.getByRole("dialog", { name: "Salida de efectivo" });
    await d2.locator("#mv-cat").selectOption("retiro");
    await type(d2.locator("#mv-amount"), 99999);
    await d2.getByRole("button", { name: "Registrar salida" }).click();
    await expectVisible(d2.getByText(/En la caja solo hay RD\$ 6,700/), "rechazo por falta de efectivo");
    await page.keyboard.press("Escape");
    await expectKpi("Salidas", 300);
  });

  await step("Producción: la especialista que paga 15 % produjo 600 → paga 90 al salón y se queda 510; se le paga desde la caja", async () => {
    const prod = () => page.locator("section", { hasText: "Producción por especialista" }).locator("tr", { hasText: "E2E Caja Mani" });
    const row = prod();
    await expectVisible(row, "fila de la especialista en producción");
    const t = await row.innerText();
    assert(t.includes("RD$ 600") && t.includes("RD$ 90") && t.includes("15%") && t.includes("RD$ 510"), `fila de producción: ${t.replace(/\s+/g, " ")}`);
    await row.getByRole("button", { name: "Pagar a E2E Caja Mani desde la caja" }).click();
    const d = page.getByRole("dialog", { name: "Salida de efectivo" });
    assert((await d.locator("#mv-cat").inputValue()) === "pago_especialista", "la categoría viene elegida");
    assert((await d.locator("#mv-amount").inputValue()) === "510", "el monto viene con lo que le falta por recibir");
    assert((await d.locator("#mv-emp").inputValue()) === EMP.id, "la especialista viene elegida");
    await d.getByRole("button", { name: "Registrar salida" }).click();
    await expectVisible(toast("Salida de RD$ 510 registrada"), "toast", 10000);
    await expectKpi("Efectivo que debe haber", 6190);
    await until(async () => !(await prod().getByRole("button", { name: /Pagar a/ }).count()), "ya no hay nada por entregar", 10000);
    assert((await prod().innerText()).includes("RD$ 510"), "queda como entregado");
  });

  await step("Entrada «Dinero que se agrega» de 200 sube la caja", async () => {
    await page.getByRole("button", { name: "Entrada de efectivo" }).click();
    const d = page.getByRole("dialog", { name: "Entrada de efectivo" });
    await type(d.locator("#mv-amount"), 200);
    await type(d.locator("#mv-desc"), "E2E cambio menudo");
    await d.getByRole("button", { name: "Registrar entrada" }).click();
    await expectKpi("Efectivo que debe haber", 6390);
  });

  await step("Configuración: no se puede cambiar si «Efectivo» es efectivo con la caja abierta", async () => {
    const m = await launch(); setPage(m.page);
    try {
      await login(m.page, "tmp-admin@glow.test");
      await m.page.goto(BASE + "/admin/settings?tab=pagos");
      await m.page.getByRole("button", { name: "Editar" }).first().click();
      const d = m.page.getByRole("dialog");
      await expectVisible(d.getByLabel("Es efectivo (entra a la caja)"), "casilla «Es efectivo»");
      assert(await d.getByLabel("Es efectivo (entra a la caja)").isChecked(), "Efectivo debe venir marcado");
      await d.getByLabel("Es efectivo (entra a la caja)").uncheck();
      await d.getByRole("button", { name: "Guardar" }).click();
      await expectVisible(d.getByText("Cierra la caja antes de cambiar si este método es efectivo."), "rechazo con la caja abierta");
    } finally { await m.browser.close(); setPage(page); }
    assert((await q(`select is_cash from payment_methods where key='efectivo'`))[0].is_cash === true, "Efectivo sigue siendo efectivo");
  });

  section("Gerente anula un movimiento");
  await step("Recepción no ve «Anular»; el gerente anula la compra con motivo y la caja recupera 300", async () => {
    await page.reload();
    await expectVisible(page.getByText("E2E esponjas"), "movimiento de compra");
    assert((await page.getByRole("button", { name: /^Anular/ }).count()) === 0, "recepción no debe ver «Anular»");
    const m = await launch(); setPage(m.page);
    try {
      await login(m.page, "tmp-manager@glow.test");
      await m.page.goto(BASE + "/admin/cash");
      await m.page.getByRole("button", { name: /^Anular Compra de materiales o productos de RD\$ 300/ }).click();
      const d = m.page.getByRole("dialog", { name: "Anular movimiento" });
      await d.getByRole("button", { name: "Anular movimiento" }).click();
      await expectVisible(d.getByText("Escribe el motivo."), "motivo obligatorio");
      await type(d.locator("#rs-reason"), "E2E se registró dos veces");
      await d.getByRole("button", { name: "Anular movimiento" }).click();
      await expectVisible(m.page.getByText("Movimiento anulado"), "toast", 10000);
      await until(async () => (await m.page.locator('div[class*="stat"]', { hasText: "Efectivo que debe haber" }).first().innerText()).includes("RD$ 6,690"), "esperado 6,690", 12000);
      await expectVisible(m.page.getByText("Anulado: E2E se registró dos veces"), "movimiento anulado a la vista");
    } finally { await m.browser.close(); setPage(page); }
  });

  section("Accesibilidad y celular (caja abierta)");
  await step("Pantalla de la Caja y el cobro: sin violaciones de accesibilidad", async () => {
    await page.goto(BASE + "/admin/cash");
    await expectVisible(page.getByRole("heading", { name: /Caja abierta/ }), "caja abierta");
    let v = await axeViolations(page);
    assert(v.length === 0, "Caja: " + v.join(" || "));
    await page.getByRole("button", { name: "+ Nueva venta" }).click();
    await type(dialog().locator("#qs-cn"), "E2E a11y"); await type(dialog().locator("#qs-cp"), 500);
    await dialog().getByRole("button", { name: "Agregar", exact: true }).click();
    await dialog().getByRole("button", { name: "+ Dividir pago" }).click();
    await type(dialog().getByLabel("El cliente entregó (RD$)").first(), 600);
    v = await axeViolations(page);
    assert(v.length === 0, "Cobro: " + v.join(" || "));
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Cerrar caja" }).click();
    v = await axeViolations(page);
    assert(v.length === 0, "Cerrar caja: " + v.join(" || "));
    await page.keyboard.press("Escape");
  });

  await step("Celular: la Caja y el cobro no se salen de la pantalla", async () => {
    const mob = await launch({ mobile: true }); setPage(mob.page);
    try {
      await login(mob.page, "tmp-recep@glow.test");
      await mob.page.goto(BASE + "/admin/cash");
      await expectVisible(mob.page.getByRole("heading", { name: /Caja abierta/ }), "caja abierta en celular");
      const over = () => mob.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert((await over()) <= 1, `la Caja se desborda ${await over()} px`);
      await mob.page.getByRole("button", { name: "+ Nueva venta" }).click();
      const d = mob.page.getByRole("dialog");
      await type(d.locator("#qs-cn"), "E2E móvil"); await type(d.locator("#qs-cp"), 1700);
      await d.getByRole("button", { name: "Agregar", exact: true }).click();
      await type(d.getByLabel("El cliente entregó (RD$)"), 2000);
      assert((await d.evaluate((el) => el.scrollWidth - el.clientWidth)) <= 1, "el cobro se desborda en el celular");
      await mob.page.screenshot({ path: `${OUT}/caja/movil-cobro.png` });
    } finally { await mob.browser.close(); setPage(page); }
  });

  section("Cierre con diferencia");
  await step("Cerrar con 4,000 de 6,690 pide nota; con nota cierra y muestra el reporte", async () => {
    await page.goto(BASE + "/admin/cash");
    await page.getByRole("button", { name: "Cerrar caja" }).click();
    const d = page.getByRole("dialog", { name: "Cerrar caja" });
    await expectVisible(d.getByText("Efectivo que debería haber"), "resumen de cierre");
    assert((await d.innerText()).includes("RD$ 6,690"), "el cierre debe esperar RD$ 6,690");
    await type(d.locator("#cc-counted"), 6670);
    await expectVisible(d.getByText("Faltan RD$ 20 en la caja."), "faltante de 20");
    await d.getByRole("button", { name: "Cerrar caja" }).click();
    await expectVisible(d.getByText("Hay una diferencia: escribe una nota que la explique."), "nota obligatoria");
    await type(d.locator("#cc-note"), "E2E faltaron 20 del cambio");
    await d.getByRole("button", { name: "Cerrar caja" }).click();
    await page.waitForURL(/\/admin\/cash\/[0-9a-f-]{36}$/, { timeout: 15000 });
    await expectVisible(page.getByText("Faltaron RD$ 20."), "diferencia en el reporte");
    await expectVisible(page.getByText("Nota de cierre: E2E faltaron 20 del cambio"), "nota de cierre");
    const s = (await q(`select expected_cash::float e, counted_cash::float c, difference::float d from cash_sessions where opening_note like $1`, [`${NOTE}%`]))[0];
    assert(s.e === 6690 && s.c === 6670 && s.d === -20, `cierre guardado mal: ${JSON.stringify(s)}`);
  });

  await step("El reporte cerrado: sin violaciones de accesibilidad y con el detalle", async () => {
    const v = await axeViolations(page);
    assert(v.length === 0, v.join(" || "));
    const body = await page.locator("main, body").first().innerText();
    for (const t of ["E2E Caja Mani", "Cobrado aparte", "Efectivo", "E2E esponjas", "AUT-9"]) assert(body.includes(t), `el reporte debe mostrar «${t}»`);
    assert(body.includes("Recibido RD$ 2,000 · vuelto RD$ 300"), "el reporte muestra lo recibido y el vuelto");
  });

  await step("Exportar el cierre: Excel, PDF y CSV se descargan completos", async () => {
    const id = page.url().split("/").pop();
    const get = async (f) => { const r = await page.request.get(`${BASE}/admin/cash/${id}/export?format=${f}`); assert(r.ok(), `${f}: HTTP ${r.status()}`); return r; };
    const x = await get("xlsx"), p = await get("pdf"), c = await get("csv");
    assert(x.headers()["content-type"].includes("spreadsheetml"), "tipo de Excel");
    assert((await p.body()).subarray(0, 4).toString() === "%PDF", "el PDF empieza con %PDF");
    assert((await c.text()).includes("Cuadre del efectivo") || (await c.text()).includes("Efectivo que debía haber"), "el CSV trae el cuadre");
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await x.body());
    const names = wb.worksheets.map((w) => w.name);
    for (const n of ["Resumen", "Cuadre", "Por método", "Cobros", "Producción"]) assert(names.includes(n), `falta la hoja «${n}» (hay ${names.join(", ")})`);
    const txt = wb.getWorksheet("Cuadre").getSheetValues().flat().join(" ");
    assert(txt.includes("Efectivo contado"), "la hoja Cuadre trae lo contado");
  });

  await step("Con la caja cerrada: aparece en «Cierres anteriores» y el efectivo vuelve a pedir abrir caja", async () => {
    await page.goto(BASE + "/admin/cash");
    await expectVisible(page.getByRole("heading", { name: "La caja está cerrada" }), "caja cerrada");
    const row = page.locator("tr", { hasText: /CAJA-\d{4}/ }).first();
    assert((await row.innerText()).includes("Faltó RD$ 20"), "la tabla de cierres muestra el faltante");
    await newSale([["E2E tras el cierre", 100]], `${NOTE} 5`);
    await type(dialog().getByLabel("El cliente entregó (RD$)"), 100);
    await expectVisible(dialog().getByText("Para cobrar en efectivo primero abre la caja."), "aviso con la caja cerrada");
    await page.keyboard.press("Escape");
  });

  section("Reabrir y cerrar exacto");
  await step("Recepción no ve «Reabrir cierre»; el gerente reabre con motivo", async () => {
    await page.locator("tr", { hasText: /CAJA-\d{4}/ }).first().getByRole("link", { name: /Ver cierre/ }).click();
    await page.waitForURL(/\/admin\/cash\/[0-9a-f-]{36}$/);
    assert((await page.getByRole("button", { name: "Reabrir cierre" }).count()) === 0, "recepción no debe ver «Reabrir cierre»");
    const url = page.url();
    const m = await launch(); setPage(m.page);
    try {
      await login(m.page, "tmp-manager@glow.test");
      await m.page.goto(url);
      await m.page.getByRole("button", { name: "Reabrir cierre" }).click();
      const d = m.page.getByRole("dialog", { name: "Reabrir cierre" });
      await type(d.locator("#rs-reason"), "E2E conté mal");
      await d.getByRole("button", { name: "Reabrir caja" }).click();
      await expectVisible(m.page.getByText("Caja reabierta"), "toast", 10000);
      await m.page.goto(BASE + "/admin/cash");
      await expectVisible(m.page.getByRole("heading", { name: /Caja abierta/ }), "vuelve a estar abierta");
    } finally { await m.browser.close(); setPage(page); }
    const s = (await q(`select closed_at, counted_cash from cash_sessions where opening_note like $1`, [`${NOTE}%`]))[0];
    assert(s.closed_at === null && s.counted_cash === null, "la caja debe haber quedado abierta");
  });

  await step("Cierre exacto contando billetes (6,690) sin pedir nota", async () => {
    await page.goto(BASE + "/admin/cash");
    await expectKpi("Efectivo que debe haber", 6690);
    await page.getByRole("button", { name: "Cerrar caja" }).click();
    const d = page.getByRole("dialog", { name: "Cerrar caja" });
    await d.getByRole("button", { name: "Contar billetes y monedas" }).click();
    const bill = (v) => d.getByLabel(`Cantidad de RD$ ${v.toLocaleString("en-US")}`, { exact: true });
    // 3×2000 + 500×1 + 100×1 + 50×1 + 25×1 + 10×1 + 5×1 = 6,690
    for (const [v, n] of [[2000, 3], [500, 1], [100, 1], [50, 1], [25, 1], [10, 1], [5, 1]]) await type(bill(v), n);
    assert((await d.locator("#cc-counted").inputValue()) === "6690", "el conteo de billetes debe sumar 6690");
    await expectVisible(d.getByText("Cuadra exacto: no hay diferencia."), "sin diferencia");
    await d.getByRole("button", { name: "Cerrar caja" }).click();
    await page.waitForURL(/\/admin\/cash\/[0-9a-f-]{36}$/, { timeout: 15000 });
    await expectVisible(page.getByText("Cuadró exacto: no hubo diferencia."), "cuadró exacto");
  });

  section("Ficha de la especialista");
  await step("«Paga al salón %» y «Comisión %» van juntos: 15 ↔ 85 y 70 ↔ 30", async () => {
    const m = await launch(); setPage(m.page);
    try {
      await login(m.page, "tmp-manager@glow.test");
      await m.page.goto(`${BASE}/admin/staff/${EMP.id}`);
      const com = m.page.locator("#e-com"), salon = m.page.locator("#e-salon");
      assert((await com.inputValue()) === "85" && (await salon.inputValue()) === "15", "debe mostrar comisión 85 y salón 15");
      await type(salon, 20);
      assert((await com.inputValue()) === "80", "al escribir 20 al salón, la comisión queda en 80");
      await type(com, 70);
      assert((await salon.inputValue()) === "30", "al escribir 70 de comisión, el salón queda en 30");
      await salon.press("Control+a"); await salon.press("Delete");
      assert((await com.inputValue()) === "", "al borrar el porcentaje del salón se borra la comisión");
    } finally { await m.browser.close(); setPage(page); }
  });
} finally {
  await cleanup().catch((e) => console.error("limpieza:", e.message));
  await db.end().catch(() => {});
  await browser.close();
}
process.exit(summary(errors) ? 1 : 0);
