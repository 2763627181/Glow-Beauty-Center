import "server-only";
import { analyzeSupply, narrate, progressLines, summarizeSupply, VERDICT_LABEL, type Lot, type Narrative, type SupplySummary, type Usage, type Verdict } from "@/lib/domain/inventory";
import { drToISO, TZ, todayISO } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "./paginate";

/** Una entrada ya analizada, lista para mostrar. */
export type LotView = {
  id: string; received_on: string; quantity: number; unit_cost: number | null; supplier: string | null; notes: string | null; depleted_on: string | null;
  state: "agotada" | "en_uso" | "espera";
  /** Desde cuándo se usa de verdad (si llegó otra antes y esperó su turno, es cuando se agotó la anterior). */
  startDate: string;
  days: number; services: number; clients: number;
  verdict: Verdict | null; verdictText: string | null; verdictTone: "ok" | "warn" | "bad" | "muted" | null;
  narrative: Narrative | null; progress: string[];
};
export type SupplyView = {
  id: string; name: string; unit: string; expected: number | null; notes: string | null; active: boolean;
  services: { id: string; name: string }[];
  lots: LotView[];
  summary: SupplySummary;
};
export type ServicePick = { id: string; name: string; category: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
const localDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });

/** Servicios que se pueden marcar como «en este servicio se usa este producto». */
export async function listServicePicks(): Promise<ServicePick[]> {
  const sb = await createClient();
  const { data } = await sb.from("services").select("id,name,category:service_categories(name,display_order),display_order").eq("active", true).order("display_order");
  return (data ?? []).map((s: any) => ({ id: s.id, name: s.name, category: s.category?.name ?? "" })).sort((a, b) => a.category.localeCompare(b.category, "es") || a.name.localeCompare(b.name, "es"));
}

/** Servicios realizados (ventas no anuladas) con alguno de los servicios dados desde `fromDay`. Un servicio de un equipo cuenta una sola vez. */
async function loadUsages(serviceIds: string[], fromDay: string): Promise<Usage[]> {
  if (!serviceIds.length) return [];
  const sb = await createClient();
  const rows = await fetchAll<any>((from, to) => sb.from("sale_items")
    .select("id,quantity,team_id,sales!inner(id,client_id,completed_at,voided_at)")
    .in("service_id", serviceIds).is("sales.voided_at", null).gte("sales.completed_at", drToISO(fromDay, "00:00")).order("id").range(from, to), 20000);
  const groups = new Map<string, Usage>();
  for (const r of rows) {
    const key = `${r.sales.id}:${r.team_id ?? r.id}`;
    const qty = Math.max(1, Number(r.quantity) || 1);
    const g = groups.get(key);
    if (g) g.qty = Math.max(g.qty, qty);
    else groups.set(key, { date: localDay(r.sales.completed_at), clientKey: r.sales.client_id ?? `venta:${r.sales.id}`, qty });
  }
  return [...groups.values()];
}

async function build(raw: any): Promise<SupplyView> {
  const today = todayISO();
  const lots: Lot[] = (raw.supply_lots ?? []).map((l: any) => ({ id: l.id, received_on: l.received_on, quantity: Number(l.quantity), depleted_on: l.depleted_on }));
  const services = (raw.supply_services ?? []).map((x: any) => ({ id: x.service_id, name: x.service?.name ?? "—" })).sort((a: any, b: any) => a.name.localeCompare(b.name, "es"));
  const supply = { name: raw.name as string, unit: raw.unit as string, expected: raw.expected_services_per_unit == null ? null : Number(raw.expected_services_per_unit) };
  const from = lots.length ? lots.map((l) => l.received_on).sort()[0] : today;
  const usages = await loadUsages(services.map((s: any) => s.id), from);
  const analyses = analyzeSupply(supply, lots, usages, today);
  const names = services.map((s: any) => s.name);
  const byId = new Map<string, any>((raw.supply_lots ?? []).map((l: any) => [l.id, l]));
  const views: LotView[] = analyses.map((a) => {
    const l = byId.get(a.window.lot.id);
    const v = a.verdict ? VERDICT_LABEL[a.verdict] : null;
    return {
      id: l.id, received_on: l.received_on, quantity: Number(l.quantity), unit_cost: l.unit_cost == null ? null : Number(l.unit_cost), supplier: l.supplier, notes: l.notes, depleted_on: l.depleted_on,
      state: a.window.waiting ? "espera" : a.window.open ? "en_uso" : "agotada", startDate: a.window.startDate, days: a.days, services: a.services, clients: a.clients,
      verdict: a.verdict, verdictText: v?.text ?? null, verdictTone: v?.tone ?? null, narrative: narrate(a, supply, names), progress: progressLines(a, supply),
    };
  });
  return {
    id: raw.id, name: raw.name, unit: raw.unit, expected: supply.expected, notes: raw.notes, active: raw.active, services, lots: views.reverse(), // la más reciente primero
    summary: summarizeSupply(analyses),
  };
}

const SELECT = "id,name,unit,expected_services_per_unit,notes,active,supply_services(service_id,service:services(name)),supply_lots(id,received_on,quantity,unit_cost,supplier,notes,depleted_on)";

export async function listSupplies(): Promise<SupplyView[]> {
  const { data, error } = await (await createClient()).from("supplies").select(SELECT).order("name");
  if (error) throw new Error(error.message);
  return Promise.all((data ?? []).map(build));
}

export async function getSupply(id: string): Promise<SupplyView | null> {
  const { data } = await (await createClient()).from("supplies").select(SELECT).eq("id", id).maybeSingle();
  return data ? build(data) : null;
}

/** ¿Está instalada la actualización del inventario? (Si no, la pantalla lo explica en vez de fallar.) */
export async function inventoryInstalled(): Promise<boolean> {
  const { error } = await (await createClient()).from("supplies").select("id").limit(1);
  return !error;
}
