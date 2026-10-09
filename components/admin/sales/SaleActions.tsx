"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { updateSaleNotes, voidSale } from "@/lib/actions/admin/appointments";
import { money } from "@/lib/format";
import { allowed } from "@/lib/permissions";
import { useAdmin } from "../AdminContext";
import { DeleteDialog } from "../DeleteDialog";
import { Alert } from "../primitives";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";
import { PrintButton } from "./PrintButton";
import { SalePayModal } from "./SalePayModal";

/** Acciones sobre una venta: cobrar saldo, editar nota, anular e imprimir. */
export function SaleActions({ saleId, pending, voided, notes }: { saleId: string; pending: number; voided: boolean; notes: string }) {
  const { role } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [modal, setModal] = useState<null | "pay" | "void" | "notes">(null);
  const [del, setDel] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState(notes);
  const [error, setError] = useState<string | null>(null);

  const done = (msg: string) => { toast(msg); setModal(null); router.refresh(); };
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => start(async () => {
    setError(null);
    const r = await fn();
    if (r.ok) done(okMsg); else setError(r.error ?? "Error");
  });
  const open = (m: "pay" | "void" | "notes") => { setError(null); setModal(m); };

  return (
    <>
      <div className={u.rowActions}>
        {!voided && pending > 0 && allowed(role, "charge") && <Button size="sm" onClick={() => open("pay")}>Registrar pago ({money(pending)})</Button>}
        {allowed(role, "voidOrRefund") && <Button size="sm" variant="secondary" onClick={() => open("notes")}>Editar nota</Button>}
        {!voided && allowed(role, "voidOrRefund") && <Button size="sm" variant="danger" onClick={() => open("void")}>Anular venta</Button>}
        {allowed(role, "deleteRecords") && <Button size="sm" variant="danger" onClick={() => setDel(true)}>Eliminar venta</Button>}
        <PrintButton />
      </div>
      {del && <DeleteDialog kind="sales" ids={[saleId]} title="¿Eliminar esta venta?" onClose={() => setDel(false)} onDone={() => router.push("/admin/sales")} />}

      {modal === "pay" && <SalePayModal saleId={saleId} pending={pending} onClose={() => setModal(null)} onDone={() => router.refresh()} />}

      <Modal open={modal === "void"} onClose={() => setModal(null)} title="Anular venta">
        <div className={u.grid}>
          <p>Se reembolsarán todos los pagos de esta venta, dejará de contar en los reportes y la cita asociada quedará cancelada. Queda registrado en auditoría y <strong>no se puede deshacer</strong>.</p>
          <div className={u.field}><label htmlFor="sv-r">Motivo (obligatorio)</label><textarea id="sv-r" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></div>
          {error && <Alert>{error}</Alert>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setModal(null)}>Volver</Button>
            <Button variant="danger" disabled={busy || !reason.trim()} onClick={() => run(() => voidSale(saleId, reason), "Venta anulada")}>{busy ? "Anulando…" : "Anular venta"}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === "notes"} onClose={() => setModal(null)} title="Nota de la venta">
        <div className={u.grid}>
          <div className={u.field}><label htmlFor="sn-n">Nota</label><textarea id="sn-n" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></div>
          {error && <Alert>{error}</Alert>}
          <Button block disabled={busy} onClick={() => run(() => updateSaleNotes(saleId, note), "Nota guardada")}>Guardar nota</Button>
        </div>
      </Modal>
    </>
  );
}
