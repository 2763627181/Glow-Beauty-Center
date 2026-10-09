"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { addPayment, setAppointmentStatus, updateAppointment } from "@/lib/actions/admin/appointments";
import type { ApptRow } from "@/lib/data/appointments";
import { money } from "@/lib/format";
import { Alert } from "../primitives";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";
import { linesFromAppt, linesToPayload, subtotalOf, validateLines } from "./lines";
import { LinesEditor } from "./LinesEditor";
import { ChangeCard } from "../sales/ChangeCard";
import { CASH_CLOSED_MSG, newPayRow, PaymentRows, usePaymentPlan, type PayRow } from "../sales/PaymentRows";
import { useAdmin } from "../AdminContext";

/** Cobro de una cita: ajustar servicios/precios, descuento, propina, cobrar (efectivo con vuelto, o tarjeta/transferencia que se cobra aparte) y (opcional) completar la cita. */
export function PaymentModal({ appt, onClose, onDone, completeByDefault = true }: { appt: ApptRow; onClose: () => void; onDone: () => void; completeByDefault?: boolean }) {
  const { paymentMethods } = useAdmin();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [lines, setLines] = useState(() => linesFromAppt(appt.services));
  const [discount, setDiscount] = useState(String(appt.discount || ""));
  const [tip, setTip] = useState(String(appt.tip || ""));
  const [pays, setPays] = useState<PayRow[]>([newPayRow(paymentMethods[0].key)]);
  const [settled, setSettled] = useState(0); // ya cobrado en esta ventana (por si un pago falla a medias y se reintenta)
  const [complete, setComplete] = useState(completeByDefault);
  const [overpay, setOverpay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ charged: number; change: number } | null>(null);

  const subtotal = useMemo(() => subtotalOf(lines), [lines]);
  const total = subtotal - (Number(discount) || 0) + (Number(tip) || 0);
  const pendingAmt = Math.max(Math.round((total - appt.paid - settled) * 100) / 100, 0);
  const plan = usePaymentPlan(pays, pendingAmt);
  const { tender } = plan;
  const over = tender.overNonCash > 0.004;

  function finish(charged: number, change: number) {
    onDone();
    if (change > 0) setDone({ charged, change });
    else onClose();
  }

  function submit() {
    setError(null);
    const bad = validateLines(lines) ?? (total < 0 ? "El total no puede ser negativo." : null) ?? ((Number(discount) || 0) > subtotal ? "El descuento no puede superar el subtotal." : null);
    if (bad) return setError(bad);
    if (plan.cashBlocked) return setError(CASH_CLOSED_MSG);
    if (over && !overpay) return setError("La tarjeta o transferencia supera lo pendiente. Marca la casilla para confirmar el sobrepago.");
    const items = plan.items, change = tender.change;
    start(async () => {
      const r = await updateAppointment(appt.id, { lines: linesToPayload(lines), discount: Number(discount) || 0, tip: Number(tip) || 0 });
      if (!r.ok) return setError(r.error);
      // Cada pago registrado sale de la lista: si algo falla después, reintentar NO cobra dos veces.
      let charged = 0;
      for (const it of items) {
        const pr = await addPayment(appt.id, { amount: it.amount, method: it.method, reference: it.reference, tendered: it.tendered, allowOverpay: overpay });
        if (!pr.ok) return setError(`${pr.error}${items.length > 1 ? " Los pagos anteriores ya quedaron registrados." : ""}`);
        charged += it.amount;
        setSettled((s) => Math.round((s + it.amount) * 100) / 100);
        setPays((x) => (x.length > 1 ? x.filter((y) => y.id !== it.rowId) : [{ ...x[0], amount: "", reference: "" }]));
      }
      if (complete) {
        const c = await setAppointmentStatus(appt.id, "completado");
        if (!c.ok) return setError(`${c.error} (el cobro ya quedó registrado)`);
        toast(`Cita completada · venta ${c.saleNumber}`);
      } else toast(charged > 0 ? "Cobro registrado" : "Cambios guardados");
      finish(charged, change);
    });
  }

  if (done) {
    return (
      <Modal open onClose={onClose} title="Cobro registrado">
        <ChangeCard charged={done.charged} change={done.change} onClose={onClose} />
      </Modal>
    );
  }

  const label = tender.applied > 0 ? `Cobrar ${money(tender.applied)}${tender.change > 0 ? ` · vuelto ${money(tender.change)}` : ""}` : complete ? "Completar sin cobro" : "Guardar";
  return (
    <Modal open onClose={onClose} title={`Cobrar · ${appt.client.first_name}`} wide>
      <div className={u.grid}>
        <LinesEditor lines={lines} onChange={setLines} showStaff={false} showOrder={false} lockedTimed />

        <div className={u.form2}>
          <div className={u.field}><label htmlFor="disc">Descuento (RD$)</label><input id="disc" type="number" step="any" min={0} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          <div className={u.field}><label htmlFor="tip">Propina (RD$)</label><input id="tip" type="number" step="any" min={0} inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} /></div>
        </div>

        <div className={u.card} style={{ background: "var(--color-cream)" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal</span><span>{money(subtotal)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "1.2rem" }}><span>Total</span><span>{money(total)}</span></div>
          {appt.paid + settled > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Ya pagado</span><span>{money(appt.paid + settled)}</span></div>}
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Pendiente</span><strong>{money(pendingAmt)}</strong></div>
        </div>

        <PaymentRows rows={pays} onChange={setPays} pending={pendingAmt} plan={plan} />

        {over && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={overpay} onChange={(e) => setOverpay(e.target.checked)} /> Confirmo el pago mayor al pendiente ({money(tender.overNonCash)} de más)</label>}
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} /> Completar la cita y generar la venta</label>
        {error && !(error === CASH_CLOSED_MSG && !plan.cashBlocked) && <Alert>{error}</Alert>}
        <Button block onClick={submit} disabled={pending || lines.length === 0}>{pending ? "Procesando…" : label}</Button>
      </div>
    </Modal>
  );
}
