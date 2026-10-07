import { groupLines } from "@/lib/domain/serviceLines";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NoteForm } from "@/components/admin/appointments/NoteForm";
import { OpenActions } from "@/components/admin/appointments/OpenActions";
import { LiveRefresh } from "@/components/admin/LiveRefresh";
import { PageHead, PayBadge, StatusBadge } from "@/components/admin/primitives";
import { RefundButton } from "@/components/admin/sales/RefundButton";
import u from "@/components/admin/ui.module.css";
import { requireAccess } from "@/lib/auth";
import { apptTotal, getAppointment } from "@/lib/data/appointments";
import { STATUS_META, SOURCE_LABEL } from "@/lib/domain/status";
import { fmtDate, fmtDateTime, fmtTime, money } from "@/lib/format";
import { allowed } from "@/lib/permissions";
import type { AppointmentStatus } from "@/types/domain";

export const metadata = { title: "Cita" };
const when = fmtDateTime;

export default async function AppointmentPage({ params }: PageProps<"/admin/appointments/[id]">) {
  const s = await requireAccess("appointments");
  const { id } = await params;
  const d = await getAppointment(id);
  if (!d) notFound();
  const { appt: a } = d;
  const money$ = allowed(s.role, "seeMoney");
  return (
    <>
      <LiveRefresh />
      <PageHead title={`${a.client.first_name} ${a.client.last_name}`} sub={`${a.request_number} · ${SOURCE_LABEL[a.source]}`}>
        <StatusBadge status={a.status} />
        <OpenActions appt={a} />
      </PageHead>
      <div className={u.cols2}>
        <section className={u.card}>
          <h2>Cita</h2>
          <p><strong>{fmtDate(a.start_time, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong><br />
            {fmtTime(a.start_time)} – {fmtTime(a.end_time)} · {a.employees.length ? a.employees.map((e) => e.name).join(" + ") : "Sin asignar"}</p>
          <ul style={{ display: "grid", gap: 4 }}>
            {groupLines(a.services).map((g) => (
              <li key={g.key}>{g.name}{g.quantity > 1 && ` ×${g.quantity}`}{money$ && ` — ${money(g.price * g.quantity)}`}
                <span className={u.sub}> · {g.employees.length ? g.employees.join(" + ") : "Sin asignar"}{g.lines[0].start_time ? ` · ${fmtTime(g.lines[0].start_time)}–${fmtTime(g.lines[0].end_time!)}` : ""}</span></li>
            ))}
          </ul>
          {a.discount > 0 && money$ && <p>Descuento: −{money(a.discount)}</p>}
          {a.tip > 0 && money$ && <p>Propina: {money(a.tip)}</p>}
          {money$ && <p><strong>Total: {money(apptTotal(a))}</strong></p>}
          <p className={u.sub}>Teléfono {a.client.phone} · {s.role !== "specialist" && <Link className={u.link} href={`/admin/clients/${a.client_id}`}>Ver cliente</Link>}</p>
          {a.notes && <p className={u.sub}>Nota del cliente: {a.notes}</p>}
        </section>
        {money$ && (
          <section className={u.card}>
            <h2>Cobros</h2>
            {d.sale && <p>Venta <Link className={u.link} href={`/admin/sales/${d.sale.id}`}>{d.sale.sale_number}</Link> <PayBadge status={d.sale.payment_status} />{d.sale.voided_at && " · anulada"}</p>}
            {d.payments.length === 0 ? <p className={u.sub}>Sin pagos registrados.</p> : (
              <ul style={{ display: "grid", gap: 8, listStyle: "none", padding: 0 }}>
                {d.payments.map((p) => (
                  <li key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <span>{money(p.amount)} · {p.method}{p.status === "reembolsado" && " (reembolsado)"} · {when(p.paid_at)}</span>
                    {allowed(s.role, "voidOrRefund") && p.status === "pagado" && <RefundButton paymentId={p.id} />}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <section className={u.card}>
          <h2>Historial de estados</h2>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {d.history.map((h) => (<li key={h.id}>{when(h.changed_at)} · {STATUS_META[h.new_status as AppointmentStatus].label}</li>))}
          </ol>
        </section>
        <section className={u.card}>
          <h2>Notas internas</h2>
          <NoteForm appointmentId={a.id} />
          <ul style={{ paddingLeft: 18 }}>{d.notes.map((n) => <li key={n.id}>{n.note} <span className={u.sub}>· {when(n.created_at)}</span></li>)}</ul>
        </section>
      </div>
    </>
  );
}
