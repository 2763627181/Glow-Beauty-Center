import Link from "next/link";
import { LiveRefresh } from "@/components/admin/LiveRefresh";
import { EmptyState, PageHead, PayBadge } from "@/components/admin/primitives";
import { RefundButton } from "@/components/admin/sales/RefundButton";
import u from "@/components/admin/ui.module.css";
import { requireAccess } from "@/lib/auth";
import { fmtDate, fmtTime, money } from "@/lib/format";
import { allowed } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Cobros" };
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function PaymentsPage() {
  const s = await requireAccess("payments");
  const sb = await createClient();
  const [{ data: pays }, { data: owed }, { data: open }, { data: methods }] = await Promise.all([
    sb.from("payments").select("id,amount,method,reference,status,paid_at,appointment_id,sale:sales(id,sale_number,voided_at,client:clients(first_name,last_name))").order("paid_at", { ascending: false }).limit(80),
    sb.from("sales").select("id,sale_number,total,payment_status,completed_at,client:clients(first_name,last_name),payments(amount,status)").in("payment_status", ["pendiente", "parcial"]).is("voided_at", null).order("completed_at", { ascending: false }).limit(60),
    sb.from("appointments").select("id,start_time,status,client:clients(first_name,last_name)").in("status", ["en_espera", "en_servicio"]).order("start_time").limit(30),
    sb.from("payment_methods").select("key,label"),
  ]);
  const label = new Map((methods ?? []).map((m) => [m.key, m.label]));
  const canRefund = allowed(s.role, "voidOrRefund");
  const totalOwed = (owed ?? []).reduce((t: number, v: any) => t + Number(v.total) - v.payments.filter((p: any) => p.status === "pagado").reduce((a: number, p: any) => a + Number(p.amount), 0), 0);
  return (
    <>
      <LiveRefresh tables={["payments", "sales"]} />
      <PageHead title="Cobros" sub={`Saldo pendiente por cobrar: ${money(totalOwed)}`} />
      <div className={u.cols2}>
        <section className={u.card}>
          <h2>Pendientes por cobrar</h2>
          {(!owed?.length && !open?.length) ? <EmptyState title="Todo cobrado" text="No hay ventas con saldo ni citas en curso." /> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
              {(open ?? []).map((a: any) => (
                <li key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <Link className={u.link} href={`/admin/appointments/${a.id}`}>{a.client.first_name} {a.client.last_name} · {fmtTime(a.start_time)}</Link>
                  <span className={u.sub}>En curso — cobrar desde la cita</span>
                </li>
              ))}
              {(owed ?? []).map((v: any) => {
                const paid = v.payments.filter((p: any) => p.status === "pagado").reduce((t: number, p: any) => t + Number(p.amount), 0);
                return (
                  <li key={v.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <Link className={u.link} href={`/admin/sales/${v.id}`}>{v.sale_number} · {v.client?.first_name ?? "Mostrador"}</Link>
                    <span><PayBadge status={v.payment_status} /> debe <strong>{money(Number(v.total) - paid)}</strong></span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className={u.card}>
          <h2>Últimos pagos</h2>
          {!pays?.length ? <EmptyState title="Sin pagos" /> : (
            <div className={u.tableWrap}>
              <table className={u.table}>
                <thead><tr><th>Fecha</th><th>Venta</th><th>Método</th><th className={u.num}>Monto</th><th><span className="sr-only">Acciones</span></th></tr></thead>
                <tbody>
                  {pays.map((p: any) => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.paid_at, { day: "numeric", month: "short" })} {fmtTime(p.paid_at)}</td>
                      <td>{p.sale ? <Link className={u.link} href={`/admin/sales/${p.sale.id}`}>{p.sale.sale_number}</Link> : <Link className={u.link} href={`/admin/appointments/${p.appointment_id}`}>Cita</Link>}</td>
                      <td>{label.get(p.method) ?? p.method}{p.reference && <div className={u.hint}>{p.reference}</div>}{p.status === "reembolsado" && <span className={`${u.badge} ${u.gray}`} style={{ marginLeft: 6 }}>Reembolsado</span>}</td>
                      <td className={u.num}>{money(p.amount)}</td>
                      <td>{canRefund && p.status === "pagado" && !p.sale?.voided_at && <RefundButton paymentId={p.id} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
