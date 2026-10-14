import Link from "next/link";
import { ExportMenu } from "@/components/admin/ExportMenu";
import { LiveRefresh } from "@/components/admin/LiveRefresh";
import { Alert, EmptyState, PageHead } from "@/components/admin/primitives";
import u from "@/components/admin/ui.module.css";
import { ButtonLink } from "@/components/ui/Button";
import { requireAccess } from "@/lib/auth";
import { getManicurists } from "@/lib/data/manicurists";
import { monthLabel, parseMonth, shiftMonth, type ManiLine, type ManiSummary } from "@/lib/domain/manicurists";
import { fmtDate, fmtTime, money, todayISO } from "@/lib/format";

export const metadata = { title: "Manicuristas" };

const STATUS: Record<ManiLine["status"], { label: string; tone: string }> = {
  pagado: { label: "Cobrado", tone: u.green }, parcial: { label: "Cobro parcial", tone: u.gold }, pendiente: { label: "Sin cobrar", tone: u.pink },
};
const pctText = (p: number | null) => (p == null ? "—" : `${Number.isInteger(p) ? p : p.toFixed(2).replace(/0+$/, "")}%`);

export default async function ManicuristsPage({ searchParams }: PageProps<"/admin/manicurists">) {
  await requireAccess("manicurists");
  const sp = await searchParams;
  const current = todayISO().slice(0, 7);
  const month = parseMonth(sp.month, current);
  const onlyPaid = sp.pending !== "1";
  const list = await getManicurists(month, onlyPaid);
  const href = (m: string, paid = onlyPaid) => `/admin/manicurists?month=${m}${paid ? "" : "&pending=1"}`;
  const exportHref = `/admin/manicurists/export?month=${month}${onlyPaid ? "" : "&pending=1"}`;
  const total = (pick: (m: ManiSummary) => number) => list.reduce((t, m) => t + pick(m), 0);

  return (
    <>
      <LiveRefresh tables={["sales", "payments"]} />
      <PageHead title="Manicuristas" sub="Sueldo fijo mensual más un porcentaje de lo que cobran los servicios que realizan.">
        {list.length > 0 && <ExportMenu groups={[{ href: exportHref }]} />}
      </PageHead>

      <nav className={u.filters} aria-label="Mes y filtro">
        <ButtonLink size="sm" variant="secondary" href={href(shiftMonth(month, -1))} aria-label={`Ver ${monthLabel(shiftMonth(month, -1))}`}>← {monthLabel(shiftMonth(month, -1))}</ButtonLink>
        <strong aria-current="date" style={{ padding: "0 8px" }}>{monthLabel(month)}</strong>
        {month < current && <ButtonLink size="sm" variant="secondary" href={href(shiftMonth(month, 1))} aria-label={`Ver ${monthLabel(shiftMonth(month, 1))}`}>{monthLabel(shiftMonth(month, 1))} →</ButtonLink>}
        {month !== current && <ButtonLink size="sm" variant="soft" href={href(current)}>Este mes</ButtonLink>}
        <span style={{ flex: 1 }} />
        <ButtonLink size="sm" variant="soft" href={href(month, !onlyPaid)}>{onlyPaid ? "Incluir servicios sin cobrar" : "Solo servicios cobrados"}</ButtonLink>
      </nav>
      <p className={u.hint} style={{ marginBottom: 16 }}>
        {onlyPaid ? "La comisión cuenta los servicios de ventas ya cobradas por completo; los demás se muestran aparte y suman cuando se cobren." : "La comisión incluye también los servicios de ventas pendientes o con cobro parcial."}{" "}
        No incluye propinas (esas van en la Nómina).
      </p>

      {list.length === 0 ? (
        <section className={u.card}>
          <EmptyState title="Aún no hay manicuristas" text="Aparecen solas las especialistas cuya Especialidad dice «Manicurista» (en su ficha, en Especialistas)." />
        </section>
      ) : (
        <div className={u.grid}>
          <div className={u.kpis}>
            <div className={`${u.card} ${u.stat}`}><span>Total a pagar</span><strong>{money(total((m) => m.payable))}</strong><small>Sueldos + comisiones</small></div>
            <div className={`${u.card} ${u.stat}`}><span>Sueldos del mes</span><strong>{money(total((m) => m.salary))}</strong></div>
            <div className={`${u.card} ${u.stat}`}><span>Comisiones</span><strong>{money(total((m) => m.commission))}</strong></div>
            <div className={`${u.card} ${u.stat}`}><span>Cobrado por servicios</span><strong>{money(total((m) => m.charged))}</strong><small>{total((m) => m.services)} {total((m) => m.services) === 1 ? "servicio" : "servicios"}</small></div>
          </div>

          {list.map((m) => (
            <section key={m.employeeId} className={u.card} aria-labelledby={`mani-${m.employeeId}`}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <h2 id={`mani-${m.employeeId}`} style={{ marginBottom: 4 }}>{m.name}{!m.active && <span className={`${u.badge} ${u.gray}`} style={{ marginLeft: 8 }}>Inactiva</span>}</h2>
                <Link className={u.link} href={`/admin/staff/${m.employeeId}`}>Editar sueldo y porcentaje</Link>
              </div>
              <p className={u.sub} style={{ marginBottom: 12 }}>Sueldo fijo {money(m.salary)} al mes · gana el {pctText(m.pct)} de lo que cobra por sus servicios</p>
              {(m.salary === 0 || m.missingPct) && (
                <div style={{ marginBottom: 12 }}>
                  <Alert kind="warn">
                    {m.missingPct && <>Falta su porcentaje de comisión: sin él la comisión sale en RD$ 0. </>}
                    {m.salary === 0 && <>No tiene sueldo fijo mensual. </>}
                    Se configura en su ficha (<Link className={u.link} href={`/admin/staff/${m.employeeId}`}>abrir ficha</Link>).
                  </Alert>
                </div>
              )}

              <div className={u.kpis} style={{ marginBottom: 14 }}>
                <div className={`${u.card} ${u.stat}`}><span>Servicios</span><strong>{m.services}</strong>{m.pendingServices > 0 && <small>+ {m.pendingServices} sin cobrar</small>}</div>
                <div className={`${u.card} ${u.stat}`}><span>Cobrado</span><strong>{money(m.charged)}</strong>{m.pendingAmount > 0 && <small>+ {money(m.pendingAmount)} sin cobrar</small>}</div>
                <div className={`${u.card} ${u.stat}`}><span>Su {pctText(m.pct)}</span><strong>{money(m.commission)}</strong></div>
                <div className={`${u.card} ${u.stat}`}><span>Sueldo del mes</span><strong>{money(m.salary)}</strong></div>
                <div className={`${u.card} ${u.stat}`} style={{ background: "var(--color-blush)" }}><span>Total a pagar</span><strong>{money(m.payable)}</strong></div>
              </div>

              {m.lines.length === 0 ? (
                <EmptyState title="Sin servicios este mes" text="Cuando se completen servicios con ella aparecen aquí, con su comisión." />
              ) : (
                <div className={u.tableWrap} role="region" aria-label={`Tabla de servicios de ${m.name}`} tabIndex={0}>
                  <table className={`${u.table} ${u.stack}`}>
                    <thead><tr><th>Fecha</th><th>Cliente</th><th>Servicio</th><th className={u.num}>Cobrado</th><th>Venta</th><th className={u.num}>Su {pctText(m.pct)}</th></tr></thead>
                    <tbody>
                      {m.lines.map((l, i) => (
                        <tr key={`${l.saleId}-${i}`}>
                          <td data-label="Fecha">{fmtDate(l.date, { day: "numeric", month: "short" })} <span className={u.hint}>{fmtTime(l.date)}</span></td>
                          <td data-label="Cliente">{l.client}</td>
                          <td data-label="Servicio">{l.description}{l.shared && <span className={`${u.badge} ${u.gray}`} style={{ marginLeft: 6 }}>Compartido</span>}</td>
                          <td data-label="Cobrado" className={u.num}>{money(l.total)}</td>
                          <td data-label="Venta"><Link className={u.link} href={`/admin/sales/${l.saleId}`}>{l.saleNumber}</Link> <span className={`${u.badge} ${STATUS[l.status].tone}`}>{STATUS[l.status].label}</span></td>
                          <td data-label={`Su ${pctText(m.pct)}`} className={u.num}>
                            {l.counts ? <strong>{money(l.commission)}</strong> : <span className={u.hint}>{money(l.commissionIfPaid)} al cobrarse</span>}
                            {l.pct !== (m.pct ?? 0) && <div className={u.hint}>al {pctText(l.pct)}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
