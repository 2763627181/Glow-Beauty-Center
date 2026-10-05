"use client";

import { Button } from "@/components/ui/Button";
import { money } from "@/lib/format";
import { useAdmin } from "../AdminContext";

export type PayRow = { id: number; method: string; amount: string; reference: string };
let seq = 0;
export const newPayRow = (method: string, amount = ""): PayRow => ({ id: ++seq, method, amount, reference: "" });

const field = { minHeight: 46, borderRadius: 12, padding: "0 10px", border: "1px solid rgb(41 37 36 / 0.22)" } as const;

/** Filas de pago (método, monto, referencia) con división de pagos y "Pagar todo". */
export function PaymentRows({ rows, onChange, pending }: { rows: PayRow[]; onChange: (r: PayRow[]) => void; pending: number }) {
  const { paymentMethods } = useAdmin();
  const set = (id: number, patch: Partial<PayRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const second = paymentMethods[Math.min(1, paymentMethods.length - 1)].key;
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
      <legend style={{ fontWeight: 600, marginBottom: 6 }}>Pagos (puedes dividirlos)</legend>
      {rows.map((p, i) => (
        <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8 }}>
          <select aria-label="Método de pago" value={p.method} onChange={(e) => set(p.id, { method: e.target.value })} style={field}>
            {paymentMethods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <input aria-label="Monto" type="number" step="any" min={0} inputMode="decimal" placeholder={i === 0 ? String(pending) : "0"} value={p.amount} onChange={(e) => set(p.id, { amount: e.target.value })} style={field} />
          <input aria-label="Referencia (opcional)" placeholder="Referencia" value={p.reference} onChange={(e) => set(p.id, { reference: e.target.value })} style={field} />
          {rows.length > 1 ? <Button size="sm" variant="secondary" onClick={() => onChange(rows.filter((y) => y.id !== p.id))} aria-label="Quitar pago">✕</Button> : <span />}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button size="sm" variant="soft" onClick={() => onChange([...rows, newPayRow(second)])}>+ Dividir pago</Button>
        <Button size="sm" variant="secondary" onClick={() => onChange([newPayRow(rows[0]?.method ?? paymentMethods[0].key, String(pending))])}>Pagar todo ({money(pending)})</Button>
      </div>
    </fieldset>
  );
}
