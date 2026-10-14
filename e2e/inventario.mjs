import pg from "pg";
import { BASE, OUT, assert, axeViolations, expectVisible, launch, login, section, setPage, step, summary, until } from "./h.mjs";

/* Inventario de productos que se usan en los servicios: crear un producto, registrar entradas (fecha y cantidad), marcar cuándo se agotó y leer
   el análisis («Si 10 clientes utilizaron Manicure y se agotaron 10 potes en 20 días…»). Seguro para la base real: usa el producto «E2E Inv …» y
   ventas «E2E-I-…» de enero de 2020 (así el conteo es exacto) y lo borra todo al terminar, incluido su rastro en Auditoría. */
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
const NAME = "E2E Inv Pintura de gel";

async function cleanup() {
  const sup = await q(`select id from supplies where name like 'E2E Inv%'`);
  const lots = sup.length ? await q(`select id from supply_lots where supply_id = any($1)`, [sup.map((s) => s.id)]) : [];
  const sales = await q(`select id from sales where sale_number like 'E2E-I-%'`);
  const ids = [...sup, ...lots, ...sales].map((r) => r.id);
  await q(`delete from supplies where name like 'E2E Inv%'`);
  await q(`delete from sales where sale_number like 'E2E-I-%'`);
  if (ids.length) await q(`delete from audit_logs where entity_id = any($1::uuid[])`, [ids]);
}
await cleanup();

// 10 manicures entre el 2 y el 20 de enero de 2020, más uno antes (31 dic) y otro después (25 ene) que NO deben contar
const MANI = (await q(`select id from services where slug='manicure'`))[0];
const sale = async (n, at) => {
  const [s] = await q(`insert into sales (sale_number, subtotal, total, payment_status, completed_at) values ($1,600,600,'pagado',$2) returning id`, [`E2E-I-${n}`, `${at}T15:00:00Z`]);
  await q(`insert into sale_items (sale_id, description, quantity, unit_price, total, service_id) values ($1,'Manicure E2E',1,600,600,$2)`, [s.id, MANI.id]);
};
for (let i = 0; i < 10; i++) await sale(i + 1, `2020-01-${String(2 + i * 2).padStart(2, "0")}`);
await sale(90, "2019-12-31"); await sale(91, "2020-01-25");

const lotCard = (text) => page.locator('li[aria-label^="Entrada del"]', { hasText: text });

try {
  section("Permisos");
  await step("Recepción no ve ni entra al Inventario; el gerente lo ve en el menú, después de Servicios", async () => {
    const r = await launch(); setPage(r.page);
    try {
      await login(r.page, "tmp-recep@glow.test");
      assert(!(await r.page.locator('nav[aria-label="Panel"]').getByText("Inventario", { exact: true }).count()), "recepción no debe ver «Inventario»");
      await r.page.goto(BASE + "/admin/inventory");
      await r.page.waitForURL((u) => u.pathname === "/admin/forbidden", { timeout: 10000 });
    } finally { await r.browser.close(); setPage(page); }
    await login(page, "tmp-manager@glow.test");
    await page.goto(BASE + "/admin");
    const l = (await page.locator('nav[aria-label="Panel"] a').allInnerTexts()).map((x) => x.trim());
    assert(l.indexOf("Inventario") === l.indexOf("Servicios") + 1, `«Inventario» debe ir justo después de «Servicios»: ${l.join(" | ")}`);
  });

  section("Crear el producto");
  await step("Crear «Pintura de gel» en potes, que se usa en Manicure", async () => {
    await page.goto(BASE + "/admin/inventory");
    await expectVisible(page.getByRole("heading", { name: "Inventario", exact: true }), "título");
    await page.getByRole("button", { name: "+ Nuevo producto" }).first().click();
    await expectVisible(dialog(), "diálogo nuevo producto");
    await dialog().getByRole("button", { name: "Crear producto" }).click();
    await expectVisible(dialog().getByText("Escribe el nombre del producto."), "nombre obligatorio");
    await type(dialog().locator("#sp-name"), NAME);
    await dialog().getByRole("button", { name: "Crear producto" }).click();
    await expectVisible(dialog().getByText(/Elige al menos un servicio/), "servicio obligatorio");
    await dialog().locator("label", { hasText: /^Manicure$/ }).locator("input").check();
    await dialog().getByRole("button", { name: "Crear producto" }).click();
    await page.waitForURL(/\/admin\/inventory\/[0-9a-f-]{36}$/, { timeout: 12000 });
    await expectVisible(page.getByRole("heading", { name: NAME }), "ficha del producto");
    const [s] = await q(`select s.unit, (select count(*)::int from supply_services x where x.supply_id=s.id and x.service_id=$2) n from supplies s where name=$1`, [NAME, MANI.id]);
    assert(s.unit === "pote" && s.n === 1, JSON.stringify(s));
  });

  section("Entrada y agotado: el análisis del dueño");
  await step("Registrar la entrada: 10 potes que llegaron el 1 de enero de 2020", async () => {
    await page.getByRole("button", { name: "+ Registrar entrada" }).click();
    await expectVisible(dialog(), "diálogo de entrada");
    await type(dialog().locator("#lt-qty"), 0);
    await dialog().getByRole("button", { name: "Registrar entrada" }).click();
    await expectVisible(dialog().getByText("Escribe cuántos potes llegaron."), "cantidad obligatoria");
    await dialog().locator("#lt-day").fill("2099-01-01");
    await type(dialog().locator("#lt-qty"), 10);
    await dialog().getByRole("button", { name: "Registrar entrada" }).click();
    await expectVisible(dialog().getByText("no puede ser futura"), "no se aceptan fechas futuras");
    await dialog().locator("#lt-day").fill("2020-01-01");
    await type(dialog().locator("#lt-sup"), "E2E Proveedor");
    await dialog().getByRole("button", { name: "Registrar entrada" }).click();
    await expectVisible(toast("registrada"), "toast", 10000);
    const card = lotCard("Llegaron 10 potes el 1 ene 2020");
    await expectVisible(card, "la entrada");
    assert((await card.innerText()).includes("En uso") && (await card.innerText()).includes("E2E Proveedor"), "la entrada está en uso y lleva el proveedor");
  });

  await step("Marcar que se agotó el 21 de enero: «10 clientes, 10 potes, 20 días» → 1 pote por cliente, 1 pote cada 2 días, consumo elevado", async () => {
    await page.getByRole("button", { name: "Se agotó", exact: true }).first().click();
    await expectVisible(dialog(), "diálogo de agotado");
    await dialog().locator("#dp-day").fill("2020-01-21");
    await dialog().getByRole("button", { name: "Marcar como agotada" }).click();
    await expectVisible(toast("marcada como agotada"), "toast", 10000);
    await until(async () => (await lotCard("Llegaron 10 potes").innerText()).includes("podemos deducir"), "el análisis aparece", 15000);
    const t = await lotCard("Llegaron 10 potes").innerText();
    for (const x of [
      `Si 10 clientes utilizaron Manicure y se agotaron 10 potes de ${NAME} en 20 días, podemos deducir lo siguiente:`,
      "Consumo promedio: 1 pote por cliente.", "Duración promedio: 1 pote cada 2 días.",
      "Posible problema: existe un consumo excesivo de producto, desperdicio, uso no registrado o un control deficiente del inventario.",
      "Conclusión: Si solamente se atendieron 10 clientes en esos 20 días, el consumo de 10 potes parece elevado y sería necesario investigar cómo se está utilizando el producto.",
      "Agotada el 21 ene 2020", "Consumo elevado",
    ]) assert(t.includes(x), `falta «${x}» en: ${t.replace(/\n/g, " ")}`);
  });

  await step("Los servicios de fuera de esas fechas (31 dic y 25 ene) no cuentan, y el resumen del producto cuadra", async () => {
    const t = await page.locator("main").innerText();
    assert(t.includes("10 servicios") && t.includes("10 clientes"), "10 servicios y 10 clientes en el rango");
    assert(!/11 servicios|12 servicios/.test(t), "no debe contar los de fuera de fechas");
    const kpis = await page.locator('section[aria-label="Datos del producto"]').innerText();
    assert(/Servicios por pote\s*1\b/.test(kpis.replace(/\n/g, " ")) && /Días que dura 1 pote\s*2\b/.test(kpis.replace(/\n/g, " ")), `resumen: ${kpis.replace(/\n/g, " ")}`);
  });

  section("Rendimiento esperado");
  await step("Si se dice que un pote rinde 1 servicio, el consumo sale normal; si rinde 8, muy elevado", async () => {
    await page.getByRole("button", { name: "Editar producto" }).click();
    await type(dialog().locator("#sp-exp"), 1);
    await dialog().getByRole("button", { name: "Guardar", exact: true }).click();
    await expectVisible(toast("Producto guardado"), "guardado", 10000);
    await until(async () => (await lotCard("Llegaron 10 potes").innerText()).includes("Consumo normal"), "veredicto normal", 12000);
    let t = await lotCard("Llegaron 10 potes").innerText();
    assert(!t.includes("Posible problema") && t.includes("dentro de lo normal"), "sin posible problema cuando rinde lo esperado");
    await page.getByRole("button", { name: "Editar producto" }).click();
    await type(dialog().locator("#sp-exp"), 8);
    await dialog().getByRole("button", { name: "Guardar", exact: true }).click();
    await until(async () => (await lotCard("Llegaron 10 potes").innerText()).includes("Consumo muy elevado"), "veredicto muy elevado", 12000);
    t = await lotCard("Llegaron 10 potes").innerText();
    assert(t.includes("Posible problema") && t.includes("mucho mayor al esperado"), "muy elevado explica el problema");
  });

  section("Reabrir, entradas siguientes y turnos");
  await step("Reabrir una entrada marcada por error: vuelve a «En uso» y muestra cuánto lleva", async () => {
    await page.getByRole("button", { name: "Reabrir (se marcó por error)" }).click();
    await expectVisible(toast("reabierta"), "toast", 10000);
    await until(async () => (await lotCard("Llegaron 10 potes").innerText()).includes("En uso"), "vuelve a estar en uso", 12000);
    const t = await lotCard("Llegaron 10 potes").innerText();
    assert(/Lleva \d+ días en uso y se han hecho \d+ servicios/.test(t) && t.includes("se estima que se han usado"), `progreso: ${t.replace(/\n/g, " ")}`);
    await page.getByRole("button", { name: "Se agotó", exact: true }).first().click();
    await dialog().locator("#dp-day").fill("2020-01-21");
    await dialog().getByRole("button", { name: "Marcar como agotada" }).click();
    await until(async () => (await lotCard("Llegaron 10 potes").innerText()).includes("Agotada el 21 ene 2020"), "agotada otra vez", 12000);
  });

  await step("Una entrada que llega con otra en uso espera su turno y no se puede agotar hasta que se agote la anterior", async () => {
    for (const [d, n] of [["2020-02-01", 5], ["2020-02-05", 3]]) {
      await page.getByRole("button", { name: "+ Registrar entrada" }).click();
      await dialog().locator("#lt-day").fill(d);
      await type(dialog().locator("#lt-qty"), n);
      await dialog().getByRole("button", { name: "Registrar entrada" }).click();
      await expectVisible(lotCard(`Llegaron ${n} potes`), `entrada de ${n}`);
    }
    const first = await lotCard("Llegaron 5 potes").innerText(), second = await lotCard("Llegaron 3 potes").innerText();
    assert(first.includes("En uso") && first.includes("Se agotó"), "la primera pendiente está en uso");
    assert(second.includes("En espera") && !second.includes("Se agotó") && second.includes("En espera: esta entrada se empieza a usar cuando se agote la anterior"), `la segunda espera: ${second.replace(/\n/g, " ")}`);
    // la lista del inventario muestra el producto en uso y la última entrada analizada
    await page.goto(BASE + "/admin/inventory");
    const card = page.locator("article", { hasText: NAME });
    const t = await card.innerText();
    assert(t.includes("En uso") && t.includes("Manicure") && t.includes("Última entrada: Consumo muy elevado"), `tarjeta: ${t.replace(/\n/g, " ")}`);
  });

  await step("Desde la lista: «Se agotó» y «+ Entrada» funcionan sin entrar a la ficha", async () => {
    const card = page.locator("article", { hasText: NAME });
    await card.getByRole("button", { name: `Marcar ${NAME} como agotado` }).click();
    await dialog().locator("#dp-day").fill("2020-02-04");
    await dialog().getByRole("button", { name: "Marcar como agotada" }).click();
    await expectVisible(toast("marcada como agotada"), "toast", 10000);
    await until(async () => (await q(`select count(*)::int n from supply_lots l join supplies s on s.id=l.supply_id where s.name=$1 and l.depleted_on is not null`, [NAME]))[0].n === 2, "dos entradas agotadas", 10000);
    await page.locator("article", { hasText: NAME }).getByRole("button", { name: `Registrar entrada de ${NAME}` }).click();
    await expectVisible(dialog(), "diálogo de entrada");
    await page.keyboard.press("Escape");
  });

  section("Corregir y borrar");
  await step("Editar una entrada y eliminarla; eliminar el producto vuelve a la lista", async () => {
    await page.locator("article", { hasText: NAME }).getByRole("link", { name: `Ver análisis de ${NAME}` }).click();
    await page.waitForURL(/\/admin\/inventory\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: /^Editar entrada del 5 feb 2020/ }).click();
    await type(dialog().locator("#lt-qty"), 4);
    await dialog().getByRole("button", { name: "Guardar", exact: true }).click();
    await expectVisible(lotCard("Llegaron 4 potes"), "cantidad corregida");
    await page.getByRole("button", { name: /^Eliminar entrada del 5 feb 2020/ }).click();
    await dialog().getByRole("button", { name: "Eliminar" }).click();
    await until(async () => (await q(`select count(*)::int n from supply_lots l join supplies s on s.id=l.supply_id where s.name=$1`, [NAME]))[0].n === 2, "entrada eliminada", 10000);
    await page.getByRole("button", { name: "Eliminar producto" }).click();
    await dialog().getByRole("button", { name: "Eliminar" }).click();
    await page.waitForURL(/\/admin\/inventory$/, { timeout: 10000 });
    assert((await q(`select count(*)::int n from supplies where name=$1`, [NAME]))[0].n === 0, "producto eliminado");
    assert((await q(`select count(*)::int n from supply_lots where notes is null and supply_id not in (select id from supplies)`))[0].n === 0, "sin entradas huérfanas");
  });

  section("Accesibilidad y celular");
  await step("Lista, ficha y formularios sin violaciones de accesibilidad", async () => {
    await page.goto(BASE + "/admin/inventory");
    await page.getByRole("button", { name: "+ Nuevo producto" }).first().click();
    await type(dialog().locator("#sp-name"), NAME);
    await dialog().locator("label", { hasText: /^Manicure$/ }).locator("input").check();
    let v = await axeViolations(page);
    assert(v.length === 0, "formulario de producto: " + v.join(" || "));
    await dialog().getByRole("button", { name: "Crear producto" }).click();
    await page.waitForURL(/\/admin\/inventory\/[0-9a-f-]{36}$/, { timeout: 12000 });
    v = await axeViolations(page);
    assert(v.length === 0, "ficha vacía: " + v.join(" || "));
    await page.getByRole("button", { name: "+ Registrar entrada" }).click();
    await dialog().locator("#lt-day").fill("2020-01-01");
    await type(dialog().locator("#lt-qty"), 10);
    v = await axeViolations(page);
    assert(v.length === 0, "formulario de entrada: " + v.join(" || "));
    await dialog().getByRole("button", { name: "Registrar entrada" }).click();
    await expectVisible(lotCard("Llegaron 10 potes"), "entrada");
    await page.getByRole("button", { name: "Se agotó", exact: true }).first().click();
    await dialog().locator("#dp-day").fill("2020-01-21");
    await dialog().getByRole("button", { name: "Marcar como agotada" }).click();
    await until(async () => (await lotCard("Llegaron 10 potes").innerText()).includes("podemos deducir"), "análisis visible", 12000);
    v = await axeViolations(page);
    assert(v.length === 0, "ficha con análisis: " + v.join(" || "));
    await page.goto(BASE + "/admin/inventory");
    v = await axeViolations(page);
    assert(v.length === 0, "lista: " + v.join(" || "));
  });

  await step("Celular: la ficha con el análisis no se sale de la pantalla", async () => {
    const m = await launch({ mobile: true }); setPage(m.page);
    try {
      await login(m.page, "tmp-manager@glow.test");
      await m.page.goto(BASE + "/admin/inventory");
      await m.page.getByRole("link", { name: `Ver análisis de ${NAME}` }).click();
      await m.page.waitForURL(/\/admin\/inventory\/[0-9a-f-]{36}$/);
      await expectVisible(m.page.getByText("podemos deducir lo siguiente"), "análisis en el celular");
      const over = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(over <= 1, `la pantalla se desborda ${over} px`);
      await m.page.screenshot({ path: `${OUT}/inventario-movil.png`, fullPage: true });
    } finally { await m.browser.close(); setPage(page); }
  });
} finally {
  await cleanup().catch((e) => console.error("limpieza:", e.message));
  await db.end().catch(() => {});
  await browser.close();
}
process.exit(summary(errors) ? 1 : 0);
