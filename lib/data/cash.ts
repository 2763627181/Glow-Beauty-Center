import "server-only";
import { parseCashReport, type CashReport } from "@/lib/domain/cash";
import { drToISO, todayISO } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { listAppointments, type ApptRow } from "./appointments";

export type CashSessionRow = {
  id: string; number: string; opened_at: string; closed_at: string | null; opening_amount: number;
  expected_cash: number | null; counted_cash: number | null; difference: number | null; opened_by: string | null; closed_by: string | null;
};

/** ¿Está instalada la actualización de la base de datos de la caja? (Si no, la pantalla explica qué falta en vez de fallar.) */
export async function cashInstalled(): Promise<boolean> {
  const { error } = await (await createClient()).from("cash_sessions").select("id").limit(1);
  return !error;
}

export async function getOpenSessionId(): Promise<string | null> {
  const { data } = await (await createClient()).from("cash_sessions").select("id").is("closed_at", null).maybeSingle();
  return data?.id ?? null;
}

/** Reporte de un turno: en vivo si está abierto; la foto del cierre si ya se cerró. `null` si no existe. */
export async function getCashReport(id: string): Promise<CashReport | null> {
  const { data, error } = await (await createClient()).rpc("cash_session_report", { p_session: id });
  if (error || !data) return null;
  return parseCashReport(data);
}

/** Turnos más recientes (con el nombre de quien abrió y cerró). */
export async function listCashSessions(limit = 40): Promise<CashSessionRow[]> {
  const sb = await createClient();
  const { data } = await sb.from("cash_sessions")
    .select("id,session_number,opened_at,closed_at,opening_amount,expected_cash,counted_cash,difference,opened_by,closed_by")
    .order("opened_at", { ascending: false }).limit(limit);
  const rows = data ?? [];
  const ids = [...new Set(rows.flatMap((r) => [r.opened_by, r.closed_by]).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await sb.from("profiles").select("id,full_name").in("id", ids);
    for (const p of profiles ?? []) names.set(p.id, p.full_name);
  }
  const num = (v: unknown) => (v == null ? null : Number(v));
  return rows.map((r) => ({
    id: r.id, number: r.session_number, opened_at: r.opened_at, closed_at: r.closed_at, opening_amount: Number(r.opening_amount),
    expected_cash: num(r.expected_cash), counted_cash: num(r.counted_cash), difference: num(r.difference),
    opened_by: r.opened_by ? names.get(r.opened_by) ?? null : null, closed_by: r.closed_by ? names.get(r.closed_by) ?? null : null,
  }));
}

export type LooseCash = { count: number; total: number; items: { id: string; paid_at: string; amount: number; sale_id: string | null; sale_number: string | null; client: string | null }[] };

/** Efectivo cobrado fuera de todo turno de caja (para avisarlo y contarlo al abrir). */
export async function getLooseCash(): Promise<LooseCash> {
  const { data } = await (await createClient()).rpc("cash_unassigned");
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    count: Number(data?.count ?? 0), total: Number(data?.total ?? 0),
    items: items.map((i: Record<string, unknown>) => ({ id: String(i.id), paid_at: String(i.paid_at), amount: Number(i.amount), sale_id: (i.sale_id as string) ?? null, sale_number: (i.sale_number as string) ?? null, client: (i.client as string) ?? null })),
  };
}

export type OwedSale = { id: string; sale_number: string; completed_at: string; total: number; paid: number; client: string };

/** Lo que está por cobrar: citas de hoy (y las que siguen en curso) y ventas con saldo. */
export async function getChargeQueue(): Promise<{ appointments: ApptRow[]; sales: OwedSale[] }> {
  const today = todayISO();
  const from = drToISO(today, "00:00");
  const to = new Date(+new Date(from) + 24 * 36e5).toISOString();
  const [todays, inProgress, salesRes] = await Promise.all([
    listAppointments({ from, to, status: ["confirmado", "en_espera", "en_servicio"], limit: 200 }),
    listAppointments({ status: ["en_espera", "en_servicio"], limit: 100 }),
    (async () => {
      const sb = await createClient();
      return sb.from("sales").select("id,sale_number,total,completed_at,client:clients(first_name,last_name),payments(amount,status)")
        .in("payment_status", ["pendiente", "parcial"]).is("voided_at", null).order("completed_at", { ascending: false }).limit(60);
    })(),
  ]);
  const seen = new Map<string, ApptRow>();
  for (const a of [...todays, ...inProgress]) seen.set(a.id, a);
  const appointments = [...seen.values()].sort((a, b) => +new Date(a.start_time) - +new Date(b.start_time));
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const sales: OwedSale[] = (salesRes.data ?? []).map((s: any) => ({
    id: s.id, sale_number: s.sale_number, completed_at: s.completed_at, total: Number(s.total),
    paid: (s.payments ?? []).filter((p: any) => p.status === "pagado").reduce((t: number, p: any) => t + Number(p.amount), 0),
    client: s.client ? `${s.client.first_name} ${s.client.last_name}`.trim() : "Mostrador",
  }));
  return { appointments, sales };
}
