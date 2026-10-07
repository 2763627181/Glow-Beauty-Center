import pg from "pg";
import { BASE, assert, axeViolations, expectVisible, launch, login, section, setPage, step, summary, until } from "./h.mjs";

/* Citas simultáneas, calendario, cumpleaños de especialistas, horarios por defecto y avisos de servicios sin especialista.
   Seguro para la base real: solo crea y borra filas propias ("E2E …", teléfonos 829555910x) y restaura el ajuste que toca.
   Las especialistas y el servicio de prueba solo son visibles en la web (reservas / catálogo) por fracciones de segundo,
   justo mientras se consulta la disponibilidad, para que ninguna clienta real los vea. */
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;
const { browser, page, errors } = await launch();
setPage(page);
const dialog = () => page.getByRole("dialog");
const toast = (t) => page.getByText(t, { exact: false }).first();
const PHONES = ["8295559101", "8295559102", "8295559103", "8295559104", "8295559105", "8295559106"];
const dr = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
const today = dr(0);

// Primer día abierto del negocio dentro de unos días (para que la agenda y la web ofrezcan horarios)
const hours = (await q(`select value from business_settings where key='hours'`))[0].value;
let n = 4; while (!hours[String(new Date(dr(n) + "T12:00:00-04:00").getUTCDay())]) n++;
const DAY = dr(n);
const wdOpen = Object.entries(hours).filter(([, h]) => h && h.open && h.close);
const T = `${DAY}T11:00`;
const SVC = "lavado-y-secado";

const bookingBefore = (await q(`select value from business_settings where key='booking'`))[0].value;

async function cleanup() {
  const appts = await q(`select a.id from appointments a join clients c on c.id=a.client_id where c.phone_normalized = any($1)`, [PHONES]);
  const lines = appts.length ? await q(`select id from appointment_services where appointment_id = any($1)`, [appts.map((a) => a.id)]) : [];
  const emps = await q(`select id from employees where full_name like 'E2E %'`);
  const svcs = await q(`select id from services where slug like 'e2e-%'`);
  const clients = await q(`select id from clients where phone_normalized = any($1)`, [PHONES]);
  const ids = [...appts, ...lines, ...emps, ...svcs, ...clients].map((r) => r.id);
  await q(`delete from appointments where client_id in (select id from clients where phone_normalized = any($1))`, [PHONES]);
  await q(`delete from clients where phone_normalized = any($1)`, [PHONES]);
  await q(`delete from employees where full_name like 'E2E %'`);
  await q(`delete from services where slug like 'e2e-%'`);
  await q(`update business_settings set value=$1::jsonb where key='booking'`, [JSON.stringify(bookingBefore)]);
  // Auditoría: solo se purgan las filas de esta prueba (por id); nunca las del dueño
  if (ids.length) await q(`delete from audit_logs where entity_id = any($1::uuid[])`, [ids]);
}
await cleanup();

// Datos de prueba: dos especialistas con el horario del negocio que hacen "Lavado y Secado"
const mkEmp = async (name) => {
  const [e] = await q(`insert into employees (full_name, active, accepts_online_booking) values ($1, true, false) returning id`, [name]);
  for (const [wd, h] of wdOpen) await q(`insert into employee_schedules (employee_id, weekday, start_time, end_time) values ($1,$2,$3,$4)`, [e.id, Number(wd), h.open, h.close]);
  await q(`insert into employee_services (employee_id, service_id) values ($1,(select id from services where slug=$2))`, [e.id, SVC]);
  return e.id;
};
const anaId = await mkEmp("E2E Ana");
const beaId = await mkEmp("E2E Bea");
const svcId = (await q(`select id from services where slug=$1`, [SVC]))[0].id;
const varId = (await q(`select id from service_variants where service_id=$1 and name='Pelo corto'`, [svcId]))[0].id;
const slots = async (employeeId, serviceId = svcId, variantId = varId) => {
  await q(`update employees set accepts_online_booking=true where full_name like 'E2E %'`);
  await q(`update services set active=true where slug like 'e2e-%'`);
  try { return await slotsRaw(employeeId, serviceId, variantId); }
  finally { await q(`update employees set accepts_online_booking=false where full_name like 'E2E %'`); await q(`update services set active=false where slug like 'e2e-%'`); }
};
const slotsRaw = async (employeeId, serviceId, variantId) =>
  (await (await fetch(`${BASE}/api/availability`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: DAY, employeeId, items: [{ serviceId, variantId, addonIds: [] }] }) })).json());

try {
  await login(page, "tmp-admin@glow.test");

  section("Citas al mismo tiempo con la misma especialista (panel)");
  async function newAppt(last, phone, expectWarning) {
    await page.goto(BASE + "/admin/appointments");
    await page.getByRole("button", { name: "+ Nueva cita" }).click();
    await expectVisible(dialog(), "diálogo");
    await page.locator("#n-phone").fill(phone);
    await page.locator("#n-fn").fill("E2E");
    await page.locator("#n-ln").fill(last);
    await page.locator("#n-when").fill(T);
    await page.locator("#n-emp").selectOption({ label: "E2E Ana" });
    await page.getByLabel("Buscar servicio").fill("Lavado");
    await page.getByRole("checkbox", { name: /Lavado y Secado.*Pelo corto/ }).check();
    if (expectWarning) await expectVisible(dialog().getByText(expectWarning), `aviso «${expectWarning}»`, 10000);
    else await page.waitForTimeout(900); // la consulta del aviso espera 350 ms; no debe aparecer ninguno
    if (!expectWarning) assert((await dialog().getByText(/ya tiene .* a esa hora/).count()) === 0, "no debe avisar si la especialista está libre");
    await dialog().getByRole("button", { name: "Crear cita" }).click();
    await expectVisible(toast("Cita creada"), "toast de cita creada", 10000);
  }
  const linesAt = async () => (await q(`select count(*)::int c from appointment_services where employee_id=$1 and active and start_time = $2::timestamptz`, [anaId, `${T}:00-04:00`]))[0].c;
  await step("1.ª cita de E2E Ana a las 11:00: sin avisos", async () => { await newAppt("Uno", "829-555-9101", null); assert((await linesAt()) === 1, "una línea"); });
  await step("2.ª cita a la MISMA hora con la misma especialista: avisa «ya tiene otra cita» y la deja guardar", async () => {
    await newAppt("Dos", "829-555-9102", /E2E Ana ya tiene otra cita a esa hora/);
    assert((await linesAt()) === 2, "dos líneas a la misma hora");
  });
  await step("3.ª cita a la misma hora: avisa «ya tiene 2 citas» y también se guarda (sin tope en el panel)", async () => {
    await newAppt("Tres", "829-555-9103", /E2E Ana ya tiene 2 citas a esa hora/);
    assert((await linesAt()) === 3, "tres líneas a la misma hora");
  });

  section("Agenda: las citas simultáneas se ven una al lado de la otra");
  await step("Día: las 3 citas de E2E Ana a las 11:00 no se tapan entre sí", async () => {
    await page.goto(`${BASE}/admin/calendar?view=day&date=${DAY}`);
    const chips = page.getByRole("button", { name: /^E2E, 11:00/ });
    await until(async () => (await chips.count()) === 3, "3 citas visibles en la agenda");
    await chips.first().scrollIntoViewIfNeeded(); // una sola vez: si la agenda se desplazara entre medidas, los números no serían comparables
    const boxes = [];
    for (let i = 0; i < 3; i++) boxes.push(await chips.nth(i).boundingBox());
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const w = Math.min(boxes[i].x + boxes[i].width, boxes[j].x + boxes[j].width) - Math.max(boxes[i].x, boxes[j].x);
      assert(w <= 1, `las citas ${i + 1} y ${j + 1} se superponen ${Math.round(w)} px`);
    }
    for (const b of boxes) assert(b.width >= 100, `cada cita debe ser legible (ancho ${Math.round(b.width)} px)`);
    await page.screenshot({ path: "e2e/shots/agenda-simultaneas.png", fullPage: false });
  });
  await step("Se puede abrir cada una de las citas encimadas", async () => {
    const chips = page.getByRole("button", { name: /^E2E, 11:00/ });
    for (let i = 0; i < 3; i++) {
      await chips.nth(i).click();
      await expectVisible(dialog().getByText(/E2E (Uno|Dos|Tres)/), `ficha de la cita ${i + 1}`);
      await page.keyboard.press("Escape");
      await dialog().waitFor({ state: "hidden" }).catch(() => {});
    }
  });
  await step("Reprogramar otra cita sobre esas tres avisa y se permite", async () => {
    await page.goto(BASE + "/admin/appointments?q=E2E");
    await page.getByRole("button", { name: "Abrir" }).first().click();
    await dialog().getByRole("button", { name: "Reprogramar" }).click();
    await page.locator("#rs-when").fill(`${DAY}T11:15`);
    await expectVisible(dialog().getByText(/ya tiene .* a esa hora/), "aviso previo", 10000);
    await dialog().getByRole("button", { name: "Guardar nueva hora" }).click();
    await expectVisible(toast("Cita reprogramada"), "toast", 10000);
  });

  await step("Accesibilidad (axe): agenda con citas encimadas, aviso de coincidencia y ficha de la especialista", async () => {
    const found = [];
    const scan = async (label) => { const v = await axeViolations(page); if (v.length) found.push(`${label}: ${v.join(" | ")}`); };
    await page.goto(`${BASE}/admin/calendar?view=day&date=${DAY}`); await scan("agenda del día");
    await page.goto(BASE + "/admin/appointments"); await page.getByRole("button", { name: "+ Nueva cita" }).click();
    await page.locator("#n-when").fill(T); await page.locator("#n-emp").selectOption({ label: "E2E Ana" });
    await page.getByLabel("Buscar servicio").fill("Lavado"); await page.getByRole("checkbox", { name: /Lavado y Secado.*Pelo corto/ }).check();
    await expectVisible(dialog().getByText(/ya tiene .* a esa hora/), "aviso", 10000); await scan("nueva cita con aviso"); await page.keyboard.press("Escape");
    await page.goto(`${BASE}/admin/staff/${anaId}`); await scan("ficha de la especialista");
    assert(found.length === 0, found.join(" ¦ "));
  });

  await step("Sin límites en el panel: se puede asignar a una especialista que no tiene marcado el servicio (y el selector la ofrece aparte)", async () => {
    await page.goto(BASE + "/admin/appointments");
    await page.getByRole("button", { name: "+ Nueva cita" }).click();
    await expectVisible(dialog(), "diálogo");
    await page.locator("#n-phone").fill("829-555-9105"); await page.locator("#n-fn").fill("E2E"); await page.locator("#n-ln").fill("Otra");
    await page.locator("#n-when").fill(`${DAY}T15:00`);
    await dialog().locator("label", { hasText: /^Tinte\s*RD\$/ }).locator("input").check();
    const sel = page.getByLabel("Especialista para Tinte");
    const hacen = (await q(`select e.full_name from employee_services es join employees e on e.id=es.employee_id join services s on s.id=es.service_id where s.name='Tinte' and e.active`)).map((r) => r.full_name).sort();
    assert(hacen.length > 0, "alguien debe tener marcado Tinte");
    assert((await sel.locator("optgroup[label='Hacen este servicio'] option").allTextContents()).sort().join() === hacen.join(), "primero, quienes tienen marcado Tinte: " + hacen.join(", "));
    assert((await sel.locator("optgroup[label='Otras especialistas'] option", { hasText: "E2E Ana" }).count()) === 1, "E2E Ana (que no hace Tinte) debe aparecer en «Otras especialistas»");
    await sel.selectOption({ label: "E2E Ana" });
    await dialog().getByRole("button", { name: "Crear cita" }).click();
    await expectVisible(toast("Cita creada"), "toast", 10000);
    const [r] = await q(`select l.employee_id from appointment_services l join appointments a on a.id=l.appointment_id join clients c on c.id=a.client_id where c.phone_normalized='8295559105'`);
    assert(r.employee_id === anaId, "la línea quedó con E2E Ana");
  });
  await step("Sin límites en el panel: se puede registrar una cita de ayer (avisa que la hora ya pasó pero la guarda)", async () => {
    await page.goto(BASE + "/admin/appointments");
    await page.getByRole("button", { name: "+ Nueva cita" }).click();
    await expectVisible(dialog(), "diálogo");
    await page.locator("#n-phone").fill("829-555-9106"); await page.locator("#n-fn").fill("E2E"); await page.locator("#n-ln").fill("Ayer");
    await page.locator("#n-when").fill(`${dr(-1)}T09:00`);
    await page.locator("#n-emp").selectOption({ label: "E2E Ana" });
    await page.getByLabel("Buscar servicio").fill("Lavado");
    await page.getByRole("checkbox", { name: /Lavado y Secado.*Pelo corto/ }).check();
    await expectVisible(dialog().getByText(/ya pasó/), "aviso de hora pasada", 10000);
    await dialog().getByRole("button", { name: "Crear cita" }).click();
    await expectVisible(toast("Cita creada"), "toast", 10000);
    const [r] = await q(`select (a.start_time at time zone 'America/Santo_Domingo')::text s from appointments a join clients c on c.id=a.client_id where c.phone_normalized='8295559106'`);
    assert(r.s.startsWith(dr(-1) + " 09:00"), "guardada para ayer: " + r.s);
  });

  section("Reserva en línea: tope de citas simultáneas (editable en Configuración)");
  await step("Por defecto la web no tiene tope: con 3 citas ya a las 11:00 sigue ofreciendo esa hora con E2E Ana", async () => {
    const a = await slots(anaId); const any = await slots("any");
    assert(a.slots.some((s) => s.time === "11:00" && true), "sin tope, E2E Ana se ofrece a las 11:00 aunque ya tenga 3 citas: " + JSON.stringify(a.error));
    assert(any.slots.some((s) => s.time === "11:00"), "con 'cualquiera' también");
  });
  await step("Configuración → Reservas: muestra «0 = sin límite»; con 2 la web deja de ofrecer la hora llena y con 0 vuelve a ofrecerla", async () => {
    await page.goto(BASE + "/admin/settings?tab=reservas");
    await expectVisible(page.getByLabel(/Citas al mismo tiempo por especialista/), "campo de citas simultáneas");
    assert((await page.locator("#bk-sim").inputValue()) === "0", "el valor por defecto es 0 (sin límite)");
    await expectVisible(page.getByText(/0 = sin límite/), "explicación");
    await page.locator("#bk-sim").fill("2");
    await page.getByRole("button", { name: "Guardar reservas" }).click();
    await expectVisible(toast("Reservas guardadas"), "toast", 10000);
    assert((await q(`select (value->>'max_simultaneous')::int m from business_settings where key='booking'`))[0].m === 2, "ajuste guardado");
    await until(async () => { const a = await slots(anaId); return !a.slots.some((s) => s.time === "11:00") && a.slots.length > 0; }, "con tope 2 y 3 citas, E2E Ana ya no se ofrece a las 11:00", 20000);
    assert((await slots(beaId)).slots.some((s) => s.time === "11:00"), "E2E Bea (libre) sí se ofrece");
    await page.locator("#bk-sim").fill("0");
    await page.getByRole("button", { name: "Guardar reservas" }).click();
    await until(async () => (await q(`select (value->>'max_simultaneous')::int m from business_settings where key='booking'`))[0].m === 0, "ajuste guardado en 0", 10000);
    await until(async () => (await slots(anaId)).slots.some((s) => s.time === "11:00"), "con 0 (sin límite) vuelve a ofrecerse", 20000);
  });
  await step("El tope no acepta valores fuera de 0 a 10", async () => {
    await page.goto(BASE + "/admin/settings?tab=reservas");
    await page.locator("#bk-sim").fill("11");
    await page.getByRole("button", { name: "Guardar reservas" }).click();
    await expectVisible(page.getByText(/Máximo 10/), "mensaje de máximo", 10000);
    assert((await q(`select (value->>'max_simultaneous')::int m from business_settings where key='booking'`))[0].m === 0, "no debe cambiar");
  });

  await step("Reserva real desde la web (el caso del dueño): 1 servicio de RD$ 600 → hay horarios y la solicitud se crea", async () => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + "/services");
    await page.locator("article", { hasText: "Lavado y Secado" }).first().getByRole("button", { name: /Agregar/ }).click();
    await page.locator("article", { hasText: "Lavado y Secado" }).first().getByRole("radio", { name: /Pelo corto/ }).click();
    await page.getByRole("link", { name: "Continuar reserva" }).click();
    await page.waitForURL("**/booking");
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.locator("#other-date").fill(DAY);
    await expectVisible(page.getByRole("radio", { name: /AM|PM/ }), "horarios del día", 15000);
    assert((await page.getByRole("radio", { name: /AM|PM/ }).count()) > 5, "debe haber varios horarios");
    assert((await page.getByText(/No hay horarios disponibles/).count()) === 0, "no debe decir que no hay horarios");
    await page.getByRole("radio", { name: /AM|PM/ }).first().click();
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("E2E");
    await page.getByLabel("Apellido").fill("Web");
    await page.locator("#phone").fill("829-555-9104");
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("button", { name: "Confirmar solicitud" }).click();
    await expectVisible(page.getByText("Solicitud recibida"), "éxito", 15000);
    const [a] = await q(`select a.status, a.source, e.full_name emp from appointments a join clients c on c.id=a.client_id left join appointment_services l on l.appointment_id=a.id left join employees e on e.id=l.employee_id where c.phone_normalized='8295559104'`);
    assert(a && a.status === "solicitud" && a.source === "website" && a.emp && !/^E2E/.test(a.emp), JSON.stringify(a));
  });

  section("Cumpleaños de las especialistas");
  const [, bm, bd] = today.split("-").map(Number);
  await step("En la ficha se elige día y mes; se guarda y no deja fechas imposibles", async () => {
    await page.goto(`${BASE}/admin/staff/${anaId}`);
    await page.getByLabel("Mes de cumpleaños").selectOption("2");
    const days = await page.getByLabel("Día de cumpleaños").locator("option").count();
    assert(days === 30, "febrero muestra 29 días (+ la opción «Día»): " + days);
    await page.getByLabel("Día de cumpleaños").selectOption(String(bd <= 28 ? bd : 28));
    await page.getByLabel("Mes de cumpleaños").selectOption(String(bm));
    await page.getByLabel("Día de cumpleaños").selectOption(String(bd));
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expectVisible(toast("Especialista guardado"), "toast", 10000);
    const [e] = await q(`select birth_month m, birth_day d from employees where id=$1`, [anaId]);
    assert(e.m === bm && e.d === bd, JSON.stringify(e));
  });
  await step("Hoy es su cumpleaños: llega la notificación (campana), una sola vez, y lleva a su ficha", async () => {
    await q(`select generate_reminders()`); await q(`select generate_reminders()`);
    const nn = await q(`select count(*)::int c from notifications where type='cumpleanos' and employee_id=$1`, [anaId]);
    assert(nn[0].c === 1, "debe haber exactamente una: " + nn[0].c);
    await page.goto(BASE + "/admin/calendar");
    await page.getByRole("button", { name: /Notificaciones/ }).click();
    const item = page.getByRole("link", { name: /Hoy cumple años E2E Ana/ });
    await expectVisible(item, "notificación de cumpleaños");
    await item.click();
    await page.waitForURL(`**/admin/staff/${anaId}`, { timeout: 10000 });
  });
  await step("La lista de especialistas marca 🎂 Hoy y el dashboard lista el cumpleaños", async () => {
    await page.goto(BASE + "/admin/staff");
    await expectVisible(page.getByText("🎂 Hoy"), "etiqueta de cumpleaños en la lista");
    await expectVisible(page.getByText(/Cumpleaños: \d+ de \w+/), "fecha del cumpleaños en la lista");
    await page.goto(BASE + "/admin");
    await expectVisible(page.getByRole("heading", { name: /Cumpleaños del equipo/ }), "tarjeta del dashboard");
    await expectVisible(page.getByRole("link", { name: /E2E Ana/ }), "E2E Ana en la tarjeta");
  });

  section("Horarios por defecto y avisos");
  await step("Una especialista nueva nace con el horario del negocio y el panel avisa que falta asignarle servicios", async () => {
    await page.goto(BASE + "/admin/staff/new");
    await page.locator("#e-name").fill("E2E Nueva");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.waitForURL((u) => /\/admin\/staff\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 15000 });
    const id = page.url().split("/").pop();
    const sc = await q(`select weekday from employee_schedules where employee_id=$1 order by weekday`, [id]);
    assert(sc.length === wdOpen.length, `horario copiado del negocio: ${sc.length} de ${wdOpen.length} días`);
    await expectVisible(page.getByText("Sin servicios asignados."), "aviso de servicios");
    assert((await page.getByText("Sin horario de trabajo.").count()) === 0, "no debe avisar de horario");
    await q(`update employees set active=false, accepts_online_booking=false where id=$1`, [id]); // ya no hace falta que sea visible
  });
  await step("«Marcar todos» selecciona de una vez todos los servicios de una categoría", async () => {
    const first = page.locator("fieldset").first();
    await first.getByRole("button", { name: "Marcar todos" }).click();
    const boxes = first.getByRole("checkbox");
    const total = await boxes.count();
    for (let i = 0; i < total; i++) assert(await boxes.nth(i).isChecked(), `servicio ${i + 1} sin marcar`);
    await first.getByRole("button", { name: "Quitar todos" }).click();
    for (let i = 0; i < total; i++) assert(!(await boxes.nth(i).isChecked()), `servicio ${i + 1} sigue marcado`);
  });
  await step("Un servicio que nadie hace: el panel lo avisa y la web lo explica en vez de 'No hay horarios'", async () => {
    const [cat] = await q(`select category_id from services where slug=$1`, [SVC]);
    const [svc] = await q(`insert into services (name, slug, category_id, price, duration_minutes, active) values ('E2E Servicio sin nadie','e2e-sin-nadie',$1,500,30,true) returning id`, [cat.category_id]);
    // asignado solo a una especialista inactiva (la de la prueba anterior): nadie activo lo realiza
    await q(`insert into employee_services (employee_id, service_id) values ((select id from employees where full_name='E2E Nueva'), $1)`, [svc.id]);
    await page.goto(BASE + "/admin/services");
    const row = page.getByRole("row", { name: /E2E Servicio sin nadie/ });
    await expectVisible(row.getByText("Nadie lo realiza"), "aviso en la fila");
    await q(`update services set active=false where slug='e2e-sin-nadie'`); // fuera del catálogo público
    const sid = (await q(`select id from services where slug='e2e-sin-nadie'`))[0].id;
    // el catálogo público tarda unos minutos en refrescarse: se prueba con el motor, que lee en vivo
    const r = await slots("any", sid, null);
    assert(r.slots.length === 0 && /no hay una especialista disponible para «E2E Servicio sin nadie»/.test(r.error ?? ""), JSON.stringify(r));
  });
} finally {
  await cleanup();
}

const code = summary(errors);
await browser.close();
await db.end();
process.exit(code);
