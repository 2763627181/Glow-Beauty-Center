import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ServiceOption = { key: string; serviceId: string; variantId: string | null; label: string; price: number; categoryId: string; durationMin: number };

/** Servicios (con variantes aplanadas) para selectores del panel. */
export async function listServiceOptions(onlyActive = true): Promise<ServiceOption[]> {
  const sb = await createClient();
  let q = sb.from("services").select("id,name,price,duration_minutes,category_id,active,pending_review,service_variants(id,name,price,duration_minutes,active)").order("display_order");
  if (onlyActive) q = q.eq("active", true).eq("pending_review", false);
  const { data } = await q;
  return (data ?? []).flatMap((s): ServiceOption[] => {
    const vars = (s.service_variants ?? []).filter((v: { active: boolean }) => v.active);
    if (!vars.length) return [{ key: s.id, serviceId: s.id, variantId: null, label: s.name, price: Number(s.price), categoryId: s.category_id, durationMin: s.duration_minutes }];
    return vars.map((v: { id: string; name: string; price: number; duration_minutes: number }) => ({
      key: `${s.id}:${v.id}`, serviceId: s.id, variantId: v.id, label: `${s.name} – ${v.name}`, price: Number(v.price), categoryId: s.category_id, durationMin: v.duration_minutes,
    }));
  });
}
