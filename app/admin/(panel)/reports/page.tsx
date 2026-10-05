import Link from "next/link";
import { RankList } from "@/components/admin/charts";
import { Kpi } from "@/components/admin/KpiCard";
import { PageHead } from "@/components/admin/primitives";
import u from "@/components/admin/ui.module.css";
import { requireAccess } from "@/lib/auth";
import { loadAppts, loadReportRefs, loadSales } from "@/lib/data/reports";
import { RANGE_LABEL, resolveRange, summarize, type RangeKey } from "@/lib/domain/reports";
import { todayISO } from "@/lib/format";

export const metadata = { title: "Reportes" };
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  await requireAccess("reports");
  const sp = await searchParams;
  const key = (typeof sp.range === "string" && sp.range in RANGE_LABEL ? sp.range : "30d") as RangeKey;
  const from = isDay(sp.from) ? sp.from : undefined;
  const to = isDay(sp.to) ? sp.to : undefined;
  const r = resolveRange(key, todayISO(), from, to);
  const [sales, appts, refs] = await Promise.all([loadSales(r.fromISO, r.toISO), loadAppts(r.fromISO, r.toISO), loadReportRefs()]);
  const m = summarize(sales, appts, refs);
  const qs = `range=${key}${from && to ? `&from=${from}&to=${to}` : ""}`;

  return (
    <>
      <PageHead title="Reportes" sub={`${r.fromDay} → ${r.toDay}`}>
        <a className={u.link} href={`/admin/reports/export?${qs}&type=ventas`}>Exportar ventas (CSV)</a>
        <a className={u.link} href={`/admin/reports/export?${qs}&type=resumen`}>Exportar resumen (CSV)</a>
      </PageHead>
      <div className={u.filters}>
        {(Object.keys(RANGE_LABEL) as RangeKey[]).filter((k) => k !== "custom").map((k) => (
          <Link key={k} href={`/admin/reports?range=${k}`} className={`${u.badge} ${key === k ? u.pink : u.gray}`} style={{ minHeight: 36, padding: "0 14px", display: "inline-flex", alignItems: "center" }}>{RANGE_LABEL[k]}</Link>
        ))}
        <form style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="hidden" name="range" value="custom" />
          <label className="sr-only" htmlFor="from">Desde</label><input id="from" type="date" name="from" defaultValue={from} required />
          <label className="sr-only" htmlFor="to">Hasta</label><input id="to" type="date" name="to" defaultValue={to} required />
          <button className={`${u.badge} ${u.sage}`} style={{ minHeight: 40, padding: "0 14px", border: 0 }}>Aplicar rango</button>
        </form>
      </div>

      <div className={u.kpis}>
        <Kpi label="Ingresos totales" value={m.revenue} />
        <Kpi label="Cantidad de ventas" value={m.salesCount} format="int" />
        <Kpi label="Ticket promedio" value={m.avgTicket} />
        <Kpi label="Citas" value={m.appointments} format="int" />
        <Kpi label="Completadas" value={m.completed} format="int" />
        <Kpi label="Canceladas" value={m.cancelled} format="int" />
        <Kpi label="No-show" value={m.noShow} format="int" />
        <Kpi label="Conversión solicitud → completada" value={m.conversion} format="pct" />
      </div>

      <div className={u.cols2} style={{ marginTop: 16 }}>
        <section className={u.card}><h2>Ventas por servicio</h2><RankList rows={m.byService} /></section>
        <section className={u.card}><h2>Ventas por categoría</h2><RankList rows={m.byCategory} /></section>
        <section className={u.card}><h2>Ventas por especialista</h2><RankList rows={m.byEmployee} /></section>
        <section className={u.card}><h2>Ventas por método de pago</h2><RankList rows={m.byMethod} /></section>
        <section className={u.card}><h2>Comisiones por especialista</h2><p className={u.hint} style={{ marginBottom: 8 }}>Según el % de cada servicio o, si no tiene, el del especialista (configúralos en Servicios y Especialistas).</p><RankList rows={m.commissions} empty="Sin comisiones: define un % en los servicios o especialistas" /></section>
        <section className={u.card}><h2>Propinas y descuentos</h2><RankList rows={[{ label: "Propinas", value: m.tips }, { label: "Descuentos otorgados", value: m.discounts }]} /></section>
        <section className={u.card}><h2>Servicios más vendidos (cantidad)</h2><RankList rows={m.byService.map((x) => ({ label: x.label, value: x.count ?? 0 })).sort((a, b) => b.value - a.value)} money={false} /></section>
        <section className={u.card}><h2>Clientes frecuentes</h2><RankList rows={m.frequentClients} money={false} /></section>
        <section className={u.card}><h2>Clientes con mayor gasto</h2><RankList rows={m.topClientsSpend} /></section>
        <section className={u.card}><h2>Días con mayor demanda</h2><RankList rows={m.busyDays} money={false} /></section>
        <section className={u.card}><h2>Horas con mayor demanda</h2><RankList rows={m.busyHours} money={false} /></section>
      </div>
    </>
  );
}
