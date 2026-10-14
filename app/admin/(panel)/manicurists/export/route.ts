import { can, getSession } from "@/lib/auth";
import { getManicurists } from "@/lib/data/manicurists";
import { MONTH_RE, PERIOD_KINDS, parsePeriod } from "@/lib/domain/manicurists";
import { manicuristsDoc } from "@/lib/export/docs";
import { parseFormat } from "@/lib/export/model";
import { exportContext, exportResponse } from "@/lib/export/server";
import { todayISO } from "@/lib/format";

export const maxDuration = 60;

/** Las manicuristas de una quincena o del mes (`?month=AAAA-MM&period=q1|q2|mes&pending=1&format=xlsx|pdf|csv`). */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !can(s.role, "manicurists")) return new Response("Prohibido", { status: 403 });
  const p = new URL(req.url).searchParams;
  const month = p.get("month"), kind = p.get("period");
  if ((month && !MONTH_RE.test(month)) || (kind && !PERIOD_KINDS.some((k) => k === kind))) return new Response("Período no válido", { status: 400 });
  const period = parsePeriod(month, kind, todayISO());
  const onlyPaid = p.get("pending") !== "1";
  try {
    const [list, ctx] = await Promise.all([getManicurists(period, onlyPaid), exportContext()]);
    return await exportResponse(manicuristsDoc(period, list, onlyPaid, ctx), parseFormat(p.get("format")));
  } catch (e) {
    console.error("export manicuristas", e);
    return new Response("No se pudo generar el archivo.", { status: 500 });
  }
}
