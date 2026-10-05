import "server-only";
import type { Session } from "@/lib/auth";
import { DEFAULT_BUSINESS } from "@/lib/domain/settings";
import { mergeTemplates, type WaTemplates } from "@/lib/domain/whatsappTemplates";
import { createClient } from "@/lib/supabase/server";
import { listServiceOptions, type ServiceOption } from "./options";

export type AdminData = {
  userId: string; role: Session["role"]; employeeId: string | null; fullName: string;
  staff: { id: string; full_name: string; active: boolean }[];
  options: ServiceOption[];
  links: { employee_id: string; service_id: string }[];
  products: { id: string; name: string; price: number }[];
  paymentMethods: { key: string; label: string }[];
  templates: WaTemplates;
  business: { name: string; whatsapp: string };
};

/** Datos de referencia que casi todas las pantallas del panel necesitan (se cargan una vez en el layout). */
export async function loadAdminData(s: Session): Promise<AdminData> {
  const sb = await createClient();
  const [staff, links, products, methods, settings, options] = await Promise.all([
    sb.from("employees").select("id,full_name,active").order("display_order"),
    sb.from("employee_services").select("employee_id,service_id"),
    sb.from("products").select("id,name,price").eq("active", true).order("display_order").order("name"),
    sb.from("payment_methods").select("key,label").eq("active", true).order("display_order"),
    sb.from("business_settings").select("key,value").in("key", ["business", "whatsapp_templates"]),
    listServiceOptions(true),
  ]);
  const map = Object.fromEntries((settings.data ?? []).map((r) => [r.key, r.value as Record<string, unknown>]));
  return {
    userId: s.userId, role: s.role, employeeId: s.employeeId, fullName: s.fullName,
    staff: staff.data ?? [], options, links: links.data ?? [],
    products: (products.data ?? []).map((p) => ({ ...p, price: Number(p.price) })),
    paymentMethods: methods.data?.length ? methods.data : [{ key: "efectivo", label: "Efectivo" }],
    templates: mergeTemplates(map.whatsapp_templates),
    business: {
      name: typeof map.business?.name === "string" && map.business.name ? map.business.name : DEFAULT_BUSINESS.name,
      whatsapp: typeof map.business?.whatsapp === "string" ? map.business.whatsapp : "",
    },
  };
}
