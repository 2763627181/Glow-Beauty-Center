import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/admin/LiveRefresh";
import { PageHead, PayBadge } from "@/components/admin/primitives";
import r from "@/components/admin/sales/sales.module.css";
import { SaleActions } from "@/components/admin/sales/SaleActions";
import u from "@/components/admin/ui.module.css";
import { RefundButton } from "@/components/admin/sales/RefundButton";
import { requireAccess } from "@/lib/auth";
import { getSettings } from "@/lib/data/catalog";
import { fmtDate, fmtTime, money } from "@/lib/format";
import { allowed } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Venta" };
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function SalePage({ params }: PageProps<"/admin/sales/[id]">) {
  const session = await requireAccess("sales");
  const { id } = await params;
  const sb = await createClient();
  const [{ data: s }, { data: methods }] = await Promise.all([
    sb.from("sales").select("*, client:clients(id,first_name,last_name,phone), employee:employees(full_name), sale_items(*, employee:employees(full_name)), payments(*)").eq("id", id).maybeSingle(),
    sb.from("payment_methods").select("key,label"),
  ]);
  if (!s) notFound();
  const settings = await getSettings();
  const label = new Map((methods ?? []).map((m) => [m.key, m.label]));
  const paid = (s.payments as any[]).filter((p) => p.status === "pagado").reduce((t, p) => t + Number(p.amount), 0);
  const pending = Math.max(Number(s.total) - paid, 0);
  const voided = !!s.voided_at;

  return (
    <>
      <LiveRefresh tables={["payments", "sales"]} />
      <PageHead title={s.sale_number} sub={`${fmtDate(s.completed_at, { day: "numeric", month: "long", year: "numeric" })} · ${fmtTime(s.completed_at)}`}>
        <PayBadge status={s.payment_status} />
        {voided && <span className={`${u.badge} ${u.red}`}>Anulada</span>}
        {s.appointment_id && <Link className={u.link} href={`/admin/appointments/${s.appointment_id}`}>Ver cita</Link>}
      </PageHead>
      <div style={{ marginBottom: 16 }}><SaleActions saleId={s.id} pending={pending} voided={voided} notes={s.notes ?? ""} /></div>
      <section className={`${u.card} ${r.receipt}`}>
        <div className={r.biz}><strong>{settings.business.name}</strong>{settings.business.address && <span className={u.sub}>{settings.business.address}</span>}</div>
        <p className={u.sub}>Cliente: {s.client ? `${s.client.first_name} ${s.client.last_name}` : "Mostrador"}{s.employee?.full_name ? ` · Atendió: ${s.employee.full_name}` : ""}</p>
        {(s.sale_items as any[]).map((i) => (
          <div key={i.id} className={r.row}><span>{i.description}{i.quantity > 1 && ` ×${i.quantity}`}{i.employee?.full_name && <span className={u.sub}> · {i.employee.full_name}</span>}</span><span>{money(i.total)}</span></div>
        ))}
        <div className={r.row}><span>Subtotal</span><span>{money(s.subtotal)}</span></div>
        {Number(s.discount) > 0 && <div className={r.row}><span>Descuento</span><span>−{money(s.discount)}</span></div>}
        {Number(s.tip) > 0 && <div className={r.row}><span>Propina</span><span>{money(s.tip)}</span></div>}
        <div className={`${r.row} ${r.total}`}><span>Total</span><span>{money(s.total)}</span></div>
        <h2 style={{ marginTop: 16, fontSize: "1.1rem" }}>Pagos</h2>
        {(s.payments as any[]).length === 0 ? <p className={u.sub}>Sin pagos registrados.</p> : (s.payments as any[]).map((p) => (
          <div key={p.id} className={r.row}>
            <span>{label.get(p.method) ?? p.method}{p.reference && ` · ${p.reference}`}{p.status === "reembolsado" && " (reembolsado)"} <span className={u.sub}>{fmtDate(p.paid_at, { day: "numeric", month: "short" })}</span>{p.tendered != null && Number(p.tendered) > Number(p.amount) && <span className={u.sub}> · recibido {money(p.tendered)} · vuelto {money(Number(p.tendered) - Number(p.amount))}</span>}</span>
            <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
              {money(p.amount)}
              {!voided && p.status === "pagado" && allowed(session.role, "voidOrRefund") && <span className={r.noprint}><RefundButton paymentId={p.id} /></span>}
            </span>
          </div>
        ))}
        <div className={r.row}><span>Pagado</span><span>{money(paid)}</span></div>
        {!voided && pending > 0 && <div className={r.row}><span>Pendiente</span><strong>{money(pending)}</strong></div>}
        {voided && <p style={{ color: "var(--color-danger)" }}><strong>VENTA ANULADA</strong>{s.void_reason ? `: ${s.void_reason}` : ""}</p>}
        {s.notes && <p className={u.sub}>Notas: {s.notes}</p>}
        <p className={u.sub} style={{ textAlign: "center", marginTop: 12 }}>¡Gracias por visitarnos! ✨</p>
      </section>
    </>
  );
}
