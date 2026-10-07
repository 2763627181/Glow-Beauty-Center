import pg from "pg";
import { BASE, OUT, assert, expectVisible, launch, login, section, setPage, step, summary, until } from "./h.mjs";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;
const allErrors = [];

const nextDay = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
let wd = 3; while ([0, 6].includes(new Date(nextDay(wd) + "T12:00:00-04:00").getUTCDay())) wd++;
const DAY = nextDay(wd);
const PHONES = ["8295557401", "8295557402", "8295557403"];

async function cleanup() {
  await q(`delete from sales where client_id in (select id from clients where phone_normalized = any($1))`, [PHONES]);
  await q(`delete from appointments where client_id in (select id from clients where phone_normalized = any($1))`, [PHONES]);
  await q(`delete from clients where phone_normalized = any($1)`, [PHONES]);
}
await cleanup();

const ana = (await q(`select id from employees where full_name like 'Ana%'`))[0].id;
const carla = (await q(`select id from employees where full_name like 'Carla%'`))[0].id;
const man = (await q(`select id from services where slug='manicure'`))[0].id;
const lav = (await q(`select id from services where slug='lavado-y-secado'`))[0].id;
const lavVar = (await q(`select id from service_variants where service_id=$1 and name='Pelo largo'`, [lav]))[0].id;
const book = (last, phone, time, svc, emp, variant) => q(
  `select create_booking(jsonb_build_object('first_name','Roles','last_name',$1::text,'phone',$2::text,'status','confirmado','start_time',$3::text,
     'services',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('service_id',$4::uuid,'employee_id',$5::uuid,'variant_id',$6::uuid))))) r`,
  [last, phone, `${DAY}T${time}:00-04:00`, svc, emp, variant ?? null]);
await book("Ana", PHONES[0], "10:00", man, ana);
await book("Carla", PHONES[1], "14:00", lav, carla, lavVar);
await book("Borrar", PHONES[2], "11:30", man, ana);

const FULL = ["Dashboard", "Agenda", "Solicitudes y citas", "Tablero", "Clientes", "Servicios", "Especialistas", "Ventas", "Cobros", "Nómina", "Reportes", "Promociones", "Galería", "Configuración", "Auditoría", "Usuarios y permisos"];
const EXPECT = {
  super_admin: FULL,
  manager: FULL.filter((x) => x !== "Usuarios y permisos"),
  receptionist: ["Agenda", "Solicitudes y citas", "Tablero", "Clientes", "Ventas", "Cobros"],
  specialist: ["Agenda", "Solicitudes y citas", "Tablero", "Clientes"],
};
const PATH_OF = { Dashboard: "/admin", Agenda: "/admin/calendar", "Solicitudes y citas": "/admin/appointments", Tablero: "/admin/appointments/board", Clientes: "/admin/clients", Servicios: "/admin/services", Especialistas: "/admin/staff", Ventas: "/admin/sales", Cobros: "/admin/payments", Nómina: "/admin/payroll", Reportes: "/admin/reports", Promociones: "/admin/promotions", Galería: "/admin/gallery", Configuración: "/admin/settings", Auditoría: "/admin/audit", "Usuarios y permisos": "/admin/users" };

async function withRole(email, fn, opts) {
  const { browser, page, errors } = await launch(opts);
  setPage(page);
  try { await login(page, email); await fn(page); } finally { allErrors.push(...errors); await browser.close(); }
}
const hydrated = async (page, url) => { await page.goto(BASE + url); await page.waitForLoadState("networkidle"); };
const navLabels = async (page) => (await page.locator('nav[aria-label="Panel"] a').allTextContents()).map((t) => t.trim()).filter(Boolean);
const toast = (page, t) => page.getByText(t, { exact: false }).first();
const openFirst = async (page) => { await page.getByRole("button", { name: "Abrir", exact: true }).first().click(); await expectVisible(page.getByRole("dialog"), "ficha de la cita"); };
const btn = (page, name, exact = true) => page.getByRole("dialog").getByRole("button", { name, exact });
/** La redirección de acceso denegado llega con el flujo de la página: se espera a que la dirección se asiente. */
const settlesAt = async (page, expected, what) => {
  try { await page.waitForURL((u) => u.pathname === expected, { timeout: 10000 }); }
  catch { throw new Error(`${what}: terminó en ${new URL(page.url()).pathname} y se esperaba ${expected}`); }
};
const forbiddenCheck = async (page, role) => {
  const allowedPaths = new Set(EXPECT[role].map((l) => PATH_OF[l]));
  for (const [label, path] of Object.entries(PATH_OF)) {
    if (allowedPaths.has(path)) continue;
    await page.goto(BASE + path);
    // el dashboard no permitido lleva a la agenda; el resto, a la pantalla de acceso denegado
    await settlesAt(page, path === "/admin" ? "/admin/calendar" : "/admin/forbidden", `${role}: ${label} (${path})`);
  }
};

/* ───────────────────────────── RECEPCIÓN ───────────────────────────── */
section("Recepción (día normal de trabajo)");
await withRole("tmp-recep@glow.test", async (page) => {
  await step("Entra a la agenda y solo ve los módulos de recepción", async () => {
    await settlesAt(page, "/admin/calendar", "al iniciar sesión");
    const labels = await navLabels(page);
    assert(JSON.stringify(labels) === JSON.stringify(EXPECT.receptionist), "menú: " + labels.join(" | "));
  });
  await step("Los módulos de gerencia llevan a «sin acceso» (también escribiendo la dirección)", async () => { await forbiddenCheck(page, "receptionist"); });
  await step("Abre una cita confirmada: ve el total y los botones de gestión, pero no puede eliminar", async () => {
    await hydrated(page, "/admin/appointments?q=Roles%20Ana");
    await openFirst(page);
    await expectVisible(page.getByRole("dialog").getByText(/Total RD\$/), "total de la cita");
    for (const n of ["Cliente llegó", "Cobrar", "Editar", "Reprogramar", "No asistió", "Cancelar cita"]) await expectVisible(btn(page, n), `botón ${n}`);
    assert((await btn(page, "Eliminar definitivamente").count()) === 0, "recepción no debe poder eliminar citas");
  });
  await step("Flujo: Cliente llegó → Comenzar servicio", async () => {
    await btn(page, "Cliente llegó").click();
    await until(async () => (await q(`select a.status from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1`, [PHONES[0]]))[0].status === "en_espera", "en espera");
    await hydrated(page, "/admin/appointments?q=Roles%20Ana");
    await openFirst(page);
    await btn(page, "Comenzar servicio").click();
    await until(async () => (await q(`select a.status from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1`, [PHONES[0]]))[0].status === "en_servicio", "en servicio");
  });
  await step("Cobrar con «Pagar todo» completa la cita y genera la venta pagada", async () => {
    await hydrated(page, "/admin/appointments?q=Roles%20Ana");
    await openFirst(page);
    await btn(page, "Cobrar").click();
    await page.getByRole("button", { name: /^Pagar todo/ }).click();
    await page.getByRole("button", { name: /^Cobrar RD\$/ }).click();
    await expectVisible(toast(page, "Cita completada"), "aviso de cita completada", 15000);
    const [s] = await q(`select s.total, s.payment_status, (select coalesce(sum(amount),0) from payments p where p.sale_id=s.id and p.status='pagado') paid from sales s join clients c on c.id=s.client_id where c.phone_normalized=$1`, [PHONES[0]]);
    assert(s && s.payment_status === "pagado" && Number(s.paid) === Number(s.total) && Number(s.total) > 0, JSON.stringify(s));
  });
  await step("En la venta puede ver el recibo pero NO anular, editar nota ni reembolsar", async () => {
    const [s] = await q(`select s.id from sales s join clients c on c.id=s.client_id where c.phone_normalized=$1`, [PHONES[0]]);
    await hydrated(page, `/admin/sales/${s.id}`);
    await expectVisible(page.getByRole("heading").first(), "detalle de la venta");
    for (const n of ["Anular venta", "Editar nota", "Reembolsar"]) assert((await page.getByRole("button", { name: n }).count()) === 0, `recepción no debe ver «${n}»`);
  });
  await step("En Cobros ve los pagos pero no el botón Reembolsar", async () => {
    await hydrated(page, "/admin/payments");
    await expectVisible(page.getByRole("table"), "tabla de pagos");
    assert((await page.getByRole("button", { name: "Reembolsar" }).count()) === 0, "recepción no debe reembolsar");
  });
  await step("Escribir tecla por tecla en un formulario no pierde el foco (regresión)", async () => {
    await hydrated(page, "/admin/clients");
    await page.getByRole("button", { name: "+ Nuevo cliente" }).click();
    await expectVisible(page.locator("#c-fn"), "campo nombre");
    // el primer campo recibe el foco solo, sin hacer clic
    await until(async () => (await page.evaluate(() => document.activeElement?.id)) === "c-fn", "foco automático en el nombre");
    await page.keyboard.type("María José", { delay: 40 });
    await page.keyboard.press("Tab");
    await page.keyboard.type("Pérez Núñez", { delay: 40 });
    assert((await page.locator("#c-fn").inputValue()) === "María José", "nombre: " + (await page.locator("#c-fn").inputValue()));
    assert((await page.locator("#c-ln").inputValue()) === "Pérez Núñez", "apellido: " + (await page.locator("#c-ln").inputValue()));
    // el foco queda atrapado en el diálogo: Tab muchas veces nunca sale de él
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    assert(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), "el foco se escapó del diálogo");
    await page.keyboard.press("Escape");
    await until(async () => (await page.getByRole("dialog").count()) === 0, "Escape cierra el diálogo");
  });
  await step("Puede registrar una venta rápida (+ Nueva venta)", async () => {
    await hydrated(page, "/admin/sales");
    await page.getByRole("button", { name: "+ Nueva venta" }).click();
    await expectVisible(page.getByRole("dialog").getByText("Nueva venta"), "formulario de venta");
    await page.keyboard.press("Escape");
  });
  await step("Clientes: puede crear y editar (y no ve eliminar sin permiso)", async () => {
    await hydrated(page, "/admin/clients?q=Roles");
    await expectVisible(page.getByRole("button", { name: "+ Nuevo cliente" }), "crear cliente");
    const [c] = await q(`select id from clients where phone_normalized=$1`, [PHONES[0]]);
    await hydrated(page, `/admin/clients/${c.id}`);
    await expectVisible(page.getByText("Total gastado"), "KPI de dinero visible para recepción");
    assert((await page.getByRole("button", { name: /Eliminar/ }).count()) === 0, "recepción no debe poder eliminar clientes");
  });
});

/* ───────────────────────────── GERENTE ───────────────────────────── */
section("Gerente");
await withRole("tmp-manager@glow.test", async (page) => {
  await step("Aterriza en el dashboard y ve todo menos «Usuarios y permisos»", async () => {
    assert(new URL(page.url()).pathname === "/admin", "aterriza en " + page.url());
    const labels = await navLabels(page);
    assert(JSON.stringify(labels) === JSON.stringify(EXPECT.manager), "menú: " + labels.join(" | "));
  });
  await step("Solo «Usuarios y permisos» está vetado", async () => { await forbiddenCheck(page, "manager"); });
  await step("Todos sus módulos cargan sin error", async () => {
    for (const l of EXPECT.manager) {
      const res = await page.goto(BASE + PATH_OF[l]);
      assert(res.status() === 200 && new URL(page.url()).pathname === PATH_OF[l], `${l}: ${res.status()} ${page.url()}`);
      await expectVisible(page.locator("h1").first(), `título de ${l}`);
    }
  });
  await step("En la venta sí puede anular, editar nota y reembolsar (y también desde Cobros)", async () => {
    const [s] = await q(`select s.id from sales s join clients c on c.id=s.client_id where c.phone_normalized=$1`, [PHONES[0]]);
    await hydrated(page, `/admin/sales/${s.id}`);
    for (const n of ["Anular venta", "Editar nota"]) await expectVisible(page.getByRole("button", { name: n }), n);
    await expectVisible(page.getByRole("button", { name: "Reembolsar" }), "Reembolsar en la venta");
    await hydrated(page, "/admin/payments");
    await expectVisible(page.getByRole("button", { name: "Reembolsar" }), "Reembolsar en Cobros");
  });
  await step("Puede eliminar definitivamente una cita (con confirmación)", async () => {
    await hydrated(page, "/admin/appointments?q=Roles%20Borrar");
    await openFirst(page);
    await btn(page, "Eliminar definitivamente").click();
    await page.getByRole("dialog").filter({ hasText: "¿Eliminar la cita?" }).getByRole("button", { name: "Eliminar", exact: true }).click();
    await until(async () => (await q(`select count(*)::int c from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1`, [PHONES[2]]))[0].c === 0, "cita eliminada");
  });
});

/* ───────────────────────────── ESPECIALISTA ───────────────────────────── */
section("Especialista (Carla)");
await withRole("tmp-spec@glow.test", async (page) => {
  await step("Aterriza en su agenda y solo ve Agenda, Citas, Tablero y Clientes", async () => {
    await settlesAt(page, "/admin/calendar", "al iniciar sesión");
    const labels = await navLabels(page);
    assert(JSON.stringify(labels) === JSON.stringify(EXPECT.specialist), "menú: " + labels.join(" | "));
  });
  await step("Ventas, cobros y configuración están vetados (también por dirección)", async () => { await forbiddenCheck(page, "specialist"); });
  await step("El tablero muestra solo SUS citas", async () => {
    await hydrated(page, "/admin/appointments/board");
    await expectVisible(page.getByRole("button", { name: "Roles Carla" }), "su cita en el tablero");
    assert((await page.getByRole("button", { name: "Roles Ana" }).count()) === 0, "no debe ver la cita de otra especialista");
  });
  await step("La lista de citas también muestra solo las suyas", async () => {
    await hydrated(page, "/admin/appointments?q=Roles");
    await expectVisible(page.getByRole("cell", { name: /Roles Carla/ }).or(page.getByText("Roles Carla")).first(), "su cita");
    assert((await page.getByText("Roles Ana").count()) === 0, "no debe ver la cita de otra especialista");
  });
  await step("En la ficha: sin dinero, sin cobrar/editar/reprogramar/cancelar; sí puede comenzar el servicio", async () => {
    await openFirst(page);
    await expectVisible(btn(page, "Comenzar servicio"), "Comenzar servicio");
    assert((await page.getByRole("dialog").getByText(/Total RD\$/).count()) === 0, "el especialista no debe ver el total");
    for (const n of ["Cobrar", "Editar", "Reprogramar", "Cancelar cita", "No asistió", "Eliminar definitivamente"]) assert((await btn(page, n).count()) === 0, `no debe ver «${n}»`);
  });
  await step("Comienza y completa su propio servicio (se genera la venta)", async () => {
    await btn(page, "Comenzar servicio").click();
    await until(async () => (await q(`select a.status from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1`, [PHONES[1]]))[0].status === "en_servicio", "en servicio");
    await hydrated(page, "/admin/appointments?q=Roles");
    await openFirst(page);
    await btn(page, "Completar").click();
    await until(async () => (await q(`select a.status from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1`, [PHONES[1]]))[0].status === "completado", "completada");
    assert((await q(`select count(*)::int c from sales s join clients c on c.id=s.client_id where c.phone_normalized=$1`, [PHONES[1]]))[0].c === 1, "debe generarse exactamente una venta");
  });
  await step("Clientes: solo ve los suyos, sin dinero y sin botones de edición", async () => {
    await hydrated(page, "/admin/clients?q=Roles");
    await expectVisible(page.getByText("Roles Carla").first(), "su clienta");
    assert((await page.getByText("Roles Ana").count()) === 0, "no debe ver clientas de otra especialista");
    assert((await page.getByRole("button", { name: "+ Nuevo cliente" }).count()) === 0, "no debe poder crear clientes");
    const [c] = await q(`select id from clients where phone_normalized=$1`, [PHONES[1]]);
    await hydrated(page, `/admin/clients/${c.id}`);
    await expectVisible(page.getByText("Visitas"), "ficha de la clienta");
    assert((await page.getByText("Total gastado").count()) === 0 && (await page.getByText("Pagos y ventas").count()) === 0, "no debe ver dinero");
    for (const n of ["Editar", "Eliminar", "Nueva cita"]) assert((await page.getByRole("button", { name: new RegExp(n) }).count()) === 0, `no debe ver «${n}»`);
  });
  await step("No puede abrir la venta de su servicio ni por dirección directa", async () => {
    const [s] = await q(`select s.id from sales s join clients c on c.id=s.client_id where c.phone_normalized=$1`, [PHONES[1]]);
    await page.goto(`${BASE}/admin/sales/${s.id}`);
    await settlesAt(page, "/admin/forbidden", "venta por dirección directa");
    assert((await page.getByText(/GBC-|Total/).count()) === 0, "no debe mostrarse nada de la venta");
  });
});

/* ───────────────────────────── CUENTA DESACTIVADA ───────────────────────────── */
section("Cuenta desactivada con la sesión abierta");
await withRole("tmp-recep@glow.test", async (page) => {
  const setActive = (v) => q(`update profiles set active=$1 where id=(select id from auth.users where email='tmp-recep@glow.test')`, [v]);
  await step("Se cierra la sesión y se avisa (sin bucle de redirecciones entre el ingreso y el panel)", async () => {
    await setActive(false);
    try {
      await page.goto(BASE + "/admin/clients");
      await settlesAt(page, "/admin/login", "cuenta desactivada");
      assert(new URL(page.url()).searchParams.get("error") === "sin-acceso", "debe llegar con el aviso: " + page.url());
      await expectVisible(page.getByText(/no tiene acceso al panel/), "mensaje de aviso");
      await page.goto(BASE + "/admin");
      await settlesAt(page, "/admin/login", "la sesión quedó cerrada");
    } finally { await setActive(true); }
  });
  await step("Al reactivar la cuenta puede volver a entrar", async () => {
    await login(page, "tmp-recep@glow.test");
    await settlesAt(page, "/admin/calendar", "ingreso de nuevo");
  });
});

/* ───────────────────────────── MÓVIL (ADMIN) ───────────────────────────── */
section("Panel en el celular (390×844)");
await withRole("tmp-admin@glow.test", async (page) => {
  await step("Menú lateral: abre, navega y se cierra", async () => {
    await hydrated(page, "/admin");
    await page.getByRole("button", { name: "Abrir menú" }).click();
    const drawer = page.getByRole("dialog", { name: "Menú" });
    await expectVisible(drawer, "menú lateral");
    await drawer.getByRole("link", { name: "Clientes", exact: true }).click();
    await page.waitForURL("**/admin/clients");
    await until(async () => (await page.getByRole("dialog", { name: "Menú" }).count()) === 0, "el menú se cierra al navegar");
  });
  await step("Ninguna pantalla del panel se desborda horizontalmente", async () => {
    const bad = [];
    for (const [label, path] of Object.entries(PATH_OF)) {
      await page.goto(BASE + path);
      await page.waitForLoadState("networkidle");
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      if (o.sw > o.cw + 1) bad.push(`${label} (${o.sw}>${o.cw})`);
      if (["Dashboard", "Agenda", "Tablero", "Ventas", "Configuración"].includes(label)) await page.screenshot({ path: `${OUT}/mobile-admin-${path.replace(/\W+/g, "_")}.png` });
    }
    assert(bad.length === 0, "desbordan: " + bad.join(", "));
  });
  await step("Detalles y fichas también caben en el celular", async () => {
    const [a] = await q(`select a.id from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1`, [PHONES[0]]);
    const [s] = await q(`select s.id from sales s join clients c on c.id=s.client_id where c.phone_normalized=$1`, [PHONES[0]]);
    const [c] = await q(`select id from clients where phone_normalized=$1`, [PHONES[0]]);
    const bad = [];
    for (const path of [`/admin/appointments/${a.id}`, `/admin/sales/${s.id}`, `/admin/clients/${c.id}`, "/admin/services/new", "/admin/staff/new"]) {
      await page.goto(BASE + path);
      await page.waitForLoadState("networkidle");
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      if (o.sw > o.cw + 1) bad.push(`${path} (${o.sw}>${o.cw})`);
    }
    assert(bad.length === 0, "desbordan: " + bad.join(", "));
  });
  await step("Ficha de cita en modal: se puede usar con el pulgar (botones ≥ 36 px y sin salirse)", async () => {
    await hydrated(page, "/admin/appointments?q=Roles%20Carla");
    await page.getByRole("button", { name: "Abrir", exact: true }).first().click();
    const dlg = page.getByRole("dialog");
    await expectVisible(dlg, "ficha");
    await page.waitForTimeout(500); // termina la animación de entrada
    const box = await dlg.boundingBox();
    assert(box.x >= 0 && box.x + box.width <= 391, `el modal se sale de la pantalla: x=${box.x} w=${box.width}`);
    const small = await dlg.getByRole("button").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 36).map((e) => e.textContent.trim()));
    assert(small.length === 0, "botones muy pequeños: " + small.join(", "));
    await page.screenshot({ path: `${OUT}/mobile-admin-modal.png` });
  });
}, { mobile: true });

console.log("\nLimpieza de datos de prueba…");
await cleanup();
await db.end();
const code = summary(allErrors);
process.exit(code);
