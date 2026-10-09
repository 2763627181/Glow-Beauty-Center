"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { openCash } from "@/lib/actions/admin/cash";
import { money } from "@/lib/format";
import { NumInput } from "../NumInput";
import { Alert } from "../primitives";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";

/** Abrir la caja: cuánto efectivo hay en la gaveta al empezar (fondo inicial). Sugiere lo que se contó al cerrar la vez anterior. */
export function OpenCashModal({ suggested, onClose, onDone }: { suggested: number | null; onClose: () => void; onDone?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState<number | null>(suggested);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (amount == null || amount < 0) return setError("Escribe cuánto efectivo hay en la caja (si no hay nada, escribe 0).");
    start(async () => {
      const r = await openCash({ opening: amount, note: note || undefined });
      if (!r.ok) return setError(r.error);
      toast(`Caja ${r.number} abierta con ${money(amount)}`);
      router.refresh();
      onDone?.();
      onClose();
    });
  }

  return (
    <Modal open onClose={onClose} title="Abrir caja">
      <form className={u.grid} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className={u.sub}>Cuenta el efectivo que hay en la gaveta ahora. Todo lo que se cobre en efectivo, y las entradas y salidas de dinero, se llevan desde este monto.</p>
        <div className={u.field}>
          <label htmlFor="oc-amount">Efectivo en la caja al abrir (RD$)</label>
          <NumInput id="oc-amount" min={0} value={amount} onValue={setAmount} aria-describedby="oc-hint" />
          <span id="oc-hint" className={u.hint}>{suggested != null ? `En el último cierre se contaron ${money(suggested)}.` : "Es el «fondo inicial» o sencillo para dar vuelto."}</span>
        </div>
        <div className={u.field}>
          <label htmlFor="oc-note">Nota (opcional)</label>
          <input id="oc-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" block disabled={pending}>{pending ? "Abriendo…" : "Abrir caja"}</Button>
      </form>
    </Modal>
  );
}
