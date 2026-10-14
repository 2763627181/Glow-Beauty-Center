import ExcelJS from "exceljs";
import pg from "pg";
import { BASE, OUT, assert, axeViolations, expectVisible, launch, login, section, setPage, step, summary } from "./h.mjs";

/* Apartado «Manicuristas»: sueldo fijo mensual + porcentaje de los servicios que realizan, con qué servicio, a quién y cuánto se cobró.
   Seguro para la base real: usa manicuristas «E2E Mani …», clientes «E2E …» (teléfonos 829555940x) y ventas de enero de 2020, y lo borra
   todo al terminar (incluidas sus filas de auditoría, por id). Las manicuristas reales solo se leen. */
const connect = async () => {
  for (let i = 1; ; i++) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
    try { await c.connect(); return c; } catch (e) { try { await c.end(); } catch { /* ya cerrado */ } if (i >= 20) throw e; await new Promise((r) => setTimeout(r, 4000)); }
  }
};
const db = await connect();
const q = async (s, p) => (await db.query(s, p)).rows;
const { browser, page, errors } = await launch();
setPage(page);
const PHONES = ["8295559401", "8295559402", "8295559403"];
const MONTH = "2020-01";

async function cleanup() {
  const sales = await q(`select id from sales where sale_number like 'E2E-M-%'`);
  const emps = await q(`select id from employees where full_name like 'E2E Mani%'`);
  const clients = await q(`select id from clients where phone_normalized = any($1)`, [PHONES]);
  const ids = [...sales, ...emps, ...clients].map((r) => r.id);
  await q(`delete from sales where sale_number like 'E2E-M-%'`);
  await q(`delete from employees where full_name like 'E2E Mani%'`);
  await q(`delete from clients where phone_normalized = any($1)`, [PHONES]);
  if (ids.length) await q(`delete from audit_logs where entity_id = any($1::uuid[])`, [ids]);
}
await cleanup();

const mkEmp = async (name, pct, salary) => (await q(`insert into employees (full_name, specialty, active, accepts_online_booking, commission_pct, base_salary) values ($1,'Manicurista',true,false,$2,$3) returning id`, [name, pct, salary]))[0].id;
const mkClient = async (first, phone) => (await q(`insert into clients (first_name, last_name, phone) values ($1,'E2E',$2) returning id`, [first, phone]))[0].id;
const A = await mkEmp("E2E Mani A", 15, 14000), B = await mkEmp("E2E Mani B", 20, 10000);
const [c1, c2, c3] = [await mkClient("Laura", PHONES[0]), await mkClient("Ana", PHONES[1]), await mkClient("Pendiente", PHONES[2])];
const sale = async (n, status, at, client, items) => {
  const total = items.reduce((t, i) => t + i.total, 0);
  const [s] = await q(`insert into sales (sale_number, subtotal, total, payment_status, completed_at, client_id) values ($1,$2,$2,$3,$4,$5) returning id`, [`E2E-M-${n}`, total, status, `${at}T15:00:00Z`, client]);
  for (const i of items) await q(`insert into sale_items (sale_id, description, quantity, unit_price, total, employee_id) values ($1,$2,1,$3,$3,$4)`, [s.id, i.desc, i.total, i.emp]);
  return s.id;
};
await sale(1, "pagado", "2020-01-03", c1, [{ emp: A, desc: "Manicure E2E", total: 600 }, { emp: A, desc: "Pintura de pies E2E", total: 450 }]);
await sale(2, "pagado", "2020-01-04", c2, [{ emp: B, desc: "Soft Gel E2E", total: 1500 }]);
await sale(3, "pendiente", "2020-01-05", c3, [{ emp: A, desc: "Builder E2E", total: 1500 }]);
await sale(4, "reembolsado", "2020-01-06", c1, [{ emp: A, desc: "Reembolsado E2E", total: 9999 }]);

const card = (name) => page.locator("section", { has: page.getByRole("heading", { name, exact: false }) }).first();

try {
  section("Permisos");
  await step("Recepción no ve ni entra a Manicuristas; el gerente sí", async () => {
    const r = await launch(); setPage(r.page);
    try {
      await login(r.page, "tmp-recep@glow.test");
      assert(!(await r.page.locator('nav[aria-label="Panel"]').getByText("Manicuristas", { exact: true }).count()), "recepción no debe ver «Manicuristas» en el menú");
      await r.page.goto(BASE + "/admin/manicurists");
      await r.page.waitForURL((u) => u.pathname === "/admin/forbidden", { timeout: 10000 });
    } finally { await r.browser.close(); setPage(page); }
    await login(page, "tmp-manager@glow.test");
    await expectVisible(page.locator('nav[aria-label="Panel"]').getByText("Manicuristas", { exact: true }), "«Manicuristas» en el menú del gerente");
  });

  section("Mes con servicios");
  await step("Cada manicurista muestra servicio, cliente y cobrado, con su 15 % automático", async () => {
    await page.goto(`${BASE}/admin/manicurists?month=${MONTH}`);
    await expectVisible(page.getByRole("heading", { name: "Manicuristas", exact: true }), "título");
    const a = card("E2E Mani A");
    await expectVisible(a, "tarjeta de E2E Mani A");
    const t = await a.innerText();
    for (const x of ["Manicure E2E", "Pintura de pies E2E", "Laura E2E", "RD$ 600", "RD$ 450", "RD$ 90", "RD$ 67.50", "gana el 15%", "Sueldo fijo RD$ 14,000 al mes"]) assert(t.includes(x), `la tarjeta de A debe mostrar «${x}»`);
    assert(t.includes("RD$ 157.50"), "su 15 % de 1,050 es RD$ 157.50");
    assert(t.includes("RD$ 14,157.50"), "total a pagar = 14,000 + 157.50");
    const b = card("E2E Mani B");
    const tb = await b.innerText();
    assert(tb.includes("Soft Gel E2E") && tb.includes("Ana E2E") && tb.includes("RD$ 300") && tb.includes("RD$ 10,300") && tb.includes("20%"), "B: Soft Gel de Ana, 20 % = 300, total 10,300");
  });

  await step("Lo sin cobrar se muestra aparte y no suma; lo reembolsado no aparece", async () => {
    const t = await card("E2E Mani A").innerText();
    assert(t.includes("Builder E2E") && t.includes("Sin cobrar") && t.includes("RD$ 225 al cobrarse"), "el servicio sin cobrar aparece con lo que ganaría al cobrarse");
    assert(!t.includes("Reembolsado E2E") && !t.includes("9,999"), "lo reembolsado no debe aparecer");
    assert(!t.includes("RD$ 382.50"), "sin cobrar no suma a la comisión");
  });

  await step("«Incluir servicios sin cobrar» suma lo pendiente y se puede volver atrás", async () => {
    await page.getByRole("link", { name: "Incluir servicios sin cobrar" }).click();
    await page.waitForURL(/pending=1/);
    const t = await card("E2E Mani A").innerText();
    assert(t.includes("RD$ 382.50") && t.includes("RD$ 14,382.50"), "con lo pendiente: 15 % de 2,550 = 382.50 y total 14,382.50");
    await page.getByRole("link", { name: "Solo servicios cobrados" }).click();
    await page.waitForURL((u) => !u.search.includes("pending"));
  });

  await step("Cambiar de mes: anterior, «Este mes» y sin flecha hacia el futuro", async () => {
    await page.getByRole("link", { name: /Ver diciembre de 2019/ }).click();
    await page.waitForURL(/month=2019-12/);
    await expectVisible(page.getByText("diciembre de 2019", { exact: true }), "mes mostrado");
    await expectVisible(card("E2E Mani A").getByText("Sin servicios este mes"), "mes sin servicios");
    await expectVisible(card("E2E Mani A").getByText("RD$ 14,000").first(), "aun sin servicios se muestra su sueldo");
    await page.getByRole("link", { name: "Este mes" }).click();
    await page.waitForURL((u) => !u.search.includes("month=2019") && !u.search.includes("2020"));
    assert((await page.getByRole("link", { name: /Ver .* de 20\d\d$/ }).filter({ hasText: "→" }).count()) === 0, "en el mes actual no hay flecha al futuro");
  });

  section("Las manicuristas reales");
  await step("Mayra y María aparecen con sueldo 14,000 y 15 %, sin avisos de configuración", async () => {
    await page.goto(`${BASE}/admin/manicurists`);
    for (const n of ["Mayra", "MARIA NOVAS"]) {
      const c = card(n);
      await expectVisible(c, `tarjeta de ${n}`);
      const t = await c.innerText();
      assert(t.includes("Sueldo fijo RD$ 14,000 al mes") && t.includes("gana el 15%"), `${n}: sueldo 14,000 y 15 % (${t.slice(0, 160).replace(/\s+/g, " ")})`);
      assert(!t.includes("Falta su porcentaje") && !t.includes("No tiene sueldo fijo"), `${n}: no debe pedir configuración`);
    }
  });

  section("Exportar");
  await step("Excel, PDF y CSV del mes traen el resumen y los servicios con su comisión", async () => {
    const get = async (f) => { const r = await page.request.get(`${BASE}/admin/manicurists/export?month=${MONTH}&format=${f}`); assert(r.ok(), `${f}: HTTP ${r.status()}`); return r; };
    const x = await get("xlsx"), p = await get("pdf"), c = await get("csv");
    assert((await p.body()).subarray(0, 4).toString() === "%PDF", "el PDF empieza con %PDF");
    const csv = await c.text();
    assert(csv.includes("E2E Mani A") && csv.includes("Manicure E2E") && csv.includes("Laura E2E"), "el CSV trae manicurista, servicio y cliente");
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await x.body());
    const names = wb.worksheets.map((w) => w.name);
    for (const n of ["Resumen", "Por manicurista", "Servicios"]) assert(names.includes(n), `falta la hoja «${n}» (hay ${names.join(", ")})`);
    const people = JSON.stringify(wb.getWorksheet("Por manicurista").getSheetValues());
    assert(people.includes("14157.5") && people.includes("10300"), "la hoja «Por manicurista» trae los totales a pagar");
    const rows = JSON.stringify(wb.getWorksheet("Servicios").getSheetValues());
    assert(rows.includes("Builder E2E") && rows.includes("Sin cobrar"), "la hoja «Servicios» incluye lo sin cobrar marcado");
    const bad = await page.request.get(`${BASE}/admin/manicurists/export?month=2020-13&format=csv`);
    assert(bad.status() === 400, "un mes inválido se rechaza");
  });

  section("Accesibilidad y celular");
  await step("La pantalla no tiene violaciones de accesibilidad (mes con datos y mes actual)", async () => {
    await page.goto(`${BASE}/admin/manicurists?month=${MONTH}&pending=1`);
    await expectVisible(card("E2E Mani A"), "tarjeta");
    let v = await axeViolations(page);
    assert(v.length === 0, "mes con datos: " + v.join(" || "));
    await page.goto(`${BASE}/admin/manicurists`);
    v = await axeViolations(page);
    assert(v.length === 0, "mes actual: " + v.join(" || "));
  });

  await step("Celular: la tabla no se sale de la pantalla", async () => {
    const m = await launch({ mobile: true }); setPage(m.page);
    try {
      await login(m.page, "tmp-manager@glow.test");
      await m.page.goto(`${BASE}/admin/manicurists?month=${MONTH}`);
      await expectVisible(m.page.getByText("Manicure E2E"), "servicio en el celular");
      const over = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(over <= 1, `la pantalla se desborda ${over} px`);
      await m.page.screenshot({ path: `${OUT}/manicuristas-movil.png`, fullPage: true });
    } finally { await m.browser.close(); setPage(page); }
  });

  await step("La ficha explica cómo aparecer aquí y qué es la comisión", async () => {
    await page.goto(`${BASE}/admin/staff/${A}`);
    await expectVisible(page.getByText(/Si dice «Manicurista», aparece en el apartado Manicuristas/), "ayuda de Especialidad");
    await expectVisible(page.getByText(/una manicurista que gana el 15 % escribe 15/), "ayuda de Comisión");
  });
} finally {
  await cleanup().catch((e) => console.error("limpieza:", e.message));
  await db.end().catch(() => {});
  await browser.close();
}
process.exit(summary(errors) ? 1 : 0);
