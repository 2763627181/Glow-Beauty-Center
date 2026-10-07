import "server-only";
import { computeSlots, weekdayOf, type EmployeeDay, type Interval, type LineReq, type Slot } from "@/lib/domain/availability";
import { normalizeSettings } from "@/lib/domain/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SelectionItem } from "@/types/domain";

export type SlotQuery = { date: string; items: SelectionItem[]; employeeId: string | "any" };
export type SlotResult = { slots: Slot[]; totalMinutes: number; items: SelectionItem[]; error?: string };

const ms = (iso: string) => new Date(iso).getTime();
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : null);

/** Duración de cada línea (con preparación y tiempo posterior) calculada desde la BD; nunca se confía en el cliente. */
async function resolveLines(items: SelectionItem[]): Promise<{ minutes: number; serviceId: string; name: string }[] | null> {
  const db = createAdminClient();
  const ids = [...new Set(items.map((i) => i.serviceId))];
  const [{ data: svcs }, { data: vars }, { data: adds }] = await Promise.all([
    db.from("services").select("id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,active,pending_review").in("id", ids),
    db.from("service_variants").select("id,service_id,duration_minutes,active").in("service_id", ids),
    db.from("service_addons").select("id,service_id,duration_minutes,active").in("service_id", ids),
  ]);
  const out: { minutes: number; serviceId: string; name: string }[] = [];
  for (const it of items) {
    const s = svcs?.find((x) => x.id === it.serviceId);
    if (!s || !s.active || s.pending_review) return null;
    const hasVariants = (vars ?? []).some((x) => x.service_id === s.id && x.active);
    const v = it.variantId ? vars?.find((x) => x.id === it.variantId && x.service_id === s.id && x.active) : null;
    if ((it.variantId && !v) || (hasVariants && !v)) return null;
    let d = v?.duration_minutes ?? s.duration_minutes;
    for (const a of it.addonIds) {
      const ad = adds?.find((x) => x.id === a && x.service_id === s.id && x.active);
      if (!ad) return null;
      d += ad.duration_minutes;
    }
    out.push({ minutes: d + s.buffer_before_minutes + s.buffer_after_minutes, serviceId: s.id, name: s.name });
  }
  return out;
}

export async function getAvailableSlots(q: SlotQuery): Promise<SlotResult> {
  const fail = (error: string): SlotResult => ({ slots: [], totalMinutes: 0, items: q.items, error });
  const db = createAdminClient();
  const resolved = await resolveLines(q.items);
  if (!resolved) return fail("Alguno de los servicios ya no está disponible. Revisa tu selección.");
  const totalMinutes = resolved.reduce((t, l) => t + l.minutes, 0);

  const { data: settingsRows } = await db.from("business_settings").select("key,value").in("key", ["hours", "booking"]);
  const settings = normalizeSettings(Object.fromEntries((settingsRows ?? []).map((r) => [r.key, r.value])));
  const weekday = weekdayOf(q.date);
  const now = Date.now();
  if (ms(`${q.date}T23:59:59-04:00`) < now) return { slots: [], totalMinutes, items: q.items, error: "Esa fecha ya pasó." };
  if (ms(`${q.date}T00:00:00-04:00`) > now + settings.booking.max_advance_days * 86_400_000) {
    return { slots: [], totalMinutes, items: q.items, error: `Solo se puede reservar con hasta ${settings.booking.max_advance_days} días de anticipación.` };
  }

  // Especialistas por línea
  const serviceIds = [...new Set(resolved.map((l) => l.serviceId))];
  const [{ data: emps }, { data: links }] = await Promise.all([
    db.from("employees").select("id").eq("active", true).eq("accepts_online_booking", true),
    db.from("employee_services").select("employee_id,service_id").in("service_id", serviceIds),
  ]);
  const allIds = (emps ?? []).map((e) => e.id as string);
  const lineReqs: LineReq[] = resolved.map((l) => {
    const linked = (links ?? []).filter((x) => x.service_id === l.serviceId).map((x) => x.employee_id as string);
    let eligible = linked.length ? allIds.filter((id) => linked.includes(id)) : allIds;
    if (q.employeeId !== "any") eligible = eligible.filter((id) => id === q.employeeId);
    return { minutes: l.minutes, eligible };
  });
  const nobody = lineReqs.findIndex((l) => l.eligible.length === 0);
  if (nobody >= 0) {
    return {
      slots: [], totalMinutes, items: q.items,
      error: q.employeeId === "any"
        ? `Por ahora no hay una especialista disponible para «${resolved[nobody].name}». Escríbenos por WhatsApp y te ayudamos a agendar.`
        : "Esa especialista no realiza todos los servicios elegidos.",
    };
  }
  const pool = [...new Set(lineReqs.flatMap((l) => l.eligible))];

  const dayStart = `${q.date}T00:00:00-04:00`;
  const dayEnd = `${q.date}T23:59:59-04:00`;
  const [{ data: scheds }, { data: blocks }, { data: off }, { data: busyLines }] = await Promise.all([
    db.from("employee_schedules").select("*").eq("weekday", weekday).in("employee_id", pool),
    db.from("schedule_blocks").select("employee_id,starts_at,ends_at").lt("starts_at", dayEnd).gt("ends_at", dayStart),
    db.from("employee_time_off").select("employee_id,starts_at,ends_at").lt("starts_at", dayEnd).gt("ends_at", dayStart).in("employee_id", pool),
    db.from("appointment_services").select("employee_id,start_time,end_time").eq("active", true).not("start_time", "is", null)
      .lt("start_time", dayEnd).gt("end_time", dayStart).in("employee_id", pool),
  ]);

  const iv = (r: { starts_at?: string; ends_at?: string; start_time?: string; end_time?: string }): Interval => ({
    start: ms((r.starts_at ?? r.start_time)!), end: ms((r.ends_at ?? r.end_time)!),
  });
  const employees: EmployeeDay[] = pool.map((id) => {
    const sc = scheds?.find((x) => x.employee_id === id);
    return {
      employeeId: id,
      work: sc ? { start: hhmm(sc.start_time)!, end: hhmm(sc.end_time)!, breakStart: hhmm(sc.break_start), breakEnd: hhmm(sc.break_end) } : null,
      busy: [
        ...(blocks ?? []).filter((b) => b.employee_id === id).map(iv),
        ...(off ?? []).filter((b) => b.employee_id === id).map(iv),
      ],
      booked: (busyLines ?? []).filter((b) => b.employee_id === id).map(iv),
    };
  });

  const slots = computeSlots({
    date: q.date, businessHours: settings.hours[String(weekday)],
    businessBlocks: (blocks ?? []).filter((b) => b.employee_id == null).map(iv),
    employees, lines: lineReqs, slotMinutes: settings.booking.slot_minutes, now, minNoticeHours: settings.booking.min_notice_hours,
    maxConcurrent: settings.booking.max_simultaneous,
  });
  return { slots, totalMinutes, items: q.items };
}
