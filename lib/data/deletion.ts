import "server-only";
import type { DeletionInfo, DeletionResult } from "@/lib/domain/deletion";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Eliminación de citas, ventas y clientes por la API de Supabase (con la llave de servicio). Es el mismo trabajo que hacen las
 * funciones `delete_*` de la base de datos (migración 15) y se usa cuando esas funciones todavía no están instaladas.
 * El permiso (gerencia / super admin) lo comprueba la acción que llama, ANTES de llegar aquí.
 * Orden: pagos → ventas (se llevan sus artículos) → citas (se llevan sus líneas, historial y notas) → clientes. Si algo falla a
 * medias, lo que falta se puede volver a borrar sin dejar datos inconsistentes.
 */
type Db = ReturnType<typeof createAdminClient>;
type Raw = DeletionResult & { calendar_events?: string[] };
type Row = Record<string, unknown>;

const SIZE = 40; // las listas de ids van en la dirección de la petición: se parten para que no sea demasiado larga
const chunks = <T,>(list: T[], n = SIZE) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const must = async <T,>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> => {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
};
/** Una consulta por cada tramo de ids, con los resultados juntos. */
async function many<T>(ids: string[], run: (part: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunks(ids)) out.push(...(await must(run(part))));
  return out;
}
/** Borra por tramos y devuelve cuántas filas se fueron. */
async function removeIn(db: Db, table: string, column: string, ids: string[]): Promise<number> {
  let n = 0;
  for (const part of chunks(ids)) n += (await must(db.from(table).delete().in(column, part).select("id"))).length;
  return n;
}
const uniq = <T,>(a: T[]) => [...new Set(a)];

/** Ventas de las citas y pagos (de esas ventas o de las citas), sin repetir. */
async function related(db: Db, apptIds: string[], saleIds: string[]) {
  const sales = apptIds.length ? await many<{ id: string; total: number }>(apptIds, (p) => db.from("sales").select("id,total").in("appointment_id", p)) : [];
  const allSales = uniq([...saleIds, ...sales.map((s) => s.id)]);
  const pays = new Map<string, { id: string; amount: number; status: string }>();
  for (const p of [
    ...(apptIds.length ? await many<{ id: string; amount: number; status: string }>(apptIds, (q) => db.from("payments").select("id,amount,status").in("appointment_id", q)) : []),
    ...(allSales.length ? await many<{ id: string; amount: number; status: string }>(allSales, (q) => db.from("payments").select("id,amount,status").in("sale_id", q)) : []),
  ]) pays.set(p.id, p);
  return { saleIds: allSales, payments: [...pays.values()] };
}

/** Lo que se borraría (igual que `describe_deletion`). */
export async function describeViaApi(kind: "appointments" | "clients" | "sales", ids: string[]): Promise<DeletionInfo> {
  const db = createAdminClient();
  let apptIds: string[] = [], saleIds: string[] = [], linked = 0, hist = 0, clean = 0;
  if (kind === "appointments") apptIds = ids;
  else if (kind === "sales") {
    saleIds = ids;
    const s = await many<{ appointment_id: string | null }>(ids, (p) => db.from("sales").select("appointment_id").in("id", p));
    apptIds = s.map((x) => x.appointment_id).filter((x): x is string => !!x);
    linked = apptIds.length;
  } else {
    const appts = await many<{ id: string; client_id: string }>(ids, (p) => db.from("appointments").select("id,client_id").in("client_id", p));
    const sales = await many<{ id: string; client_id: string | null }>(ids, (p) => db.from("sales").select("id,client_id").in("client_id", p));
    apptIds = appts.map((a) => a.id);
    saleIds = sales.map((s) => s.id);
    hist = new Set([...appts.map((a) => a.client_id), ...sales.map((s) => s.client_id)].filter((x): x is string => !!x)).size;
    clean = ids.length - hist;
  }
  const rel = await related(db, apptIds, saleIds);
  const sales = rel.saleIds.length ? await many<{ total: number }>(rel.saleIds, (p) => db.from("sales").select("total").in("id", p)) : [];
  return {
    appointments: kind === "sales" ? 0 : apptIds.length, sales: rel.saleIds.length, sales_total: sales.reduce((t, s) => t + Number(s.total), 0),
    payments: rel.payments.length, paid_total: rel.payments.filter((p) => p.status === "pagado").reduce((t, p) => t + Number(p.amount), 0),
    linked_appointments: linked, clients_with_history: hist, clients_clean: clean,
  };
}

/** Citas con su venta y sus pagos. Devuelve cuántas filas se fueron y los eventos de Google Calendar a quitar. */
async function purgeAppointments(db: Db, apptIds: string[]): Promise<Required<Pick<Raw, "appointments" | "sales" | "payments">> & { calendar_events: string[] }> {
  if (!apptIds.length) return { appointments: 0, sales: 0, payments: 0, calendar_events: [] };
  const events = (await many<{ google_calendar_event_id: string | null }>(apptIds, (p) => db.from("appointments").select("google_calendar_event_id").in("id", p)))
    .map((a) => a.google_calendar_event_id).filter((e): e is string => !!e);
  const rel = await related(db, apptIds, []);
  const payments = await removeIn(db, "payments", "id", rel.payments.map((p) => p.id));
  const sales = await removeIn(db, "sales", "id", rel.saleIds);
  const appointments = await removeIn(db, "appointments", "id", apptIds);
  return { appointments, sales, payments, calendar_events: events };
}

export async function deleteAppointmentsViaApi(ids: string[]): Promise<Raw> {
  return purgeAppointments(createAdminClient(), ids);
}

export async function deleteSalesViaApi(ids: string[], withAppointment: boolean): Promise<Raw> {
  const db = createAdminClient();
  const sales = await many<{ id: string; appointment_id: string | null }>(ids, (p) => db.from("sales").select("id,appointment_id").in("id", p));
  const apptIds = sales.map((s) => s.appointment_id).filter((x): x is string => !!x);
  const payments = await removeIn(db, "payments", "sale_id", sales.map((s) => s.id));
  const deleted = await removeIn(db, "sales", "id", sales.map((s) => s.id));
  if (!apptIds.length) return { sales: deleted, payments, appointments: 0, reopened: 0, calendar_events: [] };
  if (withAppointment) {
    const a = await purgeAppointments(db, apptIds);
    return { sales: deleted, payments: payments + a.payments, appointments: a.appointments, reopened: 0, calendar_events: a.calendar_events };
  }
  // la cita vuelve a «confirmada» para poder cobrarla de nuevo
  let reopened = 0;
  for (const part of chunks(apptIds)) reopened += (await must(db.from("appointments").update({ status: "confirmado", final_total: null, completed_at: null }).in("id", part).eq("status", "completado").select("id"))).length;
  return { sales: deleted, payments, appointments: 0, reopened, calendar_events: [] };
}

export async function deleteClientsViaApi(ids: string[], withHistory: boolean): Promise<Raw> {
  const db = createAdminClient();
  const appts = await many<{ id: string; client_id: string }>(ids, (p) => db.from("appointments").select("id,client_id").in("client_id", p));
  const sales = await many<{ id: string; client_id: string | null }>(ids, (p) => db.from("sales").select("id,client_id").in("client_id", p));
  const withHist = new Set([...appts.map((a) => a.client_id), ...sales.map((s) => s.client_id)].filter((x): x is string => !!x));
  const deletable = ids.filter((id) => !withHist.has(id) || withHistory);
  const skipped = withHistory ? 0 : [...withHist].filter((id) => ids.includes(id)).length;
  let a = { appointments: 0, sales: 0, payments: 0, calendar_events: [] as string[] };
  if (withHistory && withHist.size) {
    // ventas del cliente que no vienen de una cita, y luego las citas con lo suyo
    const apptIds = appts.map((x) => x.id);
    const own = sales.map((s) => s.id);
    const payments = await removeIn(db, "payments", "sale_id", own);
    const salesGone = await removeIn(db, "sales", "id", own);
    const p = await purgeAppointments(db, apptIds);
    a = { appointments: p.appointments, sales: salesGone + p.sales, payments: payments + p.payments, calendar_events: p.calendar_events };
  }
  const clients = await removeIn(db, "clients", "id", deletable);
  return { clients, skipped, ...a };
}

export async function clearNotificationsViaApi(onlyRead: boolean): Promise<number> {
  const db = createAdminClient();
  const q = db.from("notifications").delete();
  return (await must(onlyRead ? q.not("read_at", "is", null).select("id") : q.not("id", "is", null).select("id"))).length;
}

/** Deja constancia en Auditoría de QUIÉN eliminó y qué (las filas borradas se anotan solas, pero sin usuario cuando se usa la llave de servicio). */
export async function auditDeletion(userId: string, kind: string, result: Row) {
  const { calendar_events, ...rest } = result as Row & { calendar_events?: unknown };
  void calendar_events;
  await createAdminClient().from("audit_logs").insert({ user_id: userId, action: "delete_records", entity: kind, entity_id: null, after_data: rest });
}
