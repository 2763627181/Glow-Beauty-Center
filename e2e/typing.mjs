import pg from "pg";
import { BASE, PASSWORD, assert, expectVisible, launch, section, setPage, step, summary, until } from "./h.mjs";

/* Pruebas «como una persona»: tecla por tecla, con pausas, Tab, Enter y Backspace (fill() esconde los problemas de foco). */
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;
const PHONES = ["8295557501", "8295557502", "8295557503"];
const cleanup = async () => {
  await q(`delete from sales where client_id in (select id from clients where phone_normalized = any($1))`, [PHONES]);
  await q(`delete from appointments where client_id in (select id from clients where phone_normalized = any($1))`, [PHONES]);
  await q(`delete from clients where phone_normalized = any($1)`, [PHONES]);
};
await cleanup();

const nextDay = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
let wd = 4; while ([0, 6].includes(new Date(nextDay(wd) + "T12:00:00-04:00").getUTCDay())) wd++;
const DAY = nextDay(wd);
const ana = (await q(`select id from employees where full_name like 'Ana%'`))[0].id;
const man = (await q(`select id from services where slug='manicure'`))[0].id;
const book = (last, phone, time) => q(
  `select create_booking(jsonb_build_object('first_name','Teclado','last_name',$1::text,'phone',$2::text,'status','confirmado','start_time',$3::text,
     'services',jsonb_build_array(jsonb_build_object('service_id',$4::uuid,'employee_id',$5::uuid)))) r`, [last, phone, `${DAY}T${time}:00-04:00`, man, ana]);
await book("Uno", PHONES[0], "09:00");
await book("Dos", PHONES[1], "10:30");

const { browser, page, errors } = await launch();
setPage(page);
const focusedId = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName);

section("Administración");
await step("Iniciar sesión escribiendo y pulsando Enter", async () => {
  await page.goto(BASE + "/admin/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Correo").click();
  await page.keyboard.type("tmp-admin@glow.test", { delay: 35 });
  await page.keyboard.press("Tab");
  await page.keyboard.type(PASSWORD, { delay: 35 });
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 });
});
await step("Buscador de clientes: escribir despacio no pierde el foco ni letras", async () => {
  await page.goto(BASE + "/admin/clients");
  await page.waitForLoadState("networkidle");
  await page.locator("#search-q").click();
  await page.keyboard.type("Tec", { delay: 450 }); // más lento que el debounce: la URL cambia entre letras
  await page.keyboard.type("lado", { delay: 90 });
  await page.waitForTimeout(900);
  assert((await focusedId()) === "search-q", "el foco se perdió: " + (await focusedId()));
  assert((await page.locator("#search-q").inputValue()) === "Teclado", "texto: " + (await page.locator("#search-q").inputValue()));
  await until(async () => new URL(page.url()).searchParams.get("q") === "Teclado", "q=Teclado en la dirección");
  await expectVisible(page.getByText("Teclado Uno").first(), "Teclado Uno");
  await expectVisible(page.getByText("Teclado Dos").first(), "Teclado Dos");
  await page.keyboard.type(" Uno", { delay: 120 });
  await until(async () => (await page.getByText("Teclado Dos").count()) === 0, "se filtra a una sola persona");
});
await step("Buscador global: «/» enfoca, se escribe y se entra a la ficha", async () => {
  await page.goto(BASE + "/admin");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("/");
  assert((await focusedId()) === "gsearch", "«/» no enfocó el buscador: " + (await focusedId()));
  await page.keyboard.type("Teclado Uno", { delay: 70 });
  const hit = page.getByRole("link", { name: /Teclado Uno/ }).first();
  await expectVisible(hit, "resultado", 10000);
  assert((await focusedId()) === "gsearch", "el buscador perdió el foco mientras mostraba resultados");
  await hit.click();
  await page.waitForURL(/\/admin\/clients\/[0-9a-f-]{36}$/);
});
await step("Cobro: borrar el precio, escribir decimales y que no queden ceros delante", async () => {
  await page.goto(BASE + "/admin/appointments?q=Teclado%20Uno");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Abrir", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Cobrar", exact: true }).click();
  const price = page.getByRole("spinbutton", { name: /Precio de Manicure/ });
  await expectVisible(price, "precio de la línea");
  await price.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  assert((await price.inputValue()) === "", "al borrar debe quedar vacío, no «0»: «" + (await price.inputValue()) + "»");
  await page.keyboard.type("1275.5", { delay: 70 });
  assert((await price.inputValue()) === "1275.5", "decimales: «" + (await price.inputValue()) + "»");
  await expectVisible(page.getByRole("dialog").getByText(/1,275\.50/).first(), "el total se actualiza con los decimales");
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("900", { delay: 70 });
  assert((await price.inputValue()) === "900", "sin cero a la izquierda: «" + (await price.inputValue()) + "»");
  await page.keyboard.press("Tab");
  assert((await price.inputValue()) === "900", "al salir del campo: «" + (await price.inputValue()) + "»");
  // la cantidad no puede quedar en 0: se corrige a 1
  const qty = page.getByRole("spinbutton", { name: /Cantidad de Manicure/ });
  await qty.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("0");
  await until(async () => (await qty.inputValue()) === "1", "la cantidad mínima es 1");
  await page.keyboard.press("Escape");
});
await step("Producto: precio con decimales escrito a mano se guarda tal cual", async () => {
  await page.goto(BASE + "/admin/services?tab=productos");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Nuevo producto|\+ Producto|Agregar producto/ }).first().click();
  await page.keyboard.type("Crema Teclado", { delay: 40 }); // el foco debe estar ya en el primer campo
  await page.locator("#pr-p").click();
  await page.keyboard.type("349.75", { delay: 60 });
  assert((await page.locator("#pr-p").inputValue()) === "349.75", "precio: " + (await page.locator("#pr-p").inputValue()));
  await page.getByRole("dialog").getByRole("button", { name: "Guardar" }).click();
  await until(async () => (await q(`select price from products where name='Crema Teclado'`))[0]?.price == 349.75, "producto guardado con 349.75");
  await q(`delete from products where name='Crema Teclado'`);
});

section("Reserva pública (como una clienta)");
await step("Escribir los datos con teclado (con tildes y espacios en el teléfono) y reservar", async () => {
  await page.evaluate(() => localStorage.clear());
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
  await page.getByLabel("Nombre", { exact: true }).click();
  await page.keyboard.type("Sofía", { delay: 60 });
  await page.keyboard.press("Tab");
  await page.keyboard.type("Rodríguez Peña", { delay: 60 });
  await page.keyboard.press("Tab");
  await page.keyboard.type("829 555 7503", { delay: 60 });
  await page.keyboard.press("Tab");
  await page.keyboard.type("sofia.rodriguez@example.com", { delay: 40 });
  assert((await page.getByLabel("Nombre", { exact: true }).inputValue()) === "Sofía", "nombre con tilde");
  assert((await page.getByLabel("Apellido").inputValue()) === "Rodríguez Peña", "apellido con tilde y espacio");
  assert((await page.locator("#phone").inputValue()) === "829 555 7503", "teléfono: " + (await page.locator("#phone").inputValue()));
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Confirmar solicitud" }).click();
  await expectVisible(page.getByText("Solicitud recibida"), "éxito", 15000);
  const [c] = await q(`select first_name, last_name, phone_normalized from clients where phone_normalized=$1`, [PHONES[2]]);
  assert(c && c.first_name === "Sofía" && c.last_name === "Rodríguez Peña", JSON.stringify(c));
});

console.log("\nLimpieza de datos de prueba…");
await cleanup();
await db.end();
const code = summary(errors);
await browser.close();
process.exit(code);
