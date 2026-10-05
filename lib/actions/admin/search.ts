"use server";

import { requireAccess } from "@/lib/auth";
import { fmtDate, fmtTime } from "@/lib/format";
import { applyClientSearch, cleanTerm } from "@/lib/data/client-search";
import { createClient } from "@/lib/supabase/server";

export type SearchResults = {
  clients: { id: string; name: string; phone: string }[];
  appointments: { id: string; title: string; sub: string }[];
  sales: { id: string; title: string; sub: string }[];
};

/** Búsqueda global del panel. Usa la sesión del usuario: cada rol solo encuentra lo que RLS le permite ver. */
export async function globalSearch(raw: string): Promise<SearchResults> {
  await requireAccess("appointments");
  const term = cleanTerm(raw);
  const empty: SearchResults = { clients: [], appointments: [], sales: [] };
  if (term.length < 2) return empty;
  const sb = await createClient();
  const { data: clients } = await applyClientSearch(sb.from("clients").select("id,first_name,last_name,phone"), term).limit(6);
  const ids = (clients ?? []).map((c) => c.id);
  const apptOr = [ids.length ? `client_id.in.(${ids.join(",")})` : null, `request_number.ilike.%${term}%`].filter(Boolean).join(",");
  const [{ data: appts }, { data: sales }] = await Promise.all([
    sb.from("appointments").select("id,request_number,status,start_time,client:clients(first_name,last_name)").or(apptOr).order("start_time", { ascending: false }).limit(6),
    sb.from("sales").select("id,sale_number,total,client:clients(first_name,last_name)")
      .or([ids.length ? `client_id.in.(${ids.join(",")})` : null, `sale_number.ilike.%${term}%`].filter(Boolean).join(",")).order("completed_at", { ascending: false }).limit(5),
  ]);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    clients: (clients ?? []).map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name}`.trim(), phone: c.phone })),
    appointments: (appts ?? []).map((a: any) => ({ id: a.id, title: `${a.client?.first_name ?? ""} ${a.client?.last_name ?? ""}`.trim() || a.request_number, sub: `${a.request_number} · ${fmtDate(a.start_time, { day: "numeric", month: "short" })} ${fmtTime(a.start_time)} · ${a.status}` })),
    sales: (sales ?? []).map((s: any) => ({ id: s.id, title: s.sale_number, sub: `${s.client ? `${s.client.first_name} ${s.client.last_name}` : "Mostrador"} · RD$ ${Number(s.total).toLocaleString("en-US")}` })),
  };
}
