import { can, getSession } from "@/lib/auth";
import { loadAppts, loadReportRefs, loadSales } from "@/lib/data/reports";
import { RANGE_LABEL, resolveRange, summarize, toCSV, type RangeKey } from "@/lib/domain/reports";
import { todayISO } from "@/lib/format";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !can(s.role, "reports")) return new Response("Prohibido", { status: 403 });
  const p = new URL(req.url).searchParams;
  const key = (p.get("range") && (p.get("range")! in RANGE_LABEL) ? p.get("range") : "30d") as RangeKey;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const r = resolveRange(key, todayISO(), day.test(p.get("from") ?? "") ? p.get("from")! : undefined, day.test(p.get("to") ?? "") ? p.get("to")! : undefined);
  const [sales, appts, refs] = await Promise.all([loadSales(r.fromISO, r.toISO), loadAppts(r.fromISO, r.toISO), loadReportRefs()]);

  let rows: (string | number)[][];
  if (p.get("type") === "ventas") {
    rows = [["Número", "Fecha", "Cliente", "Servicios", "Especialista", "Subtotal", "Descuento", "Propina", "Total", "Estado de pago"],
      ...sales.map((x) => [x.sale_number, x.completed_at.slice(0, 10), x.client_name, x.items.map((i) => i.description).join(" + "), x.employee_name, x.subtotal, x.discount, x.tip, x.total, x.payment_status])];
  } else {
    const m = summarize(sales, appts, refs);
    rows = [["Métrica", "Valor"], ["Ingresos", m.revenue], ["Ventas", m.salesCount], ["Ticket promedio", Math.round(m.avgTicket)], ["Citas", m.appointments],
      ["Completadas", m.completed], ["Canceladas", m.cancelled], ["No-show", m.noShow], ["Conversión", `${Math.round(m.conversion * 100)}%`], [],
      ["Servicio", "Ingresos", "Cantidad"], ...m.byService.map((x) => [x.label, x.value, x.count ?? 0]), [],
      ["Especialista", "Ingresos"], ...m.byEmployee.map((x) => [x.label, x.value]), [],
      ["Método de pago", "Monto"], ...m.byMethod.map((x) => [x.label, x.value]), [],
      ["Comisiones", "Monto"], ...m.commissions.map((x) => [x.label, Math.round(x.value)])];
  }
  return new Response(toCSV(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="glow-${p.get("type") ?? "resumen"}-${r.fromDay}_${r.toDay}.csv"` },
  });
}
