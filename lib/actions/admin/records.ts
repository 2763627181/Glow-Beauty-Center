"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/auth";
import { auditDeletion, clearNotificationsViaApi, deleteAppointmentsViaApi, deleteClientsViaApi, deleteSalesViaApi, describeViaApi } from "@/lib/data/deletion";
import type { DeletionInfo, DeletionResult } from "@/lib/domain/deletion";
import { friendlyError } from "@/lib/domain/errors";
import { queueCalendarDelete } from "@/lib/integrations/google-calendar";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./appointments";

/**
 * Eliminar registros desde el panel (citas y solicitudes, ventas, clientes) y limpiar notificaciones.
 * El permiso se comprueba aquí (gerencia y super administrador) y, cuando están instaladas las funciones `delete_*` de la base de
 * datos (migración 15), otra vez dentro de ellas: esa ruta es atómica y deja cada fila borrada en Auditoría con quien la borró.
 * Si esas funciones aún no están instaladas, el borrado se hace por la API (`lib/data/deletion.ts`) con el mismo resultado y se
 * anota en Auditoría un resumen con el usuario.
 */
export type DeleteKind = "appointments" | "clients" | "sales";
const ids = z.array(z.uuid()).min(1, "Selecciona al menos un registro.").max(300, "Selecciona 300 o menos a la vez.");
const fail = (m?: string | null): { ok: false; error: string } => ({ ok: false, error: friendlyError(m) });
const refresh = () => revalidatePath("/admin", "layout");
const GENERIC = "No se pudo eliminar. Intenta de nuevo.";

/** La función de la base de datos todavía no existe (migración 15 sin aplicar). */
const missing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|schema cache/i.test(e.message ?? "");

type Raw = DeletionResult & { calendar_events?: string[] };
function finish(raw: Raw): ActionResult<{ result: DeletionResult }> {
  const { calendar_events, ...result } = raw;
  for (const ev of calendar_events ?? []) queueCalendarDelete(ev); // los eventos también salen de Google Calendar
  refresh();
  return { ok: true, result };
}

/** Cuenta lo que se borraría (citas, ventas, pagos y dinero) para mostrarlo antes de confirmar. No modifica nada. */
export async function describeDeletion(kind: DeleteKind, input: string[]): Promise<ActionResult<{ info: DeletionInfo }>> {
  await requireAction("deleteRecords");
  const p = ids.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { data, error } = await (await createClient()).rpc("describe_deletion", { p_kind: kind, p_ids: p.data });
  if (!error) return { ok: true, info: { ...data, sales_total: Number(data.sales_total), paid_total: Number(data.paid_total) } as DeletionInfo };
  if (!missing(error)) return fail(error.message);
  try { return { ok: true, info: await describeViaApi(kind, p.data) }; } catch { return { ok: false, error: GENERIC }; }
}

/** Citas y solicitudes (aunque ya estén completadas): se llevan su venta y sus pagos. */
export async function deleteAppointments(input: string[]): Promise<ActionResult<{ result: DeletionResult }>> {
  const s = await requireAction("deleteRecords");
  const p = ids.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { data, error } = await (await createClient()).rpc("delete_appointments", { p_ids: p.data });
  if (!error) return finish(data);
  if (!missing(error)) return fail(error.message);
  try { const raw = await deleteAppointmentsViaApi(p.data); await auditDeletion(s.userId, "appointments", raw); return finish(raw); } catch { return { ok: false, error: GENERIC }; }
}

/** Ventas con sus artículos y pagos. La cita de la venta se elimina también o vuelve a «confirmada». */
export async function deleteSales(input: string[], withAppointment: boolean): Promise<ActionResult<{ result: DeletionResult }>> {
  const s = await requireAction("deleteRecords");
  const p = ids.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { data, error } = await (await createClient()).rpc("delete_sales", { p_ids: p.data, p_with_appointment: withAppointment });
  if (!error) return finish(data);
  if (!missing(error)) return fail(error.message);
  try { const raw = await deleteSalesViaApi(p.data, withAppointment); await auditDeletion(s.userId, "sales", raw); return finish(raw); } catch { return { ok: false, error: GENERIC }; }
}

/** Clientes. Con citas o ventas solo se borran si `withHistory` es verdadero (se llevan su historial). */
export async function deleteClients(input: string[], withHistory: boolean): Promise<ActionResult<{ result: DeletionResult }>> {
  const s = await requireAction("deleteRecords");
  const p = ids.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { data, error } = await (await createClient()).rpc("delete_clients", { p_ids: p.data, p_with_history: withHistory });
  if (!error) return finish(data);
  if (!missing(error)) return fail(error.message);
  try { const raw = await deleteClientsViaApi(p.data, withHistory); await auditDeletion(s.userId, "clients", raw); return finish(raw); } catch { return { ok: false, error: GENERIC }; }
}

/** Borra avisos de la campana: solo los leídos o todos. */
export async function clearNotifications(onlyRead: boolean): Promise<ActionResult<{ deleted: number }>> {
  await requireAction("clearNotifications");
  const { data, error } = await (await createClient()).rpc("clear_notifications", { p_only_read: onlyRead });
  if (!error) { refresh(); return { ok: true, deleted: Number(data) }; }
  if (!missing(error)) return fail(error.message);
  try { const n = await clearNotificationsViaApi(onlyRead); refresh(); return { ok: true, deleted: n }; } catch { return { ok: false, error: GENERIC }; }
}
