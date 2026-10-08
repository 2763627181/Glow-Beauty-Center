import { createClient } from "@supabase/supabase-js";
import { BASE, assert, axeViolations, expectVisible, launch, login, section, setPage, step, summary, until } from "./h.mjs";

/* Eliminar clientes, citas, solicitudes, ventas y notificaciones desde el panel (filas, selección múltiple, tablero, ficha, venta).
   Seguro para la base real: los datos de prueba son clientes «E2E Del …» (teléfonos 829555 30xx), ventas «E2E-DEL-…»;
   se crean y se limpian por la API (service role). Las notificaciones NO se borran aquí (se borrarían también las reales del dueño):
   la limpieza de avisos se prueba en `npm run verify:db`; aquí solo se comprueba que los botones están. */
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data; };
const { browser, page, errors } = await launch();
setPage(page);
const dialog = () => page.getByRole("dialog");
const toast = (t) => page.getByText(t, { exact: false }).first();
const dayOffset = (n) => new Date(Date.now() + n * 864e5).toISOString();
const SVC = (await must(sb.from("services").select("id,price").eq("name", "Manicure").limit(1)))[0];
let seq = 0;
const phone = () => `829555${String(3000 + seq++)}`; // 10 dígitos: 829555 + 4

async function cleanup() {
  const clients = await must(sb.from("clients").select("id").like("first_name", "E2E Del%"));
  const cids = clients.map((c) => c.id);
  const appts = cids.length ? await must(sb.from("appointments").select("id").in("client_id", cids)) : [];
  const aids = appts.map((a) => a.id);
  const sales = await must(sb.from("sales").select("id").like("sale_number", "E2E-DEL-%"));
  const sids = sales.map((s) => s.id);
  if (sids.length) { await must(sb.from("payments").delete().in("sale_id", sids).select("id")); await must(sb.from("sales").delete().in("id", sids).select("id")); }
  if (aids.length) { await must(sb.from("payments").delete().in("appointment_id", aids).select("id")); await must(sb.from("sales").delete().in("appointment_id", aids).select("id")); await must(sb.from("appointments").delete().in("id", aids).select("id")); }
  if (cids.length) await must(sb.from("clients").delete().in("id", cids).select("id"));
  // Auditoría de esta prueba (por id): nunca se tocan las filas del dueño
  const ids = [...cids, ...aids, ...sids];
  if (ids.length) await must(sb.from("audit_logs").delete().in("entity_id", ids).select("id"));
}
await cleanup();

// ── Datos de prueba
const mkClient = async (last) => (await must(sb.from("clients").insert({ first_name: `E2E Del ${last}`, last_name: "Prueba", phone: phone() }).select("id,first_name,phone").single()));
const mkAppt = async (last, status = "confirmado", hours = 400) => {
  const r = await must(sb.rpc("create_booking", { p: { first_name: `E2E Del ${last}`, last_name: "Prueba", phone: phone(), source: "admin", status, start_time: dayOffset(hours / 24), services: [{ service_id: SVC.id }] } }));
  return { id: r.id, client_id: r.client_id, name: `E2E Del ${last}` };
};
let saleN = 0;
/** Cita completada con su venta y un pago. */
const mkSold = async (last, amount = 600) => {
  const a = await mkAppt(last, "confirmado", 380);
  await must(sb.from("appointments").update({ status: "completado", final_total: amount, completed_at: new Date().toISOString() }).eq("id", a.id).select("id"));
  const s = await must(sb.from("sales").insert({ sale_number: `E2E-DEL-${++saleN}`, appointment_id: a.id, client_id: a.client_id, subtotal: amount, total: amount, payment_status: "pagado" }).select("id").single());
  await must(sb.from("sale_items").insert({ sale_id: s.id, description: "Manicure E2E", quantity: 1, unit_price: amount, total: amount }).select("id"));
  await must(sb.from("payments").insert({ sale_id: s.id, appointment_id: a.id, amount, method: "efectivo", status: "pagado" }).select("id"));
  return { ...a, sale_id: s.id, sale_number: `E2E-DEL-${saleN}` };
};
const exists = async (table, id) => (await must(sb.from(table).select("id").eq("id", id))).length === 1;
const count = async (table, col, id) => (await sb.from(table).select("id", { count: "exact", head: true }).eq(col, id)).count;

try {
  await login(page, "tmp-admin@glow.test");
  const list = async (q = "E2E Del") => { await page.goto(`${BASE}/admin/appointments?range=all&q=${encodeURIComponent(q)}`); };

  section("Solicitudes y citas: botón «Eliminar» en cada fila");
  const A = await mkAppt("Solicitud", "solicitud"), B = await mkAppt("Confirmada"), C = await mkSold("Completada"), D = await mkAppt("Cancelada", "cancelado");
  await step("Una solicitud se elimina con su botón (sin pedir confirmación extra: no hay dinero)", async () => {
    await list("Solicitud");
    await page.getByRole("button", { name: /Eliminar la solicitud de E2E Del Solicitud/ }).click();
    await expectVisible(dialog().getByText("¿Eliminar la solicitud?"), "diálogo");
    await expectVisible(dialog().getByText("1 cita o solicitud"), "resumen de lo que se borra");
    assert((await dialog().getByLabel("Entiendo que no se puede deshacer").count()) === 0, "sin dinero no debe pedir confirmación extra");
    await dialog().getByRole("button", { name: "Eliminar", exact: true }).click();
    await expectVisible(toast("Se eliminó: 1 cita."), "toast", 10000);
    await until(async () => !(await exists("appointments", A.id)), "la solicitud ya no existe");
    assert(await exists("appointments", B.id), "las demás siguen");
  });
  await step("Una cita COMPLETADA con venta y pago: muestra el dinero, exige confirmar y se lleva todo", async () => {
    await list("Completada");
    await page.getByRole("button", { name: /Eliminar la cita de E2E Del Completada/ }).click();
    await expectVisible(dialog().getByText(/1 venta por RD\$ 600/), "la venta que se borraría");
    await expectVisible(dialog().getByText(/1 pago \(RD\$ 600 cobrados\)/), "el pago que se borraría");
    await expectVisible(dialog().getByText("Incluye dinero registrado."), "aviso de dinero");
    const found = [];
    const v = await axeViolations(page); if (v.length) found.push(v.join(" | "));
    assert(await dialog().getByRole("button", { name: "Eliminar", exact: true }).isDisabled(), "sin confirmar no se puede eliminar");
    await dialog().getByLabel("Entiendo que no se puede deshacer").check();
    await dialog().getByRole("button", { name: "Eliminar", exact: true }).click();
    await expectVisible(toast("Se eliminó: 1 cita, 1 venta y 1 pago."), "toast", 10000);
    await until(async () => !(await exists("appointments", C.id)) && !(await exists("sales", C.sale_id)) && (await count("payments", "sale_id", C.sale_id)) === 0, "cita, venta y pago eliminados");
    assert(found.length === 0, "accesibilidad del diálogo: " + found.join(" ¦ "));
  });
  await step("Selección múltiple: se marcan varias, aparece la barra y se eliminan juntas", async () => {
    await list();
    await page.getByRole("checkbox", { name: /Seleccionar la cita de E2E Del Confirmada/ }).check();
    await page.getByRole("checkbox", { name: /Seleccionar la cita de E2E Del Cancelada/ }).check();
    await expectVisible(page.getByText("2 registros seleccionados"), "barra de selección");
    await page.getByRole("button", { name: "Eliminar seleccionados" }).click();
    await expectVisible(dialog().getByText("2 citas o solicitudes"), "resumen");
    assert(await dialog().getByRole("button", { name: "Eliminar", exact: true }).isDisabled(), "varios registros piden confirmar");
    await dialog().getByLabel("Entiendo que no se puede deshacer").check();
    await dialog().getByRole("button", { name: "Eliminar", exact: true }).click();
    await expectVisible(toast("Se eliminó: 2 citas."), "toast", 10000);
    await until(async () => !(await exists("appointments", B.id)) && !(await exists("appointments", D.id)), "las dos eliminadas");
    await expectVisible(page.getByText("Sin citas"), "la lista queda vacía");
  });
  await step("«Seleccionar todas» marca todas las filas y «Quitar selección» las desmarca", async () => {
    const x = await mkAppt("Todas uno"), y = await mkAppt("Todas dos");
    await list("Todas");
    await page.getByRole("checkbox", { name: "Seleccionar todas las citas de esta lista" }).check();
    await expectVisible(page.getByText("2 registros seleccionados"), "dos marcadas");
    await page.getByRole("button", { name: "Quitar selección" }).click();
    assert((await page.getByText(/registros? seleccionados?/).count()) === 0, "la barra desaparece");
    await must(sb.from("appointments").delete().in("id", [x.id, y.id]).select("id"));
  });

  section("Tablero y ficha de la cita");
  await step("Tablero: cada tarjeta tiene su botón «Eliminar»", async () => {
    const F = await mkAppt("Tablero");
    await page.goto(BASE + "/admin/appointments/board");
    await page.getByRole("button", { name: /Eliminar la cita de E2E Del Tablero/ }).click();
    await expectVisible(dialog().getByText("¿Eliminar la cita?"), "diálogo");
    await dialog().getByRole("button", { name: "Eliminar", exact: true }).click();
    await expectVisible(toast("Se eliminó: 1 cita."), "toast", 10000);
    await until(async () => !(await exists("appointments", F.id)), "tarjeta eliminada");
    await until(async () => (await page.getByRole("button", { name: /Eliminar la cita de E2E Del Tablero/ }).count()) === 0, "la tarjeta desaparece del tablero");
  });
  await step("Ficha de la cita: «Eliminar definitivamente» también funciona con citas completadas", async () => {
    const S = await mkSold("Ficha");
    await list("Ficha");
    await page.getByRole("button", { name: "Abrir" }).first().click();
    await dialog().getByRole("button", { name: "Eliminar definitivamente" }).click();
    await expectVisible(page.getByRole("dialog").filter({ hasText: "¿Eliminar la cita?" }).getByText("Incluye dinero registrado."), "aviso de dinero");
    await page.getByRole("dialog").filter({ hasText: "¿Eliminar la cita?" }).getByLabel("Entiendo que no se puede deshacer").check();
    await page.getByRole("dialog").filter({ hasText: "¿Eliminar la cita?" }).getByRole("button", { name: "Eliminar", exact: true }).click();
    await expectVisible(toast("Se eliminó: 1 cita, 1 venta y 1 pago."), "toast", 10000);
    await until(async () => !(await exists("appointments", S.id)), "cita eliminada");
    await until(async () => (await page.getByRole("dialog").count()) === 0, "la ficha se cierra");
  });

  section("Clientes");
  await step("Un cliente sin historial se elimina con su botón", async () => {
    const c = await mkClient("Limpio");
    await page.goto(`${BASE}/admin/clients?q=${encodeURIComponent("E2E Del Limpio")}`);
    await page.getByRole("button", { name: /Eliminar a E2E Del Limpio/ }).click();
    await expectVisible(dialog().getByText("1 cliente"), "resumen");
    await dialog().getByRole("button", { name: "Eliminar", exact: true }).click();
    await expectVisible(toast("Se eliminó: 1 cliente."), "toast", 10000);
    await until(async () => !(await exists("clients", c.id)), "cliente eliminado");
  });
  await step("Un cliente CON historial: avisa, no borra nada hasta marcar «Borrar también su historial» y se lleva sus citas, ventas y pagos", async () => {
    const H = await mkSold("Historial");
    await page.goto(`${BASE}/admin/clients?q=${encodeURIComponent("E2E Del Historial")}`);
    await page.getByRole("button", { name: /Eliminar a E2E Del Historial/ }).click();
    await expectVisible(dialog().getByText(/se conserva porque tiene historial/), "avisa que tiene historial");
    assert(await dialog().getByRole("button", { name: "Eliminar", exact: true }).isDisabled(), "sin marcar el historial no hay nada que borrar");
    await dialog().getByLabel("Borrar también su historial").check();
    await expectVisible(dialog().getByText(/1 venta por RD\$ 600/), "ahora cuenta la venta");
    await expectVisible(dialog().getByText("Incluye dinero registrado."), "aviso de dinero");
    const found = []; const v = await axeViolations(page); if (v.length) found.push(v.join(" | "));
    await dialog().getByLabel("Entiendo que no se puede deshacer").check();
    await dialog().getByRole("button", { name: "Eliminar", exact: true }).click();
    await expectVisible(toast("Se eliminó: 1 cliente, 1 cita, 1 venta y 1 pago."), "toast", 10000);
    await until(async () => !(await exists("clients", H.client_id)) && !(await exists("appointments", H.id)) && !(await exists("sales", H.sale_id)), "todo eliminado");
    assert(found.length === 0, "accesibilidad: " + found.join(" ¦ "));
  });
  await step("Varios clientes a la vez: se conservan los que tienen historial si no se pide borrarlo", async () => {
    const c1 = await mkClient("Lote uno"), c2 = await mkClient("Lote dos"), k = await mkAppt("Lote con cita");
    await page.goto(`${BASE}/admin/clients?q=${encodeURIComponent("E2E Del Lote")}`);
    await page.getByRole("checkbox", { name: "Seleccionar todos los clientes de esta página" }).check();
    await expectVisible(page.getByText("3 clientes seleccionados"), "barra");
    await page.getByRole("button", { name: "Eliminar seleccionados" }).click();
    await expectVisible(dialog().getByText(/2 clientes/), "se borrarían los 2 sin historial");
    await expectVisible(dialog().getByText(/se conserva porque tiene historial/), "el de la cita se conserva");
    await dialog().getByLabel("Entiendo que no se puede deshacer").check();
    await dialog().getByRole("button", { name: "Eliminar", exact: true }).click();
    await expectVisible(toast("Se eliminó: 2 clientes."), "toast", 10000);
    await until(async () => !(await exists("clients", c1.id)) && !(await exists("clients", c2.id)), "los dos sin historial eliminados");
    assert((await exists("clients", k.client_id)) && (await exists("appointments", k.id)), "el cliente con cita se conserva");
  });
  await step("Ficha del cliente: «Eliminar» usa el mismo diálogo y vuelve a la lista", async () => {
    const c = await mkClient("Ficha cliente");
    await page.goto(`${BASE}/admin/clients/${c.id}`);
    await page.getByRole("button", { name: "Eliminar", exact: true }).click();
    await dialog().getByRole("button", { name: "Eliminar", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/admin/clients", { timeout: 15000 });
    assert(!(await exists("clients", c.id)), "cliente eliminado");
  });

  section("Ventas");
  await step("Eliminar una venta dejando la cita: la cita vuelve a «confirmada» y se van la venta y su pago", async () => {
    const S = await mkSold("Venta uno", 800);
    await page.goto(`${BASE}/admin/sales?q=${encodeURIComponent(S.sale_number)}`);
    await page.getByRole("button", { name: `Eliminar la venta ${S.sale_number}` }).click();
    await expectVisible(dialog().getByText(/Eliminar también la cita/), "opción de la cita");
    await expectVisible(dialog().getByText(/1 venta por RD\$ 800/), "resumen");
    await dialog().getByLabel("Entiendo que no se puede deshacer").check();
    await dialog().getByRole("button", { name: "Eliminar", exact: true }).click();
    await expectVisible(toast("1 cita volvió a «confirmada»"), "toast", 10000);
    await until(async () => !(await exists("sales", S.sale_id)), "venta eliminada");
    const [a] = await must(sb.from("appointments").select("status,final_total").eq("id", S.id));
    assert(a.status === "confirmado" && a.final_total === null, "la cita queda confirmada: " + JSON.stringify(a));
  });
  await step("Eliminar una venta junto con su cita (desde el detalle de la venta)", async () => {
    const S = await mkSold("Venta dos", 500);
    await page.goto(`${BASE}/admin/sales/${S.sale_id}`);
    await page.getByRole("button", { name: "Eliminar venta" }).click();
    await dialog().getByLabel(/Eliminar también la cita/).check();
    await dialog().getByLabel("Entiendo que no se puede deshacer").check();
    await dialog().getByRole("button", { name: "Eliminar", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/admin/sales", { timeout: 15000 });
    assert(!(await exists("sales", S.sale_id)) && !(await exists("appointments", S.id)), "venta y cita eliminadas");
  });

  section("Notificaciones");
  await step("La campana ofrece «Borrar todas» (y «Borrar leídas» si hay avisos leídos); no se pulsan para no borrar los avisos reales", async () => {
    await page.goto(BASE + "/admin/calendar");
    await page.getByRole("button", { name: /Notificaciones/ }).click();
    const empty = await page.getByText("Sin notificaciones.").count();
    if (!empty) {
      await expectVisible(page.getByRole("button", { name: "Borrar todas" }), "botón «Borrar todas»");
      const hasRead = await page.locator("a[class*='notif']:not([class*='unread'])").count();
      if (hasRead) await expectVisible(page.getByRole("button", { name: "Borrar leídas" }), "botón «Borrar leídas»");
    }
  });

  section("Permisos");
  await step("Recepción NO ve botones de eliminar en citas, clientes ni ventas (sí puede limpiar su campana)", async () => {
    const A2 = await mkAppt("Permisos");
    const r = await launch(); setPage(r.page);
    try {
      await login(r.page, "tmp-recep@glow.test");
      await r.page.goto(`${BASE}/admin/appointments?range=all&q=${encodeURIComponent("E2E Del Permisos")}`);
      await expectVisible(r.page.getByRole("button", { name: "Abrir" }), "la cita se ve");
      assert((await r.page.getByRole("button", { name: /Eliminar/ }).count()) === 0 && (await r.page.getByRole("checkbox").count()) === 0, "recepción no debe ver eliminar ni casillas en citas");
      await r.page.goto(`${BASE}/admin/clients?q=${encodeURIComponent("E2E Del Permisos")}`);
      assert((await r.page.getByRole("button", { name: /Eliminar/ }).count()) === 0 && (await r.page.getByRole("checkbox").count()) === 0, "recepción no debe ver eliminar en clientes");
      await r.page.goto(`${BASE}/admin/sales`);
      assert((await r.page.getByRole("button", { name: /Eliminar/ }).count()) === 0, "recepción no debe ver eliminar en ventas");
      await r.page.goto(`${BASE}/admin/appointments/board`);
      assert((await r.page.getByRole("button", { name: /Eliminar la cita/ }).count()) === 0, "recepción no debe ver eliminar en el tablero");
      await r.page.goto(BASE + "/admin/calendar");
      await r.page.getByRole("button", { name: /Notificaciones/ }).click();
      // la campana de recepción también ofrece limpiar los avisos (son de todo el personal)
      await expectVisible(r.page.getByRole("button", { name: "Borrar todas" }).or(r.page.getByText("Sin notificaciones.")), "campana");
    } finally { await r.browser.close(); setPage(page); }
    assert(await exists("appointments", A2.id), "la cita sigue ahí");
  });
  await step("Todo queda en Auditoría con los datos que tenía", async () => {
    await page.goto(`${BASE}/admin/audit?entity=appointments`);
    await expectVisible(page.getByText(/Eliminó/).first(), "filas de eliminación en la auditoría");
  });
} finally {
  await cleanup();
}

const code = summary(errors);
await browser.close();
process.exit(code);
