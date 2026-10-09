import { can, getSession } from "@/lib/auth";
import { getCashReport } from "@/lib/data/cash";
import { cashDoc } from "@/lib/export/docs";
import { parseFormat } from "@/lib/export/model";
import { exportContext, exportResponse } from "@/lib/export/server";

export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

/** El reporte de un turno de caja (`?format=xlsx|pdf|csv`). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || !can(s.role, "cash")) return new Response("Prohibido", { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return new Response("No encontrado", { status: 404 });
  try {
    const [report, ctx] = await Promise.all([getCashReport(id), exportContext()]);
    if (!report) return new Response("No encontrado", { status: 404 });
    return await exportResponse(cashDoc(report, ctx), parseFormat(new URL(req.url).searchParams.get("format")));
  } catch (e) {
    console.error("export caja", e);
    return new Response("No se pudo generar el archivo.", { status: 500 });
  }
}
