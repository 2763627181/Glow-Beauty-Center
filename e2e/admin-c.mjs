import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { BASE, assert, expectVisible, launch, login, section, setPage, step, summary, until } from "./h.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;
const { browser, page, errors } = await launch();
setPage(page);
const toast = (t) => page.getByText(t, { exact: false }).first();
const dialog = () => page.getByRole("dialog");
const pubHtml = async (path) => (await page.request.get(BASE + path)).text();
const nextDay = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
let wd = 3; while ([0, 6].includes(new Date(nextDay(wd) + "T12:00:00-04:00").getUTCDay())) wd++;
const DAY = nextDay(wd);
await login(page, "tmp-admin@glow.test");

section("Promociones (administración + reserva con descuento)");
await step("Una promoción sin servicios se rechaza", async () => {
  await page.goto(BASE + "/admin/promotions");
  await page.getByRole("button", { name: "+ Nueva promoción" }).click();
  await page.locator("#p-n").fill("Combo E2E");
  await page.locator("#p-p").fill("1000");
  await dialog().getByRole("button", { name: "Guardar" }).click();
  await expectVisible(dialog().getByText(/al menos un servicio/), "mensaje de validación");
});
await step("Crear promoción (Manicure + Pintura gel, RD$ 1,000) y verla en la web al instante", async () => {
  await page.locator("#p-o").fill("1300");
  await dialog().getByLabel("Manicure", { exact: true }).check();
  await dialog().getByLabel("Pintura de manos Gel", { exact: true }).check();
  await dialog().getByRole("button", { name: "Guardar" }).click();
  await expectVisible(toast("Promoción guardada"), "toast", 10000);
  const html = await pubHtml("/");
  assert(html.includes("Combo E2E") && html.includes("RD$ 1,000"), "la promoción debe verse en la home de inmediato");
});
await step("«Reservar este combo» lleva los servicios y el descuento a la reserva", async () => {
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: "Reservar este combo" }).first().click();
  await page.waitForURL("**/booking");
  await expectVisible(page.getByText(/Combo “Combo E2E”/).first(), "descuento en el resumen");
  await expectVisible(page.getByText("RD$ 1,000").first(), "total con promoción");
});
await step("Completar la reserva del combo: se guarda con descuento y vínculo a la promoción", async () => {
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.locator("#other-date").fill(DAY);
  await expectVisible(page.getByRole("radio", { name: /AM|PM/ }), "horarios", 12000);
  await page.getByRole("radio", { name: /AM|PM/ }).first().click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill("Promo");
  await page.getByLabel("Apellido").fill("E2E");
  await page.locator("#phone").fill("829-555-7300");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Confirmar solicitud" }).click();
  await expectVisible(page.getByText("Solicitud recibida"), "éxito", 15000);
  const [a] = await q(`select a.discount, a.estimated_total, a.promotion_id is not null promo from appointments a join clients c on c.id=a.client_id where c.phone_normalized='8295557300'`);
  assert(Number(a.discount) === 300 && Number(a.estimated_total) === 1000 && a.promo, JSON.stringify(a));
});
await step("Editar el precio de la promoción, desactivarla (sale de la web) y eliminarla", async () => {
  await page.goto(BASE + "/admin/promotions");
  await page.locator("article", { hasText: "Combo E2E" }).getByRole("button", { name: "Editar" }).click();
  await page.locator("#p-p").fill("900");
  await dialog().getByLabel(/Activa/).uncheck();
  await dialog().getByRole("button", { name: "Guardar" }).click();
  await expectVisible(toast("Promoción guardada"), "toast", 10000);
  await until(async () => !(await pubHtml("/")).includes("Combo E2E"), "la promoción inactiva sale de la web");
  await page.locator("article", { hasText: "Combo E2E" }).getByRole("button", { name: "Eliminar" }).click();
  await dialog().getByRole("button", { name: "Eliminar" }).click();
  await until(async () => (await q(`select count(*)::int c from promotions where name='Combo E2E'`))[0].c === 0, "promoción eliminada");
});

section("Galería");
// La prueba cambia la portada y el orden de la galería: se guarda el estado real para devolverlo al terminar
const galleryBefore = await q(`select id, display_order, is_cover from gallery`);
await step("Subir una imagen real, editar título, portada, ocultar y mover", async () => {
  await page.goto(BASE + "/admin/gallery");
  await page.locator("#g-t").fill("E2E foto");
  await page.setInputFiles('input[type="file"]', HERE + "/fixtures/photo.jpg");
  await expectVisible(toast("Imagen agregada"), "subida", 20000);
  const [g] = await q(`select id, category, storage_path, image_url from gallery where title='E2E foto'`);
  assert(g && g.category === "unas" && g.storage_path, JSON.stringify(g));
  const img = await page.request.get(g.image_url);
  assert(img.status() === 200 && (img.headers()["content-type"] ?? "").startsWith("image/"), "la imagen subida debe ser pública");
  assert((await pubHtml("/gallery")).includes("E2E foto"), "debe verse en la galería al instante");
  const card = page.locator('article:has(input[value="E2E foto"])');
  await card.getByRole("button", { name: "Portada", exact: true }).click();
  await until(async () => (await q(`select is_cover from gallery where title='E2E foto'`))[0].is_cover === true, "portada");
  assert((await q(`select count(*)::int c from gallery where is_cover`))[0].c === 1, "solo una portada");
  await card.getByRole("button", { name: "Ocultar" }).click();
  await until(async () => !(await pubHtml("/gallery")).includes("E2E foto"), "la imagen oculta sale de la web");
  await card.getByRole("button", { name: "Mostrar" }).click();
  await until(async () => (await pubHtml("/gallery")).includes("E2E foto"), "la imagen vuelve a la web");
  await card.getByRole("button", { name: "Mover antes" }).click();
  await page.waitForTimeout(800);
});
await step("Eliminar una imagen la borra de la galería y del almacenamiento", async () => {
  const [g] = await q(`select storage_path from gallery where title='E2E foto'`);
  assert(g?.storage_path, "la imagen de prueba debe existir (¿falló el paso anterior?)");
  assert((await q(`select count(*)::int c from storage.objects where bucket_id='gallery' and name=$1`, [g.storage_path]))[0].c === 1, "el archivo debe estar en el almacenamiento antes de borrar");
  await page.goto(BASE + "/admin/gallery");
  await page.locator('article:has(input[value="E2E foto"])').getByRole("button", { name: "Eliminar" }).click();
  await dialog().getByRole("button", { name: "Eliminar" }).click();
  await until(async () => (await q(`select count(*)::int c from gallery where title='E2E foto'`))[0].c === 0, "fila eliminada");
  // se verifica el objeto en Storage (la URL pública puede seguir sirviéndose unos minutos desde la caché del CDN)
  await until(async () => (await q(`select count(*)::int c from storage.objects where bucket_id='gallery' and name=$1`, [g.storage_path]))[0].c === 0, "el archivo debe borrarse del almacenamiento");
});
await step("Una imagen que no es foto o es muy pesada se rechaza", async () => {
  await page.goto(BASE + "/admin/gallery");
  await page.waitForLoadState("networkidle");
  await page.setInputFiles('input[type="file"]', { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hola") });
  await expectVisible(page.getByRole("alert").filter({ hasText: /JPG, PNG, WebP o AVIF/ }), "rechazo por tipo");
  await page.setInputFiles('input[type="file"]', { name: "grande.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(6 * 1024 * 1024, 1) });
  await expectVisible(page.getByRole("alert").filter({ hasText: /5 MB/ }), "rechazo por tamaño");
  assert((await q(`select count(*)::int c from gallery where title is null and created_at > now() - interval '2 minutes'`))[0].c === 0, "no debe crearse ninguna fila con un archivo rechazado");
});

section("Configuración (todo editable y reflejado en la web)");
await step("Negocio: cambiar nombre y redes se refleja al instante; se restaura", async () => {
  await page.goto(BASE + "/admin/settings?tab=negocio");
  const original = await page.locator("#b-name").inputValue();
  await page.locator("#b-name").fill("Glow E2E Studio");
  await page.locator("#b-instagram").fill("glow_e2e");
  await page.getByRole("button", { name: "Guardar datos del negocio" }).click();
  await expectVisible(toast("Datos guardados"), "toast", 10000);
  await until(async () => { const h = await pubHtml("/contact"); return h.includes("glow_e2e"); }, "el Instagram aparece en Contacto");
  const home = await pubHtml("/");
  assert(home.includes("Glow E2E Studio"), "el nombre debe cambiar en la web");
  await page.locator("#b-name").fill(original); await page.locator("#b-instagram").fill("");
  await page.getByRole("button", { name: "Guardar datos del negocio" }).click();
  await until(async () => (await q(`select value->>'name' n from business_settings where key='business'`))[0].n === original, "nombre restaurado");
});
await step("Un WhatsApp inválido se rechaza", async () => {
  await page.goto(BASE + "/admin/settings?tab=negocio");
  const original = await page.locator("#b-whatsapp").inputValue();
  await page.locator("#b-whatsapp").fill("829-619");
  await page.getByRole("button", { name: "Guardar datos del negocio" }).click();
  await expectVisible(page.getByText(/solo dígitos con código de país/), "validación");
  assert((await q(`select value->>'whatsapp' w from business_settings where key='business'`))[0].w === original, "no debe guardarse");
});
await step("Sitio web: el título principal editado aparece en la home; se restablece", async () => {
  await page.goto(BASE + "/admin/settings?tab=sitio");
  await page.locator("#sc-hero_title").fill("Título E2E editable");
  await page.locator("#sc-contact_title").fill("Escríbenos E2E");
  await page.locator("#sc-contact_text").fill("Texto de contacto E2E");
  await page.locator("#sc-services_page_title").fill("Catálogo E2E");
  await page.locator("#sc-booking_text").fill("Texto de reservas E2E");
  await page.locator("#sc-team_title").fill("Equipo E2E");
  await page.getByRole("button", { name: "Guardar contenido del sitio" }).click();
  await expectVisible(toast("Contenido del sitio guardado"), "toast", 10000);
  await until(async () => (await pubHtml("/")).includes("Título E2E editable"), "el título nuevo en la home");
  await until(async () => { const h = await pubHtml("/contact"); return h.includes("Escríbenos E2E") && h.includes("Texto de contacto E2E"); }, "textos de Contacto editados");
  await until(async () => (await pubHtml("/services")).includes("Catálogo E2E"), "título de Servicios editado");
  await until(async () => (await pubHtml("/booking")).includes("Texto de reservas E2E"), "texto de Reservas editado");
  await until(async () => (await pubHtml("/about")).includes("Equipo E2E") || !(await q(`select 1 from employees where active and accepts_online_booking limit 1`)).length, "título del equipo editado");
  await page.getByRole("button", { name: "Restablecer textos originales" }).click();
  await page.getByRole("button", { name: "Guardar contenido del sitio" }).click();
  await until(async () => !(await pubHtml("/")).includes("Título E2E editable"), "título restablecido");
  await until(async () => { const h = await pubHtml("/contact"); return h.includes("Hablemos") && !h.includes("Escríbenos E2E"); }, "Contacto restablecido");
  const html = await pubHtml("/");
  assert(html.includes("Tu momento. Tu belleza."), "texto original");
  assert((await q(`select value->>'hero_image_url' u from business_settings where key='site_content'`))[0].u, "restablecer no debe perder la foto de portada");
});
await step("Horarios y bloqueos: un feriado elimina los horarios de ese día", async () => {
  const man = (await q("select id from services where slug='manicure'"))[0].id;
  const slots = async () => (await (await page.request.post(BASE + "/api/availability", { data: { date: DAY, employeeId: "any", items: [{ serviceId: man, addonIds: [] }] } })).json()).slots.length;
  assert((await slots()) > 0, "debe haber horarios antes del bloqueo");
  await page.goto(BASE + "/admin/settings?tab=horarios");
  await page.locator("#bl-a").fill(`${DAY}T00:00`); await page.locator("#bl-b").fill(`${DAY}T23:59`); await page.locator("#bl-r").fill("Feriado E2E");
  await page.getByRole("button", { name: "Agregar bloqueo" }).click();
  await expectVisible(toast("Bloqueo agregado"), "toast", 10000);
  assert((await slots()) === 0, "con feriado no debe haber horarios");
  await page.getByRole("button", { name: "Quitar" }).first().click();
  await until(async () => (await slots()) > 0, "los horarios vuelven al quitar el bloqueo");
});
await step("Horarios: cambiar el horario del domingo y restaurarlo", async () => {
  await page.goto(BASE + "/admin/settings?tab=horarios");
  const dom = page.getByLabel("Domingo", { exact: true });
  const was = await dom.isChecked();
  await dom.setChecked(!was);
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expectVisible(toast("Horario guardado"), "toast", 10000);
  const [h] = await q(`select value->'0' d from business_settings where key='hours'`);
  assert((h.d !== null) === !was, "el domingo debe cambiar");
  await page.getByLabel("Domingo", { exact: true }).setChecked(was);
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await until(async () => ((await q(`select value->'0' d from business_settings where key='hours'`))[0].d !== null) === was, "domingo restaurado");
});
await step("Reservas: ajustar anticipación y restaurar", async () => {
  await page.goto(BASE + "/admin/settings?tab=reservas");
  const was = await page.locator("#bk-min").inputValue();
  await page.locator("#bk-min").fill("7");
  await page.getByRole("button", { name: "Guardar reservas" }).click();
  await expectVisible(toast("Reservas guardadas"), "toast", 10000);
  assert((await q(`select (value->>'min_notice_hours')::int m from business_settings where key='booking'`))[0].m === 7, "anticipación");
  await page.locator("#bk-min").fill(was);
  await page.getByRole("button", { name: "Guardar reservas" }).click();
  await until(async () => (await q(`select (value->>'min_notice_hours')::int m from business_settings where key='booking'`))[0].m === Number(was), "restaurado");
});
await step("Métodos de pago: agregar, renombrar, ordenar y eliminar", async () => {
  await page.goto(BASE + "/admin/settings?tab=pagos");
  await page.getByRole("button", { name: "+ Agregar método" }).click();
  await page.locator("#pm-l").fill("Zelle E2E");
  await dialog().getByRole("button", { name: "Guardar" }).click();
  await expectVisible(toast("Método guardado"), "toast", 10000);
  await expectVisible(page.getByText("Zelle E2E"), "método nuevo");
  await page.getByRole("button", { name: "Subir Zelle E2E" }).click();
  await page.waitForTimeout(700);
  await page.locator("li", { hasText: "Zelle E2E" }).getByRole("button", { name: "Editar" }).click();
  await page.locator("#pm-l").fill("Zelle E2E 2");
  await dialog().getByRole("button", { name: "Guardar" }).click();
  await expectVisible(page.getByText("Zelle E2E 2"), "renombrado");
  await page.locator("li", { hasText: "Zelle E2E 2" }).getByRole("button", { name: "Eliminar" }).click();
  await dialog().getByRole("button", { name: "Eliminar" }).click();
  await until(async () => (await q(`select count(*)::int c from payment_methods where label like 'Zelle E2E%'`))[0].c === 0, "método eliminado");
});
await step("WhatsApp: la plantilla editada se usa en el botón de la cita", async () => {
  const r = (await q(`select create_booking(jsonb_build_object('first_name','Plantilla','last_name','E2E','phone','8295557301','status','confirmado','start_time',$1::text,'services',jsonb_build_array(jsonb_build_object('service_id',(select id from services where slug='manicure'))))) r`, [new Date(Date.now() + 15 * 864e5).toISOString()]))[0].r;
  await page.goto(BASE + "/admin/settings?tab=whatsapp");
  await page.locator("#wa-confirm").fill("E2E-PLANTILLA {nombre} te esperamos el {fecha} a las {hora}");
  await page.getByRole("button", { name: "Guardar plantillas" }).click();
  await expectVisible(toast("Plantillas guardadas"), "toast", 10000);
  await page.goto(BASE + "/admin/appointments?q=Plantilla");
  await page.getByRole("button", { name: "Abrir" }).first().click();
  const href = await dialog().getByRole("link", { name: /Hablar por WhatsApp/ }).getAttribute("href");
  const text = decodeURIComponent(href.split("text=")[1]);
  assert(text.startsWith("E2E-PLANTILLA Plantilla te esperamos el "), "mensaje: " + text);
  assert(href.includes("wa.me/1829"), "debe ir al teléfono de la clienta: " + href);
  await page.keyboard.press("Escape");
  await page.goto(BASE + "/admin/settings?tab=whatsapp");
  await page.getByRole("button", { name: "Restablecer originales" }).click();
  await page.getByRole("button", { name: "Guardar plantillas" }).click();
  await expectVisible(toast("Plantillas guardadas"), "restaurado", 10000);
  assert(r.id, "ok");
});
await step("Integraciones: muestra el estado de Google Calendar", async () => {
  await page.goto(BASE + "/admin/settings?tab=integraciones");
  await expectVisible(page.getByRole("heading", { name: "Google Calendar" }), "sección");
  await expectVisible(page.getByText("No configurado"), "estado sin credenciales");
});

section("Usuarios y cuenta");
await step("Crear usuario, editar rol, cambiar contraseña y eliminar", async () => {
  await page.goto(BASE + "/admin/users");
  await page.getByRole("button", { name: "+ Nuevo usuario" }).click();
  await page.locator("#us-n").fill("Nuevo E2E");
  await page.locator("#us-e").fill("tmp-nuevo@glow.test");
  await page.locator("#us-p").fill("abc");
  await dialog().getByRole("button", { name: "Guardar" }).click();
  await expectVisible(dialog().getByText(/al menos 10 caracteres/), "contraseña débil rechazada");
  await page.locator("#us-p").fill("ClaveSegura-2026");
  await dialog().getByRole("button", { name: "Guardar" }).click();
  await expectVisible(toast("Usuario creado"), "toast", 12000);
  await page.locator("tr", { hasText: "tmp-nuevo@glow.test" }).getByRole("button", { name: "Editar" }).click();
  await page.locator("#us-r").selectOption({ label: "Gerente" });
  await dialog().getByRole("button", { name: "Guardar" }).click();
  await expectVisible(toast("Usuario actualizado"), "toast", 10000);
  assert((await q(`select p.role from profiles p join auth.users u on u.id=p.id where u.email='tmp-nuevo@glow.test'`))[0].role === "manager", "rol");
  await page.locator("tr", { hasText: "tmp-nuevo@glow.test" }).getByRole("button", { name: "Contraseña" }).click();
  await page.locator("#us-np").fill("OtraClave-2026!");
  await dialog().getByRole("button", { name: "Cambiar contraseña" }).click();
  await expectVisible(toast("Contraseña actualizada"), "toast", 10000);
  await page.locator("tr", { hasText: "tmp-nuevo@glow.test" }).getByRole("button", { name: "Eliminar" }).click();
  await dialog().getByRole("button", { name: "Eliminar" }).click();
  await until(async () => (await q(`select count(*)::int c from auth.users where email='tmp-nuevo@glow.test'`))[0].c === 0, "usuario eliminado");
});
await step("Protecciones: correo repetido y no se puede eliminar a uno mismo", async () => {
  await page.goto(BASE + "/admin/users");
  await page.getByRole("button", { name: "+ Nuevo usuario" }).click();
  await page.locator("#us-n").fill("Repetido"); await page.locator("#us-e").fill("tmp-manager@glow.test"); await page.locator("#us-p").fill("ClaveSegura-2026");
  await dialog().getByRole("button", { name: "Guardar" }).click();
  await expectVisible(dialog().getByText(/ya tiene cuenta/), "correo repetido");
  await page.keyboard.press("Escape");
  const me = page.locator("tr", { hasText: "tmp-admin@glow.test" });
  assert((await me.getByRole("button", { name: "Eliminar" }).count()) === 0, "no debe poder eliminarse a sí mismo");
  await me.getByRole("button", { name: "Editar" }).click();
  await page.locator("#us-r").selectOption({ label: "Recepción" });
  await dialog().getByRole("button", { name: "Guardar" }).click();
  await expectVisible(dialog().getByText(/No puedes quitarte tu propio rol/), "no puede degradarse a sí mismo");
});
await step("Mi cuenta: cambiar nombre y validar contraseñas", async () => {
  await page.goto(BASE + "/admin/account");
  await page.locator("#ac-n").fill("E2E Admin Renombrado");
  await page.getByRole("button", { name: "Guardar nombre" }).click();
  await expectVisible(toast("Nombre actualizado"), "toast", 10000);
  await page.locator("#ac-n").fill("E2E Admin");
  await page.getByRole("button", { name: "Guardar nombre" }).click();
  await page.locator("#ac-p1").fill("ClaveNueva-2026"); await page.locator("#ac-p2").fill("Distinta-2026");
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expectVisible(page.getByText("no coinciden"), "contraseñas distintas");
});

section("Auditoría, reportes, notificaciones");
await step("Auditoría: registra lo hecho y filtra por módulo", async () => {
  await page.goto(BASE + "/admin/audit");
  await expectVisible(page.locator("tbody tr"), "movimientos");
  const n = await page.locator("tbody tr").count();
  assert(n >= 10, "movimientos: " + n);
  await page.locator("#au-e").selectOption("promotions");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expectVisible(page.getByRole("cell", { name: "Promociones" }).first(), "filas de promociones");
  assert((await page.getByRole("cell", { name: "Ventas" }).count()) === 0, "el filtro debe excluir otros módulos");
});
await step("Reportes: rangos, rango personalizado y exportaciones", async () => {
  for (const label of ["Hoy", "Ayer", "7 días", "30 días", "Este mes", "Mes anterior"]) {
    await page.goto(BASE + "/admin/reports");
    await page.getByRole("link", { name: label, exact: true }).click();
    await expectVisible(page.getByText("Ingresos totales"), `reporte ${label}`);
  }
  await page.goto(BASE + "/admin/reports");
  await page.locator("#from").fill(nextDay(-10)); await page.locator("#to").fill(nextDay(0));
  await page.getByRole("button", { name: "Aplicar rango" }).click();
  await expectVisible(page.getByText("Comisiones por especialista"), "reporte personalizado");
  const r = await page.request.get(BASE + "/admin/reports/export?range=30d&type=resumen");
  assert(r.status() === 200 && (await r.text()).includes("Ingresos"), "csv resumen");
});
await step("Campana de notificaciones: lista, marca como leída y marca todo", async () => {
  await q(`select generate_reminders()`);
  await page.goto(BASE + "/admin");
  const bell = page.getByRole("button", { name: /Notificaciones/ });
  await bell.click();
  const unreadBefore = await q(`select count(*)::int c from notifications where read_at is null`);
  await expectVisible(page.getByRole("button", { name: "Marcar todo leído" }), "panel de notificaciones con pendientes");
  await page.getByRole("button", { name: "Marcar todo leído" }).click();
  await until(async () => (await q(`select count(*)::int c from notifications where read_at is null`))[0].c === 0, "todo leído", 10000);
  assert(unreadBefore[0].c > 0, "debía haber notificaciones sin leer");
});

console.log("\nLimpieza de datos de prueba…");
await q(`delete from appointments where client_id in (select id from clients where phone_normalized in ('8295557300','8295557301'))`);
await q(`delete from clients where phone_normalized in ('8295557300','8295557301')`);
await q(`delete from promotions where name like 'Combo E2E%'`);
await q(`delete from schedule_blocks where reason='Feriado E2E'`);
for (const g of galleryBefore) await q(`update gallery set display_order=$2, is_cover=$3 where id=$1`, [g.id, g.display_order, g.is_cover]);
await db.end();
const code = summary(errors);
await browser.close();
process.exit(code);
