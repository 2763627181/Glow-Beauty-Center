import pg from "pg";
import { BASE, assert, expectVisible, launch, login, section, setPage, step, summary, until } from "./h.mjs";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;
const PHONE = "8295557601";
const cleanup = async () => {
  await q(`delete from appointments where client_id in (select id from clients where phone_normalized=$1)`, [PHONE]);
  await q(`delete from clients where phone_normalized=$1`, [PHONE]);
};
await cleanup();

const nextDay = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
let wd = 5; while ([0, 6].includes(new Date(nextDay(wd) + "T12:00:00-04:00").getUTCDay())) wd++;
const DAY = nextDay(wd);
const man = (await q(`select id from services where slug='manicure'`))[0].id;

const { browser, page, errors } = await launch();
setPage(page);
await login(page, "tmp-admin@glow.test");

section("Tiempo real (sin recargar la página)");
await step("Una solicitud nueva aparece sola en el tablero, con aviso y contador", async () => {
  await page.goto(BASE + "/admin/appointments/board");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500); // da tiempo a que el canal de Realtime se suscriba
  const badge = async () => { const b = page.getByRole("button", { name: /Notificaciones/ }); return Number(((await b.getAttribute("aria-label")) ?? "").match(/(\d+) sin leer/)?.[1] ?? 0); };
  const before = await badge();
  await q(`select create_booking(jsonb_build_object('first_name','Realtime','last_name','Prueba','phone',$1::text,'source','website','start_time',$2::text,
    'services',jsonb_build_array(jsonb_build_object('service_id',$3::uuid)))) r`, [PHONE, `${DAY}T10:00:00-04:00`, man]);
  await expectVisible(page.locator("article", { hasText: "Realtime Prueba" }), "la tarjeta aparece sin recargar", 15000);
  await until(async () => (await badge()) > before, "sube el contador de notificaciones", 10000);
  await expectVisible(page.getByText(/Nueva solicitud/).first(), "aviso emergente");
});
await step("Cambiar el estado desde otro lado mueve la tarjeta de columna", async () => {
  await q(`update appointments set status='confirmado' where client_id in (select id from clients where phone_normalized=$1)`, [PHONE]);
  await until(async () => (await page.locator('section[aria-label="Confirmado"] article', { hasText: "Realtime Prueba" }).count()) === 1, "la tarjeta pasa a Confirmado", 15000);
  assert((await page.locator('section[aria-label="Solicitud"] article', { hasText: "Realtime Prueba" }).count()) === 0, "ya no debe estar en Solicitud");
});
await step("Una cita eliminada desaparece del tablero", async () => {
  await cleanup();
  await until(async () => (await page.locator("article", { hasText: "Realtime Prueba" }).count()) === 0, "la tarjeta desaparece", 15000);
});
await step("El dashboard y la lista de citas también reaccionan", async () => {
  await page.goto(BASE + "/admin/appointments");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
  await q(`select create_booking(jsonb_build_object('first_name','Realtime','last_name','Prueba','phone',$1::text,'source','website','start_time',$2::text,
    'services',jsonb_build_array(jsonb_build_object('service_id',$3::uuid)))) r`, [PHONE, `${DAY}T11:00:00-04:00`, man]);
  await expectVisible(page.getByText("Realtime Prueba").first(), "la lista se actualiza sola", 15000);
});

await cleanup();
await db.end();
const code = summary(errors);
await browser.close();
process.exit(code);
