import pg from "pg";
import { BASE, assert, axeViolations, expectVisible, launch, login, section, setPage, step, summary, until } from "./h.mjs";

/* La propina NO entra en la venta: ni en el total de la factura, ni en lo que se cobra, ni en las ventas. Se anota aparte para la especialista.
   Seguro para la base real: solo cobra con TARJETA/TRANSFERENCIA (no toca el efectivo de la caja real), usa el cliente «E2E Propina»
   (829555950x) y notas «E2E propina…», y borra todo al terminar (incluido su rastro en Auditoría). El caso del efectivo con propina solo se
   teclea y se mira el resumen: no se registra nada. */
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
const dialog = () => page.getByRole("dialog");
const PHONE = "8295559501";
const NOTE = "E2E propina";
const type = async (loc, text) => { await loc.click(); await loc.press("Control+a"); await loc.pressSequentially(String(text), { delay: 25 }); };

async function cleanup() {
  const appts = await q(`select a.id from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1`, [PHONE]);
  const sales = await q(`select id from sales where notes like $1 or appointment_id = any($2)`, [`${NOTE}%`, appts.map((a) => a.id)]);
  const pays = sales.length ? await q(`select id from payments where sale_id = any($1)`, [sales.map((s) => s.id)]) : [];
  const clients = await q(`select id from clients where phone_normalized=$1`, [PHONE]);
  const ids = [...appts, ...sales, ...pays, ...clients].map((r) => r.id);
  if (pays.length) await q(`delete from payments where id = any($1)`, [pays.map((p) => p.id)]);
  if (sales.length) await q(`delete from sales where id = any($1)`, [sales.map((s) => s.id)]);
  if (appts.length) await q(`delete from appointments where id = any($1)`, [appts.map((a) => a.id)]);
  if (clients.length) await q(`delete from clients where id = any($1)`, [clients.map((c) => c.id)]);
  if (ids.length) await q(`delete from audit_logs where entity_id = any($1::uuid[])`, [ids]);
}
await cleanup();
const MANI = (await q(`select id, price::float p from services where slug='manicure'`))[0];
const appt = (await q(`select create_booking(jsonb_build_object('first_name','E2E Propina','last_name','Cita','phone',$1::text,'status','en_servicio','source','walk_in','start_time',$2::text,'services',jsonb_build_array(jsonb_build_object('service_id',$3::text)))) r`,
  [PHONE, new Date(Date.now() + 5 * 60e3).toISOString(), MANI.id]))[0].r;
assert(MANI.p === 600, `se esperaba Manicure a RD$ 600 y es ${MANI.p}`);

const totalsBox = () => dialog().getByText("Subtotal", { exact: true }).locator("xpath=ancestor::div[contains(@class,'card')][1]");

async function newSale(items, note) {
  await page.getByRole("button", { name: "+ Nueva venta" }).click();
  await expectVisible(dialog(), "diálogo de nueva venta");
  for (const [name, price] of items) {
    await type(dialog().locator("#qs-cn"), name); await type(dialog().locator("#qs-cp"), price);
    await dialog().getByRole("button", { name: "Agregar", exact: true }).click();
  }
  if (note) await type(dialog().locator("#qs-n"), note);
}

try {
  await login(page, "tmp-recep@glow.test");

  section("Venta de mostrador con propina");
  await step("La propina no suma al total ni a lo que se cobra: 1,000 + propina 100 → cobra 1,000", async () => {
    await page.goto(BASE + "/admin/sales");
    await newSale([["E2E Producto con propina", 1000]], `${NOTE} 1`);
    await type(dialog().locator("#qs-t"), 100);
    await expectVisible(dialog().getByText("Aparte: no suma a la venta ni a lo que se cobra; es para la especialista."), "aviso bajo la propina");
    const total = await totalsBox().innerText();
    assert(total.includes("RD$ 1,000") && !total.includes("RD$ 1,100"), `el total no debe incluir la propina: ${total.replace(/\n/g, " ")}`);
    await dialog().getByLabel("Método").first().selectOption("tarjeta");
    await dialog().getByRole("button", { name: /Pagar todo/ }).click();
    const sum = await dialog().locator('[class*="summary"]').innerText();
    assert(sum.includes("Por cobrar") && sum.includes("RD$ 1,000") && sum.includes("Propina (aparte: no suma a la venta)") && sum.includes("RD$ 100"), `resumen: ${sum.replace(/\n/g, " | ")}`);
    await dialog().getByRole("button", { name: /^Registrar venta y cobrar RD\$ 1,000$/ }).click();
    await page.waitForURL(/\/admin\/sales\/[0-9a-f-]{36}$/, { timeout: 10000 });
    const receipt = await page.locator("main").innerText();
    assert(/Total\s*RD\$ 1,000/.test(receipt), "la factura dice Total RD$ 1,000");
    assert(receipt.includes("Propina (aparte: no está incluida en el total)") && receipt.includes("RD$ 100"), "la propina sale aparte, debajo del total");
    assert(receipt.indexOf("Total") < receipt.indexOf("Propina (aparte"), "la propina va después del total");
    const [s] = await q(`select total::float t, tip::float p, payment_status st, (select sum(amount)::float from payments where sale_id=sales.id) paid from sales where notes=$1`, [`${NOTE} 1`]);
    assert(s.t === 1000 && s.p === 100 && s.st === "pagado" && s.paid === 1000, JSON.stringify(s));
  });

  await step("En la lista de ventas, el total no incluye la propina", async () => {
    await page.goto(BASE + "/admin/sales");
    const row = page.locator("tr", { hasText: "E2E Producto con propina" });
    await expectVisible(row, "la venta de la prueba");
    const t = await row.innerText();
    assert(t.includes("RD$ 1,000") && !t.includes("RD$ 1,100"), `la fila no debe mostrar 1,100: ${t.replace(/\s+/g, " ")}`);
  });

  section("Cobro de una cita con propina");
  await step("En el cobro de la cita la propina no cambia el total ni lo pendiente; se cobra 600 y la venta queda en 600", async () => {
    await page.goto(BASE + "/admin/cash");
    await page.getByRole("button", { name: "Cobrar a E2E Propina Cita" }).click();
    await expectVisible(dialog(), "diálogo de cobro");
    await type(dialog().locator("#tip"), 200);
    const box = await totalsBox().innerText();
    assert(box.includes("RD$ 600") && !box.includes("RD$ 800"), `el total y lo pendiente no suben con la propina: ${box.replace(/\n/g, " ")}`);
    await dialog().getByLabel("Método").first().selectOption("transferencia");
    await dialog().getByRole("button", { name: /Pagar todo/ }).click();
    await dialog().getByRole("button", { name: /^Cobrar RD\$ 600$/ }).click();
    const s = await until(async () => (await q(`select s.total::float t, s.tip::float p, s.payment_status st, a.final_total::float f from sales s join appointments a on a.id=s.appointment_id where a.id=$1`, [appt.id]))[0], "la venta de la cita", 15000);
    assert(s.t === 600 && s.p === 200 && s.st === "pagado" && s.f === 600, JSON.stringify(s));
  });

  section("Efectivo con propina (solo se mira el resumen)");
  await step("1,700 + propina 200: si el cliente da 2,000 de lo que sobra salen 200 de propina y 100 de vuelto; si da 1,900 no hay vuelto", async () => {
    await page.goto(BASE + "/admin/sales");
    await newSale([["E2E Servicio efectivo", 1700]], "");
    await type(dialog().locator("#qs-t"), 200);
    await type(dialog().getByLabel("El cliente entregó (RD$)"), 2000);
    let sum = await dialog().locator('[class*="summary"]').innerText();
    assert(sum.includes("De lo que sobra del efectivo: propina para la especialista") && /Vuelto a entregar\s*RD\$ 100/.test(sum), `con 2,000: ${sum.replace(/\n/g, " | ")}`);
    await expectVisible(dialog().getByRole("button", { name: /^Registrar venta y cobrar RD\$ 1,700 · vuelto RD\$ 100 · propina RD\$ 200$/ }), "botón con vuelto y propina");
    await type(dialog().getByLabel("El cliente entregó (RD$)"), 1900);
    sum = await dialog().locator('[class*="summary"]').innerText();
    assert(/Vuelto a entregar\s*RD\$ 0/.test(sum) && sum.includes("RD$ 200"), `con 1,900: ${sum.replace(/\n/g, " | ")}`);
    await expectVisible(dialog().getByRole("button", { name: /^Registrar venta y cobrar RD\$ 1,700 · propina RD\$ 200$/ }), "botón solo con propina");
    const v = await axeViolations(page);
    assert(v.length === 0, v.join(" || "));
    await page.keyboard.press("Escape");
    assert((await q(`select count(*)::int n from sales where notes like $1 and notes <> $2`, [`${NOTE}%`, `${NOTE} 1`]))[0].n === 0, "no debe registrarse nada en este paso");
  });
} finally {
  await cleanup().catch((e) => console.error("limpieza:", e.message));
  await db.end().catch(() => {});
  await browser.close();
}
process.exit(summary(errors) ? 1 : 0);
