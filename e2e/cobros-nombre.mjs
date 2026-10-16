import ExcelJS from "exceljs";
import pg from "pg";
import { BASE, OUT, assert, axeViolations, expectVisible, launch, login, section, setPage, step, summary } from "./h.mjs";

/* Nombre del cliente en la venta de mostrador (factura, lista de ventas, buscador y movimientos de la caja) y TOTAL cobrado contando
   transferencias y tarjeta (pantalla de la caja, cierre de caja y cierre ya hecho). Seguro para la base real: cobra solo con TRANSFERENCIA
   (no toca el efectivo de la caja real), usa notas «E2E nombre…», no cierra ninguna caja y, para ver un cierre ya hecho, inserta por un
   momento un turno cerrado de marzo de 2020 que se borra al terminar. Borra todo, incluido su rastro en Auditoría. */
const connect = async () => {
  for (let i = 1; ; i++) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
    try { await c.connect(); return c; } catch (e) { try { await c.end(); } catch { /* ya cerrado */ } if (i >= 20) throw e; await new Promise((r) => setTimeout(r, 4000)); }
  }
};
const db = await connect();
const q = async (s, p) => (await db.query(s, p)).rows;
if (!(await q(`select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='customer_name'`)).length) {
  console.error("Falta instalar la migración 20261014000020_nombre_cliente_venta.sql en la base: esta prueba no puede correr todavía.");
  await db.end(); process.exit(1);
}
const { browser, page, errors } = await launch();
setPage(page);
const dialog = () => page.getByRole("dialog");
const type = async (loc, text) => { await loc.click(); await loc.press("Control+a"); await loc.pressSequentially(String(text), { delay: 25 }); };
const NOTE = "E2E nombre";
const NAME = "E2E María Pérez";
const kpi = (label) => page.locator(`div:has(> span:text-is("${label}"))`).first();
const kpiNum = async (label) => Number((await kpi(label).locator("strong").first().innerText()).replace(/[^0-9.]/g, ""));
let injected = null;

async function cleanup() {
  if (injected) { await q(`delete from cash_sessions where id=$1`, [injected]).catch(() => {}); injected = null; }
  await q(`delete from cash_sessions where opening_note = 'E2E nombre cierre'`);
  const sales = await q(`select id from sales where notes like $1`, [`${NOTE}%`]);
  const pays = sales.length ? await q(`select id from payments where sale_id = any($1)`, [sales.map((s) => s.id)]) : [];
  const ids = [...sales, ...pays].map((r) => r.id);
  if (pays.length) await q(`delete from payments where id = any($1)`, [pays.map((p) => p.id)]);
  if (sales.length) await q(`delete from sales where id = any($1)`, [sales.map((s) => s.id)]);
  if (ids.length) await q(`delete from audit_logs where entity_id = any($1::uuid[])`, [ids]);
}
await cleanup();

try {
  await login(page, "tmp-recep@glow.test");
  await page.goto(BASE + "/admin/cash");
  const open = (await q(`select id from cash_sessions where closed_at is null`)).length > 0;
  let totalBefore = 0, asideBefore = 0;

  section("Nombre del cliente en la venta");
  await step("La venta de mostrador pide el nombre del cliente (opcional) y lo explica", async () => {
    await page.getByRole("button", { name: "+ Nueva venta" }).click();
    await expectVisible(dialog(), "diálogo de nueva venta");
    await expectVisible(dialog().getByLabel("Nombre del cliente (opcional)"), "campo de nombre");
    await expectVisible(dialog().getByText("Sale en la factura y en la caja."), "explicación");
    await page.keyboard.press("Escape");
  });

  if (open) {
    await step("Antes de cobrar: se anota el total cobrado y lo cobrado por transferencia", async () => {
      await page.reload();
      totalBefore = await kpiNum("Total cobrado en el turno");
      asideBefore = await kpiNum("Transferencias y tarjeta");
      assert(totalBefore >= asideBefore, `el total (${totalBefore}) incluye lo cobrado aparte (${asideBefore})`);
    });
  }

  await step("Cobrar 1,700 por transferencia escribiendo el nombre: la factura lo muestra", async () => {
    await page.getByRole("button", { name: "+ Nueva venta" }).click();
    await type(dialog().locator("#qs-cn"), "E2E Servicio con nombre");
    await type(dialog().locator("#qs-cp"), 1700);
    await dialog().getByRole("button", { name: "Agregar", exact: true }).click();
    await type(dialog().locator("#qs-name"), NAME);
    await type(dialog().locator("#qs-n"), `${NOTE} 1`);
    await dialog().getByLabel("Método").first().selectOption("transferencia");
    await dialog().getByRole("button", { name: /Pagar todo/ }).click();
    await dialog().getByRole("button", { name: /^Registrar venta y cobrar RD\$ 1,700$/ }).click();
    await page.waitForURL(/\/admin\/sales\/[0-9a-f-]{36}$/, { timeout: 10000 });
    await expectVisible(page.getByText(`Cliente: ${NAME}`), "el nombre en la factura");
    const [s] = await q(`select customer_name n, client_id from sales where notes=$1`, [`${NOTE} 1`]);
    assert(s.n === NAME && s.client_id === null, JSON.stringify(s));
  });

  await step("La lista de ventas y el buscador encuentran la venta por el nombre", async () => {
    await page.goto(`${BASE}/admin/sales?q=${encodeURIComponent("E2E María")}`);
    const row = page.locator("tr", { hasText: NAME });
    await expectVisible(row, "la venta en la lista, buscada por nombre");
    await page.goto(BASE + "/admin");
    await page.locator("#gsearch").pressSequentially("E2E María", { delay: 30 });
    await expectVisible(page.locator("a", { hasText: NAME }), "la venta en el buscador global", 12000);
    await page.keyboard.press("Escape");
  });

  if (open) {
    section("Caja: movimientos y total con transferencias");
    await step("«Movimientos del turno» muestra «Factura GBC-… · nombre»", async () => {
      await page.goto(BASE + "/admin/cash");
      const row = page.getByRole("region", { name: "Tabla de movimientos del turno" }).locator("tr", { hasText: NAME });
      await expectVisible(row, "el cobro con el nombre del cliente");
      const t = await row.innerText();
      assert(/Factura GBC-\d{6}-\d{5}/.test(t) && t.includes(NAME) && t.includes("Transferencia") && t.includes("RD$ 1,700"), t.replace(/\s+/g, " "));
    });

    await step("El total cobrado del turno sube 1,700 y cuenta la transferencia (el efectivo de la gaveta no cambia)", async () => {
      const total = await kpiNum("Total cobrado en el turno"), aside = await kpiNum("Transferencias y tarjeta");
      assert(total === totalBefore + 1700, `total: ${totalBefore} → ${total}`);
      assert(aside === asideBefore + 1700, `aparte: ${asideBefore} → ${aside}`);
      const small = await kpi("Total cobrado en el turno").innerText();
      assert(small.includes("Transferencia"), `el desglose menciona la transferencia: ${small.replace(/\n/g, " ")}`);
    });

    await step("En «Cerrar caja» (sin cerrarla) se ve el total con transferencias y el efectivo que debe haber aparte", async () => {
      const total = await kpiNum("Total cobrado en el turno");
      await page.getByRole("button", { name: "Cerrar caja" }).click();
      const d = page.getByRole("dialog", { name: "Cerrar caja" });
      await expectVisible(d.getByText("Efectivo que debería haber"), "efectivo esperado");
      const box = await d.locator('div[aria-label="Total cobrado en el turno"]').innerText();
      assert(box.includes("Transferencia (cobrado aparte)") && box.includes("Total cobrado en el turno (todos los métodos)"), box.replace(/\n/g, " "));
      const shown = Number((await d.locator('div[aria-label="Total cobrado en el turno"] > div').last().innerText()).replace(/[^0-9.]/g, "").replace(/^0+/, "") || 0);
      assert(shown === total, `el total del cierre (${shown}) es el mismo de la pantalla (${total})`);
      assert((await d.innerText()).includes("solo cuenta el efectivo"), "explica que el cuadre es solo del efectivo");
      const v = await axeViolations(page);
      assert(v.length === 0, v.join(" || "));
      await page.keyboard.press("Escape");
      assert((await q(`select count(*)::int n from cash_sessions where closed_at is null`))[0].n === 1, "la caja sigue abierta");
    });
  }

  section("Cierre ya hecho: total con transferencias");
  await step("Un cierre guardado muestra efectivo, transferencia, tarjeta y el total de todos los métodos, también al exportar", async () => {
    const report = {
      totals: { opening: 1000, cash_in: 2000, cash_refunds: 0, entradas: 0, salidas: 0, expected: 3000 },
      methods: [
        { method: "efectivo", label: "Efectivo", is_cash: true, count: 1, total: 2000, refunded: 0 },
        { method: "transferencia", label: "Transferencia", is_cash: false, count: 1, total: 1700, refunded: 0 },
        { method: "tarjeta", label: "Tarjeta", is_cash: false, count: 2, total: 800, refunded: 100 },
      ],
      payments: [{ id: "00000000-0000-0000-0000-000000000001", paid_at: "2020-03-01T15:00:00Z", refunded_at: null, status: "pagado", method: "transferencia", label: "Transferencia", is_cash: false, amount: 1700, tendered: null, reference: "TR-1", sale_id: "00000000-0000-0000-0000-0000000000aa", sale_number: "GBC-202003-00001", appointment_id: null, client: "E2E Cliente Cierre", by: "E2E", paid_in_turn: true, refunded_in_turn: false }],
      movements: [], production: [], sales: { count: 3, total: 4500, tips: 0, discount: 0, pending: 0 },
    };
    const [s] = await q(`insert into cash_sessions (opened_at, opened_by, opening_amount, opening_note, closed_at, expected_cash, counted_cash, difference, report)
      values ('2020-03-01T14:00:00Z', null, 1000, 'E2E nombre cierre', '2020-03-01T23:00:00Z', 3000, 3000, 0, $1::jsonb) returning id`, [JSON.stringify(report)]);
    injected = s.id;
    try {
      await page.goto(`${BASE}/admin/cash/${s.id}`);
      await expectVisible(page.getByRole("heading", { name: "Total cobrado en el turno" }), "bloque de total cobrado");
      const t = await page.locator('section[aria-label="Total cobrado en el turno"]').innerText();
      for (const x of ["Efectivo cobrado", "RD$ 2,000", "Transferencia (cobrado aparte)", "RD$ 1,700", "Tarjeta (cobrado aparte)", "RD$ 700", "Total cobrado (todos los métodos)", "RD$ 4,400", "solo el efectivo"]) assert(t.includes(x), `falta «${x}» en: ${t.replace(/\n/g, " ")}`);
      const body = await page.locator("main").innerText();
      assert(body.includes("Factura GBC-202003-00001") && body.includes("E2E Cliente Cierre"), "la factura y el cliente salen en los movimientos del cierre");
      const v = await axeViolations(page);
      assert(v.length === 0, v.join(" || "));
      const csv = await (await page.request.get(`${BASE}/admin/cash/${s.id}/export?format=csv`)).text();
      assert(csv.includes("Total cobrado en el turno (todos los métodos)") && csv.includes("4400"), "el CSV trae el total cobrado");
      const x = await page.request.get(`${BASE}/admin/cash/${s.id}/export?format=xlsx`);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await x.body());
      const txt = JSON.stringify(wb.getWorksheet("Cuadre").getSheetValues());
      assert(txt.includes("Total cobrado en el turno (todos los métodos)") && txt.includes("4400") && txt.includes("Transferencia (cobrado aparte)"), "la hoja Cuadre trae el total y la transferencia");
      const cover = JSON.stringify(wb.getWorksheet("Resumen").getSheetValues());
      assert(cover.includes("Total cobrado (todos los métodos)"), "la portada del Excel trae el total cobrado");
      const p = await page.request.get(`${BASE}/admin/cash/${s.id}/export?format=pdf`);
      assert((await p.body()).subarray(0, 4).toString() === "%PDF", "el PDF se genera");
      await page.screenshot({ path: `${OUT}/cierre-total.png`, fullPage: true });
    } finally {
      await q(`delete from cash_sessions where id=$1`, [s.id]); injected = null;
    }
  });
} finally {
  await cleanup().catch((e) => console.error("limpieza:", e.message));
  await db.end().catch(() => {});
  await browser.close();
}
process.exit(summary(errors) ? 1 : 0);
