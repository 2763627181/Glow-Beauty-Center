import { can, getSession } from "@/lib/auth";
import { loadAppts, loadReportRefs, loadSales } from "@/lib/data/reports";
import { reportDoc, salesDoc } from "@/lib/export/docs";
import { parseFormat } from "@/lib/export/model";
import { exportContext, exportResponse } from "@/lib/export/server";
import { RANGE_LABEL, resolveRange, type RangeKey } from "@/lib/domain/reports";
import { todayISO } from "@/lib/format";

export const maxDuration = 60;

/** Reporte completo (`type=resumen`) o ventas detalladas (`type=ventas`) en Excel, PDF o CSV (`?format=xlsx|pdf|csv`). */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !can(s.role, "reports")) return new Response("Prohibido", { status: 403 });
  const p = new URL(req.url).searchParams;
  const key = (p.get("range") && (p.get("range")! in RANGE_LABEL) ? p.get("range") : "30d") as RangeKey;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const r = resolveRange(key, todayISO(), day.test(p.get("from") ?? "") ? p.get("from")! : undefined, day.test(p.get("to") ?? "") ? p.get("to")! : undefined);
  const range = { fromDay: r.fromDay, toDay: r.toDay, label: RANGE_LABEL[key] };
  try {
    const ventas = p.get("type") === "ventas";
    const [sales, appts, refs, ctx] = await Promise.all([loadSales(r.fromISO, r.toISO), ventas ? Promise.resolve([]) : loadAppts(r.fromISO, r.toISO), loadReportRefs(), exportContext()]);
    return await exportResponse(ventas ? salesDoc(range, sales, refs, ctx) : reportDoc(range, sales, appts, refs, ctx), parseFormat(p.get("format")));
  } catch (e) {
    console.error("export reportes", e);
    return new Response("No se pudo generar el archivo.", { status: 500 });
  }
}
