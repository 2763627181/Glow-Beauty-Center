"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { addSalePayment, updateSaleNotes, voidSale } from "@/lib/actions/admin/appointments";
import { money } from "@/lib/format";
import { allowed } from "@/lib/permissions";
import { useAdmin } from "../AdminContext";
import { DeleteDialog } from "../DeleteDialog";
import { Alert } from "../primitives";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";
import { PrintButton } from "./PrintButton";

/** Acciones sobre una venta: cobrar saldo, editar nota, anular e imprimir. */
export function SaleActions({ saleId, pending, voided, notes }: { saleId: string; pending: number; voided: boolean; notes: string }) {
  const { role, paymentMethods } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [modal, setModal] = useState<null | "pay" | "void" | "notes">(null);
  const [del, setDel] = useState(false);
  const [amount, setAmount] = useState(String(pending));
  const [method, setMethod] = useState(paymentMethods[0].key);
  const [ref, setRef] = useState("");
  const [over, setOver] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState(notes);
  const [error, setError] = useState<string | null>(null);

  const done = (msg: string) => { toast(msg); setModal(null); router.refresh(); };
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => start(async () => {
    setError(null);
    const r = await fn();
    if (r.ok) done(okMsg); else setError(r.error ?? "Error");
  });
  const open = (m: "pay" | "void" | "notes") => { setError(null); setAmount(String(pending)); setModal(m); };

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

      <Modal open={modal === "pay"} onClose={() => setModal(null)} title="Registrar pago">
        <div className={u.grid}>
          <div className={u.form2}>
            <div className={u.field}><label htmlFor="sp-a">Monto (RD$)</label><input id="sp-a" type="number" step="any" min={0} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className={u.field}><label htmlFor="sp-m">Método</label><select id="sp-m" value={method} onChange={(e) => setMethod(e.target.value)}>{paymentMethods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
            <div className={`${u.field} ${u.span2}`}><label htmlFor="sp-r">Referencia (opcional)</label><input id="sp-r" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          </div>
          {Number(amount) > pending + 0.001 && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} /> Confirmo el pago mayor al saldo</label>}
          {error && <Alert>{error}</Alert>}
          <Button block disabled={busy || !(Number(amount) > 0)} onClick={() => run(() => addSalePayment(saleId, { amount: Number(amount), method, reference: ref || undefined, allowOverpay: over }), "Pago registrado")}>{busy ? "Registrando…" : "Registrar pago"}</Button>
        </div>
      </Modal>

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
