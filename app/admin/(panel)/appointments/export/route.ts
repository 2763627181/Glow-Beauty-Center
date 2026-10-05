import { getSession } from "@/lib/auth";
import { listAppointments } from "@/lib/data/appointments";
import { apptTotal } from "@/lib/data/appointment-math";
import { toCSV } from "@/lib/domain/reports";
import { STATUS_META } from "@/lib/domain/status";
import { drToISO, todayISO } from "@/lib/format";
import { can } from "@/lib/permissions";
import type { AppointmentStatus } from "@/types/domain";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !can(s.role, "reports")) return new Response("Prohibido", { status: 403 });
  const p = new URL(req.url).searchParams;
  const today = drToISO(todayISO(), "00:00");
  const range = p.get("range") ?? "upcoming";
  const st = p.get("status");
  const items = await listAppointments({
    from: range === "upcoming" ? today : undefined, to: range === "past" ? today : undefined,
    status: st && st in STATUS_META ? [st as AppointmentStatus] : undefined, search: p.get("q") ?? "", limit: 2000,
  });
  const fmt = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });
  const rows: (string | number)[][] = [
    ["Solicitud", "Inicio", "Estado", "Cliente", "Teléfono", "Servicios", "Especialistas", "Origen", "Total", "Pagado"],
    ...items.map((a) => [a.request_number, fmt(a.start_time), STATUS_META[a.status].label, `${a.client.first_name} ${a.client.last_name}`.trim(), a.client.phone,
      a.services.map((x) => x.name).join(" + "), a.employees.map((e) => e.name).join(" + "), a.source, a.final_total ?? apptTotal(a), a.paid]),
  ];
  return new Response(toCSV(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="glow-citas-${todayISO()}.csv"` },
  });
}
