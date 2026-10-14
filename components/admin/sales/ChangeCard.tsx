"use client";

import { Button } from "@/components/ui/Button";
import { money } from "@/lib/format";
import p from "./payment.module.css";

/** Pantalla de «cobro registrado» cuando hay vuelto: no desaparece sola, para que no se olvide cuánto devolver. */
export function ChangeCard({ charged, change, tip = 0, label, onClose }: { charged: number; change: number; tip?: number; label?: string; onClose: () => void }) {
  return (
    <div className={p.done} role="status">
      <p>{label ?? "Cobro registrado"}: <strong>{money(charged)}</strong></p>
      {change > 0 && <><p>Devuélvele al cliente</p><div className={p.big}>{money(change)}</div></>}
      {tip > 0 && <><p>Entrégale a la especialista de propina</p><div className={p.big}>{money(tip)}</div><p className={p.note}>La propina no entra en la venta ni en la caja.</p></>}
      <Button block onClick={onClose} autoFocus>{change > 0 && tip > 0 ? "Listo, ya entregué el vuelto y la propina" : tip > 0 ? "Listo, ya entregué la propina" : "Listo, ya entregué el vuelto"}</Button>
    </div>
  );
}
