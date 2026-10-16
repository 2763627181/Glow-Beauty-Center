"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { money } from "@/lib/format";
import { ChangeMethodModal } from "../cash/ChangeMethodModal";

/** «Cambiar método» junto a un pago de la factura (para corregir, por ejemplo, una tarjeta guardada como efectivo). */
export function ChangeMethodButton({ payment, who }: { payment: { id: string; amount: number; method: string }; who?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} aria-label={`Cambiar el método del pago de ${money(payment.amount)}`}>Cambiar método</Button>
      {open && <ChangeMethodModal payment={payment} who={who} onClose={() => setOpen(false)} />}
    </>
  );
}
