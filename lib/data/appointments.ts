import "server-only";
import { createClient } from "@/lib/supabase/server";
import { applyClientSearch, cleanTerm } from "./client-search";
import { fetchAll } from "./paginate";
import type { AppointmentSource, AppointmentStatus } from "@/types/domain";

export type ApptService = {
  id: string; service_id: string | null; variant_id: string | null; name: string; price: number; final_price: number;
  duration_minutes: number; span_minutes: number | null; quantity: number; addons: { name: string; price: number }[];
  employee_id: string | null; employee_name: string | null; start_time: string | null; end_time: string | null; position: number;
  /** Empieza junto con la línea anterior. */
  parallel: boolean;
  /** Mismo valor en todas las líneas de un servicio atendido por varias especialistas. */
  team_id: string | null;
};
export type ApptRow = {
  id: string; request_number: string; status: AppointmentStatus; source: AppointmentSource;
  start_time: string; end_time: string; appointment_date: string;
  estimated_total: number; final_total: number | null; discount: number; tip: number; notes: string | null;
  employee_id: string | null; client_id: string; created_at: string; promotion_id: string | null;
  client: { id: string; first_name: string; last_name: string; phone: string; email: string | null };
  employee: { id: string; full_name: string } | null;
  /** Especialistas distintos que participan (para mostrar "Ana + Carla"). */
  employees: { id: string; name: string }[];
  services: ApptService[];
  paid: number;
};

const SELECT = `*, client:clients(id,first_name,last_name,phone,email), employee:employees(id,full_name),
  services:appointment_services(id,service_id,variant_id,name,price,final_price,duration_minutes,span_minutes,quantity,addons,employee_id,start_time,end_time,position,parallel,team_id,employee:employees(full_name)),
  payments(amount,status)`;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;
export function shapeAppointment(r: Raw): ApptRow {
  const services: ApptService[] = (r.services ?? [])
    .map((s: Raw) => ({ ...s, price: Number(s.price), final_price: Number(s.final_price), employee_name: s.employee?.full_name ?? null, employee: undefined }))
    .sort((a: ApptService, b: ApptService) => a.position - b.position);
  const seen = new Map<string, string>();
  for (const s of services) if (s.employee_id && s.employee_name) seen.set(s.employee_id, s.employee_name);
  if (r.employee?.id && !seen.size) seen.set(r.employee.id, r.employee.full_name);
  return {
    ...r,
    estimated_total: Number(r.estimated_total), final_total: r.final_total == null ? null : Number(r.final_total),
    discount: Number(r.discount), tip: Number(r.tip),
    services, employees: [...seen].map(([id, name]) => ({ id, name })),
    paid: (r.payments ?? []).filter((p: Raw) => p.status === "pagado").reduce((t: number, p: Raw) => t + Number(p.amount), 0),
  } as ApptRow;
}

export { apptTotal, apptSubtotal } from "./appointment-math";

export type ApptFilter = { from?: string; to?: string; status?: AppointmentStatus[]; employeeId?: string; clientId?: string; search?: string; limit?: number };

export async function listAppointments(f: ApptFilter = {}): Promise<ApptRow[]> {
  const sb = await createClient();
  let q = sb.from("appointments").select(SELECT).order("start_time", { ascending: true }).order("id");
  if (f.from) q = q.gte("start_time", f.from);
  if (f.to) q = q.lt("start_time", f.to);
  if (f.status?.length) q = q.in("status", f.status);
  if (f.clientId) q = q.eq("client_id", f.clientId);
  if (f.search?.trim()) {
    // Busca por nombre/teléfono del cliente (varias palabras) o por número de solicitud (SOL-XXXX)
    const { data: cl } = await applyClientSearch(sb.from("clients").select("id"), f.search).limit(100);
    const ids = (cl ?? []).map((c) => c.id);
    const term = cleanTerm(f.search);
    q = q.or([ids.length ? `client_id.in.(${ids.join(",")})` : null, `request_number.ilike.%${term}%`].filter(Boolean).join(","));
  }
  const data = await fetchAll((from, to) => q.range(from, to), f.limit ?? 300);
  let rows = data.map(shapeAppointment);
  if (f.employeeId) rows = rows.filter((a) => a.employee_id === f.employeeId || a.services.some((s) => s.employee_id === f.employeeId));
  return rows;
}

export async function countAppointments(status: AppointmentStatus[]): Promise<number> {
  const sb = await createClient();
  const { count } = await sb.from("appointments").select("id", { count: "exact", head: true }).in("status", status);
  return count ?? 0;
}

export async function getAppointment(id: string) {
  const sb = await createClient();
  const [{ data }, { data: history }, { data: notes }, { data: payments }, { data: sale }] = await Promise.all([
    sb.from("appointments").select(SELECT).eq("id", id).maybeSingle(),
    sb.from("appointment_status_history").select("*").eq("appointment_id", id).order("changed_at"),
    sb.from("appointment_notes").select("*").eq("appointment_id", id).order("created_at", { ascending: false }),
    sb.from("payments").select("*").eq("appointment_id", id).order("paid_at"),
    sb.from("sales").select("id,sale_number,total,payment_status,voided_at").eq("appointment_id", id).maybeSingle(),
  ]);
  if (!data) return null;
  return { appt: shapeAppointment(data), history: history ?? [], notes: notes ?? [], payments: payments ?? [], sale };
}

export async function listStaffOptions() {
  const sb = await createClient();
  const { data } = await sb.from("employees").select("id,full_name,active").order("display_order");
  return (data ?? []) as { id: string; full_name: string; active: boolean }[];
}
