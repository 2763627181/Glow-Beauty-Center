import pg from "pg";
import { BASE, assert, expectVisible, launch, login, section, setPage, step, summary, until } from "./h.mjs";

/* Sincronización con Google Calendar contra un servidor simulado (mock-google.mjs en :4010).
   El servidor de la web debe haberse iniciado con GOOGLE_* y GOOGLE_API_BASE / GOOGLE_OAUTH_URL apuntando al simulado. */
const MOCK = "http://127.0.0.1:4010";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;
const log = async () => (await (await fetch(MOCK + "/_log")).json());
const events = async () => (await log()).filter((l) => l.kind === "event");
const mockCall = (path) => fetch(MOCK + path, { method: "POST" });

const PHONES = ["8295557901", "8295557902", "8295557903", "8295557904"];
const cleanup = async () => {
  await q(`delete from appointments where client_id in (select id from clients where phone_normalized = any($1))`, [PHONES]);
  await q(`delete from clients where phone_normalized = any($1)`, [PHONES]);
};
await cleanup();
await mockCall("/_reset");
await q(`update calendar_integrations set last_error=null, last_sync_at=null where provider='google'`);

const nextDay = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
let wd = 3; while ([0, 6].includes(new Date(nextDay(wd) + "T12:00:00-04:00").getUTCDay())) wd++;
const DAY = nextDay(wd);
const man = (await q(`select id from services where slug='manicure'`))[0].id;
const ana = (await q(`select id from employees where full_name like 'Ana%'`))[0].id;
const book = async (last, phone, time, status = "confirmado") => (await q(
  `select create_booking(jsonb_build_object('first_name','GCal','last_name',$1::text,'phone',$2::text,'status',$3::text,'start_time',$4::text,'services',jsonb_build_array(jsonb_build_object('service_id',$5::uuid,'employee_id',$6::uuid)))) r`,
  [last, phone, status, `${DAY}T${time}:00-04:00`, man, ana]))[0].r;
const eventId = async (phone) => (await q(`select a.google_calendar_event_id id from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1`, [phone]))[0]?.id ?? null;

const { browser, page, errors } = await launch();
setPage(page);
const toast = (t) => page.getByText(t, { exact: false }).first();
const openAppt = async (q_) => { await page.goto(BASE + "/admin/appointments?q=" + encodeURIComponent(q_)); await page.waitForLoadState("networkidle"); await page.getByRole("button", { name: "Abrir", exact: true }).first().click(); await page.getByRole("dialog").waitFor(); };

await login(page, "tmp-admin@glow.test");

section("Google Calendar (servidor simulado)");
await step("El panel muestra la integración como conectada", async () => {
  await page.goto(BASE + "/admin/settings?tab=integraciones");
  await expectVisible(page.getByText("Conectado (credenciales en el servidor)"), "estado conectado");
  await expectVisible(page.getByRole("button", { name: /Enviar citas pendientes/ }), "botón de envío");
});
await step("Una reserva de la web crea el evento (título, especialista, hora, zona horaria) y guarda su id", async () => {
  await page.goto(BASE + "/services");
  await page.locator("article", { hasText: "Manicure" }).first().getByRole("button", { name: /Agregar/ }).click();
  await page.getByRole("link", { name: "Continuar reserva" }).click();
  await page.waitForURL("**/booking");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.locator("#other-date").fill(DAY);
  await expectVisible(page.getByRole("radio", { name: /AM|PM/ }), "horarios", 12000);
  await page.getByRole("radio", { name: /AM|PM/ }).last().click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill("GCal");
  await page.getByLabel("Apellido").fill("Web");
  await page.locator("#phone").fill("829-555-7901");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Confirmar solicitud" }).click();
  await expectVisible(page.getByText("Solicitud recibida"), "éxito", 15000);
  await until(async () => (await events()).some((e) => e.method === "POST"), "el evento llega a Google", 10000);
  const post = (await events()).find((e) => e.method === "POST");
  assert(post.auth === "Bearer mock-token" && post.calendar === "calendario-prueba@example.com", JSON.stringify({ a: post.auth, c: post.calendar }));
  assert(/^Solicitud - GCal Web - Manicure$/.test(post.body.summary), post.body.summary);
  assert(post.body.start.timeZone === "America/Santo_Domingo" && post.body.colorId === "5", JSON.stringify(post.body.start) + post.body.colorId);
  assert(/Teléfono: 829-555-7901|Teléfono: 8295557901/.test(post.body.description) && /Servicios: Manicure/.test(post.body.description), post.body.description);
  await until(async () => !!(await eventId(PHONES[0])), "se guarda el id del evento", 8000);
  const tok = (await log()).find((l) => l.kind === "token");
  assert(tok.grant === "refresh_token" && tok.refresh === "refresh-prueba", "intercambio OAuth con refresh token: " + JSON.stringify(tok));
});
await step("Cambiar el estado desde el panel actualiza el mismo evento (PATCH, no uno nuevo)", async () => {
  const id = await eventId(PHONES[0]);
  await q(`update appointments set status='contactado' where id=(select a.id from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1)`, [PHONES[0]]);
  await openAppt("GCal Web");
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await until(async () => (await events()).some((e) => e.method === "PATCH" && e.id === id && /^CONFIRMADA - /.test(e.body.summary)), "PATCH con CONFIRMADA", 10000);
  const patch = (await events()).filter((e) => e.method === "PATCH").at(-1);
  assert(patch.body.colorId === "10", "color verde: " + patch.body.colorId);
  assert((await events()).filter((e) => e.method === "POST").length === 1, "no debe crear eventos duplicados");
});
await step("«Sincronizar con Google Calendar» funciona, y si el evento se borró en Google se crea de nuevo", async () => {
  const oldId = await eventId(PHONES[0]);
  await openAppt("GCal Web");
  await page.getByRole("dialog").getByRole("button", { name: "Sincronizar con Google Calendar" }).click();
  await expectVisible(toast("Sincronizada con Google Calendar"), "aviso de éxito", 10000);
  await mockCall(`/_gone/${oldId}`); // alguien lo borró a mano en Google
  await page.keyboard.press("Escape");
  await openAppt("GCal Web");
  await page.getByRole("dialog").getByRole("button", { name: "Sincronizar con Google Calendar" }).click();
  await until(async () => (await eventId(PHONES[0])) && (await eventId(PHONES[0])) !== oldId, "se crea un evento nuevo y se guarda su id", 10000);
  assert((await events()).filter((e) => e.method === "POST").length === 2, "dos POST en total");
});
await step("La clienta cancela desde «Mi cita»: el evento queda cancelado en Google", async () => {
  const id = await eventId(PHONES[0]);
  const [a] = await q(`select a.request_number from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1`, [PHONES[0]]);
  await page.goto(`${BASE}/booking/manage?number=${a.request_number}`);
  await page.waitForLoadState("networkidle");
  await page.locator("#m-p").fill("829-555-7901");
  await page.getByRole("button", { name: "Consultar mi cita" }).click();
  await page.getByRole("button", { name: "Cancelar mi cita" }).click();
  await page.getByRole("button", { name: "Sí, cancelar" }).click();
  await until(async () => (await events()).some((e) => e.method === "PATCH" && e.id === id && e.body.status === "cancelled"), "PATCH con status cancelled", 12000);
  assert(/^CANCELADA - /.test((await events()).filter((e) => e.method === "PATCH").at(-1).body.summary), "título CANCELADA");
});
await step("Cancelar una cita que nunca estuvo en el calendario no llama a Google", async () => {
  await book("Sin evento", PHONES[1], "09:30");
  const before = (await events()).length;
  await openAppt("GCal Sin evento");
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar cita", exact: true }).click();
  await page.getByRole("dialog").filter({ hasText: "¿Cancelar la cita?" }).getByRole("button", { name: "Cancelar cita" }).click();
  await until(async () => (await q(`select a.status from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1`, [PHONES[1]]))[0].status === "cancelado", "cita cancelada");
  await new Promise((r) => setTimeout(r, 2500));
  assert((await events()).length === before, "no debe haber llamadas nuevas a Calendar");
});
await step("Eliminar una cita también elimina su evento de Google", async () => {
  await book("Borrar", PHONES[2], "11:00");
  await openAppt("GCal Borrar");
  await page.getByRole("dialog").getByRole("button", { name: "Sincronizar con Google Calendar" }).click();
  await until(async () => !!(await eventId(PHONES[2])), "el evento se crea", 10000);
  const id = await eventId(PHONES[2]);
  await page.keyboard.press("Escape");
  await openAppt("GCal Borrar");
  await page.getByRole("dialog").getByRole("button", { name: "Eliminar definitivamente" }).click();
  await page.getByRole("dialog").filter({ hasText: "¿Eliminar la cita?" }).getByRole("button", { name: "Eliminar", exact: true }).click();
  await until(async () => (await events()).some((e) => e.method === "DELETE" && e.id === id), "DELETE del evento", 10000);
});
await step("Si Google falla, la recepcionista no se entera: la acción funciona y el error queda registrado", async () => {
  await mockCall("/_fail/on");
  await book("Falla", PHONES[3], "13:00", "contactado");
  await openAppt("GCal Falla");
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar", exact: true }).click();
  await until(async () => (await q(`select a.status from appointments a join clients c on c.id=a.client_id where c.phone_normalized=$1`, [PHONES[3]]))[0].status === "confirmado", "el estado cambia aunque Google falle");
  await until(async () => /Google Calendar 500/.test((await q(`select last_error from calendar_integrations where provider='google'`))[0].last_error ?? ""), "queda registrado el error", 10000);
  await page.goto(BASE + "/admin/settings?tab=integraciones");
  await expectVisible(page.getByText(/último error: Error: Google Calendar 500/), "el panel muestra el último error");
});
await step("Al volver Google, «Enviar citas pendientes» sincroniza y limpia el error", async () => {
  await mockCall("/_fail/off");
  await page.getByRole("button", { name: /Enviar citas pendientes/ }).click();
  await expectVisible(toast("cita(s) enviada(s) al calendario"), "resultado", 15000);
  await until(async () => (await q(`select last_error from calendar_integrations where provider='google'`))[0].last_error === null, "el error se limpia", 8000);
  assert(!!(await eventId(PHONES[3])), "la cita pendiente quedó con evento");
});

await cleanup();
await q(`update calendar_integrations set last_error=null, last_sync_at=null where provider='google'`);
await db.end();
const code = summary(errors);
await browser.close();
process.exit(code);
