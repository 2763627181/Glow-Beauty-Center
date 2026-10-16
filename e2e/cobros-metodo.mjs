import pg from "pg";
import { BASE, assert, axeViolations, expectVisible, launch, login, section, setPage, step, summary } from "./h.mjs";

/* Corregir el método de un cobro (una tarjeta que se guardó como efectivo) y ver quién pagó cada cobro aparte en «Cobrado por método».
   Seguro para la base real: cobra solo con TRANSFERENCIA y la pasa a TARJETA (nunca mueve efectivo de la caja real: el paso a efectivo
   solo se mira en el aviso y se cancela), usa notas «E2E método…» y borra todo al terminar, incluido su rastro en Auditoría. */
const connect = async () => {
  for (let i = 1; ; i++) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
    try { await c.connect(); return c; } catch (e) { try { await c.end(); } catch { /* ya cerrado */ } if (i >= 20) throw e; await new Promise((r) => setTimeout(r, 4000)); }
  }
};
const db = await connect();
const q = async (s, p) => (await db.query(s, p)).rows;
if (!(await q(`select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'change_payment_method'`)).length) {
  console.error("Falta instalar la migración 20261015000021_corregir_metodo_pago.sql en la base: esta prueba no puede correr todavía.");
  await db.end(); process.exit(1);
}
const { browser, page, errors } = await launch();
setPage(page);
const dialog = () => page.getByRole("dialog");
const type = async (loc, text) => { await loc.click(); await loc.press("Control+a"); await loc.pressSequentially(String(text), { delay: 25 }); };
const NOTE = "E2E método";
const NAME = "E2E Rosa Prueba";
let saleUrl = "", efectivoAntes = "";
const efectivoEsperado = async () => (await page.locator('div:has(> span:text-is("Efectivo que debe haber"))').first().locator("strong").first().innerText()).replace(/[^0-9.]/g, "");
const quienPago = () => page.getByRole("group", { name: "Quién pagó cada cobro aparte" });
const filaQuien = (metodo) => quienPago().locator("div", { has: page.locator("p", { hasText: new RegExp(`^${metodo} · quién pagó`) }) }).filter({ hasText: NAME }).last();

async function cleanup() {
  const sales = await q(`select id from sales where notes like $1`, [`${NOTE}%`]);
  const pays = sales.length ? await q(`select id from payments where sale_id = any($1)`, [sales.map((s) => s.id)]) : [];
  const ids = [...sales, ...pays].map((r) => r.id);
  if (pays.length) await q(`delete from payments where id = any($1)`, [pays.map((p) => p.id)]);
  if (sales.length) await q(`delete from sales where id = any($1)`, [sales.map((s) => s.id)]);
  if (ids.length) await q(`delete from audit_logs where entity_id = any($1::uuid[])`, [ids]);
}
await cleanup();

try {
  await login(page, "tmp-manager@glow.test");
  await page.goto(BASE + "/admin/cash");
  const open = (await q(`select id from cash_sessions where closed_at is null`)).length > 0;

  section("Registrar un cobro por transferencia y corregirlo a tarjeta");
  await step("Una venta de mostrador cobrada por transferencia (como si fuera tarjeta mal registrada)", async () => {
    await page.getByRole("button", { name: "+ Nueva venta" }).click();
    await type(dialog().locator("#qs-cn"), "E2E Servicio mostrador");
    await type(dialog().locator("#qs-cp"), 700);
    await dialog().getByRole("button", { name: "Agregar", exact: true }).click();
    await type(dialog().locator("#qs-name"), NAME);
    await type(dialog().locator("#qs-n"), `${NOTE} 1`);
    await dialog().getByLabel("Método", { exact: true }).selectOption("transferencia");
    await dialog().getByRole("button", { name: /Pagar todo/ }).click();
    await dialog().getByRole("button", { name: /^Registrar venta y cobrar RD\$ 700$/ }).click();
    await page.waitForURL(/\/admin\/sales\/[0-9a-f-]{36}$/, { timeout: 10000 });
    saleUrl = page.url();
    await expectVisible(page.getByText(`Cliente: ${NAME}`), "el nombre en la factura");
  });

  if (open) {
    await step("Caja: «Cobrado por método» muestra el nombre de quien pagó por transferencia", async () => {
      await page.goto(BASE + "/admin/cash");
      efectivoAntes = await efectivoEsperado();
      const t = await filaQuien("Transferencia").innerText();
      assert(t.includes(NAME) && t.includes("RD$ 700"), `«Quién pagó» no lista el nombre bajo Transferencia: ${t.replace(/\s+/g, " ")}`);
    });
  }

  await step("En la factura, el gerente ve «Cambiar método» y lo pasa a Tarjeta con un motivo", async () => {
    await page.goto(saleUrl);
    await page.getByRole("button", { name: /Cambiar el método del pago de RD\$ 700/ }).click();
    const d = page.getByRole("dialog", { name: "Cambiar método de pago" });
    await expectVisible(d, "ventana de cambio de método");
    assert((await d.innerText()).includes(NAME) && (await d.innerText()).includes("Transferencia"), "la ventana dice de quién es y cómo estaba");
    const v = await axeViolations(page);
    assert(v.length === 0, v.join(" || "));
    await d.getByLabel("¿Con qué método se pagó en realidad?").selectOption("tarjeta");
    await type(d.getByLabel("Motivo (opcional)"), "E2E fue con tarjeta");
    await d.getByRole("button", { name: "Cambiar método" }).click();
    await expectVisible(page.getByText("Tarjeta").first(), "el pago ahora dice Tarjeta", 10000);
    const [p] = await q(`select method, tendered from payments where sale_id = (select id from sales where notes = $1)`, [`${NOTE} 1`]);
    assert(p.method === "tarjeta" && p.tendered === null, JSON.stringify(p));
  });

  if (open) {
    await step("Caja: el cobro ahora aparece como Tarjeta con el nombre, y el efectivo que debe haber no cambió", async () => {
      await page.goto(BASE + "/admin/cash");
      const row = page.locator("tr", { hasText: NAME }).first();
      const t = await row.innerText();
      assert(/Cobro\s*·\s*Tarjeta/.test(t.replace(/\s+/g, " ")) && t.includes("Factura GBC-"), t.replace(/\s+/g, " "));
      const t2 = await filaQuien("Tarjeta").innerText();
      assert(t2.includes(NAME) && t2.includes("RD$ 700"), `bajo Tarjeta en «Quién pagó»: ${t2.replace(/\s+/g, " ")}`);
      assert((await quienPago().getByText(NAME).count()) === 1, "el nombre sale una sola vez en «Quién pagó» (ya no bajo Transferencia)");
      assert((await efectivoEsperado()) === efectivoAntes, `el efectivo que debe haber no debía cambiar (${efectivoAntes} → ${await efectivoEsperado()})`);
    });

    await step("Caja: el aviso de pasar a efectivo explica que sube el efectivo de la caja (se cancela, no se registra)", async () => {
      await page.getByRole("button", { name: new RegExp(`Cambiar el método del cobro de RD\\$ 700 de ${NAME}`) }).click();
      const d = page.getByRole("dialog", { name: "Cambiar método de pago" });
      await d.getByLabel("¿Con qué método se pagó en realidad?").selectOption("efectivo");
      await expectVisible(d.getByText(/Entra al efectivo de la caja: el efectivo que debe haber sube RD\$ 700/), "aviso del efecto en el efectivo");
      await d.getByRole("button", { name: "Volver" }).click();
      const [p] = await q(`select method from payments where sale_id = (select id from sales where notes = $1)`, [`${NOTE} 1`]);
      assert(p.method === "tarjeta", "no se cambió nada");
    });
  }

  section("Auditoría y permisos");
  await step("Queda en Auditoría: método anterior, nuevo y motivo", async () => {
    const [a] = await q(`select before_data b, after_data a from audit_logs where action = 'change_payment_method' and entity_id = (select id from payments where sale_id = (select id from sales where notes = $1))`, [`${NOTE} 1`]);
    assert(a && a.b.method === "transferencia" && a.a.method === "tarjeta" && a.a.reason === "E2E fue con tarjeta", JSON.stringify(a));
  });

  await step("Recepción no ve «Cambiar método» (ni en la factura ni en la caja)", async () => {
    const r = await launch();
    setPage(r.page);
    try {
      await login(r.page, "tmp-recep@glow.test");
      await r.page.goto(saleUrl);
      await expectVisible(r.page.getByText(`Cliente: ${NAME}`), "la factura");
      assert((await r.page.getByRole("button", { name: /Cambiar el método/ }).count()) === 0, "recepción no debería ver el botón en la factura");
      if (open) {
        await r.page.goto(BASE + "/admin/cash");
        await expectVisible(r.page.getByRole("heading", { name: "Movimientos del turno" }), "movimientos");
        assert((await r.page.getByRole("button", { name: /Cambiar el método/ }).count()) === 0, "recepción no debería ver el botón en la caja");
      }
    } finally { await r.browser.close(); setPage(page); }
  });
} finally {
  await cleanup().catch((e) => console.error("limpieza:", e.message));
  await db.end().catch(() => {});
  await browser.close();
}
process.exit(summary(errors) ? 1 : 0);
