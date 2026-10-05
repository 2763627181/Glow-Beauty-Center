"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession, requireAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./appointments";

const ROLES = ["super_admin", "manager", "receptionist", "specialist"] as const;
const password = z.string().min(10, "La contraseña debe tener al menos 10 caracteres").regex(/[A-Za-z]/, "Incluye al menos una letra").regex(/\d/, "Incluye al menos un número");

async function requireSuperAdmin() {
  const s = await requireAccess("users");
  if (s.role !== "super_admin") throw new Error("forbidden");
  return s;
}
const done = () => { revalidatePath("/admin/users"); revalidatePath("/admin/staff", "layout"); };

async function activeSuperAdmins(excludeId?: string) {
  const { count } = await createAdminClient().from("profiles").select("id", { count: "exact", head: true }).eq("role", "super_admin").eq("active", true).neq("id", excludeId ?? "00000000-0000-0000-0000-000000000000");
  return count ?? 0;
}

const createSchema = z.object({
  email: z.email("Correo no válido"), password, fullName: z.string().trim().min(2, "Escribe el nombre"),
  role: z.enum(ROLES), employeeId: z.uuid().nullish(),
});
export async function createUser(input: z.input<typeof createSchema>): Promise<ActionResult> {
  await requireSuperAdmin();
  const p = createSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (p.data.role === "specialist" && !p.data.employeeId) return { ok: false, error: "Un especialista debe vincularse a su ficha de especialista." };
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email: p.data.email, password: p.data.password, email_confirm: true, user_metadata: { full_name: p.data.fullName } });
  if (error || !data.user) return { ok: false, error: error?.message.toLowerCase().includes("already") ? "Ese correo ya tiene cuenta." : "No se pudo crear la cuenta." };
  const { error: e2 } = await admin.from("profiles").upsert({ id: data.user.id, full_name: p.data.fullName, role: p.data.role, employee_id: p.data.role === "specialist" ? p.data.employeeId : (p.data.employeeId ?? null), active: true });
  if (e2) { await admin.auth.admin.deleteUser(data.user.id); return { ok: false, error: "No se pudo asignar el rol." }; }
  done();
  return { ok: true };
}

const updateSchema = z.object({ fullName: z.string().trim().min(2, "Escribe el nombre"), role: z.enum(ROLES), employeeId: z.uuid().nullish(), active: z.boolean() });
export async function updateUser(id: string, input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const me = await requireSuperAdmin();
  const p = updateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (p.data.role === "specialist" && !p.data.employeeId) return { ok: false, error: "Un especialista debe vincularse a su ficha de especialista." };
  if (id === me.userId && (p.data.role !== "super_admin" || !p.data.active)) return { ok: false, error: "No puedes quitarte tu propio rol de super administrador ni desactivarte." };
  const admin = createAdminClient();
  if ((p.data.role !== "super_admin" || !p.data.active) && (await activeSuperAdmins(id)) === 0) return { ok: false, error: "Debe quedar al menos un super administrador activo." };
  const { error } = await admin.from("profiles").update({ full_name: p.data.fullName, role: p.data.role, employee_id: p.data.employeeId ?? null, active: p.data.active }).eq("id", id);
  if (error) return { ok: false, error: "No se pudo guardar." };
  done();
  return { ok: true };
}

export async function resetUserPassword(id: string, newPassword: string): Promise<ActionResult> {
  await requireSuperAdmin();
  const p = password.safeParse(newPassword);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { error } = await createAdminClient().auth.admin.updateUserById(id, { password: p.data });
  if (error) return { ok: false, error: "No se pudo cambiar la contraseña." };
  return { ok: true };
}

export async function deleteUser(id: string): Promise<ActionResult> {
  const me = await requireSuperAdmin();
  if (id === me.userId) return { ok: false, error: "No puedes eliminar tu propia cuenta." };
  if ((await activeSuperAdmins(id)) === 0) return { ok: false, error: "Debe quedar al menos un super administrador activo." };
  const admin = createAdminClient();
  await admin.from("profiles").delete().eq("id", id);
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return { ok: false, error: "No se pudo eliminar la cuenta." };
  done();
  return { ok: true };
}

/* ───────── Mi cuenta ───────── */
export async function updateMyName(fullName: string): Promise<ActionResult> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Sesión expirada." };
  const n = fullName.trim();
  if (n.length < 2) return { ok: false, error: "Escribe tu nombre." };
  const { error } = await createAdminClient().from("profiles").update({ full_name: n }).eq("id", s.userId);
  if (error) return { ok: false, error: "No se pudo guardar." };
  revalidatePath("/admin", "layout");
  return { ok: true };
}

export async function changeMyPassword(newPassword: string): Promise<ActionResult> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Sesión expirada." };
  const p = password.safeParse(newPassword);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const sb = await createClient();
  const { error } = await sb.auth.updateUser({ password: p.data });
  if (error) return { ok: false, error: error.message.toLowerCase().includes("same") ? "La nueva contraseña debe ser distinta a la actual." : "No se pudo cambiar la contraseña. Cierra sesión, vuelve a entrar e inténtalo de nuevo." };
  return { ok: true };
}
