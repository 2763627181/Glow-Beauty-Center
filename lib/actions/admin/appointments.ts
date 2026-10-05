"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccess, requireAction } from "@/lib/auth";
import { friendlyError } from "@/lib/domain/errors";
import { queueCalendarDelete, queueCalendarSync, syncAppointmentToCalendar } from "@/lib/integrations/google-calendar";
import { isValidDRPhone, normalizePhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { selectionSchema } from "@/lib/validation/booking";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const STATUSES = ["solicitud", "contactando", "contactado", "confirmado", "en_espera", "en_servicio", "completado", "cancelado", "no_asistio"] as const;
const refresh = () => revalidatePath("/admin", "layout");
const touch = (id?: string) => { refresh(); queueCalendarSync(id); };
const fail = (m?: string | null): { ok: false; error: string } => ({ ok: false, error: friendlyError(m) });

/** Cambia el estado. "completado" genera la venta con complete_appointment (idempotente). */
export async function setAppointmentStatus(id: string, status: (typeof STATUSES)[number]): Promise<ActionResult<{ saleNumber?: string }>> {
  const s = await requireAction("advanceOwn");
  if (!STATUSES.includes(status)) return { ok: false, error: "Estado no válido." };
  if (s.role === "specialist" && !["en_servicio", "completado"].includes(status)) return { ok: false, error: "Solo puedes iniciar o completar tus servicios." };
  const sb = await createClient();
  if (status === "completado") {
    const { data, error } = await sb.rpc("complete_appointment", { p_appointment: id });
    if (error) return fail(error.message);
    touch(id);
    return { ok: true, saleNumber: data.sale_number };
  }
  const { data, error } = await sb.from("appointments").update({ status }).eq("id", id).select("id").maybeSingle();
  if (error) return fail(error.message);
  if (!data) return { ok: false, error: "No tienes permiso sobre esta cita." };
  touch(id);
  return { ok: true };
}

export async function rescheduleAppointment(id: string, startISO: string, employeeId: string | null): Promise<ActionResult> {
  await requireAction("manageAppointments");
  if (Number.isNaN(new Date(startISO).getTime())) return { ok: false, error: "Fecha no válida." };
  const sb = await createClient();
  const { error } = await sb.rpc("reschedule_appointment", { p_appointment: id, p_start: new Date(startISO).toISOString(), p_employee: employeeId });
  if (error) return fail(error.message);
  touch(id);
  return { ok: true };
}

/* ───────── Editar cita (servicios, especialistas, precios, horario, notas, descuento y propina) ───────── */
const lineSchema = z.object({
  id: z.uuid().optional(),
  service_id: z.uuid().optional(), variant_id: z.uuid().nullish(), addon_ids: z.array(z.uuid()).max(10).optional(),
  employee_id: z.uuid().nullish(),
  name: z.string().trim().max(120).optional(),
  final_price: z.number().min(0, "El precio no puede ser negativo").optional(),
  quantity: z.number().int().min(1).max(50).optional(),
});
const updateSchema = z.object({
  start_time: z.iso.datetime().optional(), notes: z.string().max(500).nullish(), source: z.enum(["website", "admin", "whatsapp", "phone", "walk_in", "instagram"]).optional(),
  discount: z.number().min(0).optional(), tip: z.number().min(0).optional(),
  lines: z.array(lineSchema).min(1, "La cita debe tener al menos un servicio"),
});
export type UpdateAppointmentInput = z.input<typeof updateSchema>;

export async function updateAppointment(id: string, input: UpdateAppointmentInput): Promise<ActionResult<{ total: number }>> {
  await requireAction("manageAppointments");
  const p = updateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  // Se omiten las claves undefined: en SQL, "clave ausente" = conservar y "null" = quitar.
  const payload = JSON.parse(JSON.stringify(p.data));
  const sb = await createClient();
  const { data, error } = await sb.rpc("update_appointment", { p_appointment: id, p: payload });
  if (error) return fail(error.message);
  touch(id);
  return { ok: true, total: Number(data.total) };
}

export async function deleteAppointment(id: string): Promise<ActionResult> {
  await requireAction("deleteRecords");
  const sb = await createClient();
  const { data: sale } = await sb.from("sales").select("id").eq("appointment_id", id).maybeSingle();
  if (sale) return { ok: false, error: "Esta cita ya generó una venta. Anula la venta en lugar de eliminar la cita." };
  const { data: before } = await sb.from("appointments").select("google_calendar_event_id").eq("id", id).maybeSingle();
  const { data, error } = await sb.from("appointments").delete().eq("id", id).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return { ok: false, error: "No se pudo eliminar (¿ya no existe o no tienes permiso?)." };
  refresh();
  queueCalendarDelete(before?.google_calendar_event_id); // el evento también sale de Google Calendar
  return { ok: true };
}

/* ───────── Pagos ───────── */
const paySchema = z.object({
  amount: z.number().positive("Escribe un monto mayor a 0"), method: z.string().regex(/^[a-z0-9_]{2,30}$/, "Método no válido"),
  reference: z.string().max(80).optional(), allowOverpay: z.boolean().optional(),
});
export type PayInput = z.input<typeof paySchema>;

/** Pago ligado a la cita (antes de completarla) o a su venta (después). */
export async function addPayment(appointmentId: string, input: PayInput): Promise<ActionResult<{ pending: number }>> {
  await requireAction("charge");
  const p = paySchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const sb = await createClient();
  const { data, error } = await sb.rpc("record_payment", {
    p_appointment: appointmentId, p_amount: p.data.amount, p_method: p.data.method, p_reference: p.data.reference ?? null, p_allow_overpay: p.data.allowOverpay ?? false,
  });
  if (error) return fail(error.message);
  touch();
  return { ok: true, pending: Number(data.pending) };
}

export async function addSalePayment(saleId: string, input: PayInput): Promise<ActionResult<{ pending: number }>> {
  await requireAction("charge");
  const p = paySchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const sb = await createClient();
  const { data, error } = await sb.rpc("record_sale_payment", {
    p_sale: saleId, p_amount: p.data.amount, p_method: p.data.method, p_reference: p.data.reference ?? null, p_allow_overpay: p.data.allowOverpay ?? false,
  });
  if (error) return fail(error.message);
  refresh();
  return { ok: true, pending: Number(data.pending) };
}

export async function refundPayment(paymentId: string): Promise<ActionResult> {
  await requireAction("voidOrRefund");
  const sb = await createClient();
  const { error } = await sb.rpc("refund_payment", { p_payment: paymentId });
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

export async function voidSale(saleId: string, reason: string): Promise<ActionResult> {
  await requireAction("voidOrRefund");
  if (!reason.trim()) return { ok: false, error: "Escribe el motivo de la anulación." };
  const sb = await createClient();
  const { error } = await sb.rpc("void_sale", { p_sale: saleId, p_reason: reason });
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

export async function updateSaleNotes(saleId: string, notes: string): Promise<ActionResult> {
  await requireAction("voidOrRefund");
  const sb = await createClient();
  const { error } = await sb.rpc("update_sale_notes", { p_sale: saleId, p_notes: notes });
  if (error) return fail(error.message);
  revalidatePath(`/admin/sales/${saleId}`);
  return { ok: true };
}

const quickSchema = z.object({
  client_id: z.uuid().nullish(), employee_id: z.uuid().nullish(), discount: z.number().min(0).optional(), tip: z.number().min(0).optional(),
  notes: z.string().max(500).optional(), allow_overpay: z.boolean().optional(),
  items: z.array(z.object({ description: z.string().trim().min(1, "Cada artículo necesita un nombre"), quantity: z.number().int().min(1), unit_price: z.number().min(0, "El precio no puede ser negativo"), service_id: z.uuid().nullish() })).min(1, "Agrega al menos un artículo"),
  payments: z.array(paySchema.pick({ amount: true, method: true, reference: true })).optional(),
});
export type QuickSaleInput = z.input<typeof quickSchema>;

export async function createQuickSale(input: QuickSaleInput): Promise<ActionResult<{ saleId: string; saleNumber: string }>> {
  await requireAction("charge");
  const p = quickSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const sb = await createClient();
  const { data, error } = await sb.rpc("create_quick_sale", { p: JSON.parse(JSON.stringify(p.data)) });
  if (error) return fail(error.message);
  refresh();
  return { ok: true, saleId: data.sale_id, saleNumber: data.sale_number };
}

export async function addAppointmentNote(id: string, note: string): Promise<ActionResult> {
  await requireAccess("appointments");
  if (!note.trim()) return { ok: false, error: "Escribe una nota." };
  const sb = await createClient();
  const { error } = await sb.from("appointment_notes").insert({ appointment_id: id, note: note.trim().slice(0, 1000), created_by: (await sb.auth.getUser()).data.user!.id });
  if (error) return { ok: false, error: "No se pudo guardar la nota." };
  revalidatePath(`/admin/appointments/${id}`);
  return { ok: true };
}

/* ───────── Cita manual / sin cita ───────── */
const manualSchema = z.object({
  firstName: z.string().trim().min(2, "Nombre requerido"), lastName: z.string().trim().default(""),
  phone: z.string().refine(isValidDRPhone, "Teléfono no válido (809/829/849)"),
  email: z.union([z.literal(""), z.email("Correo no válido")]).optional(),
  source: z.enum(["admin", "whatsapp", "phone", "walk_in", "instagram"]),
  start: z.iso.datetime(),
  status: z.enum(["solicitud", "confirmado", "en_espera", "en_servicio"]),
  items: z.array(selectionSchema.extend({ employeeId: z.uuid().nullish() })).min(1, "Selecciona al menos un servicio"),
  notes: z.string().max(500).optional(),
});
export type ManualAppointmentInput = z.input<typeof manualSchema>;

export async function createManualAppointment(input: ManualAppointmentInput): Promise<ActionResult<{ id: string }>> {
  const s = await requireAction("manageAppointments");
  const p = manualSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  const { data, error } = await createAdminClient().rpc("create_booking", {
    p: {
      first_name: d.firstName, last_name: d.lastName, phone: d.phone, email: d.email || null, notes: d.notes ?? null,
      source: d.source, start_time: d.start, status: d.status, created_by: s.userId,
      services: d.items.map((i) => ({ service_id: i.serviceId, variant_id: i.variantId ?? null, addon_ids: i.addonIds, employee_id: i.employeeId ?? null })),
    },
  });
  if (error) return fail(error.message);
  touch(data.id);
  return { ok: true, id: data.id };
}

/** Buscar cliente por teléfono (normalizado) para reutilizar el perfil. */
export async function findClientByPhone(phone: string) {
  await requireAction("manageAppointments");
  const digits = normalizePhone(phone);
  if (digits.length < 7) return null;
  const sb = await createClient();
  const { data } = await sb.from("clients").select("id,first_name,last_name,email,phone").like("phone_normalized", `%${digits}`).limit(1).maybeSingle();
  return data;
}

/** Sincroniza manualmente una cita con Google Calendar. */
export async function syncCalendarNow(id: string): Promise<ActionResult> {
  await requireAction("manageAppointments");
  const r = await syncAppointmentToCalendar(id);
  if ("skipped" in r) return { ok: false, error: "Google Calendar no está configurado en el servidor." };
  if (!r.ok) return { ok: false, error: "Google Calendar rechazó la sincronización. Revisa las credenciales en Configuración." };
  revalidatePath(`/admin/appointments/${id}`);
  return { ok: true };
}
