"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { voidCashMovement } from "@/lib/actions/admin/cash";
import type { CashSessionRow, LooseCash, OwedSale } from "@/lib/data/cash";
import type { ApptRow } from "@/lib/data/appointments";
import { apptTotal } from "@/lib/data/appointment-math";
import { MOVE_LABEL, type CashMovement, type CashReport, type ProductionRow } from "@/lib/domain/cash";
import { serviceNames } from "@/lib/domain/serviceLines";
import { fmtDate, fmtDateTime, fmtTime, money } from "@/lib/format";
import { useAdmin, useCan } from "../AdminContext";
import { PaymentModal } from "../appointments/PaymentModal";
import { Alert, EmptyState, StatusBadge } from "../primitives";
import { QuickSale } from "../sales/QuickSale";
import { SalePayModal } from "../sales/SalePayModal";
import u from "../ui.module.css";
import c from "./cash.module.css";
import { CloseCashModal } from "./CloseCashModal";
import { MovementModal, type MovementPreset } from "./MovementModal";
import { OpenCashModal } from "./OpenCashModal";
import { ReasonModal } from "./ReasonModal";
import { MethodsTable, ProductionTable, Timeline } from "./ReportSections";
import { SessionsTable } from "./SessionsTable";

type Dialog =
  | { type: "open" } | { type: "close" }
  | { type: "move"; kind: "entrada" | "salida"; preset?: MovementPreset }
  | { type: "pay"; appt: ApptRow } | { type: "salepay"; sale: OwedSale }
  | { type: "void"; movement: CashMovement };

/** La caja: abrir y cerrar el turno, cobrar lo pendiente, registrar entradas y salidas de efectivo y ver la producción de cada especialista. */
export function CashDesk({ report, queue, sessions, loose }: { report: CashReport | null; queue: { appointments: ApptRow[]; sales: OwedSale[] }; sessions: CashSessionRow[]; loose: LooseCash }) {
  const { cash } = useAdmin();
  const canManage = useCan("manageCash");
  const canVoid = useCan("voidCash");
  const canCharge = useCan("charge");
  const [modal, setModal] = useState<Dialog | null>(null);
  const close = () => setModal(null);
  const t = report?.totals;
  const aside = report ? report.methods.filter((m) => !m.is_cash).reduce((s, m) => s + m.total - m.refunded, 0) : 0;

  return (
    <div className={c.stack}>
      <section className={`${u.card} ${c.status}`} aria-label="Estado de la caja">
        <div>
          <h2><span className={`${c.dot} ${report ? "" : c.dotOff}`} aria-hidden />{report ? `Caja abierta · ${report.session.number}` : "La caja está cerrada"}</h2>
          <p className={u.sub}>
            {report
              ? `Desde ${fmtDateTime(report.session.opened_at)}${report.session.opened_by ? ` · la abrió ${report.session.opened_by}` : ""}`
              : cash.lastCounted != null ? `En el último cierre se contaron ${money(cash.lastCounted)}.` : "Abre la caja para cobrar en efectivo y llevar el control del dinero."}
          </p>
        </div>
        <div className={u.rowActions}>
          <QuickSale />
          {canManage && report && <>
            <Button size="sm" variant="secondary" onClick={() => setModal({ type: "move", kind: "salida" })}>Salida de efectivo</Button>
            <Button size="sm" variant="secondary" onClick={() => setModal({ type: "move", kind: "entrada" })}>Entrada de efectivo</Button>
            <Button size="sm" variant="danger" onClick={() => setModal({ type: "close" })}>Cerrar caja</Button>
          </>}
          {canManage && !report && <Button size="sm" onClick={() => setModal({ type: "open" })}>Abrir caja</Button>}
        </div>
      </section>

      {loose.count > 0 && (
        <section className={u.card} aria-labelledby="cash-loose">
          <h2 id="cash-loose">Efectivo cobrado fuera de la caja</h2>
          <Alert kind="warn">Se cobraron {money(loose.total)} en efectivo ({loose.count} {loose.count === 1 ? "cobro" : "cobros"}) mientras la caja estaba cerrada. No están en ningún cierre: cuéntalos con el fondo inicial al abrir la caja.</Alert>
          <ul className={c.list} style={{ marginTop: 10 }}>
            {loose.items.slice(0, 6).map((i) => (
              <li key={i.id} className={c.item}>
                <div>{i.sale_id ? <Link className={u.link} href={`/admin/sales/${i.sale_id}`}>{i.sale_number}</Link> : "Cobro de cita"}{i.client ? ` · ${i.client}` : ""}<small>{fmtDateTime(i.paid_at)}</small></div>
                <strong>{money(i.amount)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report && t && (
        <div className={u.kpis}>
          <div className={`${u.card} ${u.stat}`}><span>Fondo inicial</span><strong>{money(t.opening)}</strong></div>
          <div className={`${u.card} ${u.stat}`}><span>Efectivo cobrado</span><strong>{money(t.cash_in)}</strong><small>{t.cash_refunds > 0 ? `Reembolsado ${money(t.cash_refunds)}` : "El vuelto ya está descontado"}</small></div>
          <div className={`${u.card} ${u.stat}`}><span>Salidas</span><strong>{money(t.salidas)}</strong></div>
          <div className={`${u.card} ${u.stat}`}><span>Entradas</span><strong>{money(t.entradas)}</strong></div>
          <div className={`${u.card} ${u.stat} ${c.expected}`}><span>Efectivo que debe haber</span><strong>{money(t.expected)}</strong></div>
          <div className={`${u.card} ${u.stat}`}><span>Tarjeta y transferencia</span><strong>{money(aside)}</strong><small>Cobrado aparte; solo se registra</small></div>
        </div>
      )}

      <section className={u.card} aria-labelledby="cash-queue">
        <h2 id="cash-queue">Por cobrar</h2>
        {!queue.appointments.length && !queue.sales.length ? <EmptyState title="Todo cobrado" text="No hay citas de hoy ni ventas con saldo." /> : (
          <ul className={c.list}>
            {queue.appointments.map((a) => {
              const total = apptTotal(a), owed = Math.max(total - a.paid, 0);
              return (
                <li key={a.id} className={c.item}>
                  <div>
                    <strong><Link className={u.link} href={`/admin/appointments/${a.id}`}>{fmtTime(a.start_time)} · {a.client.first_name} {a.client.last_name}</Link></strong>
                    <small>{serviceNames(a.services).join(", ") || "Sin servicios"}</small>
                  </div>
                  <div className={c.right}>
                    <StatusBadge status={a.status} />
                    <span>{money(total)}{a.paid > 0 && <small> · pagado {money(a.paid)}</small>}</span>
                    {canCharge && <Button size="sm" onClick={() => setModal({ type: "pay", appt: a })} aria-label={`Cobrar a ${a.client.first_name} ${a.client.last_name}`}>{owed > 0 ? `Cobrar ${money(owed)}` : "Completar"}</Button>}
                  </div>
                </li>
              );
            })}
            {queue.sales.map((s) => (
              <li key={s.id} className={c.item}>
                <div>
                  <strong><Link className={u.link} href={`/admin/sales/${s.id}`}>{s.sale_number} · {s.client}</Link></strong>
                  <small>Venta del {fmtDate(s.completed_at, { day: "numeric", month: "short" })}</small>
                </div>
                <div className={c.right}>
                  <span>Debe <strong>{money(Math.max(s.total - s.paid, 0))}</strong> de {money(s.total)}</span>
                  {canCharge && <Button size="sm" onClick={() => setModal({ type: "salepay", sale: s })} aria-label={`Cobrar saldo de ${s.sale_number}`}>Cobrar saldo</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {report && (
        <>
          <section className={u.card} aria-labelledby="cash-moves">
            <h2 id="cash-moves">Movimientos del turno</h2>
            <Timeline report={report} onVoid={canVoid ? (m) => setModal({ type: "void", movement: m }) : undefined} />
          </section>
          <div className={u.cols2}>
            <section className={u.card} aria-labelledby="cash-prod">
              <h2 id="cash-prod">Producción por especialista</h2>
              <ProductionTable rows={report.production} onPay={canManage ? (r: ProductionRow, toPay) => setModal({ type: "move", kind: "salida", preset: { category: "pago_especialista", employeeId: r.employee_id ?? undefined, amount: Math.min(toPay, t?.expected ?? toPay) } }) : undefined} />
            </section>
            <section className={u.card} aria-labelledby="cash-methods">
              <h2 id="cash-methods">Cobrado por método</h2>
              <MethodsTable methods={report.methods} />
            </section>
          </div>
        </>
      )}

      <section className={u.card} aria-labelledby="cash-history">
        <h2 id="cash-history">Cierres anteriores</h2>
        <SessionsTable sessions={sessions.filter((s) => s.closed_at)} />
      </section>

      {modal?.type === "open" && <OpenCashModal suggested={cash.lastCounted} onClose={close} />}
      {modal?.type === "close" && t && <CloseCashModal totals={t} onClose={close} />}
      {modal?.type === "move" && t && <MovementModal kind={modal.kind} expected={t.expected} preset={modal.preset} onClose={close} />}
      {modal?.type === "pay" && <PaymentModal appt={modal.appt} onClose={close} onDone={() => { /* la pantalla se actualiza sola al registrar */ }} completeByDefault={modal.appt.status !== "confirmado"} />}
      {modal?.type === "salepay" && <SalePayModal saleId={modal.sale.id} pending={Math.max(modal.sale.total - modal.sale.paid, 0)} onClose={close} onDone={() => { /* ídem */ }} />}
      {modal?.type === "void" && (
        <ReasonModal title="Anular movimiento" confirmLabel="Anular movimiento" danger doneMessage="Movimiento anulado" onClose={close}
          text={`Se anula ${MOVE_LABEL[modal.movement.category].toLowerCase()} por ${money(modal.movement.amount)} y ${modal.movement.kind === "salida" ? "el dinero vuelve" : "el dinero sale"} de la caja. Queda en Auditoría y no se puede deshacer.`}
          run={(reason) => voidCashMovement(modal.movement.id, reason)} />
      )}
    </div>
  );
}
