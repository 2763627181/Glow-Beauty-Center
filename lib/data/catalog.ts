import { unstable_cache } from "next/cache";
import { normalizeSettings, type BusinessSettings } from "@/lib/domain/settings";
import { createPublicClient } from "@/lib/supabase/public";
import type { Catalog, Employee, GalleryItem, Promotion, Service } from "@/types/domain";
import { CATALOG_TAG } from "./cache-tags";

/* Datos públicos: lectura anónima (RLS) cacheada 5 min y purgada al instante cuando el admin guarda (updateTag). */
const cached = <T>(key: string, fn: () => Promise<T>) => unstable_cache(fn, [key], { tags: [CATALOG_TAG], revalidate: 300 });
const num = (v: unknown) => Number(v ?? 0);

export const getCatalog = cached<Catalog>("catalog-v3", async () => {
  const sb = createPublicClient();
  const [cats, svcs, vars, adds] = await Promise.all([
    sb.from("service_categories").select("*").eq("active", true).order("display_order"),
    sb.from("services").select("*").eq("active", true).eq("pending_review", false).order("display_order"),
    sb.from("service_variants").select("*").eq("active", true).order("display_order"),
    sb.from("service_addons").select("*").eq("active", true),
  ]);
  const services: Service[] = (svcs.data ?? []).map((s) => ({
    ...s,
    price: num(s.price),
    variants: (vars.data ?? []).filter((v) => v.service_id === s.id).map((v) => ({ ...v, price: num(v.price) })),
    addons: (adds.data ?? []).filter((a) => a.service_id === s.id).map((a) => ({ ...a, price: num(a.price) })),
  }));
  // Solo categorías con servicios publicados
  const categories = (cats.data ?? []).filter((c) => services.some((s) => s.category_id === c.id));
  return { categories, services };
});

export const getSettings = cached<BusinessSettings>("settings-v4", async () => {
  const sb = createPublicClient();
  const { data } = await sb.from("business_settings").select("key, value").eq("is_public", true);
  return normalizeSettings(Object.fromEntries((data ?? []).map((r) => [r.key, r.value])));
});

export const getPublicEmployees = cached<Employee[]>("employees-v3", async () => {
  const sb = createPublicClient();
  const { data } = await sb.from("employees").select("id, full_name, avatar_url, specialty, bio")
    .eq("active", true).eq("accepts_online_booking", true).order("display_order");
  return data ?? [];
});

export const getEmployeeServiceLinks = cached<{ employee_id: string; service_id: string }[]>("emp-links-v3", async () => {
  const sb = createPublicClient();
  const { data } = await sb.from("employee_services").select("employee_id, service_id");
  return data ?? [];
});

export const getActivePromotions = cached<Promotion[]>("promos-v3", async () => {
  const sb = createPublicClient();
  const { data } = await sb.from("promotions").select("*, promotion_services(service_id)").eq("active", true).order("created_at", { ascending: false });
  return (data ?? []).map((p) => ({
    id: p.id, name: p.name, description: p.description,
    original_price: p.original_price == null ? null : num(p.original_price),
    promo_price: num(p.promo_price), ends_on: p.ends_on, image_url: p.image_url,
    service_ids: (p.promotion_services ?? []).map((x: { service_id: string }) => x.service_id),
  }));
});

export const getGallery = cached<GalleryItem[]>("gallery-v3", async () => {
  const sb = createPublicClient();
  const { data } = await sb.from("gallery").select("*").eq("active", true).order("display_order");
  return data ?? [];
});
