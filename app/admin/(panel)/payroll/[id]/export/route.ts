import { can, getSession } from "@/lib/auth";
import { getPayroll } from "@/lib/data/payroll";
import { paySlipDoc, payrollDoc } from "@/lib/export/docs";
import { parseFormat } from "@/lib/export/model";
import { exportContext, exportResponse } from "@/lib/export/server";

export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

/** La nómina completa (`?format=xlsx|pdf|csv`) o el volante de una especialista (`?employee=<id>`). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || !can(s.role, "payroll")) return new Response("Prohibido", { status: 403 });
  const { id } = await params;
  const p = new URL(req.url).searchParams;
  const employee = p.get("employee");
  if (!UUID.test(id) || (employee && !UUID.test(employee))) return new Response("No encontrado", { status: 404 });
  try {
    const [data, ctx] = await Promise.all([getPayroll(id), exportContext()]);
    if (!data) return new Response("No encontrado", { status: 404 });
    if (employee) {
      const line = data.lines.find((l) => l.employee_id === employee);
      if (!line) return new Response("No encontrado", { status: 404 });
      return await exportResponse(paySlipDoc(data.run, line, ctx), parseFormat(p.get("format")));
    }
    return await exportResponse(payrollDoc(data.run, data.lines, ctx), parseFormat(p.get("format")));
  } catch (e) {
    console.error("export nómina", e);
    return new Response("No se pudo generar el archivo.", { status: 500 });
  }
}
