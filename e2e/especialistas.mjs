import pg from "pg";
import { BASE, assert, axeViolations, expectVisible, launch, login, section, setPage, step, summary } from "./h.mjs";

/* Número de cada especialista («02 · Nombre») en el panel y que NO salga en la web pública; menú con Caja, Manicuristas, Clientes, Nómina y
   Servicios de primeras; y el buscador que lleva a esas secciones. Seguro para la base real: usa especialistas «E2E Num …» con números 96 a 99
   (las reales usan 0 a 3), y las borra al terminar junto con su rastro en Auditoría. */
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
const toast = (t) => page.getByText(t, { exact: false }).first();
const type = async (loc, text) => { await loc.click(); await loc.press("Control+a"); await loc.pressSequentially(String(text), { delay: 25 }); };

async function cleanup() {
  const emps = await q(`select id from employees where full_name like 'E2E Num%'`);
  await q(`delete from employees where full_name like 'E2E Num%'`);
  if (emps.length) await q(`delete from audit_logs where entity_id = any($1::uuid[])`, [emps.map((e) => e.id)]);
}
await cleanup();
const mk = async (name, num, specialty) => (await q(`insert into employees (full_name, employee_number, specialty, active, accepts_online_booking, commission_pct, base_salary) values ($1,$2,$3,true,false,15,7000) returning id`, [name, num, specialty]))[0].id;
const A = await mk("E2E Num A", 97, "Manicurista");
await mk("E2E Num B", 98, "Estilista");
const navLabels = (p) => p.locator('nav[aria-label="Panel"] a').allInnerTexts();

try {
  section("Menú: Caja, Manicuristas, Clientes, Nómina y Servicios de primeras");
  await step("Gerente: los primeros cinco del menú, en ese orden, y el resto como siempre", async () => {
    await login(page, "tmp-manager@glow.test");
    await page.goto(BASE + "/admin");
    const l = (await navLabels(page)).map((x) => x.trim());
    assert(JSON.stringify(l.slice(0, 5)) === JSON.stringify(["Caja", "Manicuristas", "Clientes", "Nómina", "Servicios"]), `menú: ${l.join(" | ")}`);
    assert(l[5] === "Inventario" && l[6] === "Dashboard" && l.includes("Especialistas") && l.includes("Ventas") && l.includes("Cobros"), `el resto del menú sigue ahí: ${l.join(" | ")}`);
    assert(new Set(l).size === l.length, "no se repite ninguna sección");
  });

  await step("Recepción solo ve las que le tocan, pero también con Caja y Clientes primero", async () => {
    const r = await launch(); setPage(r.page);
    try {
      await login(r.page, "tmp-recep@glow.test");
      await r.page.goto(BASE + "/admin/calendar");
      const l = (await navLabels(r.page)).map((x) => x.trim());
      assert(l[0] === "Caja" && l[1] === "Clientes", `menú de recepción: ${l.join(" | ")}`);
      assert(!l.includes("Manicuristas") && !l.includes("Nómina") && !l.includes("Servicios"), "recepción no ve Manicuristas, Nómina ni Servicios");
    } finally { await r.browser.close(); setPage(page); }
  });

  section("Buscador: también lleva a las secciones");
  await step("Al hacer clic sin escribir salen las secciones en el mismo orden; escribir filtra sin tildes", async () => {
    await page.goto(BASE + "/admin");
    await page.locator("#gsearch").click();
    const panel = page.getByRole("region", { name: "Secciones del panel" }).or(page.locator('section[aria-label="Secciones del panel"]'));
    await expectVisible(panel, "lista de secciones");
    const first = (await panel.locator("a").allInnerTexts()).map((x) => x.trim());
    assert(JSON.stringify(first.slice(0, 5)) === JSON.stringify(["Caja", "Manicuristas", "Clientes", "Nómina", "Servicios"]), `secciones del buscador: ${first.join(" | ")}`);
    await page.locator("#gsearch").pressSequentially("nomi", { delay: 30 });
    await expectVisible(page.locator('section[aria-label="Secciones del panel"] a', { hasText: "Nómina" }), "Nómina al escribir «nomi»");
    assert((await page.locator('section[aria-label="Secciones del panel"] a').count()) === 1, "solo queda Nómina");
    await page.locator("#gsearch").press("Control+a"); await page.locator("#gsearch").pressSequentially("caj", { delay: 30 });
    await page.locator('section[aria-label="Secciones del panel"] a', { hasText: "Caja" }).click();
    await page.waitForURL(/\/admin\/cash$/, { timeout: 10000 });
    assert((await page.locator("#gsearch").inputValue()) === "", "el buscador se limpia al ir a la sección");
  });

  await step("El buscador sigue encontrando clientes, citas y ventas", async () => {
    await page.goto(BASE + "/admin");
    await page.locator("#gsearch").pressSequentially("GBC-", { delay: 30 });
    await expectVisible(page.getByRole("heading", { name: "Ventas" }), "resultados de ventas", 12000);
  });

  section("Especialistas con número");
  await step("La lista muestra «97 · E2E Num A» y «98 · E2E Num B» en orden de número", async () => {
    await page.goto(BASE + "/admin/staff");
    const t = await page.locator("main").innerText();
    assert(t.includes("97 · E2E Num A") && t.includes("98 · E2E Num B"), "los números aparecen junto al nombre");
    assert(t.indexOf("97 · E2E Num A") < t.indexOf("98 · E2E Num B"), "orden por número");
    const real = await q(`select employee_number n, full_name from employees where employee_number is not null and full_name not like 'E2E%'`);
    for (const e of real) assert(t.includes(`${String(e.n).padStart(2, "0")} · ${e.full_name}`), `la especialista real «${e.full_name}» debe verse con su número`);
  });

  await step("La ficha: campo «Número», rechaza repetidos, acepta uno libre y lo muestra en el título", async () => {
    await page.goto(`${BASE}/admin/staff/${A}`);
    await expectVisible(page.getByRole("heading", { name: "97 · E2E Num A" }), "título con número");
    assert((await page.locator("#e-num").inputValue()) === "97", "el campo trae el 97");
    await type(page.locator("#e-num"), 98);
    await page.getByRole("button", { name: "Guardar" }).first().click();
    await expectVisible(page.getByText("Ese número ya lo tiene otra especialista"), "rechazo por repetido", 10000);
    await type(page.locator("#e-num"), 96);
    await page.getByRole("button", { name: "Guardar" }).first().click();
    await expectVisible(toast("Especialista guardado"), "guardado", 10000);
    await expectVisible(page.getByRole("heading", { name: "96 · E2E Num A" }), "título con el número nuevo");
    assert((await q(`select employee_number n from employees where id=$1`, [A]))[0].n === 96, "guardado en la base");
    await type(page.locator("#e-num"), 100);
    await page.getByRole("button", { name: "Guardar" }).first().click();
    await page.waitForTimeout(1500);
    assert((await q(`select employee_number n from employees where id=$1`, [A]))[0].n === 96, "un número fuera de 0–99 no se guarda");
    await page.locator("#e-num").press("Control+a"); await page.locator("#e-num").press("Delete");
    await page.getByRole("button", { name: "Guardar" }).first().click();
    await expectVisible(toast("Especialista guardado"), "guardado sin número", 10000);
    await page.reload();
    await expectVisible(page.getByRole("heading", { name: "E2E Num A", exact: true }), "sin número, solo el nombre");
    assert((await q(`select employee_number n from employees where id=$1`, [A]))[0].n === null, "número quitado");
    await q(`update employees set employee_number = 97 where id=$1`, [A]);
  });

  await step("Los selectores del panel muestran número y nombre (nueva cita, agenda y filtro)", async () => {
    await page.goto(BASE + "/admin/appointments");
    await page.getByRole("button", { name: "+ Nueva cita" }).click();
    await expectVisible(dialog(), "diálogo de nueva cita");
    assert((await dialog().locator("#n-emp option", { hasText: "98 · E2E Num B" }).count()) === 1, "la opción dice «98 · E2E Num B»");
    await page.keyboard.press("Escape");
    await page.goto(BASE + "/admin/calendar");
    const text = await page.locator("main").innerText();
    assert(text.includes("98 · E2E Num B"), "la agenda lleva el número en la columna");
    assert((await page.locator("#c-emp option", { hasText: "97 · E2E Num A" }).count()) === 1, "el filtro de la agenda también");
  });

  await step("Manicuristas: la tarjeta lleva el número", async () => {
    await page.goto(`${BASE}/admin/manicurists`);
    await expectVisible(page.getByRole("heading", { name: "97 · E2E Num A" }), "tarjeta con número");
  });

  section("La página pública no muestra números");
  await step("La web pública sigue mostrando solo nombres", async () => {
    for (const p of ["/", "/booking", "/services", "/about", "/contact"]) {
      const r = await page.request.get(BASE + p);
      assert(r.ok(), `${p} → ${r.status()}`);
      const html = await r.text();
      assert(!/\b0\d · [A-ZÁÉÍÓÚÑ]/.test(html) && !html.includes("employee_number"), `${p}: no debe mostrar números de especialista`);
    }
  });

  section("Accesibilidad");
  await step("Especialistas, ficha y buscador sin violaciones de accesibilidad", async () => {
    for (const p of ["/admin/staff", `/admin/staff/${A}`, "/admin/manicurists"]) {
      await page.goto(BASE + p);
      const v = await axeViolations(page);
      assert(v.length === 0, `${p}: ${v.join(" || ")}`);
    }
    await page.goto(BASE + "/admin");
    await page.locator("#gsearch").click();
    await expectVisible(page.locator('section[aria-label="Secciones del panel"]'), "secciones");
    const v = await axeViolations(page);
    assert(v.length === 0, "buscador abierto: " + v.join(" || "));
  });
} finally {
  await cleanup().catch((e) => console.error("limpieza:", e.message));
  await db.end().catch(() => {});
  await browser.close();
}
process.exit(summary(errors) ? 1 : 0);
