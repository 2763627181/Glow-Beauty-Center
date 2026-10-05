import Link from "next/link";
import { notFound } from "next/navigation";
import { NewForClient } from "@/components/admin/appointments/NewAppointment";
import { ClientForm, ClientManage, ClientNotes } from "@/components/admin/clients/ClientTools";
import { Kpi } from "@/components/admin/KpiCard";
import { PageHead, PayBadge, StatusBadge } from "@/components/admin/primitives";
import u from "@/components/admin/ui.module.css";
import { ButtonAnchor } from "@/components/ui/Button";
import { requireAccess } from "@/lib/auth";
import { getClientProfile } from "@/lib/data/clients";
import { apptTotal, shapeAppointment } from "@/lib/data/appointments";
import { fmtDate, fmtTime, money } from "@/lib/format";
import { allowed } from "@/lib/permissions";
import { waLink } from "@/lib/whatsapp";

export const metadata = { title: "Cliente" };

export default async function ClientPage({ params }: PageProps<"/admin/clients/[id]">) {
  const s = await requireAccess("clients");
  const { id } = await params;
  const d = await getClientProfile(id);
  if (!d) notFound();
  const { client: c, stats, appts, sales } = d;
  const next = stats?.next_appointment;
  const manage = allowed(s.role, "manageClients");
  const money$ = allowed(s.role, "seeMoney");
  return (
    <>
      <PageHead title={`${c.first_name} ${c.last_name}`} sub={`${c.phone}${c.email ? ` · ${c.email}` : ""}${c.active ? "" : " · Inactivo"}`}>
        {manage && <NewForClient client={c} />}
        {manage && <ButtonAnchor size="sm" variant="whatsapp" href={waLink(c.phone, `Hola ${c.first_name} ✨`)} target="_blank" rel="noopener">WhatsApp</ButtonAnchor>}
        <ButtonAnchor size="sm" variant="secondary" href={`tel:${c.phone}`}>Llamar</ButtonAnchor>
        {manage && <ClientForm client={{ id: c.id, first_name: c.first_name, last_name: c.last_name, phone: c.phone, email: c.email }} />}
        {manage && <ClientManage id={c.id} name={`${c.first_name} ${c.last_name}`.trim()} active={c.active} canDelete={allowed(s.role, "deleteRecords")} />}
      </PageHead>
      <div className={u.kpis}>
        {money$ && <Kpi label="Total gastado" value={Number(stats?.total_spent ?? 0)} />}
        <Kpi label="Visitas" value={stats?.visits ?? 0} format="int" />
        <Kpi label="Cancelaciones" value={stats?.cancellations ?? 0} format="int" />
        <Kpi label="No-shows" value={stats?.no_shows ?? 0} format="int" />
      </div>
      <p className={u.sub} style={{ margin: "12px 0" }}>Próxima cita: {next ? `${fmtDate(next, { weekday: "long", day: "numeric", month: "long" })} · ${fmtTime(next)}` : "ninguna"}</p>

      <div className={u.cols2}>
        <section className={u.card}><h2>Notas privadas</h2><ClientNotes id={c.id} initial={c.internal_notes ?? ""} readOnly={!manage} /></section>
        {money$ && (
          <section className={u.card}>
            <h2>Pagos y ventas</h2>
            {sales.length === 0 ? <p className={u.sub}>Sin ventas todavía.</p> : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                {sales.map((x) => (
                  <li key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <Link className={u.link} href={`/admin/sales/${x.id}`}>{x.sale_number}</Link>
                    <span>{fmtDate(x.completed_at, { day: "numeric", month: "short" })}</span>
                    <PayBadge status={x.payment_status} /><strong>{money(x.total)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <section className={u.card} style={{ gridColumn: "1 / -1" }}>
          <h2>Historial de citas y servicios</h2>
          {appts.length === 0 ? <p className={u.sub}>Sin citas.</p> : (
            <div className={u.tableWrap}>
              <table className={`${u.table} ${u.stack}`}>
                <thead><tr><th>Fecha</th><th>Servicios</th><th>Especialista</th>{money$ && <th className={u.num}>Total</th>}<th>Estado</th></tr></thead>
                <tbody>
                  {appts.map((raw) => {
                    const a = shapeAppointment(raw);
                    return (
                      <tr key={a.id}>
                        <td data-label="Fecha"><Link className={u.link} href={`/admin/appointments/${a.id}`}>{fmtDate(a.start_time, { day: "numeric", month: "short", year: "numeric" })}</Link></td>
                        <td data-label="Servicios">{a.services.map((x) => x.name).join(", ")}</td>
                        <td data-label="Especialista">{a.employees.length ? a.employees.map((e) => e.name).join(" + ") : "—"}</td>
                        {money$ && <td data-label="Total" className={u.num}>{money(a.final_total ?? apptTotal(a))}</td>}
                        <td data-label="Estado"><StatusBadge status={a.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
