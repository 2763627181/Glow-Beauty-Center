"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { addPayment, setAppointmentStatus, updateAppointment } from "@/lib/actions/admin/appointments";
import type { ApptRow } from "@/lib/data/appointments";
import { money } from "@/lib/format";
import { useAdmin } from "../AdminContext";
import { Alert } from "../primitives";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";
import { linesFromAppt, linesToPayload, subtotalOf, validateLines } from "./lines";
import { LinesEditor } from "./LinesEditor";
import { newPayRow, PaymentRows, type PayRow } from "../sales/PaymentRows";


/** Cobro de una cita: ajustar servicios/precios, descuento, propina, dividir el pago y (opcional) completar la cita. */
export function PaymentModal({ appt, onClose, onDone, completeByDefault = true }: { appt: ApptRow; onClose: () => void; onDone: () => void; completeByDefault?: boolean }) {
  const { paymentMethods } = useAdmin();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [lines, setLines] = useState(() => linesFromAppt(appt.services));
  const [discount, setDiscount] = useState(String(appt.discount || ""));
  const [tip, setTip] = useState(String(appt.tip || ""));
  const [pays, setPays] = useState<PayRow[]>([newPayRow(paymentMethods[0].key)]);
  const [complete, setComplete] = useState(completeByDefault);
  const [overpay, setOverpay] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = useMemo(() => subtotalOf(lines), [lines]);
  const total = subtotal - (Number(discount) || 0) + (Number(tip) || 0);
  const pendingAmt = Math.max(total - appt.paid, 0);
  const entered = pays.reduce((t, p) => t + (Number(p.amount) || 0), 0);
  const over = entered > pendingAmt + 0.001;

  function submit() {
    setError(null);
    const bad = validateLines(lines) ?? (total < 0 ? "El total no puede ser negativo." : null) ?? ((Number(discount) || 0) > subtotal ? "El descuento no puede superar el subtotal." : null);
    if (bad) return setError(bad);
    if (over && !overpay) return setError("El pago supera lo pendiente. Marca la casilla para confirmar el sobrepago.");
    start(async () => {
      const r = await updateAppointment(appt.id, { lines: linesToPayload(lines), discount: Number(discount) || 0, tip: Number(tip) || 0 });
      if (!r.ok) return setError(r.error);
      // Cada pago registrado sale de la lista: si algo falla después, reintentar NO cobra dos veces.
      for (const p of pays.filter((x) => Number(x.amount) > 0)) {
        const pr = await addPayment(appt.id, { amount: Number(p.amount), method: p.method, reference: p.reference || undefined, allowOverpay: overpay });
        if (!pr.ok) return setError(`${pr.error}${pays.length > 1 ? " Los pagos anteriores ya quedaron registrados." : ""}`);
        setPays((x) => (x.length > 1 ? x.filter((y) => y.id !== p.id) : [{ ...x[0], amount: "", reference: "" }]));
      }
      if (complete) {
        const c = await setAppointmentStatus(appt.id, "completado");
        if (!c.ok) return setError(`${c.error} (el cobro ya quedó registrado)`);
        toast(`Cita completada · venta ${c.saleNumber}`);
      } else toast(entered > 0 ? "Cobro registrado" : "Cambios guardados");
      onDone();
      onClose();
    });
  }

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
          {appt.paid > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Ya pagado</span><span>{money(appt.paid)}</span></div>}
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Pendiente</span><strong>{money(pendingAmt)}</strong></div>
        </div>

        <PaymentRows rows={pays} onChange={setPays} pending={pendingAmt} />

        {over && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={overpay} onChange={(e) => setOverpay(e.target.checked)} /> Confirmo el pago mayor al pendiente ({money(entered - pendingAmt)} de más)</label>}
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} /> Completar la cita y generar la venta</label>
        {error && <Alert>{error}</Alert>}
        <Button block onClick={submit} disabled={pending || lines.length === 0}>{pending ? "Procesando…" : entered > 0 ? `Cobrar ${money(entered)}` : complete ? "Completar sin cobro" : "Guardar"}</Button>
      </div>
    </Modal>
  );
}
