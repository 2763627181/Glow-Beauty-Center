import { can, getSession } from "@/lib/auth";
import { getManicurists } from "@/lib/data/manicurists";
import { MONTH_RE } from "@/lib/domain/manicurists";
import { manicuristsDoc } from "@/lib/export/docs";
import { parseFormat } from "@/lib/export/model";
import { exportContext, exportResponse } from "@/lib/export/server";
import { todayISO } from "@/lib/format";

export const maxDuration = 60;

/** Las manicuristas del mes (`?month=AAAA-MM&pending=1&format=xlsx|pdf|csv`). */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !can(s.role, "manicurists")) return new Response("Prohibido", { status: 403 });
  const p = new URL(req.url).searchParams;
  const month = p.get("month") ?? todayISO().slice(0, 7);
  if (!MONTH_RE.test(month)) return new Response("Mes no válido", { status: 400 });
  const onlyPaid = p.get("pending") !== "1";
  try {
    const [list, ctx] = await Promise.all([getManicurists(month, onlyPaid), exportContext()]);
    return await exportResponse(manicuristsDoc(month, list, onlyPaid, ctx), parseFormat(p.get("format")));
  } catch (e) {
    console.error("export manicuristas", e);
    return new Response("No se pudo generar el archivo.", { status: 500 });
  }
}
