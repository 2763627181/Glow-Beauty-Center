import pg from "pg";
import { BASE, assert, axeViolations, expectVisible, launch, login, section, setPage, step, summary, until } from "./h.mjs";

/* Varias especialistas por servicio (equipos) y servicios al mismo tiempo: panel (cliente sin cita, nueva cita, editar, reprogramar,
   completar), agenda, venta, y reserva en la web. Seguro para la base real: solo crea y borra filas propias («E2E Eq …», teléfonos
   829555920x); las especialistas de prueba solo son visibles en la web durante la prueba de la reserva pública (segundos). */
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;
const { browser, page, errors } = await launch();
setPage(page);
const dialog = () => page.getByRole("dialog");
const toast = (t) => page.getByText(t, { exact: false }).first();
const PHONES = ["8295559201", "8295559202", "8295559203"];
const dr = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
const hours = (await q(`select value from business_settings where key='hours'`))[0].value;
let n = 5; while (!hours[String(new Date(dr(n) + "T12:00:00-04:00").getUTCDay())]) n++;
const DAY = dr(n);
const wdOpen = Object.entries(hours).filter(([, h]) => h && h.open && h.close);
const svc = async (name) => (await q(`select id, price::float p, duration_minutes d, (duration_minutes + buffer_before_minutes + buffer_after_minutes) span from services where name=$1`, [name]))[0];
const MANI = await svc("Manicure"), PEDI = await svc("Pedicure");

async function cleanup() {
  const appts = await q(`select a.id from appointments a join clients c on c.id=a.client_id where c.phone_normalized = any($1)`, [PHONES]);
  const lines = appts.length ? await q(`select id from appointment_services where appointment_id = any($1)`, [appts.map((a) => a.id)]) : [];
  const sales = appts.length ? await q(`select id from sales where appointment_id = any($1)`, [appts.map((a) => a.id)]) : [];
  const items = sales.length ? await q(`select id from sale_items where sale_id = any($1)`, [sales.map((s) => s.id)]) : [];
  const emps = await q(`select id from employees where full_name like 'E2E Eq %'`);
  const clients = await q(`select id from clients where phone_normalized = any($1)`, [PHONES]);
  const ids = [...appts, ...lines, ...sales, ...items, ...emps, ...clients].map((r) => r.id);
  await q(`delete from sales where appointment_id = any($1)`, [appts.map((a) => a.id)]);
  await q(`delete from appointments where client_id in (select id from clients where phone_normalized = any($1))`, [PHONES]);
  await q(`delete from clients where phone_normalized = any($1)`, [PHONES]);
  await q(`delete from employees where full_name like 'E2E Eq %'`);
  if (ids.length) await q(`delete from audit_logs where entity_id = any($1::uuid[])`, [ids]);
}
await cleanup();

// Tres especialistas de prueba con el horario del negocio que hacen Manicure y Pedicure (no visibles en la web hasta la prueba pública)
const mkEmp = async (name) => {
  const [e] = await q(`insert into employees (full_name, active, accepts_online_booking) values ($1, true, false) returning id`, [name]);
  for (const [wd, h] of wdOpen) await q(`insert into employee_schedules (employee_id, weekday, start_time, end_time) values ($1,$2,$3,$4)`, [e.id, Number(wd), h.open, h.close]);
  for (const s of [MANI, PEDI]) await q(`insert into employee_services (employee_id, service_id) values ($1,$2)`, [e.id, s.id]);
  return e.id;
};
const A = await mkEmp("E2E Eq A"), B = await mkEmp("E2E Eq B"), C = await mkEmp("E2E Eq C");
const nameOf = { [A]: "A", [B]: "B", [C]: "C" };
const lineRows = async (phone) => q(`select l.name, l.employee_id, l.final_price::float fp, l.start_time, l.end_time, l.parallel, l.team_id, l.position, a.id appt, a.status, a.source, a.end_time aend
  from appointment_services l join appointments a on a.id=l.appointment_id join clients c on c.id=a.client_id where c.phone_normalized=$1 order by l.position, l.id`, [phone]);

try {
  await login(page, "tmp-admin@glow.test");

  section("Panel: cliente sin cita que se hace manicure y pedicure");
  await step("Cliente sin cita: manicure con DOS especialistas y pedicure con otra, al mismo tiempo", async () => {
    await page.goto(BASE + "/admin/appointments");
    await page.getByRole("button", { name: "Cliente sin cita" }).click();
    await expectVisible(dialog(), "diálogo");
    await page.locator("#n-phone").fill("829-555-9201"); await page.locator("#n-fn").fill("E2E"); await page.locator("#n-ln").fill("Sin cita");
    await page.locator("#n-st").selectOption("en_servicio");
    await dialog().locator("label", { hasText: /^Manicure\s*RD\$/ }).locator("input").check();
    await dialog().locator("label", { hasText: /^Pedicure\s*RD\$/ }).locator("input").check();
    const mani = page.getByRole("group", { name: "Especialistas para Manicure" }), pedi = page.getByRole("group", { name: "Especialistas para Pedicure" });
    await mani.getByLabel("E2E Eq A").check(); await mani.getByLabel("E2E Eq B").check();
    await expectVisible(mani.getByText(/Las 2 trabajan este servicio al mismo tiempo/), "aviso de equipo");
    await pedi.getByLabel("E2E Eq C").check();
    await dialog().getByLabel("Al mismo tiempo que el servicio anterior").check();
    await dialog().getByRole("button", { name: "Registrar" }).click();
    await expectVisible(toast("Cliente registrado"), "toast", 10000);
    const r = await lineRows("8295559201");
    assert(r.length === 3, "tres líneas: " + r.length);
    const manis = r.filter((x) => x.name === "Manicure"), pedi1 = r.find((x) => x.name === "Pedicure");
    assert(manis.length === 2 && new Set(manis.map((x) => x.employee_id)).size === 2 && manis.every((x) => [A, B].includes(x.employee_id)), "manicure con A y B");
    assert(pedi1.employee_id === C, "pedicure con C");
    assert(r.every((x) => +x.start_time === +r[0].start_time), "las 3 líneas empiezan a la vez");
    assert(manis[0].team_id && manis[0].team_id === manis[1].team_id && pedi1.team_id === null, "el manicure es un equipo; el pedicure no");
    assert(Math.abs(manis[0].fp + manis[1].fp - MANI.p) < 0.005 && Math.abs(pedi1.fp - PEDI.p) < 0.005, `precios: ${manis.map((x) => x.fp)} / ${pedi1.fp}`);
    assert(r[0].status === "en_servicio" && r[0].source === "walk_in", "estado y origen");
    const longest = Math.max(...r.map((x) => +x.end_time));
    assert(+r[0].aend === longest, "la cita termina cuando termina su servicio más largo");
  });
  await step("La ficha de la cita muestra un solo manicure con sus dos especialistas", async () => {
    await page.goto(BASE + "/admin/appointments?q=E2E");
    await page.getByRole("button", { name: "Abrir" }).first().click();
    await expectVisible(dialog().getByText(/Manicure.*E2E Eq A \+ E2E Eq B/), "manicure con las dos especialistas");
    assert((await dialog().getByText(/^Manicure/).count()) === 1, "el manicure aparece una sola vez");
    await expectVisible(dialog().getByText(/Pedicure.*E2E Eq C/), "pedicure con la tercera");
  });
  await step("Completar: la venta guarda una línea por especialista y el reparto exacto", async () => {
    await dialog().getByRole("button", { name: "Completar" }).click();
    await expectVisible(toast("Cita completada"), "toast", 15000);
    const [sale] = await q(`select s.id, s.total::float t from sales s join appointments a on a.id=s.appointment_id join clients c on c.id=a.client_id where c.phone_normalized='8295559201'`);
    const items = await q(`select employee_id, total::float t, team_id from sale_items where sale_id=$1 order by employee_id`, [sale.id]);
    assert(items.length === 3 && Math.abs(items.reduce((s, i) => s + i.t, 0) - (MANI.p + PEDI.p)) < 0.005, "tres artículos que suman el total: " + JSON.stringify(items));
    const eq = items.filter((i) => i.team_id);
    assert(eq.length === 2 && eq[0].team_id === eq[1].team_id, "las dos del manicure comparten equipo");
    await page.goto(`${BASE}/admin/sales/${sale.id}`);
    for (const nm of ["E2E Eq A", "E2E Eq B", "E2E Eq C"]) await expectVisible(page.getByText(nm).first(), `${nm} en la venta`);
    await page.goto(BASE + "/admin/sales?q=E2E");
    const row = page.getByRole("row", { name: /Manicure/ }).first();
    await expectVisible(row, "la venta en la lista");
    assert(((await row.innerText()).match(/Manicure/g) ?? []).length === 1, "la lista muestra el manicure una sola vez");
  });

  section("Panel: cita futura con equipos, agenda, edición y reprogramación");
  await step("Nueva cita con equipos (manicure con A y B, pedicure con C «al mismo tiempo»)", async () => {
    await page.goto(BASE + "/admin/appointments");
    await page.getByRole("button", { name: "+ Nueva cita" }).click();
    await expectVisible(dialog(), "diálogo");
    await page.locator("#n-phone").fill("829-555-9202"); await page.locator("#n-fn").fill("E2E"); await page.locator("#n-ln").fill("Equipo");
    await page.locator("#n-when").fill(`${DAY}T10:00`);
    await dialog().locator("label", { hasText: /^Manicure\s*RD\$/ }).locator("input").check();
    await dialog().locator("label", { hasText: /^Pedicure\s*RD\$/ }).locator("input").check();
    const mani = page.getByRole("group", { name: "Especialistas para Manicure" }), pedi = page.getByRole("group", { name: "Especialistas para Pedicure" });
    await mani.getByLabel("E2E Eq A").check(); await mani.getByLabel("E2E Eq B").check(); await pedi.getByLabel("E2E Eq C").check();
    await dialog().getByLabel("Al mismo tiempo que el servicio anterior").check();
    // La duración mostrada es la del servicio más largo (no la suma)
    const dur = Math.max(MANI.d, PEDI.d);
    await expectVisible(dialog().getByText(new RegExp(`· ${dur} min`)), "duración del bloque");
    await dialog().getByRole("button", { name: "Crear cita" }).click();
    await expectVisible(toast("Cita creada"), "toast", 10000);
    const r = await lineRows("8295559202");
    assert(r.length === 3 && r.every((x) => +x.start_time === +r[0].start_time), "tres líneas a la vez");
  });
  await step("Agenda: cada especialista ve su parte a la misma hora, en su propia columna", async () => {
    await page.goto(`${BASE}/admin/calendar?view=day&date=${DAY}`);
    const chips = page.getByRole("button", { name: /^E2E, 10:00/ });
    await until(async () => (await chips.count()) === 3, "3 bloques (uno por especialista) en la agenda");
    const tops = [];
    for (let i = 0; i < 3; i++) tops.push(Math.round((await chips.nth(i).boundingBox()).y));
    assert(new Set(tops).size === 1, "los tres empiezan a la misma altura: " + tops.join(","));
    for (const nm of ["E2E Eq A", "E2E Eq B", "E2E Eq C"]) await expectVisible(page.locator("div", { hasText: new RegExp(`^${nm}$`) }).first(), `columna de ${nm}`);
  });
  await step("Editar: «+ Otra especialista» en el pedicure reparte el precio y deja a las dos a la vez", async () => {
    await page.goto(BASE + "/admin/appointments?q=Equipo");
    await page.getByRole("button", { name: "Abrir" }).first().click();
    await dialog().getByRole("button", { name: "Editar", exact: true }).click();
    await expectVisible(page.getByRole("heading", { name: /Editar cita/ }), "editor");
    await page.getByRole("button", { name: "Sumar otra especialista a Pedicure" }).click();
    const sels = page.getByLabel("Especialista para Pedicure");
    assert((await sels.count()) === 2, "ahora hay dos líneas de pedicure");
    await sels.nth(1).selectOption({ label: "E2E Eq A" });
    const half = PEDI.p / 2;
    assert((await page.getByLabel("Precio de Pedicure").first().inputValue()) === String(half) && (await page.getByLabel("Precio de Pedicure").nth(1).inputValue()) === String(half), "el precio se reparte en partes iguales");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expectVisible(toast("Cita actualizada"), "toast", 10000);
    const r = await lineRows("8295559202");
    const ped = r.filter((x) => x.name === "Pedicure");
    assert(ped.length === 2 && new Set(ped.map((x) => x.employee_id)).size === 2 && ped[0].team_id && ped[0].team_id === ped[1].team_id, "pedicure en equipo: " + JSON.stringify(ped.map((x) => [nameOf[x.employee_id], x.team_id ? "equipo" : "solo"])));
    assert(Math.abs(ped[0].fp + ped[1].fp - PEDI.p) < 0.005, "el equipo suma el precio del pedicure");
    assert(r.every((x) => +x.start_time === +r[0].start_time), "las 4 líneas siguen a la vez");
  });
  await step("Reprogramar mueve todo junto y conserva «al mismo tiempo»", async () => {
    await page.goto(BASE + "/admin/appointments?q=Equipo");
    await page.getByRole("button", { name: "Abrir" }).first().click();
    await dialog().getByRole("button", { name: "Reprogramar" }).click();
    await page.locator("#rs-when").fill(`${DAY}T14:00`);
    await dialog().getByRole("button", { name: "Guardar nueva hora" }).click();
    await expectVisible(toast("Cita reprogramada"), "toast", 10000);
    const r = await lineRows("8295559202");
    assert(r.length === 4 && r.every((x) => +x.start_time === +r[0].start_time), "las 4 líneas empiezan a la vez");
    const [h] = await q(`select to_char(start_time at time zone 'America/Santo_Domingo','HH24:MI') h from appointments where id=$1`, [r[0].appt]);
    assert(h.h === "14:00", "nueva hora " + h.h);
  });

  section("Reserva en la web con equipos y al mismo tiempo");
  const slots = async (items, parallel) => {
    await q(`update employees set accepts_online_booking=true where full_name like 'E2E Eq %'`);
    try {
      return await (await fetch(`${BASE}/api/availability`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: DAY, employeeId: "any", items, parallel }) })).json();
    } finally { await q(`update employees set accepts_online_booking=false where full_name like 'E2E Eq %'`); }
  };
  const sel = (s, employeeIds) => ({ serviceId: s.id, variantId: null, addonIds: [], employeeIds });
  await step("El motor exige que TODAS las del equipo estén libres a la vez (y respeta «al mismo tiempo»)", async () => {
    const [{ id: off }] = await q(`insert into employee_time_off (employee_id, starts_at, ends_at, reason) values ($1,$2,$3,'E2E') returning id`, [A, `${DAY}T10:00:00-04:00`, `${DAY}T11:00:00-04:00`]);
    try {
      const team = await slots([sel(MANI, [A, B]), sel(PEDI, [C])], true);
      const soloB = await slots([sel(MANI, [B]), sel(PEDI, [C])], true);
      assert(team.slots.length > 0 && soloB.slots.length > 0, "debe haber horarios: " + JSON.stringify(team.error ?? soloB.error));
      assert(!team.slots.some((s) => s.time === "10:00" || s.time === "10:15"), "con A ausente de 10 a 11 el equipo A+B no puede empezar a las 10:00");
      assert(soloB.slots.some((s) => s.time === "10:00"), "solo con B sí se ofrece a las 10:00");
      const seq = await slots([sel(MANI, [B]), sel(PEDI, [C])], false), par = await slots([sel(MANI, [B]), sel(PEDI, [C])], true);
      assert(seq.totalMinutes === MANI.span + PEDI.span && par.totalMinutes === Math.max(MANI.span, PEDI.span), `duración: seguidos ${seq.totalMinutes} / a la vez ${par.totalMinutes}`);
    } finally { await q(`delete from employee_time_off where id=$1`, [off]); }
  });
  await step("Una especialista que no hace el servicio se rechaza con un mensaje claro", async () => {
    const mayra = (await q(`select id, full_name from employees where full_name ilike 'mayra%' and active limit 1`))[0];
    if (!mayra) return; // solo si existe en la base
    const r = await slots([sel(MANI, [mayra.id])], false);
    assert(r.slots.length === 0 && /no realiza «Manicure»/.test(r.error ?? ""), JSON.stringify(r));
  });
  await step("Clienta: elige varias especialistas por servicio y pide que la atiendan al mismo tiempo; la solicitud queda completa", async () => {
    await q(`update employees set accepts_online_booking=true where full_name like 'E2E Eq %'`);
    try {
      // Guardar una ficha refresca la caché pública de especialistas y servicios (las de prueba se crearon directo en la base)
      await page.goto(`${BASE}/admin/staff/${A}`);
      await page.getByRole("button", { name: "Guardar", exact: true }).click();
      await expectVisible(toast("Especialista guardado"), "toast", 10000);
      const pub = await launch(); setPage(pub.page);
      try {
        const w = pub.page;
        await w.goto(BASE + "/services");
        await w.evaluate(() => localStorage.clear());
        await w.goto(BASE + "/services");
        await w.locator("article", { hasText: "Manicure" }).first().getByRole("button", { name: /Agregar/ }).click();
        await w.locator("article", { hasText: "Pedicure" }).first().getByRole("button", { name: /Agregar/ }).click();
        await w.getByRole("link", { name: "Continuar reserva" }).click();
        await w.waitForURL("**/booking");
        await w.getByRole("button", { name: "Continuar" }).click();
        // Paso «¿Con quién prefieres?»: una pregunta por servicio
        const mani = w.getByRole("group", { name: "Especialistas para Manicure" }), pedi = w.getByRole("group", { name: "Especialistas para Pedicure" });
        await expectVisible(mani, "pregunta del manicure"); await expectVisible(pedi, "pregunta del pedicure");
        await mani.getByRole("checkbox", { name: /E2E Eq A/ }).click(); await mani.getByRole("checkbox", { name: /E2E Eq B/ }).click();
        await expectVisible(w.getByText(/Las 2 especialistas que marcaste te atenderán/), "aviso de equipo");
        await pedi.getByRole("checkbox", { name: /E2E Eq C/ }).click();
        const found = [];
        const scan = async (label) => { const v = await axeViolations(w); if (v.length) found.push(`${label}: ${v.join(" | ")}`); };
        await scan("paso de especialistas");
        await w.getByLabel("Quiero que me atiendan al mismo tiempo").check();
        await w.getByRole("button", { name: "Continuar" }).click();
        await w.locator("#other-date").fill(DAY);
        await expectVisible(w.getByRole("radio", { name: /AM|PM/ }), "horarios", 15000);
        await w.getByRole("radio", { name: /AM|PM/ }).first().click();
        await w.getByRole("button", { name: "Continuar" }).click();
        await w.getByLabel("Nombre", { exact: true }).fill("E2E"); await w.getByLabel("Apellido").fill("Web");
        await w.locator("#phone").fill("829-555-9203");
        await w.getByRole("button", { name: "Continuar" }).click();
        await expectVisible(w.getByRole("button", { name: "Confirmar solicitud" }), "paso de confirmación");
        await expectVisible(w.getByText("Con E2E Eq A + E2E Eq B").first(), "resumen: el manicure con las dos");
        await expectVisible(w.getByText(/\(al mismo tiempo\)/).first(), "resumen: duración al mismo tiempo");
        await scan("confirmación");
        await w.getByRole("button", { name: "Confirmar solicitud" }).click();
        await expectVisible(w.getByText("Solicitud recibida"), "éxito", 20000);
        assert(found.length === 0, found.join(" ¦ "));
      } finally { await pub.browser.close(); setPage(page); }
    } finally { await q(`update employees set accepts_online_booking=false where full_name like 'E2E Eq %'`); }
    const r = await lineRows("8295559203");
    assert(r.length === 3 && r[0].source === "website" && r[0].status === "solicitud", "tres líneas, solicitud web: " + r.length);
    assert(r.every((x) => +x.start_time === +r[0].start_time), "las tres a la vez");
    const manis = r.filter((x) => x.name === "Manicure");
    assert(manis.length === 2 && new Set(manis.map((x) => x.employee_id)).size === 2 && manis.every((x) => [A, B].includes(x.employee_id)) && r.find((x) => x.name === "Pedicure").employee_id === C, "A y B en el manicure, C en el pedicure");
    assert(manis[0].team_id && manis[0].team_id === manis[1].team_id, "equipo");
    assert(Math.abs(r.reduce((s, x) => s + x.fp, 0) - (MANI.p + PEDI.p)) < 0.005, "el total es el de los dos servicios");
  });

  section("Accesibilidad del panel con equipos");
  await step("Accesibilidad (axe): nueva cita con equipos y editor de líneas sin violaciones", async () => {
    const found = [];
    const scan = async (label) => { const v = await axeViolations(page); if (v.length) found.push(`${label}: ${v.join(" | ")}`); };
    await page.goto(BASE + "/admin/appointments");
    await page.getByRole("button", { name: "+ Nueva cita" }).click();
    await dialog().locator("label", { hasText: /^Manicure\s*RD\$/ }).locator("input").check();
    await dialog().locator("label", { hasText: /^Pedicure\s*RD\$/ }).locator("input").check();
    await page.getByRole("group", { name: "Especialistas para Manicure" }).getByLabel("E2E Eq A").check();
    await scan("nueva cita con equipos"); await page.keyboard.press("Escape");
    await page.goto(BASE + "/admin/appointments?q=Equipo");
    await page.getByRole("button", { name: "Abrir" }).first().click();
    await dialog().getByRole("button", { name: "Editar", exact: true }).click();
    await expectVisible(page.getByRole("heading", { name: /Editar cita/ }), "editor");
    await scan("editar cita con equipos"); await page.keyboard.press("Escape");
    assert(found.length === 0, found.join(" ¦ "));
  });
} finally {
  await cleanup();
}

const code = summary(errors);
await browser.close();
await db.end();
process.exit(code);
