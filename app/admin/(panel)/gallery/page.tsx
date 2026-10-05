import { GalleryManager } from "@/components/admin/content/GalleryManager";
import { PageHead } from "@/components/admin/primitives";
import { requireAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Galería" };

export default async function GalleryAdmin() {
  await requireAccess("gallery");
  const sb = await createClient();
  const { data } = await sb.from("gallery").select("id,title,category,image_url,is_cover,active").order("display_order").order("created_at");
  return (<><PageHead title="Galería" sub="Imágenes públicas del sitio. Máx. 5 MB por imagen." /><GalleryManager items={data ?? []} /></>);
}
