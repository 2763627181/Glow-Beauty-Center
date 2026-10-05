"use server";

import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth";
import { syncAppointmentToCalendar } from "@/lib/integrations/google-calendar";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./appointments";

/** Envía a Google Calendar las citas futuras que todavía no tienen evento (por ejemplo, creadas antes de conectar). */
export async function syncUpcomingToCalendar(): Promise<ActionResult<{ synced: number; failed: number }>> {
  await requireAccess("settings");
  const sb = await createClient();
  const { data } = await sb.from("appointments").select("id").is("google_calendar_event_id", null)
    .in("status", ["solicitud", "contactando", "contactado", "confirmado", "en_espera"]).gte("start_time", new Date().toISOString()).limit(100);
  let synced = 0, failed = 0;
  for (const a of data ?? []) {
    const r = await syncAppointmentToCalendar(a.id);
    if ("skipped" in r) return { ok: false, error: "Google Calendar no está configurado en el servidor." };
    if (r.ok) synced++; else failed++;
  }
  revalidatePath("/admin/settings");
  return { ok: true, synced, failed };
}
