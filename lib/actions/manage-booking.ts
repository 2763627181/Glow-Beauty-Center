"use server";

import { z } from "zod";
import { friendlyError } from "@/lib/domain/errors";
import { queueCalendarSync } from "@/lib/integrations/google-calendar";
import { isValidDRPhone } from "@/lib/phone";
import { tooManyRequests } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export type BookingInfo = {
  id: string; request_number: string; status: string; start_time: string; end_time: string; first_name: string;
  total: number; lines: { name: string; price: number; quantity: number }[]; cancellable: boolean; cancel_hours: number;
};
export type LookupResult = { ok: true; booking: BookingInfo } | { ok: false; error: string };

const schema = z.object({
  number: z.string().trim().regex(/^[A-Za-z0-9-]{4,24}$/, "Escribe el número de solicitud (ej. SOL-1A2B3C4D)"),
  phone: z.string().refine(isValidDRPhone, "Escribe el WhatsApp con el que reservaste"),
});

/** La clienta consulta su cita con número de solicitud + teléfono. */
export async function lookupBooking(raw: { number: string; phone: string }): Promise<LookupResult> {
  const p = schema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (await tooManyRequests("lookup")) return { ok: false, error: "Demasiados intentos. Espera un minuto e inténtalo de nuevo." };
  const { data, error } = await createAdminClient().rpc("lookup_booking_public", { p_request: p.data.number, p_phone: p.data.phone });
  if (error) return { ok: false, error: friendlyError(error.message, "No pudimos consultar tu cita. Inténtalo de nuevo.") };
  return { ok: true, booking: data as BookingInfo };
}

/** La clienta cancela su cita (solo si faltan más horas que el límite configurado). */
export async function cancelMyBooking(raw: { number: string; phone: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = schema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (await tooManyRequests("cancel", 5)) return { ok: false, error: "Demasiados intentos. Espera un minuto e inténtalo de nuevo." };
  const db = createAdminClient();
  const { data, error } = await db.rpc("cancel_booking_public", { p_request: p.data.number, p_phone: p.data.phone });
  if (error) return { ok: false, error: friendlyError(error.message, "No pudimos cancelar tu cita. Escríbenos por WhatsApp.") };
  queueCalendarSync(data.id);
  return { ok: true };
}
