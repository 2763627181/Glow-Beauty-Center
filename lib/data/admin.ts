import "server-only";
import type { Session } from "@/lib/auth";
import { DEFAULT_BUSINESS } from "@/lib/domain/settings";
import { can } from "@/lib/permissions";
import { staffLabel } from "@/lib/domain/staffLabel";
import { mergeTemplates, type WaTemplates } from "@/lib/domain/whatsappTemplates";
import { createClient } from "@/lib/supabase/server";
import { saleNamesInstalled } from "./sale-names";
import { listServiceOptions, type ServiceOption } from "./options";

export type AdminData = {
  userId: string; role: Session["role"]; employeeId: string | null; fullName: string;
  /** `label` = «02 · Nombre» (número y nombre) para los selectores del panel. */
  staff: { id: string; full_name: string; active: boolean; employee_number: number | null; label: string }[];
  options: ServiceOption[];
  links: { employee_id: string; service_id: string }[];
  products: { id: string; name: string; price: number }[];
  /** `isCash`: el método es efectivo (entra a la caja, permite «recibido» y vuelto). */
  paymentMethods: { key: string; label: string; isCash: boolean }[];
  /**
   * Estado de la caja. `ready` = la actualización de la base de datos está instalada; `open` = turno abierto ahora;
   * `lastCounted` = efectivo contado en el último cierre (sugerencia para el fondo inicial).
   */
  cash: { ready: boolean; open: { id: string; number: string; openedAt: string; openingAmount: number } | null; lastCounted: number | null };
  /** La base ya tiene la columna del nombre del cliente en las ventas (si no, «Nueva venta» no pide el nombre). */
  saleNames: boolean;
  templates: WaTemplates;
  business: { name: string; whatsapp: string };
};

type Sb = Awaited<ReturnType<typeof createClient>>;

/** Especialistas con su número (si la columna aún no existe en la base, sin número) en el orden del panel: manual, número y nombre. */
async function loadStaff(sb: Sb): Promise<AdminData["staff"]> {
  const full = await sb.from("employees").select("id,full_name,active,employee_number").order("display_order").order("employee_number", { nullsFirst: false }).order("full_name");
  const rows: { id: string; full_name: string; active: boolean; employee_number?: number | null }[] = !full.error
    ? full.data ?? []
    : (await sb.from("employees").select("id,full_name,active").order("display_order").order("full_name")).data ?? [];
  return rows.map((r) => ({ id: r.id, full_name: r.full_name, active: r.active, employee_number: r.employee_number ?? null, label: staffLabel(r.full_name, r.employee_number ?? null) }));
}

/** Métodos de pago activos. Si la base aún no tiene la columna `is_cash` (caja sin instalar), «efectivo» cuenta como efectivo. */
async function loadMethods(sb: Sb): Promise<AdminData["paymentMethods"]> {
  const full = await sb.from("payment_methods").select("key,label,is_cash").eq("active", true).order("display_order");
  if (!full.error) return (full.data ?? []).map((m) => ({ key: m.key, label: m.label, isCash: !!m.is_cash }));
  const basic = await sb.from("payment_methods").select("key,label").eq("active", true).order("display_order");
  return (basic.data ?? []).map((m) => ({ key: m.key, label: m.label, isCash: m.key === "efectivo" }));
}

/** ¿Hay una caja abierta? Solo para quien la usa; si las tablas aún no existen, `ready` es falso y el panel sigue como antes. */
async function loadCash(sb: Sb, s: Session): Promise<AdminData["cash"]> {
  if (!can(s.role, "cash")) return { ready: false, open: null, lastCounted: null };
  const { data, error } = await sb.from("cash_sessions").select("id,session_number,opened_at,opening_amount").is("closed_at", null).maybeSingle();
  if (error) return { ready: false, open: null, lastCounted: null };
  if (data) return { ready: true, open: { id: data.id, number: data.session_number, openedAt: data.opened_at, openingAmount: Number(data.opening_amount) }, lastCounted: null };
  const { data: last } = await sb.from("cash_sessions").select("counted_cash").not("closed_at", "is", null).order("closed_at", { ascending: false }).limit(1).maybeSingle();
  return { ready: true, open: null, lastCounted: last?.counted_cash == null ? null : Number(last.counted_cash) };
}

/** Datos de referencia que casi todas las pantallas del panel necesitan (se cargan una vez en el layout). */
export async function loadAdminData(s: Session): Promise<AdminData> {
  const sb = await createClient();
  const [staff, links, products, methods, settings, options, cash, saleNames] = await Promise.all([
    loadStaff(sb),
    sb.from("employee_services").select("employee_id,service_id"),
    sb.from("products").select("id,name,price").eq("active", true).order("display_order").order("name"),
    loadMethods(sb),
    sb.from("business_settings").select("key,value").in("key", ["business", "whatsapp_templates"]),
    listServiceOptions(true),
    loadCash(sb, s),
    saleNamesInstalled(),
  ]);
  const map = Object.fromEntries((settings.data ?? []).map((r) => [r.key, r.value as Record<string, unknown>]));
  return {
    userId: s.userId, role: s.role, employeeId: s.employeeId, fullName: s.fullName,
    staff, options, links: links.data ?? [],
    products: (products.data ?? []).map((p) => ({ ...p, price: Number(p.price) })),
    paymentMethods: methods.length ? methods : [{ key: "efectivo", label: "Efectivo", isCash: true }],
    cash, saleNames,
    templates: mergeTemplates(map.whatsapp_templates),
    business: {
      name: typeof map.business?.name === "string" && map.business.name ? map.business.name : DEFAULT_BUSINESS.name,
      whatsapp: typeof map.business?.whatsapp === "string" ? map.business.whatsapp : "",
    },
  };
}
