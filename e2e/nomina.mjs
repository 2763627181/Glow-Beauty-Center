import { mkdirSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import pg from "pg";
import { BASE, OUT, assert, axeViolations, expectVisible, launch, login, section, setPage, step, summary } from "./h.mjs";

/* Nómina de pago de punta a punta: crear, ajustar, recalcular, pagar, exportar, reabrir, eliminar, permisos y celular.
   Seguro para la base real: usa especialistas «E2E Nom …», ventas «E2E-N-…» de enero de 2020 y borra todo al terminar
   (incluidas las filas de auditoría de esta prueba, por id). Las nóminas de prueba incluyen a las especialistas reales con
   montos en cero y se eliminan al final. */
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;
const DIR = `${OUT}/nomina`;
mkdirSync(DIR, { recursive: true });
const { browser, page, errors } = await launch();
setPage(page);
const dialog = () => page.getByRole("dialog");
const toast = (t) => page.getByText(t, { exact: false }).first();
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
const P1 = ["2020-01-01", "2020-01-15"];
const money2 = (n) => Math.round(n * 100) / 100;
const type = async (loc, text) => { await loc.click(); await loc.press("Control+a"); await loc.pressSequentially(text, { delay: 25 }); };

async function cleanup() {
  const runs = await q(`select id from payroll_runs where title like 'E2E%' or (period_start >= '2020-01-01' and period_end <= '2020-03-01')`);
  const lines = runs.length ? await q(`select id from payroll_lines where run_id = any($1)`, [runs.map((r) => r.id)]) : [];
  const sales = await q(`select id from sales where sale_number like 'E2E-N-%'`);
  const emps = await q(`select id from employees where full_name like 'E2E Nom%'`);
  const ids = [...runs, ...lines, ...sales, ...emps].map((r) => r.id);
  await q(`update payroll_runs set status='borrador', paid_on=null, paid_method=null, paid_reference=null, paid_by=null where id = any($1)`, [runs.map((r) => r.id)]);
  await q(`delete from payroll_runs where id = any($1)`, [runs.map((r) => r.id)]);
  await q(`delete from sales where sale_number like 'E2E-N-%'`);
  await q(`delete from employees where full_name like 'E2E Nom%'`);
  if (ids.length) await q(`delete from audit_logs where entity_id = any($1::uuid[])`, [ids]);
}
await cleanup();

// Datos: dos especialistas con comisión y ventas del 1 al 15 de enero de 2020
const mkEmp = async (name, pct, base) => (await q(`insert into employees (full_name, active, accepts_online_booking, commission_pct, base_salary) values ($1,true,false,$2,$3) returning id`, [name, pct, base]))[0].id;
const A = await mkEmp("E2E Nom A", 40, 3000);
const B = await mkEmp("E2E Nom B", 50, 0);
const sale = async (n, status, at, tip, items) => {
  const total = items.reduce((t, i) => t + i.total, 0) + tip;
  const [s] = await q(`insert into sales (sale_number, subtotal, total, tip, payment_status, completed_at, employee_id) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [`E2E-N-${n}`, total - tip, total, tip, status, `${at}T15:00:00Z`, items[0].emp]);
  for (const i of items) await q(`insert into sale_items (sale_id, description, quantity, unit_price, total, employee_id, commission_pct) values ($1,$2,1,$3,$3,$4,$5)`, [s.id, i.desc, i.total, i.emp, i.pct ?? null]);
};
await sale(1, "pagado", "2020-01-03", 150, [{ emp: A, desc: "Tinte E2E", total: 1000 }, { emp: B, desc: "Peinado E2E", total: 500, pct: 60 }]);
await sale(2, "pagado", "2020-01-04", 0, [{ emp: B, desc: "Corte E2E", total: 800 }]);
await sale(3, "reembolsado", "2020-01-05", 0, [{ emp: A, desc: "Reembolsado E2E", total: 9999 }]);
await sale(4, "pendiente", "2020-01-05", 0, [{ emp: A, desc: "Pendiente E2E", total: 2000 }]);

let runId = null;
const line = async (emp) => (await q(`select * from payroll_lines where run_id=$1 and employee_id=$2`, [runId, emp]))[0];
const num = (v) => Number(v);

try {
  section("Permisos");
  await step("Recepción no entra a Nómina (la manda a «acceso denegado»)", async () => {
    const r = await launch(); setPage(r.page);
    try {
      await login(r.page, "tmp-recep@glow.test");
      await r.page.goto(BASE + "/admin/payroll");
      await r.page.waitForURL((u) => u.pathname === "/admin/forbidden", { timeout: 10000 });
      assert(!(await r.page.locator('nav[aria-label="Panel"]').getByText("Nómina").count()), "el menú de recepción no debe mostrar Nómina");
    } finally { await r.browser.close(); setPage(page); }
  });

  await step("Especialista tampoco; gerente sí entra y ve Nómina en el menú", async () => {
    const r = await launch(); setPage(r.page);
    try {
      await login(r.page, "tmp-spec@glow.test");
      await r.page.goto(BASE + "/admin/payroll");
      await r.page.waitForURL((u) => u.pathname === "/admin/forbidden" || u.pathname === "/admin/calendar", { timeout: 10000 });
      assert(!r.page.url().endsWith("/admin/payroll"), "el especialista no debe ver la nómina");
    } finally { await r.browser.close(); }
    const m = await launch(); setPage(m.page);
    try {
      await login(m.page, "tmp-manager@glow.test");
      await m.page.goto(BASE + "/admin/payroll");
      await expectVisible(m.page.getByRole("heading", { name: "Nómina", exact: true }), "pantalla de nómina para el gerente");
      await expectVisible(m.page.locator('nav[aria-label="Panel"]').getByText("Nómina"), "opción en el menú");
    } finally { await m.browser.close(); setPage(page); }
  });

  section("Crear la nómina");
  await login(page, "tmp-admin@glow.test");
  await step("Nueva nómina: períodos sugeridos, nombre automático y cálculo con las ventas del período", async () => {
    await page.goto(BASE + "/admin/payroll");
    await page.getByRole("button", { name: "+ Nueva nómina" }).click();
    await expectVisible(dialog(), "formulario");
    const opts = await page.locator("#pr-period option").allTextContents();
    assert(opts.length === 5 && /Quincena anterior/.test(opts[0]) && /Otro período/.test(opts[4]), "opciones: " + opts.join(" | "));
    await page.locator("#pr-period").selectOption("custom");
    await page.locator("#pr-from").fill(P1[0]); await page.locator("#pr-to").fill(P1[1]);
    assert((await page.locator("#pr-title").inputValue()) === "Quincena 1–15 de enero 2020", "nombre sugerido: " + (await page.locator("#pr-title").inputValue()));
    await type(page.locator("#pr-title"), "E2E Quincena");
    await dialog().getByRole("button", { name: "Crear nómina" }).click();
    await page.waitForURL((u) => /\/admin\/payroll\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 20000 });
    runId = page.url().split("/").pop();
    const a = await line(A), b = await line(B);
    assert(a.services_count === 1 && num(a.sales_total) === 1000 && num(a.commission) === 400 && num(a.tips) === 100 && num(a.base_salary) === 3000 && num(a.net) === 3500, "A: " + JSON.stringify(a));
    assert(b.services_count === 2 && num(b.sales_total) === 1300 && num(b.commission) === 700 && num(b.tips) === 50 && num(b.base_salary) === 0 && num(b.net) === 750, "B: " + JSON.stringify(b));
    const [r] = await q(`select status, only_paid, include_tips from payroll_runs where id=$1`, [runId]);
    assert(r.status === "borrador" && r.only_paid && r.include_tips, JSON.stringify(r));
    await expectVisible(page.getByRole("heading", { name: "E2E Quincena" }), "título");
    await expectVisible(page.getByText("Borrador."), "aviso de borrador");
    for (const n of ["E2E Nom A", "E2E Nom B", "Santa Antigua"]) await expectVisible(page.getByRole("cell", { name: n }), `fila de ${n}`);
  });
  await step("La reembolsada y la pendiente NO cuentan; el detalle muestra las ventas que originan la comisión", async () => {
    await page.getByRole("button", { name: "Editar E2E Nom B" }).click();
    await expectVisible(dialog().getByText("Ventas que originan la comisión (2)"), "detalle de B");
    await expectVisible(dialog().getByText("Peinado E2E"), "venta de B"); await expectVisible(dialog().getByText("60%"), "porcentaje propio de la línea");
    await page.keyboard.press("Escape");
    const detailA = (await line(A)).detail;
    assert(detailA.length === 1 && detailA[0].description === "Tinte E2E", JSON.stringify(detailA));
  });

  section("Ajustar y recalcular");
  await step("Editar un volante escribiendo como una persona: bonos, descuentos y nota; el neto se ve en vivo", async () => {
    await page.getByRole("button", { name: "Editar E2E Nom A" }).click();
    await type(dialog().getByLabel("Bonos (RD$)"), "500");
    await type(dialog().getByLabel("Descuentos (RD$)"), "200");
    await type(dialog().getByLabel(/Nota/), "Adelanto del 5");
    await expectVisible(dialog().getByText(/Neto a pagar:.*3,800/), "neto en vivo = 3000 + 400 + 100 + 500 − 200");
    await dialog().getByRole("button", { name: "Guardar" }).click();
    await expectVisible(toast("Volante guardado"), "toast", 10000);
    const a = await line(A);
    assert(num(a.bonus) === 500 && num(a.deductions) === 200 && num(a.net) === 3800 && a.notes === "Adelanto del 5", JSON.stringify(a));
  });
  await step("Descuentos mayores a lo que le corresponde: avisa y no deja guardar", async () => {
    await page.getByRole("button", { name: "Editar E2E Nom B" }).click();
    await type(dialog().getByLabel("Descuentos (RD$)"), "99999");
    await expectVisible(dialog().getByText("Los descuentos superan lo que le corresponde."), "aviso");
    assert(await dialog().getByRole("button", { name: "Guardar" }).isDisabled(), "Guardar debe estar deshabilitado");
    await page.keyboard.press("Escape");
  });
  await step("Recalcular: toma una venta nueva y conserva sueldo base, bonos, descuentos y nota", async () => {
    await sale(5, "pagado", "2020-01-06", 0, [{ emp: A, desc: "Venta nueva E2E", total: 800 }]);
    await page.getByRole("button", { name: "Recalcular desde ventas" }).click();
    await dialog().getByRole("button", { name: "Recalcular" }).click();
    await expectVisible(toast("Nómina recalculada"), "toast", 10000);
    const a = await line(A);
    assert(num(a.sales_total) === 1800 && num(a.commission) === 720 && num(a.bonus) === 500 && num(a.deductions) === 200 && num(a.base_salary) === 3000 && a.notes === "Adelanto del 5" && num(a.net) === 4120, JSON.stringify(a));
  });
  await step("Quitar y volver a agregar a una especialista", async () => {
    await page.getByRole("button", { name: "Quitar a E2E Nom B" }).click();
    await dialog().getByRole("button", { name: "Quitar" }).click();
    await expectVisible(toast("Volante quitado"), "toast", 10000);
    assert(!(await line(B)), "B ya no debe estar");
    await page.locator("#pr-add").selectOption({ label: "E2E Nom B" });
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await expectVisible(toast("Especialista agregada"), "toast", 10000);
    const b = await line(B);
    assert(b && num(b.commission) === 700 && num(b.tips) === 50, JSON.stringify(b));
  });
  await step("El campo «Sueldo base» de la ficha de la especialista se guarda", async () => {
    await page.goto(`${BASE}/admin/staff/${A}`);
    assert((await page.locator("#e-base").inputValue()) === "3000", "valor inicial " + (await page.locator("#e-base").inputValue()));
    await type(page.locator("#e-base"), "3500");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expectVisible(toast("Especialista guardado"), "toast", 10000);
    assert(num((await q(`select base_salary from employees where id=$1`, [A]))[0].base_salary) === 3500, "sueldo guardado");
    await q(`update employees set base_salary=3000 where id=$1`, [A]);
  });

  section("Pagar, congelar y exportar");
  await step("Marcar como pagada: pide fecha, forma de pago y referencia; la nómina queda congelada", async () => {
    await page.goto(`${BASE}/admin/payroll/${runId}`);
    await page.getByRole("button", { name: "Marcar como pagada" }).click();
    assert((await page.locator("#pp-date").inputValue()) === today, "fecha por defecto = hoy");
    await page.locator("#pp-method").selectOption("Transferencia");
    await type(page.locator("#pp-ref"), "E2E-REF-1");
    await dialog().getByRole("button", { name: "Confirmar pago" }).click();
    await expectVisible(toast("Nómina marcada como pagada"), "toast", 10000);
    const [r] = await q(`select status, paid_on::text d, paid_method, paid_reference from payroll_runs where id=$1`, [runId]);
    assert(r.status === "pagada" && r.d === today && r.paid_method === "Transferencia" && r.paid_reference === "E2E-REF-1", JSON.stringify(r));
    await expectVisible(page.getByText(/Pagada el/), "aviso de pagada"); await expectVisible(page.getByRole("button", { name: "Reabrir para corregir" }), "botón reabrir");
    assert((await page.getByRole("button", { name: "Marcar como pagada" }).count()) === 0, "ya no se puede volver a pagar");
    assert((await page.getByRole("button", { name: "Recalcular desde ventas" }).count()) === 0, "ya no se recalcula");
  });
  await step("Congelada de verdad: ni la pantalla ni la base de datos dejan modificarla", async () => {
    await page.getByRole("button", { name: "Detalle de E2E Nom A" }).click();
    assert(await dialog().getByLabel("Bonos (RD$)").isDisabled(), "campos deshabilitados");
    assert((await dialog().getByRole("button", { name: "Guardar" }).count()) === 0, "sin botón Guardar");
    await page.keyboard.press("Escape");
    let blocked = false;
    try { await q(`update payroll_lines set bonus=1 where run_id=$1`, [runId]); } catch (e) { blocked = /payroll_paid/.test(e.message); }
    assert(blocked, "la base de datos debe rechazar el cambio");
    // una venta posterior (o un reembolso) ya no altera lo pagado
    await sale(6, "pagado", "2020-01-07", 0, [{ emp: A, desc: "Tarde E2E", total: 5000 }]);
    await page.reload(); await page.waitForLoadState("networkidle");
    assert(num((await line(A)).sales_total) === 1800, "lo pagado no cambia");
  });
  const files = [
    ["nómina xlsx", `/admin/payroll/${"ID"}/export?format=xlsx`, "xlsx", /^glow-nomina-2020-01-01_2020-01-15\.xlsx$/],
    ["nómina pdf", `/admin/payroll/${"ID"}/export?format=pdf`, "pdf", /^glow-nomina-2020-01-01_2020-01-15\.pdf$/],
    ["nómina csv", `/admin/payroll/${"ID"}/export?format=csv`, "csv", /^glow-nomina-2020-01-01_2020-01-15\.csv$/],
    ["volante pdf", `/admin/payroll/${"ID"}/export?employee=${"EMP"}&format=pdf`, "pdf", /^glow-volante-e2e-nom-a-2020-01-01_2020-01-15\.pdf$/],
    ["volante xlsx", `/admin/payroll/${"ID"}/export?employee=${"EMP"}&format=xlsx`, "xlsx", /^glow-volante-e2e-nom-a-.*\.xlsx$/],
  ];
  const MIME = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf", csv: "text/csv" };
  for (const [name, path, ext, re] of files) {
    await step(`Descarga: ${name}`, async () => {
      const res = await page.request.get(BASE + path.replace("ID", runId).replace("EMP", A));
      assert(res.status() === 200, "estado " + res.status());
      assert((res.headers()["content-type"] ?? "").startsWith(MIME[ext]), "tipo " + res.headers()["content-type"]);
      const fn = /filename="([^"]+)"/.exec(res.headers()["content-disposition"] ?? "")?.[1] ?? "";
      assert(re.test(fn), "nombre: " + fn);
      const body = await res.body();
      writeFileSync(`${DIR}/${fn}`, body);
      if (ext === "pdf") assert(body.subarray(0, 5).toString() === "%PDF-" && body.length > 3000, "PDF inválido");
      if (ext === "csv") assert(body.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && /E2E Nom A/.test(body.toString("utf8")), "CSV sin BOM o sin datos");
      if (ext === "xlsx") {
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(body);
        const names = wb.worksheets.map((w) => w.name);
        if (name === "nómina xlsx") {
          assert(["Resumen", "Nómina", "Detalle de ventas"].every((n) => names.includes(n)), "hojas: " + names.join(" | "));
          const ws = wb.getWorksheet("Nómina");
          let rowA = null; ws.eachRow((r) => { if (r.getCell(1).value === "E2E Nom A") rowA = r; });
          assert(rowA, "fila de E2E Nom A");
          const v = (c) => { const x = rowA.getCell(c).value; return typeof x === "object" && x && "result" in x ? x.result : x; };
          assert(v(2) === 2 && v(3) === 1800 && v(4) === 720 && v(5) === 100 && v(6) === 3000 && v(7) === 500 && v(8) === 200, `valores: ${[2, 3, 4, 5, 6, 7, 8].map(v).join(",")}`);
          assert(rowA.getCell(9).value && (rowA.getCell(9).value.formula || rowA.getCell(9).value === 4120), "el neto debe ser fórmula o 4120");
        } else {
          assert(names.includes("Resumen") && names.includes("Servicios"), "hojas del volante: " + names.join(" | "));
          let seen = false; wb.getWorksheet("Servicios").eachRow((r) => { if (String(r.getCell(3).value ?? "").includes("Tinte E2E")) seen = true; });
          assert(seen, "el volante lista las ventas del período");
        }
      }
    });
  }
  await step("Descarga: volante de alguien que no está en la nómina, un id inválido y recepción → 404 / 404 / 403", async () => {
    assert((await page.request.get(`${BASE}/admin/payroll/${runId}/export?employee=${(await q(`select id from employees where full_name='Santa Antigua'`))[0].id.replace(/^./, "0")}&format=pdf`)).status() === 404, "empleada ajena");
    assert((await page.request.get(`${BASE}/admin/payroll/no-es-un-id/export?format=pdf`)).status() === 404, "id inválido");
    const r = await launch();
    try { await login(r.page, "tmp-recep@glow.test"); assert((await r.page.request.get(`${BASE}/admin/payroll/${runId}/export?format=pdf`)).status() === 403, "recepción debe recibir 403"); }
    finally { await r.browser.close(); }
    assert((await (await browser.newContext()).request.get(`${BASE}/admin/payroll/${runId}/export?format=pdf`, { maxRedirects: 0 })).status() !== 200, "sin sesión no se descarga");
  });
  await step("Botón «Exportar» de la pantalla descarga el Excel", async () => {
    await page.goto(`${BASE}/admin/payroll/${runId}`);
    await page.getByRole("button", { name: /^Exportar/ }).click();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByRole("button", { name: /^Excel/ }).first().click()]);
    assert(/^glow-nomina-2020-01-01_2020-01-15\.xlsx$/.test(dl.suggestedFilename()), "nombre: " + dl.suggestedFilename());
    await expectVisible(page.getByText("Archivo descargado"), "aviso de descarga");
  });

  await step("Accesibilidad (axe): lista, detalle, formulario de nueva nómina, volante y pago sin violaciones", async () => {
    const found = [];
    const scan = async (label) => { const v = await axeViolations(page); if (v.length) found.push(`${label}: ${v.join(" | ")}`); };
    await page.goto(BASE + "/admin/payroll"); await scan("lista");
    await page.getByRole("button", { name: "+ Nueva nómina" }).click(); await scan("nueva nómina"); await page.keyboard.press("Escape");
    await page.goto(`${BASE}/admin/payroll/${runId}`); await scan("detalle pagada");
    await page.getByRole("button", { name: "Detalle de E2E Nom A" }).click(); await scan("volante (solo lectura)"); await page.keyboard.press("Escape");
    assert(found.length === 0, found.join(" ¦ "));
  });

  section("Reabrir, proteger y eliminar");
  await step("Reabrir: vuelve a borrador y se puede corregir", async () => {
    await page.getByRole("button", { name: "Reabrir para corregir" }).click();
    await dialog().getByRole("button", { name: "Reabrir" }).click();
    await expectVisible(toast("Nómina reabierta"), "toast", 10000);
    const [r] = await q(`select status, paid_on from payroll_runs where id=$1`, [runId]);
    assert(r.status === "borrador" && r.paid_on === null, JSON.stringify(r));
    await expectVisible(page.getByRole("button", { name: "Marcar como pagada" }), "puede volver a pagarse");
  });
  await step("No se puede pagar dos veces el mismo día: una segunda nómina que se cruza se rechaza con un mensaje claro", async () => {
    await page.goto(BASE + "/admin/payroll");
    await page.getByRole("button", { name: "+ Nueva nómina" }).click();
    await page.locator("#pr-period").selectOption("custom");
    await page.locator("#pr-from").fill("2020-01-10"); await page.locator("#pr-to").fill("2020-01-20");
    await type(page.locator("#pr-title"), "E2E Cruzada");
    await dialog().getByRole("button", { name: "Crear nómina" }).click();
    await expectVisible(dialog().getByText(/ya está en otra nómina que cubre esas fechas \(NOM-\d{4} «E2E Quincena»\)/), "mensaje de cruce", 15000);
    assert((await q(`select count(*)::int c from payroll_runs where title='E2E Cruzada'`))[0].c === 0, "no debe quedar a medias");
    await page.keyboard.press("Escape");
  });
  await step("Fechas inválidas: el formulario lo explica (final antes del inicio, futuro)", async () => {
    await page.reload(); await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "+ Nueva nómina" }).click();
    await page.locator("#pr-period").selectOption("custom");
    await page.locator("#pr-from").fill("2020-02-10"); await page.locator("#pr-to").fill("2020-02-01");
    await dialog().getByRole("button", { name: "Crear nómina" }).click();
    await expectVisible(dialog().getByText("La fecha final debe ser igual o posterior a la inicial."), "mensaje de fechas");
    await page.keyboard.press("Escape");
  });
  await step("Accesibilidad (axe) en borrador: edición de volante y ventana de pago", async () => {
    const found = [];
    const scan = async (label) => { const v = await axeViolations(page); if (v.length) found.push(`${label}: ${v.join(" | ")}`); };
    await page.goto(`${BASE}/admin/payroll/${runId}`); await scan("detalle borrador");
    await page.getByRole("button", { name: "Editar E2E Nom A" }).click(); await scan("editar volante"); await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Marcar como pagada" }).click(); await scan("marcar como pagada"); await page.keyboard.press("Escape");
    assert(found.length === 0, found.join(" ¦ "));
  });
  await step("La lista muestra la nómina, su estado y el total", async () => {
    await page.goto(BASE + "/admin/payroll");
    const row = page.getByRole("row", { name: /E2E Quincena/ });
    await expectVisible(row.getByText("Borrador"), "estado"); await expectVisible(row.getByText(/1–15 de enero de 2020/), "período");
  });
  await step("En el celular: la nómina se lee sin desbordar la pantalla", async () => {
    const m = await launch({ mobile: true });
    try {
      await login(m.page, "tmp-admin@glow.test");
      await m.page.goto(`${BASE}/admin/payroll/${runId}`);
      await expectVisible(m.page.getByRole("heading", { name: "E2E Quincena" }), "título");
      const over = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(over <= 1, `desborda ${over}px a lo ancho`);
      await m.page.screenshot({ path: `${DIR}/movil.png`, fullPage: true });
      await m.page.goto(BASE + "/admin/payroll");
      assert((await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, "la lista desborda");
    } finally { await m.browser.close(); }
  });
  await step("Eliminar el borrador: se va con sus volantes y vuelve a la lista", async () => {
    await page.goto(`${BASE}/admin/payroll/${runId}`);
    await page.getByRole("button", { name: "Eliminar nómina" }).click();
    await dialog().getByRole("button", { name: "Eliminar" }).click();
    await page.waitForURL((u) => u.pathname === "/admin/payroll", { timeout: 10000 });
    assert((await q(`select count(*)::int c from payroll_runs where id=$1`, [runId]))[0].c === 0 && (await q(`select count(*)::int c from payroll_lines where run_id=$1`, [runId]))[0].c === 0, "debe borrarse todo");
  });
  await step("Una nómina sin ventas sale en cero y se puede crear de nuevo para el mismo período", async () => {
    await page.getByRole("button", { name: "+ Nueva nómina" }).click();
    await page.locator("#pr-period").selectOption("custom");
    await page.locator("#pr-from").fill("2020-02-01"); await page.locator("#pr-to").fill("2020-02-15");
    await dialog().getByRole("button", { name: "Crear nómina" }).click();
    await page.waitForURL((u) => /\/admin\/payroll\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 20000 });
    const id = page.url().split("/").pop();
    const [t] = await q(`select count(*)::int n, coalesce(sum(commission),0)::float c, coalesce(sum(base_salary),0)::float b from payroll_lines where run_id=$1`, [id]);
    assert(t.n >= 2 && t.c === 0 && money2(t.b) === 3000, JSON.stringify(t)); // E2E Nom A (3000) + el resto en cero
  });
} finally {
  await cleanup();
}

const code = summary(errors);
await browser.close();
await db.end();
process.exit(code);
