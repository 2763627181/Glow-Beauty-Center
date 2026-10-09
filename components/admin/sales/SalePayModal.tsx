"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { addSalePayment } from "@/lib/actions/admin/appointments";
import { money } from "@/lib/format";
import { useAdmin } from "../AdminContext";
import { Alert } from "../primitives";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";
import { ChangeCard } from "./ChangeCard";
import { CASH_CLOSED_MSG, newPayRow, PaymentRows, usePaymentPlan, type PayRow } from "./PaymentRows";

/** Cobrar el saldo de una venta: efectivo con vuelto, o tarjeta/transferencia que se cobra aparte y aquí solo se registra. */
export function SalePayModal({ saleId, pending: due, onClose, onDone }: { saleId: string; pending: number; onClose: () => void; onDone: () => void }) {
  const { paymentMethods } = useAdmin();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [pays, setPays] = useState<PayRow[]>([newPayRow(paymentMethods[0].key, String(due))]);
  const [settled, setSettled] = useState(0);
  const [overpay, setOverpay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ charged: number; change: number } | null>(null);

  const pending = Math.max(Math.round((due - settled) * 100) / 100, 0);
  const plan = usePaymentPlan(pays, pending);
  const { tender } = plan;
  const over = tender.overNonCash > 0.004;

  function submit() {
    setError(null);
    if (plan.items.length === 0) return setError("Escribe cuánto se cobra.");
    if (plan.cashBlocked) return setError(CASH_CLOSED_MSG);
    if (over && !overpay) return setError("La tarjeta o transferencia supera el saldo. Marca la casilla para confirmar el sobrepago.");
    const items = plan.items, change = tender.change;
    start(async () => {
      let charged = 0;
      for (const it of items) {
        const r = await addSalePayment(saleId, { amount: it.amount, method: it.method, reference: it.reference, tendered: it.tendered, allowOverpay: overpay });
        if (!r.ok) return setError(`${r.error}${items.length > 1 ? " Los pagos anteriores ya quedaron registrados." : ""}`);
        charged += it.amount;
        setSettled((s) => Math.round((s + it.amount) * 100) / 100);
        setPays((x) => (x.length > 1 ? x.filter((y) => y.id !== it.rowId) : [{ ...x[0], amount: "", reference: "" }]));
      }
      toast("Pago registrado");
      onDone();
      if (change > 0) setDone({ charged, change }); else onClose();
    });
  }

  if (done) {
    return (
      <Modal open onClose={onClose} title="Pago registrado">
        <ChangeCard charged={done.charged} change={done.change} label="Pago cobrado" onClose={onClose} />
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title="Registrar pago" wide>
      <div className={u.grid}>
        <PaymentRows rows={pays} onChange={setPays} pending={pending} plan={plan} />
        {over && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={overpay} onChange={(e) => setOverpay(e.target.checked)} /> Confirmo el pago mayor al saldo ({money(tender.overNonCash)} de más)</label>}
        {error && !(error === CASH_CLOSED_MSG && !plan.cashBlocked) && <Alert>{error}</Alert>}
        <Button block disabled={busy || tender.applied <= 0} onClick={submit}>{busy ? "Registrando…" : `Registrar pago${tender.applied > 0 ? ` de ${money(tender.applied)}` : ""}${tender.change > 0 ? ` · vuelto ${money(tender.change)}` : ""}`}</Button>
      </div>
    </Modal>
  );
}
