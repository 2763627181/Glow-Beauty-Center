import { notFound } from "next/navigation";
import { PageHead } from "@/components/admin/primitives";
import { ServiceForm } from "@/components/admin/services/ServiceForm";
import { ServiceTools } from "@/components/admin/services/ServiceTools";
import { requireAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Editar servicio" };
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function EditService({ params }: PageProps<"/admin/services/[id]">) {
  await requireAccess("services");
  const { id } = await params;
  const sb = await createClient();
  const [{ data: s }, { data: cats }, { data: emps }, { data: links }] = await Promise.all([
    sb.from("services").select("*, service_variants(*), service_addons(*)").eq("id", id).maybeSingle(),
    sb.from("service_categories").select("id,name").order("display_order"),
    sb.from("employees").select("id,full_name").eq("active", true).order("display_order"),
    sb.from("employee_services").select("employee_id").eq("service_id", id),
  ]);
  if (!s) notFound();
  return (
    <>
      <PageHead title={s.name} sub={`/services/${s.slug}`}><ServiceTools id={s.id} slug={s.slug} name={s.name} publicVisible={s.active && !s.pending_review} /></PageHead>
      <ServiceForm id={s.id} categories={cats ?? []} employees={(emps ?? []).map((e) => ({ id: e.id, name: e.full_name }))}
        initial={{
          name: s.name, category_id: s.category_id, short_description: s.short_description, description: s.description,
          price: Number(s.price), price_from: s.price_from, duration_minutes: s.duration_minutes,
          buffer_before_minutes: s.buffer_before_minutes, buffer_after_minutes: s.buffer_after_minutes,
          commission_pct: s.commission_pct == null ? null : Number(s.commission_pct), requires_consultation: s.requires_consultation,
          featured: s.featured, active: s.active, pending_review: s.pending_review, image_url: s.image_url,
          variants: [...s.service_variants].sort((a: any, b: any) => a.display_order - b.display_order).map((v: any) => ({ id: v.id, name: v.name, price: Number(v.price), duration_minutes: v.duration_minutes, active: v.active })),
          addons: s.service_addons.map((a: any) => ({ id: a.id, name: a.name, price: Number(a.price), duration_minutes: a.duration_minutes, active: a.active })),
          employee_ids: (links ?? []).map((l) => l.employee_id),
        }} />
    </>
  );
}
