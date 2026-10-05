import { PageHead } from "@/components/admin/primitives";
import { ServiceForm } from "@/components/admin/services/ServiceForm";
import { requireAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Nuevo servicio" };

export default async function NewService() {
  await requireAccess("services");
  const sb = await createClient();
  const [{ data: cats }, { data: emps }] = await Promise.all([
    sb.from("service_categories").select("id,name").order("display_order"),
    sb.from("employees").select("id,full_name").eq("active", true).order("display_order"),
  ]);
  return (
    <>
      <PageHead title="Nuevo servicio" />
      <ServiceForm id={null} categories={cats ?? []} employees={(emps ?? []).map((e) => ({ id: e.id, name: e.full_name }))}
        initial={{ name: "", category_id: "", short_description: "", description: "", price: 0, price_from: false, duration_minutes: 45, buffer_before_minutes: 0, buffer_after_minutes: 0,
          commission_pct: null, requires_consultation: false, featured: false, active: true, pending_review: false, image_url: null, variants: [], addons: [], employee_ids: [] }} />
    </>
  );
}
