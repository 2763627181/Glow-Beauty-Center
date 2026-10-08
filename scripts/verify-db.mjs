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
  // Si las especialistas demo ya se eliminaron de la base, se recrean aquí (con su horario y sus servicios, igual que en la semilla):
  // viven solo dentro de esta transacción, que siempre se revierte.
  if (!(await q("select 1 from employees where is_demo and full_name like 'Ana%'")).rows.length) {
    await q("insert into employees (full_name, specialty, bio, is_demo, display_order) values ('Ana (demo)','Uñas y pedicure','Especialista en manicure, builder y soft gel.',true,1), ('Carla (demo)','Cabello','Especialista en lavado, color y keratina.',true,2)");
    await q("insert into employee_schedules (employee_id, weekday, start_time, end_time, break_start, break_end) select e.id, d, '09:00'::time, (case when d = 6 then '16:00' else '18:00' end)::time, '13:00'::time, '14:00'::time from employees e, generate_series(1,6) d where e.is_demo");
    await q("insert into employee_services (employee_id, service_id) select e.id, s.id from employees e join services s on true join service_categories c on c.id = s.category_id where e.is_demo and ((e.full_name like 'Ana%' and c.slug in ('unas','pies-spa')) or (e.full_name like 'Carla%' and c.slug in ('cabello','tratamientos'))) on conflict do nothing");
  }

  /* ───────── datos base ───────── */
  const ana = (await q("select id from employees where is_demo and full_name like 'Ana%'")).rows[0].id;
  const carla = (await q("select id from employees where is_demo and full_name like 'Carla%'")).rows[0].id;
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
  // Recepción y gerencia: sin esa restricción (la web sí la conserva, arriba)
  await q("savepoint staff1");
  const okStaff = (await q(...booking({ first_name: "T", last_name: "Y", phone: "8095557780", employee_id: carla, source: "phone", start_time: iso(base + 5 * 36e5), services: [{ service_id: man }] }))).rows[0].r;
  check("recepción: puede asignar a una especialista que no tiene marcado el servicio", !!okStaff.id);
  const pastOk = (await q(...booking({ first_name: "T", last_name: "Z", phone: "8095557781", source: "admin", start_time: iso(Date.now() - 5 * 36e5), services: [{ service_id: man }] }))).rows[0].r;
  check("recepción: puede registrar una cita a una hora que ya pasó (la web no)", !!pastOk.id);
  await q("rollback to savepoint staff1");

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
  await q("savepoint ed");
  const reasg = (await q("select update_appointment($1, $2::jsonb) r", [e1.id, JSON.stringify({ lines: [{ id: eLines[0].id, employee_id: carla }] })])).rows[0].r;
  check("editar: el personal puede asignar a una especialista que no tiene marcado el servicio", !!reasg.id && (await q("select employee_id from appointment_services where id=$1", [eLines[0].id])).rows[0].employee_id === carla);
  await q("rollback to savepoint ed");

  const r1 = (await q("select reschedule_appointment($1, $2, null) r", [e1.id, iso(base + 210 * 36e5)])).rows[0].r;
  check("reprogramar mueve la cita", !!r1.id);
  await q("savepoint pas");
  const rPast = (await q("select reschedule_appointment($1, $2, null) r", [e1.id, iso(Date.now() - 36e5)])).rows[0].r;
  check("reprogramar a una hora que ya pasó se permite al personal", !!rPast.id);
  await q("rollback to savepoint pas");
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
  const cnt = async (at) => Number((await q("select count(*) from appointment_services where employee_id=$1 and active and start_time=$2", [ana, at])).rows[0].count);
  const setMax = (v) => q("update business_settings set value = jsonb_set(value, '{max_simultaneous}', $1::jsonb) where key='booking'", [JSON.stringify(v)]);
  await q("update business_settings set value = value - 'max_simultaneous' where key='booking'");
  for (const n of [10, 11, 12, 13]) await q(...web(n));
  check("web: sin tope configurado (valor por defecto) se aceptan 4 solicitudes a la misma hora con la misma especialista", (await cnt(tc)) === 4);
  await q(...web(14, tc, { source: "admin" })); await q(...web(15, tc, { source: "phone" }));
  check("personal: las citas manuales tampoco tienen tope (6 a la misma hora)", (await cnt(tc)) === 6);
  // Tope 2 explícito
  await setMax(2);
  const tc3 = iso(base + 710 * 36e5);
  await q(...web(30, tc3)); await q(...web(31, tc3));
  await expectErr("web: con tope 2 la 3.ª solicitud a la misma hora se rechaza", ...web(32, tc3), "slot_taken");
  const endTc = (await q("select max(end_time) e from appointment_services where employee_id=$1 and start_time=$2", [ana, tc3])).rows[0].e;
  await q(...web(33, iso(+new Date(endTc))));
  check("web: una solicitud que empieza justo cuando terminan las otras sí cabe", true);
  await q(...web(34, tc3, { source: "admin" }));
  check("personal: con tope 2 en la web, recepción igual puede agendar otra a esa hora", (await cnt(tc3)) === 3);
  // Tope 1
  await setMax(1);
  const tc1 = iso(base + 720 * 36e5);
  await q(...web(16, tc1));
  await expectErr("web: con tope 1 la 2.ª solicitud a la misma hora se rechaza", ...web(17, tc1), "slot_taken");
  // Tope 3
  await setMax(3);
  await q(...web(18, tc1)); await q(...web(19, tc1));
  await expectErr("web: con tope 3 la 4.ª se rechaza", ...web(20, tc1), "slot_taken");
  // 0 = sin límite; un valor inválido también equivale a sin límite
  await setMax(0);
  const tc2 = iso(base + 740 * 36e5);
  for (const n of [21, 22, 23, 24, 25]) await q(...web(n, tc2));
  check("web: tope 0 = sin límite", (await cnt(tc2)) === 5);
  await setMax("abc");
  const tc4 = iso(base + 760 * 36e5);
  for (const n of [40, 41, 42]) await q(...web(n, tc4));
  check("web: un valor inválido equivale a sin límite", (await cnt(tc4)) === 3);
  await q("update business_settings set value = value - 'max_simultaneous' where key='booking'");

  /* ───────── equipos de especialistas por servicio y servicios al mismo tiempo ───────── */
  console.log("\n— Equipos y servicios al mismo tiempo —");
  await asAdmin();
  const lineRows = async (id) => (await q("select id, employee_id, price::float p, final_price::float fp, start_time, end_time, parallel, team_id, span_minutes from appointment_services where appointment_id=$1 order by position, id", [id])).rows;
  const tA = iso(base + 800 * 36e5);
  const A = (await q(...booking({ first_name: "Eq", last_name: "Uno", phone: "8295552001", source: "admin", start_time: tA, services: [
    { service_id: man, employee_id: ana, team: "m1" }, { service_id: man, employee_id: carla, team: "m1", parallel: true }] }))).rows[0].r;
  const la = await lineRows(A.id);
  check("equipo: dos especialistas en el mismo servicio quedan con su propia línea, a la misma hora",
    la.length === 2 && +la[0].start_time === +la[1].start_time && +la[0].end_time === +la[1].end_time && la[0].employee_id === ana && la[1].employee_id === carla);
  check("equipo: el precio se reparte entre ellas y el total de la cita no cambia", la[0].p === 300 && la[1].p === 300 && la[0].fp + la[1].fp === 600 && Number(A.estimated_total) === 600, JSON.stringify(la.map((l) => l.p)));
  check("equipo: comparten team_id y la segunda va «al mismo tiempo»", !!la[0].team_id && la[0].team_id === la[1].team_id && la[0].parallel === false && la[1].parallel === true);
  check("equipo: la cita dura lo de un solo servicio (no se suman)", +new Date(A.end_time) - +new Date(tA) === la[0].span_minutes * 60e3);

  const tB = iso(base + 810 * 36e5);
  const B = (await q(...booking({ first_name: "Eq", last_name: "Dos", phone: "8295552002", source: "admin", start_time: tB, services: [
    { service_id: man, employee_id: ana }, { service_id: gel, employee_id: carla, parallel: true }, { service_id: man, employee_id: ana }] }))).rows[0].r;
  const lb = await lineRows(B.id);
  check("al mismo tiempo: manicure con una y pintura con otra empiezan juntas, y el servicio siguiente va después del bloque más largo",
    +lb[0].start_time === +lb[1].start_time && lb[1].parallel === true && +lb[2].start_time === Math.max(+lb[0].end_time, +lb[1].end_time) && lb[2].parallel === false);
  check("al mismo tiempo: la cita termina cuando termina su última línea", +new Date(B.end_time) === +lb[2].end_time);
  const dur = (l) => l.span_minutes * 60e3;
  check("al mismo tiempo: sin equipos el precio no se reparte", lb[0].p === 600 && lb[1].p > 0);
  void dur;

  const tercera = (await q("insert into employees (full_name, active) values ('Tercera test', true) returning id")).rows[0].id;
  const D = (await q(...booking({ first_name: "Eq", last_name: "Tres", phone: "8295552003", source: "admin", start_time: iso(base + 820 * 36e5), services: [
    { service_id: gel, employee_id: ana, team: "g" }, { service_id: gel, employee_id: carla, team: "g", parallel: true }, { service_id: gel, employee_id: tercera, team: "g", parallel: true }] }))).rows[0].r;
  const ld = await lineRows(D.id);
  check("equipo de 3: el reparto suma exacto (la primera recibe el centavo que sobra)", ld.map((l) => l.p).join() === "233.34,233.33,233.33" && Number(D.estimated_total) === 700, ld.map((l) => l.p).join());

  // Reprogramar conserva la estructura (misma hora de inicio de las líneas simultáneas)
  await asUser(uManager);
  const newB = iso(base + 830 * 36e5);
  await q("select reschedule_appointment($1, $2, null)", [B.id, newB]);
  const lb2 = await lineRows(B.id);
  check("reprogramar: las líneas simultáneas siguen juntas y todo se corre al nuevo horario", +lb2[0].start_time === +new Date(newB) && +lb2[0].start_time === +lb2[1].start_time && lb2[1].parallel === true && +lb2[2].start_time === Math.max(+lb2[0].end_time, +lb2[1].end_time));

  // Editar: sumar una tercera especialista al equipo existente y repartir el precio
  const teamId = la[0].team_id;
  await q("select update_appointment($1, $2::jsonb)", [A.id, JSON.stringify({ lines: [
    { id: la[0].id, final_price: 200, team: teamId }, { id: la[1].id, final_price: 200, team: teamId },
    { service_id: man, employee_id: tercera, parallel: true, team: teamId, final_price: 200 }] })]);
  const la2 = await lineRows(A.id);
  check("editar: se suma una especialista al equipo, a la misma hora y con el mismo team_id", la2.length === 3 && new Set(la2.map((l) => l.team_id)).size === 1 && new Set(la2.map((l) => +l.start_time)).size === 1 && la2[2].parallel === true);
  check("editar: el precio repartido suma el precio del servicio", la2.reduce((s, l) => s + l.fp, 0) === 600);
  await q("select update_appointment($1, $2::jsonb)", [A.id, JSON.stringify({ lines: [{ id: la[0].id, final_price: 600, team: null }, { id: la[1].id, final_price: 0, team: null }] })]);
  const la3 = await lineRows(A.id);
  check("editar: quitar a una especialista y deshacer el equipo deja las líneas sin team_id", la3.length === 2 && la3.every((l) => l.team_id === null));
  await asAdmin();

  // Completar: la venta conserva el equipo; una especialista que NO es la primera también puede completar
  const G = (await q(...booking({ first_name: "Eq", last_name: "Cuatro", phone: "8295552004", source: "admin", status: "en_servicio", start_time: iso(base + 840 * 36e5), services: [
    { service_id: man, employee_id: ana, team: "c" }, { service_id: man, employee_id: carla, team: "c", parallel: true }] }))).rows[0].r;
  await asUser(uSpec); // Carla: es la segunda del equipo
  const doneG = (await q("select complete_appointment($1) r", [G.id])).rows[0].r;
  await asAdmin();
  const si = (await q("select employee_id, total::float t, team_id from sale_items where sale_id=$1 order by employee_id", [doneG.sale_id])).rows;
  check("completar: la especialista que no es la primera del equipo puede completar la cita", !!doneG.sale_id && !doneG.already_completed);
  check("completar: la venta tiene una línea por especialista, con su parte y el mismo team_id", si.length === 2 && si.every((r) => r.t === 300) && si[0].team_id && si[0].team_id === si[1].team_id && new Set(si.map((r) => r.employee_id)).size === 2);

  // La clienta ve un solo servicio por equipo en «Mi cita»
  const H = (await q(...booking({ first_name: "Eq", last_name: "Cinco", phone: "8295552005", source: "admin", start_time: iso(base + 850 * 36e5), services: [
    { service_id: man, employee_id: ana, team: "w" }, { service_id: man, employee_id: carla, team: "w", parallel: true }] }))).rows[0].r;
  const lkH = (await q("select lookup_booking_public($1, '8295552005') r", [H.request_number])).rows[0].r;
  check("mi cita: un equipo se muestra como un solo servicio con el precio completo", lkH.lines.length === 1 && lkH.lines[0].name === "Manicure" && Number(lkH.lines[0].price) === 600, JSON.stringify(lkH.lines));


  /* ───────── eliminar registros (citas, solicitudes, ventas, clientes, notificaciones) ───────── */
  console.log("\n— Eliminar registros —");
  await asAdmin();
  const mkAppt = async (last, phone, status, hours) => (await q(...booking({ first_name: "Del", last_name: last, phone, source: "admin", status, start_time: iso(base + hours * 36e5), services: [{ service_id: man, employee_id: ana }] }))).rows[0].r;
  const exists = async (table, id) => (await q("select 1 from " + table + " where id=$1", [id])).rows.length === 1;
  const D1 = await mkAppt("Uno", "8295553001", "en_servicio", 900), D2 = await mkAppt("Dos", "8295553002", "confirmado", 910), D3 = await mkAppt("Tres", "8295553003", "solicitud", 920);
  await asUser(uManager);
  const sale1 = (await q("select complete_appointment($1) r", [D1.id])).rows[0].r;
  await q("select record_sale_payment($1, 100, 'efectivo')", [sale1.sale_id]);
  await asAdmin();

  // Permisos: solo super admin y gerencia borran; recepción y especialista no; anónimo tampoco
  await asUser(uRecep);
  await expectErr("eliminar: recepción NO puede borrar citas", "select delete_appointments($1)", [[D3.id]], "forbidden");
  await expectErr("eliminar: recepción NO puede borrar ventas", "select delete_sales($1, false)", [[sale1.sale_id]], "forbidden");
  await expectErr("eliminar: recepción NO puede borrar clientes", "select delete_clients($1, true)", [[D3.client_id]], "forbidden");
  await expectErr("eliminar: recepción NO puede ver la vista previa", "select describe_deletion('appointments', $1)", [[D3.id]], "forbidden");
  await asUser(uSpec);
  await expectErr("eliminar: el especialista NO puede borrar citas", "select delete_appointments($1)", [[D3.id]], "forbidden");
  await expectErr("eliminar: el especialista NO puede limpiar notificaciones", "select clear_notifications(true)", [], "forbidden");
  await asAnon();
  await expectErr("eliminar: anon NO puede borrar", "select public.delete_appointments('{}')", [], "permission denied");
  await expectErr("eliminar: anon NO puede limpiar notificaciones", "select public.clear_notifications(true)", [], "permission denied");
  await asAdmin();
  check("eliminar: las citas siguen ahí tras los intentos sin permiso", (await exists("appointments", D3.id)) && (await exists("appointments", D1.id)));

  // Gerencia: vista previa y borrado de una solicitud sin venta
  await asUser(uManager);
  const dv = (await q("select describe_deletion('appointments', $1) r", [[D1.id]])).rows[0].r;
  check("vista previa de una cita completada: 1 cita, 1 venta, 1 pago", dv.appointments === 1 && dv.sales === 1 && dv.payments === 1 && Number(dv.paid_total) === 100, JSON.stringify(dv));
  const dvSolo = (await q("select describe_deletion('appointments', $1) r", [[D3.id]])).rows[0].r;
  check("vista previa de una solicitud sin venta: nada de dinero", dvSolo.appointments === 1 && dvSolo.sales === 0 && dvSolo.payments === 0);
  await expectErr("eliminar: sin seleccionar nada se rechaza", "select delete_appointments('{}')", [], "nothing_selected");
  const del3 = (await q("select delete_appointments($1) r", [[D3.id]])).rows[0].r;
  check("eliminar una solicitud: se va sola y las demás citas siguen", del3.appointments === 1 && !(await exists("appointments", D3.id)) && (await exists("appointments", D2.id)));

  // Cita completada con venta y pago: se llevan todo
  const del1 = (await q("select delete_appointments($1) r", [[D1.id]])).rows[0].r;
  check("eliminar una cita completada: se borran también su venta y su pago", del1.appointments === 1 && del1.sales === 1 && del1.payments === 1 && !(await exists("appointments", D1.id)) && !(await exists("sales", sale1.sale_id)) && (await q("select count(*) from payments where sale_id=$1", [sale1.sale_id])).rows[0].count === "0");
  check("eliminar: queda en la auditoría con los datos que tenía", Number((await q("select count(*) from audit_logs where entity in ('appointments','sales','payments') and action='delete'")).rows[0].count) >= 3);

  // Ventas: dejando la cita o llevándosela
  await asAdmin();
  const D4 = await mkAppt("Cuatro", "8295553004", "en_servicio", 930), D5 = await mkAppt("Cinco", "8295553005", "en_servicio", 940);
  await asUser(uManager);
  const sale4 = (await q("select complete_appointment($1) r", [D4.id])).rows[0].r, sale5 = (await q("select complete_appointment($1) r", [D5.id])).rows[0].r;
  await q("select record_sale_payment($1, 50, 'efectivo')", [sale4.sale_id]);
  const dvs = (await q("select describe_deletion('sales', $1) r", [[sale4.sale_id, sale5.sale_id]])).rows[0].r;
  check("vista previa de ventas: cuenta pagos y citas ligadas", dvs.sales === 2 && dvs.payments === 1 && dvs.linked_appointments === 2, JSON.stringify(dvs));
  const ds4 = (await q("select delete_sales($1, false) r", [[sale4.sale_id]])).rows[0].r;
  const a4 = (await q("select status, final_total, completed_at from appointments where id=$1", [D4.id])).rows[0];
  check("eliminar una venta dejando la cita: la cita vuelve a «confirmada» para cobrarla de nuevo", ds4.sales === 1 && ds4.reopened === 1 && a4.status === "confirmado" && a4.final_total === null && a4.completed_at === null && !(await exists("sales", sale4.sale_id)));
  check("eliminar una venta: se van también sus pagos", ds4.payments === 1 && (await q("select count(*) from payments where sale_id=$1", [sale4.sale_id])).rows[0].count === "0");
  const ds5 = (await q("select delete_sales($1, true) r", [[sale5.sale_id]])).rows[0].r;
  check("eliminar una venta junto con su cita: se van las dos", ds5.sales === 1 && ds5.appointments === 1 && !(await exists("appointments", D5.id)) && !(await exists("sales", sale5.sale_id)));
  const qs2 = (await q("select create_quick_sale($1::jsonb) r", [JSON.stringify({ items: [{ description: "Venta suelta", quantity: 1, unit_price: 100 }], payments: [{ method: "efectivo", amount: 100 }] })])).rows[0].r;
  const dsq = (await q("select delete_sales($1, false) r", [[qs2.sale_id]])).rows[0].r;
  check("eliminar una venta de mostrador (sin cita): se borra con su pago", dsq.sales === 1 && dsq.payments === 1 && dsq.appointments === 0 && !(await exists("sales", qs2.sale_id)));

  // Clientes: sin historial se borran; con historial solo si se pide
  await asAdmin();
  const cClean = (await q("insert into clients (first_name, last_name, phone) values ('Sin','Historial','8295553010') returning id")).rows[0].id;
  const D6 = await mkAppt("Seis", "8295553006", "en_servicio", 950);
  await asUser(uManager);
  const sale6 = (await q("select complete_appointment($1) r", [D6.id])).rows[0].r;
  await q("select record_sale_payment($1, 70, 'efectivo')", [sale6.sale_id]);
  const dvc = (await q("select describe_deletion('clients', $1) r", [[cClean, D6.client_id]])).rows[0].r;
  check("vista previa de clientes: separa los que tienen historial", dvc.clients_clean === 1 && dvc.clients_with_history === 1 && dvc.appointments === 1 && dvc.sales === 1 && dvc.payments === 1, JSON.stringify(dvc));
  const dc1 = (await q("select delete_clients($1, false) r", [[cClean, D6.client_id]])).rows[0].r;
  check("eliminar clientes sin pedir el historial: borra al que no tiene y conserva (y avisa de) al que sí", dc1.clients === 1 && dc1.skipped === 1 && !(await exists("clients", cClean)) && (await exists("clients", D6.client_id)) && (await exists("appointments", D6.id)));
  const dc2 = (await q("select delete_clients($1, true) r", [[D6.client_id]])).rows[0].r;
  check("eliminar un cliente CON su historial: se van sus citas, ventas y pagos", dc2.clients === 1 && dc2.appointments === 1 && dc2.sales === 1 && dc2.payments === 1 && !(await exists("clients", D6.client_id)) && !(await exists("appointments", D6.id)) && !(await exists("sales", sale6.sale_id)));

  // Notificaciones
  await asAdmin();
  await q("insert into notifications (type, title, read_at) values ('prueba', 'leída', now()), ('prueba', 'sin leer', null)");
  await asUser(uRecep);
  const cn1 = (await q("select clear_notifications(true) n")).rows[0].n;
  const left1 = (await q("select count(*) from notifications where type='prueba'")).rows[0].count;
  check("notificaciones: «borrar leídas» deja las que faltan por leer", cn1 >= 1 && left1 === "1");
  const cn2 = (await q("select clear_notifications(false) n")).rows[0].n;
  check("notificaciones: «borrar todas» las limpia (recepción puede)", cn2 >= 1 && (await q("select count(*) from notifications")).rows[0].count === "0");
  await asAdmin();


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
