import { PageHead } from "@/components/admin/primitives";
import { StaffList } from "@/components/admin/staff/StaffTools";
import { ButtonLink } from "@/components/ui/Button";
import { requireAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Especialistas" };

export default async function StaffPage() {
  await requireAccess("staff");
  const sb = await createClient();
  const { data } = await sb.from("employees").select("id,full_name,specialty,avatar_url,active,employee_services(service_id)").order("display_order").order("full_name");
  return (
    <>
      <PageHead title="Especialistas" sub="El orden define cómo aparecen en la web y en la agenda."><ButtonLink size="sm" href="/admin/staff/new">+ Nuevo especialista</ButtonLink></PageHead>
      <StaffList staff={(data ?? []).map((e) => ({ id: e.id, full_name: e.full_name, specialty: e.specialty, avatar_url: e.avatar_url, active: e.active, services: e.employee_services.length }))} />
    </>
  );
}
