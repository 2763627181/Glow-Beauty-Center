"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { refreshPublicSite } from "../refresh";
import type { ActionResult } from "./appointments";

const employeeSchema = z.object({
  full_name: z.string().trim().min(2, "Nombre requerido").max(80),
  avatar_url: z.string().url().nullish(), phone: z.string().max(30).nullish(), email: z.union([z.literal(""), z.email("Correo no válido")]).nullish(),
  specialty: z.string().max(80).nullish(), bio: z.string().max(600).nullish(),
  commission_pct: z.number().min(0).max(100).nullish(), active: z.boolean(), accepts_online_booking: z.boolean(),
  service_ids: z.array(z.uuid()),
});
export type EmployeeInput = z.input<typeof employeeSchema>;

export async function saveEmployee(id: string | null, input: EmployeeInput): Promise<ActionResult<{ id: string }>> {
  await requireAccess("staff");
  const p = employeeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { service_ids, ...row } = p.data;
  const sb = await createClient();
  const payload = { ...row, email: row.email || null };
  const { data, error } = id
    ? await sb.from("employees").update(payload).eq("id", id).select("id").single()
    : await sb.from("employees").insert(payload).select("id").single();
  if (error) return { ok: false, error: "No se pudo guardar." };
  // Diferencias en vez de borrar todo y reinsertar: si algo falla a medias, la especialista no pierde sus servicios.
  const { data: current } = await sb.from("employee_services").select("service_id").eq("employee_id", data.id);
  const have = new Set((current ?? []).map((r) => r.service_id));
  const want = new Set(service_ids);
  const toAdd = [...want].filter((s) => !have.has(s));
  const toRemove = [...have].filter((s) => !want.has(s));
  if (toAdd.length) {
    const { error: addErr } = await sb.from("employee_services").insert(toAdd.map((s) => ({ employee_id: data.id, service_id: s })));
    if (addErr) return { ok: false, error: "Se guardaron los datos, pero no los servicios. Inténtalo de nuevo." };
  }
  if (toRemove.length) {
    const { error: delErr } = await sb.from("employee_services").delete().eq("employee_id", data.id).in("service_id", toRemove);
    if (delErr) return { ok: false, error: "Se guardaron los datos, pero no se pudieron quitar algunos servicios. Inténtalo de nuevo." };
  }
  refreshPublicSite();
  revalidatePath("/admin/staff");
  return { ok: true, id: data.id };
}

/** Elimina un especialista sin historial; si ya atendió citas o ventas lo desactiva para conservar los reportes. */
export async function deleteEmployee(id: string): Promise<ActionResult<{ archived: boolean }>> {
  await requireAccess("staff");
  const sb = await createClient();
  const [{ count: a }, { count: b }, { count: c }, { count: d }] = await Promise.all([
    sb.from("appointments").select("id", { count: "exact", head: true }).eq("employee_id", id),
    sb.from("appointment_services").select("id", { count: "exact", head: true }).eq("employee_id", id),
    sb.from("sale_items").select("id", { count: "exact", head: true }).eq("employee_id", id),
    sb.from("sales").select("id", { count: "exact", head: true }).eq("employee_id", id),
  ]);
  if ((a ?? 0) + (b ?? 0) + (c ?? 0) + (d ?? 0) > 0) {
    const { error } = await sb.from("employees").update({ active: false, accepts_online_booking: false }).eq("id", id);
    if (error) return { ok: false, error: "No se pudo archivar." };
    refreshPublicSite(); revalidatePath("/admin/staff");
    return { ok: true, archived: true };
  }
  const { error } = await sb.from("employees").delete().eq("id", id);
  if (error) return { ok: false, error: "No se pudo eliminar." };
  refreshPublicSite(); revalidatePath("/admin/staff");
  return { ok: true, archived: false };
}

export async function moveEmployee(id: string, dir: -1 | 1): Promise<ActionResult> {
  await requireAccess("staff");
  const sb = await createClient();
  const { data } = await sb.from("employees").select("id").order("display_order").order("full_name");
  const arr = data ?? [];
  const i = arr.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return { ok: true };
  [arr[i], arr[j]] = [arr[j], arr[i]];
  for (const [n, x] of arr.entries()) await sb.from("employees").update({ display_order: n + 1 }).eq("id", x.id);
  refreshPublicSite(); revalidatePath("/admin/staff");
  return { ok: true };
}

const time = z.string().regex(/^\d{2}:\d{2}$/);
const dayRow = z.object({ weekday: z.number().int().min(0).max(6), working: z.boolean(), start: time, end: time, breakStart: time.or(z.literal("")), breakEnd: time.or(z.literal("")) });
export async function saveSchedule(employeeId: string, days: z.input<typeof dayRow>[]): Promise<ActionResult> {
  await requireAccess("staff");
  const p = z.array(dayRow).safeParse(days);
  if (!p.success) return { ok: false, error: "Horario no válido." };
  for (const d of p.data) {
    if (d.working && d.end <= d.start) return { ok: false, error: "La hora de salida debe ser posterior a la de entrada." };
    if (d.working && ((d.breakStart && !d.breakEnd) || (!d.breakStart && d.breakEnd) || (d.breakStart && d.breakEnd <= d.breakStart))) return { ok: false, error: "Revisa el horario de almuerzo." };
  }
  const sb = await createClient();
  await sb.from("employee_schedules").delete().eq("employee_id", employeeId);
  const rows = p.data.filter((d) => d.working).map((d) => ({
    employee_id: employeeId, weekday: d.weekday, start_time: d.start, end_time: d.end, break_start: d.breakStart || null, break_end: d.breakEnd || null,
  }));
  if (rows.length) { const { error } = await sb.from("employee_schedules").insert(rows); if (error) return { ok: false, error: "No se pudo guardar el horario." }; }
  revalidatePath(`/admin/staff/${employeeId}`);
  return { ok: true };
}

export async function addTimeOff(employeeId: string, startsAt: string, endsAt: string, reason: string): Promise<ActionResult> {
  await requireAccess("staff");
  const a = new Date(startsAt), b = new Date(endsAt);
  if (Number.isNaN(+a) || Number.isNaN(+b) || b <= a) return { ok: false, error: "Rango de fechas no válido." };
  const sb = await createClient();
  const { error } = await sb.from("employee_time_off").insert({ employee_id: employeeId, starts_at: a.toISOString(), ends_at: b.toISOString(), reason: reason.slice(0, 120) || null });
  if (error) return { ok: false, error: "No se pudo guardar." };
  revalidatePath(`/admin/staff/${employeeId}`);
  return { ok: true };
}

export async function removeTimeOff(id: string, employeeId: string): Promise<ActionResult> {
  await requireAccess("staff");
  const sb = await createClient();
  const { error } = await sb.from("employee_time_off").delete().eq("id", id);
  if (error) return { ok: false, error: "No se pudo eliminar." };
  revalidatePath(`/admin/staff/${employeeId}`);
  return { ok: true };
}

/** Solo super_admin: crea un usuario de acceso (el registro público está deshabilitado). */
export async function createStaffAccount(input: { employeeId: string | null; email: string; password: string; fullName: string; role: "manager" | "receptionist" | "specialist" }): Promise<ActionResult> {
  const s = await requireAccess("staff");
  if (s.role !== "super_admin") return { ok: false, error: "Solo el super administrador puede crear cuentas." };
  const p = z.object({ email: z.email("Correo no válido"), password: z.string().min(10, "La contraseña debe tener al menos 10 caracteres"), fullName: z.string().min(2), role: z.enum(["manager", "receptionist", "specialist"]), employeeId: z.uuid().nullable() }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (p.data.role === "specialist" && !p.data.employeeId) return { ok: false, error: "Un especialista debe estar vinculado a su ficha." };
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email: p.data.email, password: p.data.password, email_confirm: true, user_metadata: { full_name: p.data.fullName } });
  if (error || !data.user) return { ok: false, error: error?.message.includes("already") ? "Ese correo ya tiene cuenta." : "No se pudo crear la cuenta." };
  const { error: e2 } = await admin.from("profiles").upsert({ id: data.user.id, full_name: p.data.fullName, role: p.data.role, employee_id: p.data.employeeId, active: true });
  if (e2) { await admin.auth.admin.deleteUser(data.user.id); return { ok: false, error: "No se pudo asignar el rol." }; }
  revalidatePath("/admin/staff");
  return { ok: true };
}

export async function setAccountActive(profileId: string, active: boolean): Promise<ActionResult> {
  const s = await requireAccess("staff");
  if (s.role !== "super_admin") return { ok: false, error: "Solo el super administrador puede hacerlo." };
  if (profileId === s.userId) return { ok: false, error: "No puedes desactivar tu propia cuenta." };
  const { error } = await createAdminClient().from("profiles").update({ active }).eq("id", profileId);
  if (error) return { ok: false, error: "No se pudo actualizar." };
  revalidatePath("/admin/staff");
  return { ok: true };
}
