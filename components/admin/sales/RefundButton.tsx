"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { refundPayment } from "@/lib/actions/admin/appointments";
import { ConfirmDialog, useToast } from "../overlay";

export function RefundButton({ paymentId }: { paymentId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <Button size="sm" variant="danger" disabled={pending} onClick={() => setOpen(true)}>Reembolsar</Button>
      <ConfirmDialog open={open} danger title="¿Reembolsar este pago?" text="El pago quedará marcado como reembolsado y la venta cambiará de estado. Queda registrado en auditoría."
        confirmLabel="Reembolsar" onClose={() => setOpen(false)}
        onConfirm={() => start(async () => { const r = await refundPayment(paymentId); toast(r.ok ? "Pago reembolsado" : r.error, r.ok ? "ok" : "err"); router.refresh(); })} />
    </>
  );
}
