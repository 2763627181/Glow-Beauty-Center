import { PageHead } from "@/components/admin/primitives";
import { UsersManager, type UserRow } from "@/components/admin/users/UsersManager";
import { requireAccess } from "@/lib/auth";
import type { Role } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Usuarios y permisos" };

export default async function UsersPage() {
  const me = await requireAccess("users");
  const admin = createAdminClient();
  const sb = await createClient();
  const [{ data: profiles }, { data: auth }, { data: emps }] = await Promise.all([
    admin.from("profiles").select("id,full_name,role,employee_id,active").order("created_at"),
    admin.auth.admin.listUsers({ perPage: 200 }),
    sb.from("employees").select("id,full_name").order("display_order"),
  ]);
  const byId = new Map((auth?.users ?? []).map((x) => [x.id, x]));
  const users: UserRow[] = (profiles ?? []).map((p) => ({
    id: p.id, full_name: p.full_name ?? "", role: p.role as Role, employee_id: p.employee_id, active: p.active,
    email: byId.get(p.id)?.email ?? "—", last_sign_in: byId.get(p.id)?.last_sign_in_at ?? null,
  }));
  return (
    <>
      <PageHead title="Usuarios y permisos" sub="Quién puede entrar al panel y qué puede hacer. El registro público está desactivado: las cuentas se crean aquí." />
      <UsersManager users={users} employees={emps ?? []} me={me.userId} />
    </>
  );
}
