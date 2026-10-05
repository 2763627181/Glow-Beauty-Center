import { PageHead } from "@/components/admin/primitives";
import { PromotionsManager, type PromoRow } from "@/components/admin/content/PromotionsManager";
import { requireAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Promociones" };
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function PromotionsPage() {
  await requireAccess("promotions");
  const sb = await createClient();
  const [{ data: promos }, { data: svcs }] = await Promise.all([
    sb.from("promotions").select("*, promotion_services(service_id)").order("created_at", { ascending: false }),
    sb.from("services").select("id,name").eq("pending_review", false).order("display_order"),
  ]);
  const rows: PromoRow[] = (promos ?? []).map((p: any) => ({
    id: p.id, name: p.name, description: p.description, original_price: p.original_price == null ? null : Number(p.original_price), promo_price: Number(p.promo_price),
    starts_on: p.starts_on ?? "", ends_on: p.ends_on ?? "", image_url: p.image_url, active: p.active, service_ids: p.promotion_services.map((x: any) => x.service_id),
  }));
  return (<><PageHead title="Promociones" sub="Las activas y vigentes se muestran solas en la página principal." /><PromotionsManager promos={rows} services={svcs ?? []} /></>);
}
