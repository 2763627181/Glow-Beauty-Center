import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { allowed, can, PERMISSIONS, type ActionKey, type Area, type Role } from "./permissions";
import { createClient } from "./supabase/server";

export { allowed, can, PERMISSIONS };
export type { Area, Role };

export type Session = {
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  employeeId: string | null;
};

/** Devuelve la sesión de staff o null (sin perfil activo = sin acceso). Una consulta por petición. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: p } = await supabase
    .from("profiles")
    .select("full_name, role, employee_id, active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!p || !p.active) return null;
  return {
    userId: data.user.id,
    email: data.user.email ?? "",
    fullName: p.full_name ?? data.user.email ?? "",
    role: p.role as Role,
    employeeId: p.employee_id,
  };
});

/** Exige sesión y permiso sobre un área; redirige si no. */
export async function requireAccess(area: Area): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/admin/logout");
  if (!can(s.role, area)) redirect("/admin/forbidden");
  return s;
}

/** Exige una acción concreta (para Server Actions). */
export async function requireAction(action: ActionKey): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/admin/logout");
  if (!allowed(s.role, action)) redirect("/admin/forbidden");
  return s;
}
