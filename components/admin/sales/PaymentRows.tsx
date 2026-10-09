"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { allocatePayments, round2, suggestTenders, type Tender } from "@/lib/domain/cash";
import { money } from "@/lib/format";
import { useAdmin } from "../AdminContext";
import { OpenCashModal } from "../cash/OpenCashModal";
import { Alert } from "../primitives";
import p from "./payment.module.css";

/**
 * Filas de pago de la caja.
 *  • Efectivo: se escribe lo que ENTREGÓ el cliente; el sistema calcula lo cobrado y el vuelto.
 *  • Tarjeta, transferencia y otros: se cobran aparte (datáfono o banco); aquí solo se registra cuánto fue, con su referencia.
 * `amount` es lo que se escribió (en efectivo = lo entregado; en los demás = lo cobrado).
 */
export type PayRow = { id: number; method: string; amount: string; reference: string };
let seq = 0;
export const newPayRow = (method: string, amount = ""): PayRow => ({ id: ++seq, method, amount, reference: "" });

/** Un pago listo para registrar: `amount` ya es lo que queda cobrado (el vuelto descontado) y `tendered` el efectivo entregado. */
export type PayItem = { rowId: number; method: string; amount: number; reference?: string; tendered?: number };
export type PaymentPlan = {
  tender: Tender;
  items: PayItem[];
  /** Hay efectivo por cobrar pero no hay caja abierta. */
  cashBlocked: boolean;
};

/** Calcula, para las filas escritas, lo que se cobra, el vuelto y los pagos que se enviarán. */
export function usePaymentPlan(rows: PayRow[], pending: number): PaymentPlan {
  const { paymentMethods, cash } = useAdmin();
  return useMemo(() => {
    const isCash = (m: string) => paymentMethods.find((x) => x.key === m)?.isCash ?? false;
    const tender = allocatePayments(rows.map((r) => ({ key: r.id, isCash: isCash(r.method), value: Number(r.amount) || 0 })), pending);
    const items: PayItem[] = rows.flatMap((r, i) => {
      const t = tender.rows[i];
      if (t.applied <= 0) return [];
      return [{ rowId: r.id, method: r.method, amount: t.applied, reference: r.reference.trim() || undefined, tendered: cash.ready && t.isCash && t.tendered ? t.tendered : undefined }];
    });
    const cashBlocked = cash.ready && !cash.open && tender.rows.some((t) => t.isCash && t.applied > 0);
    return { tender, items, cashBlocked };
  }, [rows, pending, paymentMethods, cash]);
}

export const CASH_CLOSED_MSG = "Para cobrar en efectivo primero abre la caja.";

export function PaymentRows({ rows, onChange, pending, plan }: { rows: PayRow[]; onChange: (r: PayRow[]) => void; pending: number; plan: PaymentPlan }) {
  const { paymentMethods, cash } = useAdmin();
  const uid = useId();
  const [openCashModal, setOpenCashModal] = useState(false);
  const set = (id: number, patch: Partial<PayRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const second = paymentMethods[Math.min(1, paymentMethods.length - 1)].key;
  const { tender } = plan;
  // lo que aún cabe en cada fila (para el atajo «exacto» y el ejemplo del campo)
  const rooms: number[] = [];
  for (let i = 0, room = Math.max(round2(pending - tender.nonCash), 0); i < rows.length; i++) {
    rooms.push(room);
    if (tender.rows[i].isCash) room = Math.max(round2(room - tender.rows[i].applied), 0);
  }
  const hasCash = tender.rows.some((t) => t.isCash);

  return (
    <fieldset className={p.rows}>
      <legend>Pagos (puedes dividirlos)</legend>
      {rows.map((r, i) => {
        const t = tender.rows[i];
        const id = `${uid}-${r.id}`;
        const typed = Number(r.amount) || 0;
        return (
          <div key={r.id} className={`${p.row} ${t.isCash ? p.cash : ""}`}>
            <div className={`${p.fields} ${!t.isCash ? p.fieldsRef : ""}`}>
              <div className={p.field}>
                <label htmlFor={`${id}-m`}>Método</label>
                <select id={`${id}-m`} value={r.method} onChange={(e) => set(r.id, { method: e.target.value })}>
                  {paymentMethods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              <div className={p.field}>
                <label htmlFor={`${id}-a`}>{t.isCash ? "El cliente entregó (RD$)" : "Monto cobrado (RD$)"}</label>
                <input id={`${id}-a`} type="number" step="any" min={0} inputMode="decimal" placeholder={String(rooms[i])} value={r.amount} onChange={(e) => set(r.id, { amount: e.target.value })} />
              </div>
              {!t.isCash && (
                <div className={p.field}>
                  <label htmlFor={`${id}-r`}>Referencia o aprobación (opcional)</label>
                  <input id={`${id}-r`} maxLength={80} value={r.reference} onChange={(e) => set(r.id, { reference: e.target.value })} />
                </div>
              )}
              {rows.length > 1 ? <Button size="sm" variant="secondary" onClick={() => onChange(rows.filter((y) => y.id !== r.id))} aria-label="Quitar este pago">✕</Button> : <span />}
            </div>

            {t.isCash ? (
              <>
                {rooms[i] > 0 && (
                  <div className={p.chips} role="group" aria-label="Montos rápidos de efectivo">
                    <span className={p.chipsLabel}>El cliente dio:</span>
                    {suggestTenders(rooms[i]).map((v, k) => (
                      <button key={v} type="button" className={p.chip} onClick={() => set(r.id, { amount: String(v) })}>{k === 0 ? `Exacto ${money(v)}` : money(v)}</button>
                    ))}
                  </div>
                )}
                {typed > 0 && (
                  <div className={p.result} aria-live="polite">
                    <span>Cobrado en efectivo: <strong>{money(t.applied)}</strong></span>
                    <span>Vuelto: <strong className={t.change > 0 ? p.changeNow : undefined}>{money(t.change)}</strong></span>
                  </div>
                )}
              </>
            ) : (
              <p className={p.note}>Se cobra aparte (datáfono o banco). Aquí solo se registra que se cobró {typed > 0 ? money(typed) : "este monto"}.</p>
            )}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button size="sm" variant="soft" onClick={() => onChange([...rows, newPayRow(second)])}>+ Dividir pago</Button>
        <Button size="sm" variant="secondary" onClick={() => onChange([newPayRow(rows[0]?.method ?? paymentMethods[0].key, String(pending))])}>Pagar todo ({money(pending)})</Button>
      </div>

      <div className={p.summary} aria-live="polite">
        <div className={p.line}><span>Por cobrar</span><strong>{money(pending)}</strong></div>
        {tender.cashReceived > 0 && <div className={p.line}><span>Efectivo recibido</span><span>{money(tender.cashReceived)}</span></div>}
        {tender.nonCash > 0 && <div className={p.line}><span>Tarjeta / transferencia (cobrado aparte)</span><span>{money(tender.nonCash)}</span></div>}
        <div className={p.line}><span>Se cobra ahora</span><strong>{money(tender.applied)}</strong></div>
        {hasCash && <div className={`${p.line} ${p.change} ${tender.change > 0 ? p.changeOn : ""}`}><span>Vuelto a entregar</span><span>{money(tender.change)}</span></div>}
        <div className={p.line}><span>Quedará pendiente</span><span>{money(tender.remaining)}</span></div>
      </div>

      {plan.cashBlocked && (
        <Alert kind="warn">
          {CASH_CLOSED_MSG}{" "}
          <Button size="sm" variant="secondary" onClick={() => setOpenCashModal(true)}>Abrir caja</Button>
        </Alert>
      )}
      {openCashModal && <OpenCashModal suggested={cash.lastCounted} onClose={() => setOpenCashModal(false)} />}
    </fieldset>
  );
}
