"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { changePaymentMethod } from "@/lib/actions/admin/cash";
import { money } from "@/lib/format";
import { useAdmin } from "../AdminContext";
import { Alert } from "../primitives";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";

/** Corrige el método de un cobro ya registrado (por ejemplo, una tarjeta que se guardó como efectivo). Queda en Auditoría. */
export function ChangeMethodModal({ payment, who, onClose }: { payment: { id: string; amount: number; method: string }; who?: string | null; onClose: () => void }) {
  const { paymentMethods } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const current = paymentMethods.find((m) => m.key === payment.method);
  const options = paymentMethods.filter((m) => m.key !== payment.method);
  const [method, setMethod] = useState(options[0]?.key ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const target = options.find((m) => m.key === method);
  const effect = !current || !target ? null
    : current.isCash && !target.isCash ? `Sale del efectivo de la caja: el efectivo que debe haber baja ${money(payment.amount)} (se cobró aparte, con ${target.label.toLowerCase()}).`
    : !current.isCash && target.isCash ? `Entra al efectivo de la caja: el efectivo que debe haber sube ${money(payment.amount)}.`
    : "No cambia el efectivo de la caja.";
  return (
    <Modal open onClose={onClose} title="Cambiar método de pago">
      <form className={u.grid} onSubmit={(e) => {
        e.preventDefault(); setError(null);
        if (!method) return setError("Elige el método de pago correcto.");
        start(async () => {
          const r = await changePaymentMethod(payment.id, method, reason.trim() || undefined);
          if (!r.ok) return setError(r.error);
          toast(`Cobro de ${money(r.amount)} pasado a ${target?.label ?? "otro método"}`); router.refresh(); onClose();
        });
      }}>
        <p>Cobro de <strong>{money(payment.amount)}</strong>{who ? <> de <strong>{who}</strong></> : null}, registrado como <strong>{current?.label ?? payment.method}</strong>.</p>
        <div className={u.field}>
          <label htmlFor="cm-method">¿Con qué método se pagó en realidad?</label>
          <select id="cm-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {options.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          {effect && <span className={u.hint}>{effect}</span>}
        </div>
        <div className={u.field}><label htmlFor="cm-reason">Motivo (opcional)</label><textarea id="cm-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: se registró como efectivo pero fue con tarjeta" /></div>
        {error && <Alert>{error}</Alert>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Volver</Button>
          <Button type="submit" disabled={busy || !method}>{busy ? "Guardando…" : "Cambiar método"}</Button>
        </div>
      </form>
    </Modal>
  );
}
