"use server";

import { getAvailableSlots } from "@/lib/data/availability";
import { friendlyError } from "@/lib/domain/errors";
import { servicesFromAssignments } from "@/lib/domain/lineplan";
import { queueCalendarSync } from "@/lib/integrations/google-calendar";
import { createAdminClient } from "@/lib/supabase/admin";
import { bookingSchema } from "@/lib/validation/booking";

export type BookingResult =
  | { ok: true; requestNumber: string; appointmentId: string; total: number }
  | { ok: false; error: string; field?: string };

/** Reserva pública. Revalida la disponibilidad en servidor y crea la cita vía RPC transaccional. */
export async function createPublicBooking(raw: unknown): Promise<BookingResult> {
  const parsed = bookingSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0] ?? "") };
  }
  const b = parsed.data;
  if (b.website) return { ok: false, error: "Solicitud no válida" }; // bot

  // 1. El horario debe seguir disponible; el motor decide qué especialista atiende cada servicio.
  const avail = await getAvailableSlots({ date: b.date, employeeId: b.employeeId, items: b.items, parallel: b.parallel });
  if (avail.error && !avail.slots.length) return { ok: false, error: avail.error, field: "start" };
  const slot = avail.slots.find((s) => new Date(s.start).getTime() === new Date(b.start).getTime());
  if (!slot) return { ok: false, error: "Ese horario acaba de ocuparse. Elige otra hora, por favor.", field: "start" };

  // Los servicios se envían en el orden agendado, cada uno con su(s) especialista(s): los que empiezan a la vez llevan
  // «parallel» y las especialistas de un mismo servicio comparten «team» (el precio se reparte entre ellas en la base de datos).
  const services = servicesFromAssignments(slot.assignments, avail.plan, b.items);

  // 2. Crear (si hay un tope de citas simultáneas configurado, la base de datos lo vuelve a comprobar al guardar).
  const db = createAdminClient();
  const { data, error } = await db.rpc("create_booking", {
    p: {
      first_name: b.firstName, last_name: b.lastName, phone: b.phone, email: b.email || null,
      notes: b.notes || null, source: "website", start_time: b.start, promotion_id: b.promotionId ?? null, services,
    },
  });
  if (error) {
    const taken = error.message.includes("slot_taken");
    return {
      ok: false,
      error: taken ? "Ese horario acaba de ocuparse. Elige otra hora, por favor." : friendlyError(error.message, "No pudimos crear tu solicitud. Intenta de nuevo."),
      field: taken ? "start" : undefined,
    };
  }

  // 3. Calendario (después de responder; no bloquea la reserva si falla)
  queueCalendarSync(data.id);

  return { ok: true, requestNumber: data.request_number, appointmentId: data.id, total: Number(data.estimated_total) };
}
