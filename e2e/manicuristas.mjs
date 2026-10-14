import ExcelJS from "exceljs";
import pg from "pg";
import { BASE, OUT, assert, axeViolations, expectVisible, launch, login, section, setPage, step, summary } from "./h.mjs";

/* Apartado «Manicuristas»: sueldo fijo por quincena (7,000; 14,000 al mes) + porcentaje de los servicios que realizan, con qué servicio,
   a quién y cuánto se cobró. Seguro para la base real: usa manicuristas «E2E Mani …», clientes «E2E …» (teléfonos 829555940x) y ventas de
   enero de 2020, y lo borra todo al terminar (incluidas sus filas de auditoría, por id). Las manicuristas reales solo se leen. */
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
const Q1 = "month=2020-01&period=q1", Q2 = "month=2020-01&period=q2", WHOLE = "month=2020-01&period=mes";

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

// A: 7,000 por quincena y 15 %. B: 5,000 por quincena y 20 %.
const mkEmp = async (name, pct, salary) => (await q(`insert into employees (full_name, specialty, active, accepts_online_booking, commission_pct, base_salary) values ($1,'Manicurista',true,false,$2,$3) returning id`, [name, pct, salary]))[0].id;
const mkClient = async (first, phone) => (await q(`insert into clients (first_name, last_name, phone) values ($1,'E2E',$2) returning id`, [first, phone]))[0].id;
const A = await mkEmp("E2E Mani A", 15, 7000), B = await mkEmp("E2E Mani B", 20, 5000);
const [c1, c2, c3] = [await mkClient("Laura", PHONES[0]), await mkClient("Ana", PHONES[1]), await mkClient("Pendiente", PHONES[2])];
const sale = async (n, status, at, client, items) => {
  const total = items.reduce((t, i) => t + i.total, 0);
  const [s] = await q(`insert into sales (sale_number, subtotal, total, payment_status, completed_at, client_id) values ($1,$2,$2,$3,$4,$5) returning id`, [`E2E-M-${n}`, total, status, `${at}T15:00:00Z`, client]);
  for (const i of items) await q(`insert into sale_items (sale_id, description, quantity, unit_price, total, employee_id) values ($1,$2,1,$3,$3,$4)`, [s.id, i.desc, i.total, i.emp]);
  return s.id;
};
// 1.ª quincena (1–15)
await sale(1, "pagado", "2020-01-03", c1, [{ emp: A, desc: "Manicure E2E", total: 600 }, { emp: A, desc: "Pintura de pies E2E", total: 450 }]);
await sale(2, "pagado", "2020-01-04", c2, [{ emp: B, desc: "Soft Gel E2E", total: 1500 }]);
await sale(3, "pendiente", "2020-01-05", c3, [{ emp: A, desc: "Builder E2E", total: 1500 }]);
await sale(4, "reembolsado", "2020-01-06", c1, [{ emp: A, desc: "Reembolsado E2E", total: 9999 }]);
// 2.ª quincena (16–31), con el último día del mes
await sale(5, "pagado", "2020-01-20", c2, [{ emp: A, desc: "Retoque E2E", total: 800 }]);
await sale(6, "pagado", "2020-01-31", c1, [{ emp: A, desc: "Último día E2E", total: 200 }]);

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

  section("1.ª quincena: 7,000 + el 15 %");
  await step("Cada manicurista muestra servicio, cliente y cobrado; su sueldo de 7,000 + su 15 % automático = total de la quincena", async () => {
    await page.goto(`${BASE}/admin/manicurists?${Q1}`);
    await expectVisible(page.getByText("1.ª quincena de enero de 2020 (del 1 al 15)", { exact: true }), "período mostrado");
    const a = card("E2E Mani A");
    await expectVisible(a, "tarjeta de E2E Mani A");
    const t = await a.innerText();
    for (const x of ["Manicure E2E", "Pintura de pies E2E", "Laura E2E", "RD$ 600", "RD$ 450", "RD$ 90", "RD$ 67.50", "gana el 15%", "Sueldo fijo RD$ 7,000 por quincena (RD$ 14,000 al mes)", "Total a pagar la quincena"]) assert(t.includes(x), `la tarjeta de A debe mostrar «${x}»`);
    assert(t.includes("RD$ 157.50"), "su 15 % de 1,050 es RD$ 157.50");
    assert(t.includes("RD$ 7,157.50"), "total = 7,000 + 157.50");
    assert(t.includes("RD$ 7,000 de sueldo + RD$ 157.50 de comisión"), "el desglose sueldo + comisión");
    assert(!t.includes("Retoque E2E") && !t.includes("Último día E2E"), "lo de la 2.ª quincena no aparece aquí");
    const tb = await card("E2E Mani B").innerText();
    assert(tb.includes("Soft Gel E2E") && tb.includes("Ana E2E") && tb.includes("RD$ 300") && tb.includes("RD$ 5,300") && tb.includes("20%"), "B: Soft Gel de Ana, 20 % = 300, sueldo 5,000 → total 5,300");
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
    assert(t.includes("RD$ 382.50") && t.includes("RD$ 7,382.50"), "con lo pendiente: 15 % de 2,550 = 382.50 y total 7,382.50");
    await page.getByRole("link", { name: "Solo servicios cobrados" }).click();
    await page.waitForURL((u) => !u.search.includes("pending"));
  });

  section("2.ª quincena y mes completo");
  await step("La 2.ª quincena (16 al 31) trae sus servicios, otra vez 7,000 de sueldo, y cuenta el último día del mes", async () => {
    await page.getByRole("link", { name: "2.ª quincena", exact: true }).click();
    await page.waitForURL(/period=q2/);
    await expectVisible(page.getByText("2.ª quincena de enero de 2020 (del 16 al 31)", { exact: true }), "período mostrado");
    const t = await card("E2E Mani A").innerText();
    for (const x of ["Retoque E2E", "Último día E2E", "RD$ 1,000", "RD$ 150", "RD$ 7,150"]) assert(t.includes(x), `la 2.ª quincena de A debe mostrar «${x}»`);
    assert(!t.includes("Manicure E2E"), "lo de la 1.ª quincena no aparece aquí");
    await expectVisible(card("E2E Mani B").getByText("Sin servicios en este período"), "B sin servicios esta quincena");
    assert((await card("E2E Mani B").innerText()).includes("RD$ 5,000"), "aun sin servicios se paga su sueldo de la quincena");
  });

  await step("«Mes completo» suma las dos quincenas de sueldo (14,000) y toda la comisión", async () => {
    await page.getByRole("link", { name: "Mes completo", exact: true }).click();
    await page.waitForURL(/period=mes/);
    const t = await card("E2E Mani A").innerText();
    // 15 % de (1,050 + 800 + 200) = 307.50 ; 14,000 + 307.50
    for (const x of ["Sueldo del mes", "RD$ 14,000", "RD$ 307.50", "RD$ 14,307.50", "Total a pagar del mes"]) assert(t.includes(x), `el mes completo de A debe mostrar «${x}»`);
    await expectVisible(page.getByText("enero de 2020 (mes completo)", { exact: true }), "período mostrado");
  });

  await step("Anterior y siguiente van de quincena en quincena; «Quincena de hoy» vuelve; el futuro no se ofrece", async () => {
    await page.goto(`${BASE}/admin/manicurists?${Q1}`);
    await page.getByRole("link", { name: /Ver 2\.ª quincena de diciembre de 2019/ }).click();
    await page.waitForURL(/month=2019-12&period=q2/);
    await expectVisible(card("E2E Mani A").getByText("Sin servicios en este período"), "quincena sin servicios");
    await page.goto(`${BASE}/admin/manicurists?${Q2}`);
    await page.getByRole("link", { name: /Ver 1\.ª quincena de febrero de 2020/ }).click();
    await page.waitForURL(/month=2020-02&period=q1/);
    await page.getByRole("link", { name: "Quincena de hoy" }).click();
    await page.waitForURL((u) => !u.search.includes("2020") && !u.search.includes("2019"));
    const day = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }).slice(8, 10));
    assert((await page.getByRole("link", { name: "Siguiente →" }).count()) === 0, "en la quincena actual no hay flecha al futuro");
    await expectVisible(page.getByText(day <= 15 ? /1\.ª quincena de .* \(del 1 al 15\)/ : /2\.ª quincena de .* \(del 16 al \d+\)/).first(), "la quincena de hoy");
  });

  section("Las manicuristas reales");
  await step("Las manicuristas reales (las que están en la base) aparecen con su sueldo por quincena y su porcentaje", async () => {
    // Se leen de la base (el dueño puede cambiarles el nombre, el número, el sueldo o el porcentaje): la pantalla debe mostrar exactamente eso
    const real = await q(`select full_name, employee_number n, base_salary::float s, commission_pct::float p from employees where active and specialty ilike '%manicur%' and full_name not like 'E2E%'`);
    assert(real.length > 0, "debe haber al menos una manicurista real");
    const money = (v) => "RD$ " + v.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
    await page.goto(`${BASE}/admin/manicurists`);
    for (const e of real) {
      const c = card(e.full_name);
      await expectVisible(c, `tarjeta de ${e.full_name}`);
      const t = await c.innerText();
      assert(t.includes(`Sueldo fijo ${money(e.s)} por quincena (${money(e.s * 2)} al mes)`), `${e.full_name}: sueldo por quincena (${t.slice(0, 220).replace(/\s+/g, " ")})`);
      if (e.p != null) assert(t.includes(`gana el ${e.p}%`), `${e.full_name}: porcentaje ${e.p}%`);
      assert(t.includes("Sueldo de la quincena") && t.includes(`${money(e.s)} de sueldo +`), `${e.full_name}: el total de la quincena parte de su sueldo`);
      if (e.n != null) assert(t.includes(`${String(e.n).padStart(2, "0")} · ${e.full_name}`), `${e.full_name}: lleva su número`);
    }
  });

  section("Exportar");
  await step("Excel, PDF y CSV de la quincena traen el resumen y los servicios con su comisión", async () => {
    const get = async (f) => { const r = await page.request.get(`${BASE}/admin/manicurists/export?${Q1}&format=${f}`); assert(r.ok(), `${f}: HTTP ${r.status()}`); return r; };
    const x = await get("xlsx"), p = await get("pdf"), c = await get("csv");
    assert((await p.body()).subarray(0, 4).toString() === "%PDF", "el PDF empieza con %PDF");
    assert(/glow-manicuristas-2020-01-q1/.test(x.headers()["content-disposition"] ?? ""), "el nombre del archivo lleva la quincena");
    const csv = await c.text();
    assert(csv.includes("E2E Mani A") && csv.includes("Manicure E2E") && csv.includes("Laura E2E") && csv.includes("Sueldo de la quincena"), "el CSV trae manicurista, servicio, cliente y el sueldo de la quincena");
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await x.body());
    const names = wb.worksheets.map((w) => w.name);
    for (const n of ["Resumen", "Por manicurista", "Servicios"]) assert(names.includes(n), `falta la hoja «${n}» (hay ${names.join(", ")})`);
    const people = JSON.stringify(wb.getWorksheet("Por manicurista").getSheetValues());
    assert(people.includes("7157.5") && people.includes("5300") && people.includes("Sueldo de la quincena"), "la hoja «Por manicurista» trae el sueldo de la quincena y los totales a pagar");
    const rows = JSON.stringify(wb.getWorksheet("Servicios").getSheetValues());
    assert(rows.includes("Builder E2E") && rows.includes("Sin cobrar"), "la hoja «Servicios» incluye lo sin cobrar marcado");
    const whole = await page.request.get(`${BASE}/admin/manicurists/export?${WHOLE}&format=csv`);
    assert((await whole.text()).includes("Sueldo del mes"), "el mes completo habla de «Sueldo del mes»");
    assert((await page.request.get(`${BASE}/admin/manicurists/export?month=2020-13&format=csv`)).status() === 400, "un mes inválido se rechaza");
    assert((await page.request.get(`${BASE}/admin/manicurists/export?${Q1.replace("q1", "q9")}&format=csv`)).status() === 400, "una quincena inválida se rechaza");
  });

  section("Accesibilidad y celular");
  await step("La pantalla no tiene violaciones de accesibilidad (quincena con datos y quincena actual)", async () => {
    await page.goto(`${BASE}/admin/manicurists?${Q1}&pending=1`);
    await expectVisible(card("E2E Mani A"), "tarjeta");
    let v = await axeViolations(page);
    assert(v.length === 0, "quincena con datos: " + v.join(" || "));
    await page.goto(`${BASE}/admin/manicurists`);
    v = await axeViolations(page);
    assert(v.length === 0, "quincena actual: " + v.join(" || "));
  });

  await step("Celular: la tabla no se sale de la pantalla", async () => {
    const m = await launch({ mobile: true }); setPage(m.page);
    try {
      await login(m.page, "tmp-manager@glow.test");
      await m.page.goto(`${BASE}/admin/manicurists?${Q1}`);
      await expectVisible(m.page.getByText("Manicure E2E"), "servicio en el celular");
      const over = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(over <= 1, `la pantalla se desborda ${over} px`);
      await m.page.screenshot({ path: `${OUT}/manicuristas-movil.png`, fullPage: true });
    } finally { await m.browser.close(); setPage(page); }
  });

  await step("La ficha explica cómo aparecer aquí, qué es la comisión y el sueldo por pago", async () => {
    await page.goto(`${BASE}/admin/staff/${A}`);
    await expectVisible(page.getByText(/Si dice «Manicurista», aparece en el apartado Manicuristas/), "ayuda de Especialidad");
    await expectVisible(page.getByText(/una manicurista que gana el 15 % escribe 15/), "ayuda de Comisión");
    await expectVisible(page.getByText(/si cobra por quincena, el de una quincena, por ejemplo 7,000/), "ayuda del sueldo por pago");
  });
} finally {
  await cleanup().catch((e) => console.error("limpieza:", e.message));
  await db.end().catch(() => {});
  await browser.close();
}
process.exit(summary(errors) ? 1 : 0);
