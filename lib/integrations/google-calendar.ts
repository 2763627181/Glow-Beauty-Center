import "server-only";
import { after } from "next/server";
import { buildCalendarEvent, type ApptForEvent } from "@/lib/domain/calendarEvent";
import { createAdminClient } from "@/lib/supabase/admin";

const configured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_CALENDAR_ID);

const TIMEOUT = 10_000;
// Direcciones de Google. Se pueden sustituir (GOOGLE_API_BASE / GOOGLE_OAUTH_URL) solo para probar con un servidor simulado.
const API_BASE = process.env.GOOGLE_API_BASE ?? "https://www.googleapis.com";
const OAUTH_URL = process.env.GOOGLE_OAUTH_URL ?? "https://oauth2.googleapis.com/token";

/** Credenciales solo en servidor: intercambia el refresh token por un access token. */
async function accessToken() {
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!, grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`Google OAuth ${res.status}`);
  return (await res.json()).access_token as string;
}

const eventsUrl = () => `${API_BASE}/calendar/v3/calendars/${encodeURIComponent(process.env.GOOGLE_CALENDAR_ID!)}/events`;

/** Crea o actualiza el evento de una cita. Idempotente por google_calendar_event_id. */
export async function syncAppointmentToCalendar(appointmentId: string) {
  if (!configured()) return { skipped: true as const };
  const db = createAdminClient();
  const { data } = await db
    .from("appointments")
    .select("*, clients(first_name,last_name,phone), employees(full_name), appointment_services(name,start_time,end_time,position,team_id,employees(full_name))")
    .eq("id", appointmentId).single();
  if (!data) return { skipped: true as const };
  const a = data as typeof data & ApptForEvent;
  const cancelled = a.status === "cancelado";
  if (cancelled && !a.google_calendar_event_id) return { skipped: true as const }; // nunca estuvo en el calendario: no hay nada que cancelar

  const event = buildCalendarEvent(a);
  try {
    const token = await accessToken();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const call = (url: string, method: string, body: unknown) => fetch(url, { method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });

    let res: Response;
    if (a.google_calendar_event_id) {
      res = await call(`${eventsUrl()}/${a.google_calendar_event_id}`, "PATCH", cancelled ? { ...event, status: "cancelled" } : event);
      // Si alguien borró el evento a mano en Google, se vuelve a crear (a menos que la cita esté cancelada)
      if (res.status === 404 || res.status === 410) {
        if (cancelled) return { ok: true as const };
        res = await call(eventsUrl(), "POST", event);
      }
    } else {
      res = await call(eventsUrl(), "POST", event);
    }
    if (!res.ok) throw new Error(`Google Calendar ${res.status}`);
    const ev = await res.json();
    if (ev.id && ev.id !== a.google_calendar_event_id) await db.from("appointments").update({ google_calendar_event_id: ev.id }).eq("id", a.id);
    await db.from("calendar_integrations").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("provider", "google");
    return { ok: true as const };
  } catch (e) {
    await db.from("calendar_integrations").update({ last_error: String(e) }).eq("provider", "google");
    return { ok: false as const, error: String(e) };
  }
}

/** Quita el evento de Google Calendar (cuando se elimina una cita). Un evento que ya no existe no es un error. */
export async function deleteCalendarEvent(eventId: string) {
  if (!configured()) return { skipped: true as const };
  try {
    const token = await accessToken();
    const res = await fetch(`${eventsUrl()}/${eventId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Google Calendar ${res.status}`);
    return { ok: true as const };
  } catch (e) {
    await createAdminClient().from("calendar_integrations").update({ last_error: String(e) }).eq("provider", "google");
    return { ok: false as const, error: String(e) };
  }
}

/**
 * Sincroniza DESPUÉS de responder al usuario (Next `after`): en Vercel una promesa suelta se pierde cuando la función
 * termina, y un fallo del calendario nunca debe estorbar a la recepcionista ni a la clienta.
 */
export function queueCalendarSync(appointmentId?: string | null) {
  if (!appointmentId || !configured()) return;
  after(async () => { await syncAppointmentToCalendar(appointmentId).catch(() => {}); });
}

export function queueCalendarDelete(eventId?: string | null) {
  if (!eventId || !configured()) return;
  after(async () => { await deleteCalendarEvent(eventId).catch(() => {}); });
}
