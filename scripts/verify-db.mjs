// Verifica reglas críticas de la BD y los permisos de cada rol dentro de una transacción que SIEMPRE se revierte.
// Uso: node --env-file=.env.local scripts/verify-db.mjs
import { readFileSync } from "node:fs";
import pg from "pg";

const MIGRATIONS_DIR = process.env.GLOW_MIGRATIONS_DIR ?? new URL("../supabase/migrations/", import.meta.url);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = (sql, p) => c.query(sql, p);
let fails = 0, total = 0;
const check = (name, ok, extra = "") => { total++; console.log(ok ? "OK  " : "FAIL", name, extra); if (!ok) fails++; };

/** Ejecuta sql y espera un error que contenga `msg`. */
async function expectErr(name, sql, params, msg) {
  await q("savepoint s");
  try { await q(sql, params); check(name, false, "no lanzó error"); }
  catch (e) { check(name, e.message.includes(msg), e.message.includes(msg) ? "" : `(${e.message})`); }
  await q("rollback to savepoint s");
}
/** Ejecuta sql y devuelve filas afectadas (para probar RLS que filtra en silencio). */
async function rows(sql, params) { await q("savepoint r"); try { return (await q(sql, params)).rowCount; } finally { await q("rollback to savepoint r"); } }

const asAdmin = async () => { await q("reset role"); };
async function asUser(uid) {
  await q("reset role");
  await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  await q("set local role authenticated");
}
async function asAnon() {
  await q("reset role");
  await q("select set_config('request.jwt.claims', '', true)");
  await q("set local role anon");
}
const iso = (ms) => new Date(ms).toISOString();
const booking = (o) => ["select create_booking($1::jsonb) r", [JSON.stringify(o)]];

try {
  await q("begin");
  // Funciona también con la base real (donde las especialistas demo ya están desactivadas): todo corre en una transacción que se revierte.
  await q("update employees set active = true, accepts_online_booking = true where is_demo");

  /* ───────── datos base ───────── */
  const ana = (await q("select id from employees where full_name like 'Ana%'")).rows[0].id;
  const carla = (await q("select id from employees where full_name like 'Carla%'")).rows[0].id;
  const svc = async (slug) => (await q("select id from services where slug=$1", [slug])).rows[0].id;
  const man = await svc("manicure"), gel = await svc("pintura-de-manos-gel"), lav = await svc("lavado-y-secado");
  const lavLargo = (await q("select id from service_variants where service_id=$1 and name='Pelo largo'", [lav])).rows[0].id;
  const pend = (await q("select id from services where pending_review limit 1")).rows[0].id;
  const base = Date.now() + 9 * 864e5; // lejos de las citas demo
  const t0 = iso(base);
  const mk = async (name, role, employeeId = null) => {
    const id = (await q("insert into auth.users (id, email, instance_id, aud, role) values (gen_random_uuid(), $1, '00000000-0000-0000-0000-000000000000','authenticated','authenticated') returning id", [`${name}@verify.local`])).rows[0].id;
    await q("insert into profiles (id, full_name, role, employee_id, active) values ($1,$2,$3,$4,true)", [id, name, role, employeeId]);
    return id;
  };
  const uManager = await mk("manager", "manager"), uRecep = await mk("recep", "receptionist"), uSpec = await mk("spec", "specialist", carla);
  const uAdmin = await mk("admin", "super_admin");

  /* ───────── reservas y anti-solapes por línea ───────── */
  console.log("\n— Reservas y agenda —");
  const a1 = (await q(...booking({ first_name: "T", last_name: "Uno", phone: "+1 (809) 555-7777", employee_id: ana, start_time: t0, services: [{ service_id: man }] }))).rows[0].r;
  check("reserva simple: total calculado desde la BD", Number(a1.estimated_total) === 600);
  // Citas simultáneas: el personal puede agendar varias a la misma hora con la misma especialista
  await q(...booking({ first_name: "T", last_name: "Dos", phone: "8095557778", employee_id: ana, source: "phone", start_time: iso(base + 600e3), services: [{ service_id: man }] }));
  check("recepción: dos citas a la misma hora con la misma especialista se aceptan",
    Number((await q("select count(*) from appointment_services where employee_id=$1 and active and start_time < $3 and end_time > $2", [ana, t0, iso(base + 3600e3)])).rows[0].count) >= 2);
  await q(...booking({ first_name: "T", last_name: "Uno", phone: "809-555-7777", start_time: t0, services: [{ service_id: man }] }));
  check("teléfono en 3 formatos = 1 cliente", (await q("select count(*) from clients where phone_normalized='8095557777'")).rows[0].count === "1");
  await expectErr("rechaza servicio pendiente de confirmar", ...booking({ first_name: "T", last_name: "X", phone: "8095557779", start_time: t0, services: [{ service_id: pend }] }), "service_unavailable");
  await expectErr("rechaza fecha pasada", ...booking({ first_name: "T", last_name: "X", phone: "8095557779", start_time: iso(Date.now() - 864e5), services: [{ service_id: man }] }), "past_date");
  await expectErr("rechaza teléfono inválido", ...booking({ first_name: "T", last_name: "X", phone: "123", start_time: t0, services: [{ service_id: man }] }), "invalid_phone");
  await expectErr("exige elegir variante cuando el servicio las tiene", ...booking({ first_name: "T", last_name: "X", phone: "8095557779", start_time: t0, services: [{ service_id: lav }] }), "variant_required");
  await expectErr("rechaza especialista que no realiza el servicio", ...booking({ first_name: "T", last_name: "X", phone: "8095557779", employee_id: carla, start_time: iso(base + 5 * 36e5), services: [{ service_id: man }] }), "employee_cannot_perform");

  // combo multi-especialista: uñas con Ana → cabello con Carla, en secuencia
  const t1 = base + 24 * 36e5;
  const combo = (await q(...booking({ first_name: "Combo", last_name: "Cliente", phone: "8295550001", start_time: iso(t1),
    services: [{ service_id: man, employee_id: ana }, { service_id: lav, variant_id: lavLargo, employee_id: carla }] }))).rows[0].r;
  const lines = (await q("select position, employee_id, start_time, end_time from appointment_services where appointment_id=$1 order by position", [combo.id])).rows;
  check("combo: 2 líneas con especialistas distintos", lines.length === 2 && lines[0].employee_id === ana && lines[1].employee_id === carla);
  check("combo: líneas en secuencia sin hueco", +new Date(lines[0].end_time) === +new Date(lines[1].start_time));
  const apptCombo = (await q("select employee_id, start_time, end_time from appointments where id=$1", [combo.id])).rows[0];
  check("combo: la cita abarca todo y su especialista principal es el primero", apptCombo.employee_id === ana && +new Date(apptCombo.end_time) === +new Date(lines[1].end_time));
  // Ana está libre mientras Carla trabaja → se puede reservar a Ana en ese tramo
  const midCarla = +new Date(lines[1].start_time) + 5 * 60e3;
  await q("savepoint x");
  await q(...booking({ first_name: "Libre", last_name: "Ana", phone: "8295550002", employee_id: ana, start_time: iso(midCarla), services: [{ service_id: gel }] }));
  check("combo: Ana queda libre durante el tramo de Carla", true);
  await q("rollback to savepoint x");
  await q("savepoint y");
  const busyCarla = (await q(...booking({ first_name: "X", last_name: "Y", phone: "8295550003", employee_id: carla, source: "admin", start_time: iso(midCarla), services: [{ service_id: lav, variant_id: lavLargo }] }))).rows[0].r;
  check("combo: Carla ocupada en su tramo igual se puede agendar (citas simultáneas)", !!busyCarla.id);
  await q("rollback to savepoint y");

  // cancelar libera; reabrir con conflicto falla
  await q("update appointments set status='cancelado' where id=$1", [combo.id]);
  check("cancelar desactiva las líneas", (await q("select count(*) from appointment_services where appointment_id=$1 and active", [combo.id])).rows[0].count === "0");
  const rebook = (await q(...booking({ first_name: "Otro", last_name: "Cliente", phone: "8295550004", employee_id: carla, start_time: iso(midCarla), services: [{ service_id: lav, variant_id: lavLargo }] }))).rows[0].r;
  check("el horario liberado se puede reservar de nuevo", !!rebook.id);
  await q("savepoint reo");
  await q("update appointments set status='solicitud' where id=$1", [combo.id]);
  check("reabrir una cita cuyo horario fue tomado ahora se permite", Number((await q("select count(*) from appointment_services where appointment_id=$1 and active", [combo.id])).rows[0].count) > 0);
  await q("rollback to savepoint reo");

  // promociones
  const promoIns = (await q("insert into promotions (name, original_price, promo_price, active) values ('Combo test', 1300, 1000, true) returning id")).rows[0].id;
  await q("insert into promotion_services (promotion_id, service_id) values ($1,$2),($1,$3)", [promoIns, man, gel]);
  const tp = base + 48 * 36e5;
  const withPromo = (await q(...booking({ first_name: "Promo", last_name: "Cliente", phone: "8495550005", start_time: iso(tp), promotion_id: promoIns, services: [{ service_id: man }, { service_id: gel }] }))).rows[0].r;
  const ap = (await q("select discount, estimated_total from appointments where id=$1", [withPromo.id])).rows[0];
  check("promoción: descuento = lista − precio promo", Number(ap.discount) === 300 && Number(ap.estimated_total) === 1000, `desc=${ap.discount} total=${ap.estimated_total}`);
  await expectErr("promoción: exige incluir sus servicios", ...booking({ first_name: "P", last_name: "X", phone: "8495550006", start_time: iso(tp + 36e5 * 3), promotion_id: promoIns, services: [{ service_id: man }] }), "promotion_invalid");
  await q("update promotions set ends_on = current_date - 1 where id=$1", [promoIns]);
  await expectErr("promoción vencida se rechaza", ...booking({ first_name: "P", last_name: "X", phone: "8495550006", start_time: iso(tp + 36e5 * 3), promotion_id: promoIns, services: [{ service_id: man }, { service_id: gel }] }), "promotion_invalid");

  // anti-spam web
  for (let i = 0; i < 4; i++) await q(...booking({ first_name: "Spam", last_name: "Bot", phone: "8095559999", start_time: iso(base + (100 + i) * 36e5), services: [{ service_id: man }] }));
  await expectErr("anti-spam: máx. 4 solicitudes abiertas por teléfono", ...booking({ first_name: "Spam", last_name: "Bot", phone: "8095559999", start_time: iso(base + 110 * 36e5), services: [{ service_id: man }] }), "too_many_requests");

  /* ───────── edición, reprogramación, cobros ───────── */
  console.log("\n— Edición, ventas y cobros —");
  await asAdmin();
  const e1 = (await q(...booking({ first_name: "E", last_name: "Dit", phone: "8295550010", employee_id: ana, start_time: iso(base + 200 * 36e5), services: [{ service_id: man }, { service_id: gel }] }))).rows[0].r;
  await asUser(uRecep);
  const eLines = (await q("select id, service_id from appointment_services where appointment_id=$1 order by position", [e1.id])).rows;
  const upd = (await q("select update_appointment($1, $2::jsonb) r", [e1.id, JSON.stringify({
    start_time: iso(base + 201 * 36e5), discount: 100, tip: 50, notes: "editada",
    lines: [{ id: eLines[1].id, final_price: 650, employee_id: ana }, { id: eLines[0].id }, { name: "Shampoo", final_price: 400, quantity: 2 }],
  })])).rows[0].r;
  // subtotal = 650 + 600 + 800 = 2050; − 100 + 50 = 2000 con propina
  check("editar cita: total correcto (precio final, línea libre, descuento y propina)", Number(upd.total) === 2000, `total=${upd.total}`);
  const ed = (await q("select estimated_total, notes, start_time from appointments where id=$1", [e1.id])).rows[0];
  check("editar cita: estimado = subtotal − descuento y notas guardadas", Number(ed.estimated_total) === 1950 && ed.notes === "editada");
  const timed = (await q("select position, start_time, end_time from appointment_services where appointment_id=$1 and start_time is not null order by position", [e1.id])).rows;
  check("editar cita: las líneas con horario se reordenan en secuencia", timed.length === 2 && +new Date(timed[0].end_time) === +new Date(timed[1].start_time) && +new Date(timed[0].start_time) === +new Date(ed.start_time));
  await expectErr("editar: el descuento no puede superar el subtotal", "select update_appointment($1, $2::jsonb)", [e1.id, JSON.stringify({ discount: 99999, lines: [{ id: eLines[0].id }] })], "discount_exceeds_subtotal");
  await expectErr("editar: especialista que no hace el servicio", "select update_appointment($1, $2::jsonb)", [e1.id, JSON.stringify({ lines: [{ id: eLines[0].id, employee_id: carla }] })], "employee_cannot_perform");

  const r1 = (await q("select reschedule_appointment($1, $2, null) r", [e1.id, iso(base + 210 * 36e5)])).rows[0].r;
  check("reprogramar mueve la cita", !!r1.id);
  await expectErr("reprogramar al pasado se rechaza", "select reschedule_appointment($1, $2, null)", [e1.id, iso(Date.now() - 36e5)], "past_date");
  const rOver = (await q("select reschedule_appointment($1, $2, null) r", [e1.id, t0])).rows[0].r;
  check("reprogramar sobre otra cita de la misma especialista se permite", !!rOver.id);

  // completar → venta; pagos
  await q("update appointments set status='en_servicio' where id=$1", [e1.id]);
  const done = (await q("select complete_appointment($1) r", [e1.id])).rows[0].r;
  const done2 = (await q("select complete_appointment($1) r", [e1.id])).rows[0].r;
  check("completar 2 veces = 1 venta (idempotente)", done.sale_id === done2.sale_id && done2.already_completed === true && /^GBC-\d{6}-\d{5}$/.test(done.sale_number), done.sale_number);
  check("la venta copia las 3 líneas con su precio final", (await q("select count(*), sum(total) s from sale_items where sale_id=$1", [done.sale_id])).rows[0].s === "2050.00");
  await expectErr("no se edita una cita ya completada", "select update_appointment($1, $2::jsonb)", [e1.id, JSON.stringify({ lines: [{ id: eLines[0].id }] })], "appointment_closed");
  await expectErr("método de pago inexistente se rechaza", "select record_sale_payment($1, 100, 'bitcoin')", [done.sale_id], "invalid_method");
  await q("select record_sale_payment($1, 1000, 'efectivo')", [done.sale_id]);
  check("pago parcial → venta 'parcial'", (await q("select payment_status from sales where id=$1", [done.sale_id])).rows[0].payment_status === "parcial");
  await expectErr("sobrepago sin confirmar se rechaza", "select record_sale_payment($1, 5000, 'tarjeta')", [done.sale_id], "overpayment");
  await q("select record_sale_payment($1, 1000, 'tarjeta', 'ref-1')", [done.sale_id]);
  check("saldo completo → 'pagado'", (await q("select payment_status from sales where id=$1", [done.sale_id])).rows[0].payment_status === "pagado");
  await expectErr("recepción NO puede anular ventas", "select void_sale($1, 'error')", [done.sale_id], "forbidden");
  await expectErr("recepción NO puede reembolsar", "select refund_payment((select id from payments where sale_id=$1 limit 1))", [done.sale_id], "forbidden");

  await asUser(uManager);
  await expectErr("anular exige motivo", "select void_sale($1, '  ')", [done.sale_id], "reason_required");
  await q("select void_sale($1, 'Cobro duplicado')", [done.sale_id]);
  const vs = (await q("select payment_status, voided_at from sales where id=$1", [done.sale_id])).rows[0];
  check("anular venta: estado reembolsado y pagos reembolsados", vs.payment_status === "reembolsado" && vs.voided_at && (await q("select count(*) from payments where sale_id=$1 and status='pagado'", [done.sale_id])).rows[0].count === "0");
  check("anular venta: la cita queda cancelada", (await q("select status from appointments where id=$1", [e1.id])).rows[0].status === "cancelado");
  check("anular dos veces es idempotente", (await q("select void_sale($1, 'otra vez') r", [done.sale_id])).rows[0].r.already_voided === true);
  await expectErr("no se cobra una venta anulada", "select record_sale_payment($1, 100, 'efectivo')", [done.sale_id], "sale_voided");

  // métodos de pago configurables (gerencia)
  await q("insert into payment_methods (key, label, display_order) values ('zelle','Zelle',9)");
  await asUser(uRecep);
  const qs = (await q("select create_quick_sale($1::jsonb) r", [JSON.stringify({ items: [{ description: "Shampoo", quantity: 2, unit_price: 500 }], payments: [{ method: "zelle", amount: 1000 }] })])).rows[0].r;
  check("venta rápida con método personalizado → pagada", (await q("select payment_status, total from sales where id=$1", [qs.sale_id])).rows[0].payment_status === "pagado" && /^GBC-/.test(qs.sale_number));
  await expectErr("venta rápida: descuento mayor al subtotal", "select create_quick_sale($1::jsonb)", [JSON.stringify({ discount: 5000, items: [{ description: "X", quantity: 1, unit_price: 100 }] })], "discount_exceeds_subtotal");
  await expectErr("venta rápida: ítem inválido", "select create_quick_sale($1::jsonb)", [JSON.stringify({ items: [{ description: "", quantity: 1, unit_price: 100 }] })], "invalid_item");
  await asAdmin();
  await q("update payment_methods set active=false where key='zelle'");
  await asUser(uRecep);
  await expectErr("método desactivado no se puede usar", "select create_quick_sale($1::jsonb)", [JSON.stringify({ items: [{ description: "X", quantity: 1, unit_price: 100 }], payments: [{ method: "zelle", amount: 100 }] })], "invalid_method");

  /* ───────── permisos por rol ───────── */
  console.log("\n— Permisos por rol —");
  await asAdmin();
  const sale0 = qs.sale_id;
  // recepción
  await asUser(uRecep);
  check("recepción: lee citas, clientes y ventas", (await q("select count(*) from appointments")).rows[0].count > "0" && (await q("select count(*) from sales")).rows[0].count > "0");
  check("recepción: NO elimina citas", (await rows("delete from appointments where id=$1", [e1.id])) === 0);
  check("recepción: NO elimina clientes", (await rows("delete from clients where id=(select client_id from appointments limit 1)")) === 0);
  check("recepción: NO modifica precios de servicios", (await rows("update services set price = 1 where slug='manicure'")) === 0);
  check("recepción: NO lee la auditoría", (await q("select count(*) from audit_logs")).rows[0].count === "0");
  check("recepción: NO administra perfiles", (await rows("update profiles set role='super_admin' where id=$1", [uRecep])) === 0);
  check("recepción: NO toca los métodos de pago", (await rows("update payment_methods set label='x' where key='efectivo'")) === 0);
  await expectErr("recepción: NO puede ejecutar create_booking directo", "select create_booking('{}'::jsonb)", [], "permission denied");

  // gerente
  await asUser(uManager);
  check("gerente: lee la auditoría", (await q("select count(*) from audit_logs")).rows[0].count > "0");
  check("gerente: edita servicios", (await rows("update services set featured = featured where slug='manicure'")) === 1);
  check("gerente: elimina citas", (await rows("delete from appointments where id=$1", [a1.id])) === 1);
  check("gerente: NO administra perfiles", (await rows("update profiles set role='super_admin' where id=$1", [uManager])) === 0);
  check("gerente: lee y gestiona métodos de pago", (await rows("update payment_methods set label='Efectivo' where key='efectivo'")) === 1);

  // super admin
  await asUser(uAdmin);
  check("super admin: administra perfiles", (await rows("update profiles set active = active where id=$1", [uRecep])) === 1);

  // especialista (Carla): solo sus citas
  await asAdmin();
  const expectSpec = Number((await q("select count(*) from appointments a where a.employee_id=$1 or exists (select 1 from appointment_services s where s.appointment_id=a.id and s.employee_id=$1)", [carla])).rows[0].count);
  const spAppt = (await q(...booking({ first_name: "Esp", last_name: "Prueba", phone: "8295550020", employee_id: carla, start_time: iso(base + 300 * 36e5), status: "confirmado", services: [{ service_id: lav, variant_id: lavLargo }] }))).rows[0].r;
  await asUser(uSpec);
  const seen = Number((await q("select count(*) from appointments")).rows[0].count);
  check("especialista: ve únicamente sus citas", seen === expectSpec + 1, `ve ${seen}, esperadas ${expectSpec + 1}`);
  check("especialista: no ve citas de otros", (await q("select count(*) from appointments where employee_id=$1 and id not in (select appointment_id from appointment_services where employee_id=$2)", [ana, carla])).rows[0].count === "0");
  for (const t of ["sales", "payments", "audit_logs", "notifications"]) check(`especialista: NO ve ${t}`, (await q(`select count(*) from ${t}`)).rows[0].count === "0");
  check("especialista: ve solo clientes asignados", Number((await q("select count(*) from clients")).rows[0].count) <= expectSpec + 1);
  await expectErr("especialista: NO puede cambiar el precio de su cita", "update appointments set estimated_total = 1 where id=$1", [spAppt.id], "forbidden");
  await expectErr("especialista: NO puede cancelar", "update appointments set status='cancelado' where id=$1", [spAppt.id], "forbidden");
  await expectErr("especialista: no salta pasos (confirmado→completado)", "update appointments set status='completado' where id=$1", [spAppt.id], "forbidden");
  await q("update appointments set status='en_servicio' where id=$1", [spAppt.id]);
  check("especialista: inicia su servicio", (await q("select status from appointments where id=$1", [spAppt.id])).rows[0].status === "en_servicio");
  const spDone = (await q("select complete_appointment($1) r", [spAppt.id])).rows[0].r;
  check("especialista: completa su cita y se genera la venta", /^GBC-/.test(spDone.sale_number));
  await expectErr("especialista: NO puede cobrar", "select record_sale_payment($1, 100, 'efectivo')", [spDone.sale_id], "forbidden");
  await expectErr("especialista: NO puede hacer ventas rápidas", "select create_quick_sale($1::jsonb)", [JSON.stringify({ items: [{ description: "X", quantity: 1, unit_price: 1 }] })], "forbidden");
  await expectErr("especialista: NO puede editar citas", "select update_appointment($1, '{}'::jsonb)", [spAppt.id], "forbidden");
  await asAdmin();
  const anaAppt = (await q("select a.id from appointments a where a.employee_id=$1 and a.status in ('contactando','solicitud','confirmado') limit 1", [ana])).rows[0];
  await asUser(uSpec);
  if (anaAppt) check("especialista: NO modifica citas ajenas", (await rows("update appointments set status='en_servicio' where id=$1", [anaAppt.id])) === 0);

  /* ───────── anónimo ───────── */
  console.log("\n— Acceso anónimo —");
  await asAdmin();
  await q("update employees set accepts_online_booking=false where id=$1", [carla]);
  const expectedServices = (await q("select count(*) from services where active and not pending_review")).rows[0].count;
  const expectedEmps = (await q("select id from employees where active and accepts_online_booking order by id")).rows.map((r) => r.id);
  await asAnon();
  for (const t of ["clients", "appointments", "appointment_services", "sales", "payments", "audit_logs", "profiles", "notifications", "payment_methods", "products", "schedule_blocks", "employee_time_off"]) {
    check(`anon no ve ${t}`, (await q(`select count(*) from ${t}`)).rows[0].count === "0");
  }
  check("anon ve solo servicios publicados", (await q("select count(*) from services")).rows[0].count === expectedServices, `ve ${(await q("select count(*) from services")).rows[0].count}, esperados ${expectedServices}`);
  const emps = (await q("select id from employees")).rows.map((r) => r.id);
  check("anon ve solo especialistas activos y reservables (Carla oculta)", !emps.includes(carla) && emps.includes(ana) && JSON.stringify([...emps].sort()) === JSON.stringify(expectedEmps));
  await expectErr("anon NO puede leer datos privados del equipo (email/comisión)", "select email, commission_pct from employees", [], "permission denied");
  for (const fn of ["complete_appointment(gen_random_uuid())", "create_quick_sale('{}')", "next_sale_number()", "void_sale(gen_random_uuid(),'x')", "update_appointment(gen_random_uuid(),'{}')", "generate_reminders()", "create_booking('{}')"]) {
    await expectErr(`anon NO puede ejecutar ${fn.split("(")[0]}`, `select public.${fn}`, [], "permission denied");
  }
  await expectErr("anon NO puede escribir tablas", "insert into services (name, slug, category_id, price, duration_minutes) values ('x','x',(select id from service_categories limit 1),1,1)", [], "permission denied");

  /* ───────── recordatorios ───────── */
  console.log("\n— Recordatorios —");
  await asAdmin();
  const soon = (await q(...booking({ first_name: "Pronto", last_name: "Cita", phone: "8295550030", status: "confirmado", start_time: iso(Date.now() + 30 * 60e3), services: [{ service_id: gel }] }))).rows[0].r;
  const n1 = (await q("select generate_reminders() n")).rows[0].n;
  const n2 = (await q("select generate_reminders() n")).rows[0].n;
  check("recordatorio 'cita próxima' se crea una sola vez", n1 >= 1 && n2 === 0 && (await q("select count(*) from notifications where type='cita_proxima' and appointment_id=$1", [soon.id])).rows[0].count === "1");
  await q("update sales set completed_at = now() - interval '3 hours' where id=$1", [sale0]);
  await q("update payments set status='reembolsado' where sale_id=$1", [sale0]);
  await q("update sales set payment_status='pendiente' where id=$1", [sale0]);
  await q("select generate_reminders()");
  check("recordatorio 'pago pendiente' se crea para ventas con saldo", (await q("select count(*) from notifications where type='pago_pendiente' and sale_id=$1", [sale0])).rows[0].count === "1");

  /* ───────── clientes y autoservicio ───────── */
  console.log("\n— Clientes y autoservicio —");
  await asAdmin();
  const mk2 = async (n, phone, offsetH) => (await q(...booking({ first_name: n, last_name: "Merge", phone, start_time: iso(base + offsetH * 36e5), services: [{ service_id: man }] }))).rows[0].r;
  const keepA = await mk2("Keep", "8095558001", 400), dupA = await mk2("Dup", "8295558002", 410);
  await asUser(uRecep);
  await expectErr("recepción NO puede fusionar clientes", "select merge_clients($1, $2)", [keepA.client_id, dupA.client_id], "forbidden");
  await asUser(uManager);
  const mg = (await q("select merge_clients($1, $2) r", [keepA.client_id, dupA.client_id])).rows[0].r;
  check("fusionar: las citas del duplicado pasan al cliente principal", mg.appointments === 1 && (await q("select count(*) from appointments where client_id=$1", [keepA.client_id])).rows[0].count === "2");
  check("fusionar: el duplicado desaparece", (await q("select count(*) from clients where id=$1", [dupA.client_id])).rows[0].count === "0");
  await expectErr("fusionar un cliente consigo mismo se rechaza", "select merge_clients($1, $1)", [keepA.client_id], "invalid_item");

  await asAdmin();
  const far = (await q(...booking({ first_name: "Auto", last_name: "Servicio", phone: "8495558003", status: "confirmado", start_time: iso(base + 500 * 36e5), employee_id: ana, services: [{ service_id: man }] }))).rows[0].r;
  const near = (await q(...booking({ first_name: "Cerca", last_name: "Hora", phone: "8495558004", status: "confirmado", start_time: iso(Date.now() + 60 * 60e3), services: [{ service_id: gel }] }))).rows[0].r;
  const lk = (await q("select lookup_booking_public($1, $2) r", [far.request_number.toLowerCase(), "+1 849 555 8003"])).rows[0].r;
  check("consultar cita: número (sin importar mayúsculas) + teléfono en cualquier formato", lk.id === far.id && lk.cancellable === true && lk.lines.length === 1);
  await expectErr("consultar con teléfono ajeno se rechaza", "select lookup_booking_public($1, '8095550000')", [far.request_number], "booking_not_found");
  await expectErr("cancelar fuera del plazo se rechaza (cita en 1 hora)", "select cancel_booking_public($1, '8495558004')", [near.request_number], "booking_too_late");
  await q("select cancel_booking_public($1, '8495558003')", [far.request_number]);
  check("cancelar: estado 'cancelado' y horario liberado", (await q("select status from appointments where id=$1", [far.id])).rows[0].status === "cancelado" && (await q("select count(*) from appointment_services where appointment_id=$1 and active", [far.id])).rows[0].count === "0");
  await expectErr("cancelar una cita ya cancelada se rechaza", "select cancel_booking_public($1, '8495558003')", [far.request_number], "booking_not_cancellable");
  await asAnon();
  await expectErr("anon NO puede consultar citas por la API", "select public.lookup_booking_public('SOL-X','8095550000')", [], "permission denied");
  await expectErr("anon NO puede cancelar citas por la API", "select public.cancel_booking_public('SOL-X','8095550000')", [], "permission denied");
  await asAdmin();
  check("dr_today() es la fecha local de Santo Domingo", (await q("select dr_today()::text d")).rows[0].d === new Date(Date.now() - 4 * 36e5).toISOString().slice(0, 10));

  /* ───────── citas simultáneas (tope de la reserva en línea) ───────── */
  console.log("\n— Citas simultáneas —");
  await asAdmin();
  const tc = iso(base + 700 * 36e5);
  const web = (n, at = tc, extra = {}) => booking({ first_name: "Web", last_name: String(n), phone: "82955512" + String(n).padStart(2, "0"), employee_id: ana, start_time: at, services: [{ service_id: man }], ...extra });
  await q(...web(10)); await q(...web(11));
  await expectErr("web: la 3.ª solicitud a la misma hora se rechaza (tope por defecto: 2)", ...web(12), "slot_taken");
  const endTc = (await q("select max(end_time) e from appointment_services where employee_id=$1 and start_time=$2", [ana, tc])).rows[0].e;
  await q(...web(13, iso(+new Date(endTc))));
  check("web: una solicitud que empieza justo cuando terminan las otras sí cabe", true);
  await q(...web(14, tc, { source: "admin" })); await q(...web(15, tc, { source: "phone" }));
  check("personal: las citas manuales no tienen tope (4.ª y 5.ª a la misma hora)", Number((await q("select count(*) from appointment_services where employee_id=$1 and active and start_time=$2", [ana, tc])).rows[0].count) === 4);
  await q("update business_settings set value = jsonb_set(value, '{max_simultaneous}', '1') where key='booking'");
  const tc1 = iso(base + 720 * 36e5);
  await q(...web(16, tc1));
  await expectErr("web: con tope 1 la 2.ª solicitud a la misma hora se rechaza", ...web(17, tc1), "slot_taken");
  await q("update business_settings set value = jsonb_set(value, '{max_simultaneous}', '3') where key='booking'");
  await q(...web(18, tc1));
  check("web: subiendo el tope a 3 entra otra solicitud", true);
  await q(...web(19, tc1));
  await expectErr("web: con tope 3 la 4.ª se rechaza", ...web(20, tc1), "slot_taken");
  await q("update business_settings set value = jsonb_set(value, '{max_simultaneous}', '\"abc\"') where key='booking'");
  const tc2 = iso(base + 740 * 36e5);
  await q(...web(21, tc2)); await q(...web(22, tc2));
  await expectErr("web: un valor de tope inválido vuelve al valor por defecto (2)", ...web(23, tc2), "slot_taken");
  await q("update business_settings set value = value - 'max_simultaneous' where key='booking'");

  /* ───────── cumpleaños del personal ───────── */
  console.log("\n— Cumpleaños del personal —");
  await asAdmin();
  const [, bm, bd] = (await q("select dr_today()::text d")).rows[0].d.split("-").map(Number);
  await expectErr("cumpleaños: el 30 de febrero no existe", "update employees set birth_month=2, birth_day=30 where id=$1", [ana], "employees_birthday_ck");
  await expectErr("cumpleaños: el 31 de abril no existe", "update employees set birth_month=4, birth_day=31 where id=$1", [ana], "employees_birthday_ck");
  await expectErr("cumpleaños: día sin mes se rechaza", "update employees set birth_month=null, birth_day=5 where id=$1", [ana], "employees_birthday_ck");
  await expectErr("cumpleaños: mes sin día se rechaza", "update employees set birth_month=3, birth_day=null where id=$1", [ana], "employees_birthday_ck");
  check("cumpleaños: el 29 de febrero sí es válido", (await rows("update employees set birth_month=2, birth_day=29 where id=$1", [ana])) === 1);
  await q("update employees set birth_month=$2, birth_day=$3 where id=$1", [ana, bm, bd]);
  await q("update employees set active=false, birth_month=$2, birth_day=$3 where id=$1", [carla, bm, bd]);
  await q("select generate_reminders()");
  const bn = (await q("select title, body, employee_id from notifications where type='cumpleanos' and employee_id=$1", [ana])).rows;
  check("cumpleaños: el día se crea la notificación de la especialista", bn.length === 1 && /Ana/.test(bn[0].title) && /felicitar/.test(bn[0].body));
  await q("select generate_reminders()");
  check("cumpleaños: no se repite (aunque corra cada 5 minutos)", (await q("select count(*) from notifications where type='cumpleanos' and employee_id=$1", [ana])).rows[0].count === "1");
  check("cumpleaños: una especialista inactiva no genera aviso", (await q("select count(*) from notifications where type='cumpleanos' and employee_id=$1", [carla])).rows[0].count === "0");
  await asUser(uRecep);
  check("cumpleaños: recepción ve el aviso", Number((await q("select count(*) from notifications where type='cumpleanos'")).rows[0].count) >= 1);
  await asAdmin();
  await q("update employees set active=true where id=$1", [carla]);
  await q("update employees set birth_month=null, birth_day=null where id in ($1,$2)", [ana, carla]);

  /* ───────── horarios por defecto (relleno de la migración 11) ───────── */
  console.log("\n— Horarios por defecto —");
  const mig = readFileSync(new URL("20261006000011_simultaneous_birthdays_schedules.sql", MIGRATIONS_DIR), "utf8");
  const backfill = mig.slice(mig.indexOf("-- ───────────── 4. Horarios por defecto"));
  const nuevaId = (await q("insert into employees (full_name, active, accepts_online_booking) values ('Sin Horario Test', true, true) returning id")).rows[0].id;
  const anaBefore = (await q("select count(*) from employee_schedules where employee_id=$1", [ana])).rows[0].count;
  await q(backfill);
  const hours = (await q("select value from business_settings where key='hours'")).rows[0].value;
  const openDays = Object.entries(hours).filter(([, h]) => h && h.open && h.close);
  const got = (await q("select weekday, to_char(start_time,'HH24:MI') s, to_char(end_time,'HH24:MI') e from employee_schedules where employee_id=$1 order by weekday", [nuevaId])).rows;
  check("horarios por defecto: una especialista sin horario recibe el del negocio (días cerrados quedan libres)",
    got.length === openDays.length && openDays.every(([wd, h]) => got.some((g) => g.weekday === Number(wd) && g.s === h.open && g.e === h.close)));
  check("horarios por defecto: no toca a quien ya tiene horario", (await q("select count(*) from employee_schedules where employee_id=$1", [ana])).rows[0].count === anaBefore);
  await q(backfill);
  check("horarios por defecto: correrlo otra vez no duplica nada", (await q("select count(*) from employee_schedules where employee_id=$1", [nuevaId])).rows[0].count === String(openDays.length));

  /* ───────── nómina de pago ───────── */
  console.log("\n— Nómina de pago —");
  await asAdmin();
  const run1 = (await q("insert into payroll_runs (title, period_start, period_end) values ('Quincena de prueba','2026-09-01','2026-09-15') returning id, run_number, status")).rows[0];
  check("nómina: nace en borrador con número NOM-####", run1.status === "borrador" && /^NOM-\d{4}$/.test(run1.run_number));
  const pl = (employee, run, a, b, cols = "") => ["insert into payroll_lines (run_id, employee_id, employee_name, period_start, period_end" + (cols ? ", " + cols.split("=")[0] : "") + ") values ($1,$2,'E',$3::date,$4::date" + (cols ? ", " + cols.split("=")[1] : "") + ") returning id, net", [run, employee, a, b]];
  const l1 = (await q("insert into payroll_lines (run_id, employee_id, employee_name, period_start, period_end, commission, tips, base_salary, bonus, deductions) values ($1,$2,'Ana','2026-09-01','2026-09-15',3200.50,800,5000,500,1000.25) returning id, net", [run1.id, ana])).rows[0];
  check("nómina: neto = base + comisión + propinas + bonos − descuentos", Number(l1.net) === 8500.25, "neto " + l1.net);
  const run2 = (await q("insert into payroll_runs (title, period_start, period_end) values ('Solapada','2026-09-10','2026-09-20') returning id")).rows[0];
  await expectErr("nómina: no se le paga dos veces el mismo día a la misma especialista", ...pl(ana, run2.id, "2026-09-10", "2026-09-20"), "payroll_lines_no_double_pay");
  await q(...pl(carla, run2.id, "2026-09-10", "2026-09-20"));
  check("nómina: otra especialista sí puede estar en un período que se cruza", true);
  const run3 = (await q("insert into payroll_runs (title, period_start, period_end) values ('Siguiente quincena','2026-09-16','2026-09-30') returning id")).rows[0];
  await q(...pl(ana, run3.id, "2026-09-16", "2026-09-30"));
  check("nómina: períodos seguidos (1–15 y 16–30) no chocan", true);
  await expectErr("nómina: una especialista no se repite en la misma nómina", ...pl(ana, run1.id, "2026-09-01", "2026-09-15"), "payroll_lines_run_emp_uq");
  await expectErr("nómina: los montos no pueden ser negativos", "update payroll_lines set bonus=-1 where id=$1", [l1.id], "payroll_lines_amounts_ck");
  await expectErr("nómina: el período de una nómina no se puede cambiar", "update payroll_runs set period_end='2026-09-30' where id=$1", [run1.id], "payroll_period_locked");
  await expectErr("nómina: pagada exige fecha de pago", "update payroll_runs set status='pagada' where id=$1", [run1.id], "check constraint");
  await q("update payroll_runs set status='pagada', paid_on='2026-09-16', paid_method='Efectivo' where id=$1", [run1.id]);
  await expectErr("nómina pagada: no se edita un volante", "update payroll_lines set bonus=1 where id=$1", [l1.id], "payroll_paid");
  await expectErr("nómina pagada: no se borra un volante", "delete from payroll_lines where id=$1", [l1.id], "payroll_paid");
  await expectErr("nómina pagada: no se agregan volantes", ...pl(carla, run1.id, "2026-09-01", "2026-09-15"), "payroll_paid");
  await expectErr("nómina pagada: no se elimina", "delete from payroll_runs where id=$1", [run1.id], "payroll_paid");
  await expectErr("nómina pagada: no se vuelve a 'pagar' con otros datos", "update payroll_runs set paid_method='Cheque' where id=$1", [run1.id], "payroll_paid");
  await q("update payroll_runs set status='borrador', paid_on=null, paid_method=null where id=$1", [run1.id]);
  await q("update payroll_lines set bonus=700 where id=$1", [l1.id]);
  check("nómina reabierta: se puede corregir y el neto se recalcula solo", Number((await q("select net from payroll_lines where id=$1", [l1.id])).rows[0].net) === 8700.25);
  await q("delete from payroll_runs where id=$1", [run2.id]);
  check("nómina en borrador: al eliminarla se van sus volantes", (await q("select count(*) from payroll_lines where run_id=$1", [run2.id])).rows[0].count === "0");
  await expectErr("especialista con nómina: no se puede eliminar", "delete from employees where id=$1", [ana], "foreign key");
  check("nómina: queda en la auditoría", Number((await q("select count(*) from audit_logs where entity in ('payroll_runs','payroll_lines')")).rows[0].count) > 0);
  // permisos
  await asUser(uRecep);
  check("nómina: recepción NO la ve", (await q("select count(*) from payroll_runs")).rows[0].count === "0" && (await q("select count(*) from payroll_lines")).rows[0].count === "0");
  await expectErr("nómina: recepción NO puede crearla", "insert into payroll_runs (title, period_start, period_end) values ('x','2026-01-01','2026-01-02')", [], "row-level security");
  await asUser(uSpec);
  check("nómina: el especialista NO la ve", (await q("select count(*) from payroll_lines")).rows[0].count === "0");
  await asUser(uManager);
  check("nómina: gerente la ve", Number((await q("select count(*) from payroll_runs")).rows[0].count) >= 2);
  check("nómina: gerente puede crearla", (await rows("insert into payroll_runs (title, period_start, period_end) values ('Gerente','2026-01-01','2026-01-02')")) === 1);
  await asUser(uAdmin);
  check("nómina: super admin la ve", Number((await q("select count(*) from payroll_runs")).rows[0].count) >= 2);
  await asAnon();
  await expectErr("nómina: anon NO puede leerla", "select count(*) from payroll_runs", [], "permission denied");
  await asAdmin();

} catch (e) {
  console.error("ERROR inesperado:", e.message);
  fails++;
} finally {
  await q("rollback").catch(() => {});
  await c.end();
}
console.log(fails ? `\n${fails} fallo(s) de ${total}` : `\nTodo OK — ${total} verificaciones (transacción revertida)`);
process.exit(fails ? 1 : 0);
