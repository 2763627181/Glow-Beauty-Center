import Link from "next/link";
import { ExportMenu } from "@/components/admin/ExportMenu";
import { LiveRefresh } from "@/components/admin/LiveRefresh";
import { Alert, EmptyState, PageHead } from "@/components/admin/primitives";
import u from "@/components/admin/ui.module.css";
import { ButtonLink } from "@/components/ui/Button";
import { requireAccess } from "@/lib/auth";
import { getManicurists } from "@/lib/data/manicurists";
import { currentPeriod, isFuture, parsePeriod, periodLabel, periodShort, shiftPeriod, type ManiLine, type ManiSummary, type Period, type PeriodKind } from "@/lib/domain/manicurists";
import { fmtDate, fmtTime, money, todayISO } from "@/lib/format";

export const metadata = { title: "Manicuristas" };

const STATUS: Record<ManiLine["status"], { label: string; tone: string }> = {
  pagado: { label: "Cobrado", tone: u.green }, parcial: { label: "Cobro parcial", tone: u.gold }, pendiente: { label: "Sin cobrar", tone: u.pink },
};
const pctText = (p: number | null) => (p == null ? "—" : `${Number.isInteger(p) ? p : p.toFixed(2).replace(/0+$/, "")}%`);
const KINDS: PeriodKind[] = ["q1", "q2", "mes"];

export default async function ManicuristsPage({ searchParams }: PageProps<"/admin/manicurists">) {
  await requireAccess("manicurists");
  const sp = await searchParams;
  const today = todayISO();
  const period = parsePeriod(sp.month, sp.period, today);
  const onlyPaid = sp.pending !== "1";
  const list = await getManicurists(period, onlyPaid);
  const href = (p: Period, paid = onlyPaid) => `/admin/manicurists?month=${p.month}&period=${p.kind}${paid ? "" : "&pending=1"}`;
  const exportHref = `/admin/manicurists/export?month=${period.month}&period=${period.kind}${onlyPaid ? "" : "&pending=1"}`;
  const total = (pick: (m: ManiSummary) => number) => list.reduce((t, m) => t + pick(m), 0);
  const prev = shiftPeriod(period, -1), next = shiftPeriod(period, 1), now = currentPeriod(today);
  const whole = period.kind === "mes";
  const salaryName = whole ? "Sueldo del mes" : "Sueldo de la quincena";
  const isNow = period.month === now.month && period.kind === now.kind;

  return (
    <>
      <LiveRefresh tables={["sales", "payments"]} />
      <PageHead title="Manicuristas" sub="Sueldo fijo por quincena más un porcentaje de lo que cobran los servicios que realizan.">
        {list.length > 0 && <ExportMenu groups={[{ href: exportHref }]} />}
      </PageHead>

      <nav className={u.filters} aria-label="Período y filtro">
        {KINDS.map((k) => (
          <ButtonLink key={k} size="sm" variant={k === period.kind ? "primary" : "secondary"} href={href({ month: period.month, kind: k })} aria-current={k === period.kind ? "true" : undefined}>{periodShort({ month: period.month, kind: k })}</ButtonLink>
        ))}
        <span style={{ flex: 1 }} />
        <ButtonLink size="sm" variant="soft" href={href(period, !onlyPaid)}>{onlyPaid ? "Incluir servicios sin cobrar" : "Solo servicios cobrados"}</ButtonLink>
      </nav>
      <nav className={u.filters} aria-label="Cambiar de período">
        <ButtonLink size="sm" variant="secondary" href={href(prev)} aria-label={`Ver ${periodLabel(prev)}`}>← Anterior</ButtonLink>
        <strong aria-current="date" style={{ padding: "0 8px" }}>{periodLabel(period)}</strong>
        {!isFuture(next, today) && <ButtonLink size="sm" variant="secondary" href={href(next)} aria-label={`Ver ${periodLabel(next)}`}>Siguiente →</ButtonLink>}
        {!isNow && <ButtonLink size="sm" variant="soft" href={href(now)}>Quincena de hoy</ButtonLink>}
      </nav>
      <p className={u.hint} style={{ marginBottom: 16 }}>
        {onlyPaid ? "La comisión cuenta los servicios de ventas ya cobradas por completo; los demás se muestran aparte y suman cuando se cobren." : "La comisión incluye también los servicios de ventas pendientes o con cobro parcial."}{" "}
        {whole ? "El mes completo suma las dos quincenas de sueldo. " : ""}No incluye propinas (esas van en la Nómina).
      </p>

      {list.length === 0 ? (
        <section className={u.card}>
          <EmptyState title="Aún no hay manicuristas" text="Aparecen solas las especialistas cuya Especialidad dice «Manicurista» (en su ficha, en Especialistas)." />
        </section>
      ) : (
        <div className={u.grid}>
          <div className={u.kpis}>
            <div className={`${u.card} ${u.stat}`}><span>Total a pagar</span><strong>{money(total((m) => m.payable))}</strong><small>Sueldos + comisiones</small></div>
            <div className={`${u.card} ${u.stat}`}><span>{whole ? "Sueldos del mes" : "Sueldos de la quincena"}</span><strong>{money(total((m) => m.salary))}</strong></div>
            <div className={`${u.card} ${u.stat}`}><span>Comisiones</span><strong>{money(total((m) => m.commission))}</strong></div>
            <div className={`${u.card} ${u.stat}`}><span>Cobrado por servicios</span><strong>{money(total((m) => m.charged))}</strong><small>{total((m) => m.services)} {total((m) => m.services) === 1 ? "servicio" : "servicios"}</small></div>
          </div>

          {list.map((m) => (
            <section key={m.employeeId} className={u.card} aria-labelledby={`mani-${m.employeeId}`}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <h2 id={`mani-${m.employeeId}`} style={{ marginBottom: 4 }}>{m.name}{!m.active && <span className={`${u.badge} ${u.gray}`} style={{ marginLeft: 8 }}>Inactiva</span>}</h2>
                <Link className={u.link} href={`/admin/staff/${m.employeeId}`}>Editar sueldo y porcentaje</Link>
              </div>
              <p className={u.sub} style={{ marginBottom: 12 }}>
                Sueldo fijo {money(m.salaryPerPay)} por quincena ({money(m.salaryPerPay * 2)} al mes) · gana el {pctText(m.pct)} de lo que cobra por sus servicios
              </p>
              {(m.salaryPerPay === 0 || m.missingPct) && (
                <div style={{ marginBottom: 12 }}>
                  <Alert kind="warn">
                    {m.missingPct && <>Falta su porcentaje de comisión: sin él la comisión sale en RD$ 0. </>}
                    {m.salaryPerPay === 0 && <>No tiene sueldo fijo por quincena. </>}
                    Se configura en su ficha (<Link className={u.link} href={`/admin/staff/${m.employeeId}`}>abrir ficha</Link>).
                  </Alert>
                </div>
              )}

              <div className={u.kpis} style={{ marginBottom: 14 }}>
                <div className={`${u.card} ${u.stat}`}><span>Servicios</span><strong>{m.services}</strong>{m.pendingServices > 0 && <small>+ {m.pendingServices} sin cobrar</small>}</div>
                <div className={`${u.card} ${u.stat}`}><span>Cobrado</span><strong>{money(m.charged)}</strong>{m.pendingAmount > 0 && <small>+ {money(m.pendingAmount)} sin cobrar</small>}</div>
                <div className={`${u.card} ${u.stat}`}><span>Su {pctText(m.pct)}</span><strong>{money(m.commission)}</strong></div>
                <div className={`${u.card} ${u.stat}`}><span>{salaryName}</span><strong>{money(m.salary)}</strong></div>
                <div className={`${u.card} ${u.stat}`} style={{ background: "var(--color-blush)" }}>
                  <span>{whole ? "Total a pagar del mes" : "Total a pagar la quincena"}</span><strong>{money(m.payable)}</strong>
                  <small>{money(m.salary)} de sueldo + {money(m.commission)} de comisión</small>
                </div>
              </div>

              {m.lines.length === 0 ? (
                <EmptyState title="Sin servicios en este período" text="Cuando se completen servicios con ella aparecen aquí, con su comisión." />
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
