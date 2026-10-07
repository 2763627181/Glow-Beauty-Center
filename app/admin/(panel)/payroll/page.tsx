import Link from "next/link";
import { NewPayroll } from "@/components/admin/payroll/NewPayroll";
import { EmptyState, PageHead } from "@/components/admin/primitives";
import u from "@/components/admin/ui.module.css";
import { requireAccess } from "@/lib/auth";
import { listPayrolls } from "@/lib/data/payroll";
import { periodLabel } from "@/lib/domain/payroll";
import { fmtDate, money, todayISO } from "@/lib/format";

export const metadata = { title: "Nómina" };

export default async function PayrollPage() {
  await requireAccess("payroll");
  const runs = await listPayrolls();
  return (
    <>
      <PageHead title="Nómina" sub="Pago a las especialistas por período: ventas, comisiones, propinas, sueldo base, bonos y descuentos.">
        <NewPayroll today={todayISO()} />
      </PageHead>
      <div className={u.card}>
        {runs.length === 0 ? (
          <EmptyState title="Aún no hay nóminas" text="Crea la primera con «+ Nueva nómina»: se calcula sola con las ventas del período y las comisiones de cada especialista." />
        ) : (
          <div className={u.tableWrap}>
            <table className={`${u.table} ${u.stack}`}>
              <thead><tr><th>Nómina</th><th>Período</th><th className={u.num}>Especialistas</th><th className={u.num}>Total a pagar</th><th>Estado</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Nómina"><Link className={u.link} href={`/admin/payroll/${r.id}`}>{r.title}</Link><br /><span className={u.hint}>{r.run_number}</span></td>
                    <td data-label="Período">{periodLabel(r.period_start, r.period_end)}</td>
                    <td data-label="Especialistas" className={u.num}>{r.people}</td>
                    <td data-label="Total a pagar" className={u.num}><strong>{money(r.net_total)}</strong></td>
                    <td data-label="Estado">
                      {r.status === "pagada"
                        ? <span className={`${u.badge} ${u.green}`}>Pagada{r.paid_on ? ` · ${fmtDate(`${r.paid_on}T12:00:00-04:00`, { day: "numeric", month: "short" })}` : ""}</span>
                        : <span className={`${u.badge} ${u.gold}`}>Borrador</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
