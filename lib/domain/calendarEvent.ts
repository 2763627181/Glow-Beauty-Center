import { groupLines } from "./serviceLines.ts";
import { fmtTime, money } from "../format.ts";

/** Datos de una cita tal como los lee la sincronización con Google Calendar. */
export type ApptForEvent = {
  status: string;
  start_time: string;
  end_time: string;
  estimated_total: number | string;
  notes: string | null;
  clients: { first_name: string; last_name: string; phone: string };
  employees: { full_name: string } | null;
  appointment_services: { name: string; start_time: string | null; end_time: string | null; position?: number | null; team_id?: string | null; employees?: { full_name: string } | null }[];
};

export const STATUS_PREFIX: Record<string, string> = {
  solicitud: "Solicitud", contactando: "Solicitud", contactado: "Solicitud", confirmado: "CONFIRMADA",
  en_espera: "CONFIRMADA", en_servicio: "EN SERVICIO", completado: "COMPLETADA",
  cancelado: "CANCELADA", no_asistio: "NO ASISTIÓ",
};

/** Colores de Google Calendar: gris = cancelada, verde = confirmada, amarillo = pendiente. */
const colorOf = (status: string) => (status === "cancelado" || status === "no_asistio" ? "8" : ["confirmado", "en_espera", "en_servicio", "completado"].includes(status) ? "10" : "5");

/** Arma el evento de Google Calendar de una cita (puro: sin red ni base de datos). */
export function buildCalendarEvent(a: ApptForEvent) {
  const client = `${a.clients.first_name} ${a.clients.last_name}`.trim();
  const lines = [...a.appointment_services].sort((x, y) => (x.position ?? 0) - (y.position ?? 0));
  // Un servicio atendido por un equipo cuenta como un solo servicio (con todas sus especialistas)
  const groups = groupLines(lines.map((s) => ({ ...s, employee_name: s.employees?.full_name ?? null })));
  const services = groups.map((g) => g.name);
  const staff = [...new Set(lines.map((s) => s.employees?.full_name).filter((n): n is string => !!n))];
  if (!staff.length && a.employees?.full_name) staff.push(a.employees.full_name);
  const prefix = STATUS_PREFIX[a.status] ?? a.status;
  // Con varios servicios y especialistas se detalla quién hace qué y a qué hora
  const detail = groups.length > 1 || groups.some((g) => g.employees.length > 1)
    ? ["", "Detalle:", ...groups.map((g) => { const s = g.lines[0]; return `• ${g.name}${g.employees.length ? ` — ${g.employees.join(" + ")}` : ""}${s.start_time && s.end_time ? ` (${fmtTime(s.start_time)} – ${fmtTime(s.end_time)})` : ""}`; })]
    : [];
  return {
    summary: `${prefix} - ${client} - ${services.join(", ")}`,
    description: [
      ...[
        `Cliente: ${client}`, `Teléfono: ${a.clients.phone}`, `Servicios: ${services.join(", ")}`,
        `Especialista: ${staff.length ? staff.join(" + ") : "Sin asignar"}`, `Hora: ${fmtTime(a.start_time)} – ${fmtTime(a.end_time)}`,
        `Precio estimado: ${money(a.estimated_total)}`, `Estado: ${a.status}`, a.notes ? `Notas: ${a.notes}` : "",
      ].filter(Boolean),
      ...detail,
    ].join("\n"),
    start: { dateTime: a.start_time, timeZone: "America/Santo_Domingo" },
    end: { dateTime: a.end_time, timeZone: "America/Santo_Domingo" },
    colorId: colorOf(a.status),
  };
}
