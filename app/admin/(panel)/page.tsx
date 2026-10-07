import { serviceNames } from "@/lib/domain/serviceLines";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart, RankList } from "@/components/admin/charts";
import { Kpi } from "@/components/admin/KpiCard";
import { LiveRefresh } from "@/components/admin/LiveRefresh";
import { EmptyState, PageHead, StatusBadge } from "@/components/admin/primitives";
import u from "@/components/admin/ui.module.css";
import { getSession, can } from "@/lib/auth";
import { birthdayLabel, cumpleLabel, daysUntilBirthday } from "@/lib/domain/birthday";
import { createClient } from "@/lib/supabase/server";
import { countAppointments, listAppointments } from "@/lib/data/appointments";
import { loadAppts, loadReportRefs, loadSales } from "@/lib/data/reports";
import { dailySeries, monthlySeries, resolveRange, summarize } from "@/lib/domain/reports";
import { drToISO, fmtDate, fmtTime, money, todayISO } from "@/lib/format";

export const metadata = { title: "Dashboard" };
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export default async function Dashboard() {
  const s = await getSession();
  if (!s) redirect("/admin/login");
  if (!can(s.role, "dashboard")) redirect("/admin/calendar");

  const today = todayISO();
  const day = resolveRange("today", today);
  const month = resolveRange("month", today);
  const sixMonths = new Date(`${today.slice(0, 7)}-01T12:00:00-04:00`);
  sixMonths.setUTCMonth(sixMonths.getUTCMonth() - 5);
  const sixFrom = drToISO(sixMonths.toISOString().slice(0, 10), "00:00");

  const [salesSix, apptsMonth, apptsToday, upcoming, requests, pendingCount, refs, { data: staffBd }] = await Promise.all([
    loadSales(sixFrom, month.toISO),
    loadAppts(month.fromISO, month.toISO),
    loadAppts(day.fromISO, day.toISO),
    listAppointments({ from: new Date().toISOString(), status: ["confirmado", "en_espera", "contactado", "contactando"], limit: 6 }),
    listAppointments({ status: ["solicitud"], limit: 6 }),
    countAppointments(["solicitud", "contactando", "contactado"]),
    loadReportRefs(),
    createClient().then((sb) => sb.from("employees").select("id,full_name,birth_month,birth_day").eq("active", true).not("birth_month", "is", null)),
  ]);
  const birthdays = (staffBd ?? []).filter((e) => e.birth_month && e.birth_day)
    .map((e) => ({ id: e.id, name: e.full_name, month: e.birth_month!, day: e.birth_day!, in: daysUntilBirthday(e.birth_month!, e.birth_day!, today) }))
    .filter((b) => b.in <= 30).sort((a, b) => a.in - b.in).slice(0, 5);
  const salesMonth = salesSix.filter((x) => x.completed_at >= month.fromISO);
  const salesToday = salesSix.filter((x) => x.completed_at >= day.fromISO && x.completed_at < day.toISO);
  const m = summarize(salesMonth, apptsMonth, refs);
  const t = summarize(salesToday, apptsToday, refs);
  const week = dailySeries(salesSix, today, 7);
  const monthly = monthlySeries(salesSix, today.slice(0, 7), 6);

  return (
    <>
      <LiveRefresh tables={["appointments", "sales"]} />
      <PageHead title="Dashboard" sub="Resumen de hoy y del mes en curso" />
      <div className={u.kpis}>
        <Kpi label="Ventas de hoy" value={t.revenue} hint={`${t.salesCount} ${t.salesCount === 1 ? "venta" : "ventas"}`} />
        <Kpi label="Ventas del mes" value={m.revenue} hint={`${m.salesCount} ${m.salesCount === 1 ? "venta" : "ventas"}`} />
        <Kpi label="Citas de hoy" value={apptsToday.filter((a) => !["cancelado", "no_asistio"].includes(a.status)).length} format="int" />
        <Kpi label="Citas pendientes" value={pendingCount} format="int" hint="Solicitud, contactando o contactado" />
        <Kpi label="Clientes atendidos (mes)" value={m.clientsServed} format="int" />
        <Kpi label="Ingresos cobrados (mes)" value={m.collected} />
        <Kpi label="Ticket promedio" value={m.avgTicket} />
        <Kpi label="Cancelaciones (mes)" value={m.cancelled} format="int" hint={`${m.noShow} no asistieron`} />
      </div>

      <div className={u.cols2} style={{ marginTop: 16 }}>
        <section className={u.card}>
          <h2>Solicitudes nuevas</h2>
          {requests.length === 0 ? <EmptyState title="Todo al día" text="No hay solicitudes pendientes." /> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
              {requests.map((a) => (
                <li key={a.id}><Link href={`/admin/appointments/${a.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span><strong>{a.client.first_name} {a.client.last_name}</strong><br /><span className={u.sub}>{serviceNames(a.services).join(", ")}</span></span>
                  <span style={{ textAlign: "right" }}>{fmtDate(a.start_time, { day: "numeric", month: "short" })}<br />{fmtTime(a.start_time)}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </section>
        <section className={u.card}>
          <h2>Citas próximas</h2>
          {upcoming.length === 0 ? <EmptyState title="Sin citas próximas" /> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
              {upcoming.map((a) => (
                <li key={a.id}><Link href={`/admin/appointments/${a.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span><strong>{a.client.first_name}</strong> · {fmtTime(a.start_time)}<br /><span className={u.sub}>{a.employee?.full_name ?? "Sin asignar"}</span></span>
                  <StatusBadge status={a.status} />
                </Link></li>
              ))}
            </ul>
          )}
        </section>
        {birthdays.length > 0 && (
          <section className={u.card}>
            <h2>🎂 Cumpleaños del equipo</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
              {birthdays.map((b) => (
                <li key={b.id}><Link href={`/admin/staff/${b.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong>{b.name}</strong>
                  <span className={u.sub}>{cumpleLabel(b.in)} · {birthdayLabel(b.month, b.day)}</span>
                </Link></li>
              ))}
            </ul>
          </section>
        )}
        <section className={u.card}><h2>Ventas últimos 7 días</h2><BarChart data={week} label="Ventas por día" fmtLabel={(l) => l.slice(8)} /></section>
        <section className={u.card}><h2>Ingresos mensuales</h2><BarChart data={monthly} label="Ingresos por mes" fmtLabel={(l) => MONTHS[Number(l.slice(5)) - 1]} /></section>
        <section className={u.card}><h2>Servicios más vendidos</h2><RankList rows={m.byService.slice(0, 6)} /></section>
        <section className={u.card}><h2>Métodos de pago</h2><RankList rows={m.byMethod} /></section>
        <section className={u.card}><h2>Top especialistas</h2><RankList rows={m.byEmployee.slice(0, 5)} /></section>
        <section className={u.card}><h2>Top clientes</h2><RankList rows={m.topClientsSpend.slice(0, 5)} /></section>
      </div>
      <p className={u.sub} style={{ marginTop: 16 }}>Ticket del mes: {money(m.avgTicket)} · Conversión solicitud → completada: {Math.round(m.conversion * 100)}%</p>
    </>
  );
}
