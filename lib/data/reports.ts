import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ApptIn, SaleIn } from "@/lib/domain/reports";
import { fetchAll } from "./paginate";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadSales(fromISO: string, toISO: string): Promise<SaleIn[]> {
  const sb = await createClient();
  const { data: cats } = await sb.from("service_categories").select("id,name");
  const catName = new Map((cats ?? []).map((c: any) => [c.id, c.name]));
  const data = await fetchAll((from, to) => sb
    .from("sales")
    .select("id,sale_number,completed_at,total,subtotal,discount,tip,payment_status,client_id,employee_id, client:clients(first_name,last_name), employee:employees(full_name), sale_items(description,total,service_id,category_id,employee_id,commission_pct,employee:employees(full_name)), payments(amount,method,status)")
    .gte("completed_at", fromISO).lt("completed_at", toISO).order("completed_at", { ascending: false }).order("id").range(from, to), 8000);
  return (data ?? []).map((s: any) => ({
    id: s.id, sale_number: s.sale_number, completed_at: s.completed_at,
    total: Number(s.total), subtotal: Number(s.subtotal), discount: Number(s.discount), tip: Number(s.tip),
    payment_status: s.payment_status, client_id: s.client_id,
    client_name: s.client ? `${s.client.first_name} ${s.client.last_name}`.trim() : "—",
    employee_id: s.employee_id, employee_name: s.employee?.full_name ?? "",
    items: (s.sale_items ?? []).map((i: any) => ({ description: i.description, total: Number(i.total), service_id: i.service_id, category_name: catName.get(i.category_id) ?? "", employee_id: i.employee_id, employee_name: i.employee?.full_name ?? "", commission_pct: i.commission_pct == null ? null : Number(i.commission_pct) })),
    payments: (s.payments ?? []).map((p: any) => ({ amount: Number(p.amount), method: p.method, status: p.status })),
  }));
}

export async function loadAppts(fromISO: string, toISO: string): Promise<ApptIn[]> {
  const sb = await createClient();
  const data = await fetchAll((from, to) => sb.from("appointments").select("status,start_time,created_at").gte("start_time", fromISO).lt("start_time", toISO).order("start_time").order("id").range(from, to), 20000);
  return data as ApptIn[];
}

/** Datos de referencia para los reportes: comisión por especialista y etiquetas de métodos de pago. */
export async function loadReportRefs() {
  const sb = await createClient();
  const [{ data: emps }, { data: methods }] = await Promise.all([
    sb.from("employees").select("id,commission_pct"),
    sb.from("payment_methods").select("key,label"),
  ]);
  return {
    employeeCommission: Object.fromEntries((emps ?? []).filter((e) => e.commission_pct != null).map((e) => [e.id, Number(e.commission_pct)])) as Record<string, number>,
    methodLabels: Object.fromEntries((methods ?? []).map((m) => [m.key, m.label])) as Record<string, string>,
  };
}
