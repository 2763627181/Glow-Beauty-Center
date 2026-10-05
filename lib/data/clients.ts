import "server-only";
import { createClient } from "@/lib/supabase/server";
import { applyClientSearch } from "./client-search";

export const PAGE_SIZE = 25;
/* eslint-disable @typescript-eslint/no-explicit-any */

export type ClientListRow = {
  id: string; first_name: string; last_name: string; phone: string; email: string | null; active: boolean;
  visits: number; total_spent: number; last_visit: string | null; next_appointment: string | null;
};

export async function listClients(q: string, page: number) {
  const sb = await createClient();
  let query = sb.from("clients").select("id,first_name,last_name,phone,email,active", { count: "exact" })
    .order("created_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q.trim()) query = applyClientSearch(query, q);
  const { data, count } = await query;
  // client_stats es una vista (sin FK): se consulta aparte por ids
  const ids = (data ?? []).map((c: any) => c.id);
  const { data: stats } = ids.length ? await sb.from("client_stats").select("client_id,visits,total_spent,last_visit,next_appointment").in("client_id", ids) : { data: [] };
  const statBy = new Map((stats ?? []).map((s: any) => [s.client_id, s]));
  const rows: ClientListRow[] = (data ?? []).map((c: any) => {
    const st: any = statBy.get(c.id);
    return { id: c.id, first_name: c.first_name, last_name: c.last_name, phone: c.phone, email: c.email, active: c.active,
      visits: st?.visits ?? 0, total_spent: Number(st?.total_spent ?? 0), last_visit: st?.last_visit ?? null, next_appointment: st?.next_appointment ?? null };
  });
  return { rows, total: count ?? 0 };
}

export async function getClientProfile(id: string) {
  const sb = await createClient();
  const [{ data: c }, { data: st }, { data: appts }, { data: sales }] = await Promise.all([
    sb.from("clients").select("*").eq("id", id).maybeSingle(),
    sb.from("client_stats").select("*").eq("client_id", id).maybeSingle(),
    sb.from("appointments").select("*, employee:employees(id,full_name), client:clients(id,first_name,last_name,phone,email), services:appointment_services(id,service_id,variant_id,name,price,final_price,duration_minutes,span_minutes,quantity,addons,employee_id,start_time,end_time,position,employee:employees(full_name)), payments(amount,status)").eq("client_id", id).order("start_time", { ascending: false }).limit(100),
    sb.from("sales").select("id,sale_number,completed_at,total,payment_status,payments(amount,method,status)").eq("client_id", id).order("completed_at", { ascending: false }).limit(100),
  ]);
  if (!c) return null;
  return { client: c, stats: st, appts: (appts ?? []) as any[], sales: (sales ?? []) as any[] };
}
