import { getSession } from "@/lib/auth";
import { listAppointments } from "@/lib/data/appointments";
import { appointmentsDoc } from "@/lib/export/docs";
import { parseFormat } from "@/lib/export/model";
import { exportContext, exportResponse } from "@/lib/export/server";
import { STATUS_META } from "@/lib/domain/status";
import { drToISO, todayISO } from "@/lib/format";
import { can } from "@/lib/permissions";
import type { AppointmentStatus } from "@/types/domain";

export const maxDuration = 60;
const LIMIT = 3000;

/** Citas en Excel, PDF o CSV (`?format=xlsx|pdf|csv`) con los mismos filtros de la pantalla. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !can(s.role, "reports")) return new Response("Prohibido", { status: 403 });
  const p = new URL(req.url).searchParams;
  const today = drToISO(todayISO(), "00:00");
  const range = ["upcoming", "past", "all"].includes(p.get("range") ?? "") ? p.get("range")! : "upcoming";
  const st = p.get("status");
  const status = st && st in STATUS_META ? st : undefined;
  const search = p.get("q") ?? "";
  try {
    const items = await listAppointments({
      from: range === "upcoming" ? today : undefined, to: range === "past" ? today : undefined,
      status: status ? [status as AppointmentStatus] : undefined, search, limit: LIMIT,
    });
    return await exportResponse(appointmentsDoc(items, await exportContext(), { range, status, search, limit: LIMIT }), parseFormat(p.get("format")));
  } catch (e) {
    console.error("export citas", e);
    return new Response("No se pudo generar el archivo.", { status: 500 });
  }
}
