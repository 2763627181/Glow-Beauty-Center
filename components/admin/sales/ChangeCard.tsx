"use client";

import { Button } from "@/components/ui/Button";
import { money } from "@/lib/format";
import p from "./payment.module.css";

/** Pantalla de «cobro registrado» cuando hay vuelto: no desaparece sola, para que no se olvide cuánto devolver. */
export function ChangeCard({ charged, change, label, onClose }: { charged: number; change: number; label?: string; onClose: () => void }) {
  return (
    <div className={p.done} role="status">
      <p>{label ?? "Cobro registrado"}: <strong>{money(charged)}</strong></p>
      <p>Devuélvele al cliente</p>
      <div className={p.big}>{money(change)}</div>
      <Button block onClick={onClose} autoFocus>Listo, ya entregué el vuelto</Button>
    </div>
  );
}
