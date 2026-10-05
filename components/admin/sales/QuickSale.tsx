"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { createQuickSale, findClientByPhone } from "@/lib/actions/admin/appointments";
import { money } from "@/lib/format";
import { useAdmin, useCan } from "../AdminContext";
import { Alert } from "../primitives";
import { NumInput } from "../NumInput";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";
import { newPayRow, PaymentRows, type PayRow } from "./PaymentRows";

type Line = { key: string; description: string; quantity: number; unit_price: number; service_id: string | null };
const k = () => Math.random().toString(36).slice(2, 9);

/** Venta de mostrador: productos y/o servicios sin cita. Crea la venta y registra los pagos de una vez. */
export function QuickSale() {
  const allowed = useCan("charge");
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>+ Nueva venta</Button>
      {open && <QuickSaleModal onClose={() => setOpen(false)} />}
    </>
  );
}

function QuickSaleModal({ onClose }: { onClose: () => void }) {
  const { options, products, staff, paymentMethods } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [lines, setLines] = useState<Line[]>([]);
  const [custom, setCustom] = useState({ name: "", price: "" });
  const [phone, setPhone] = useState("");
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [emp, setEmp] = useState("");
  const [discount, setDiscount] = useState("");
  const [tip, setTip] = useState("");
  const [notes, setNotes] = useState("");
  const [pays, setPays] = useState<PayRow[]>([newPayRow(paymentMethods[0].key)]);
  const [overpay, setOverpay] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = useMemo(() => lines.reduce((t, l) => t + l.quantity * l.unit_price, 0), [lines]);
  const total = subtotal - (Number(discount) || 0) + (Number(tip) || 0);
  const entered = pays.reduce((t, p) => t + (Number(p.amount) || 0), 0);
  const over = entered > total + 0.001;
  const set = (key: string, patch: Partial<Line>) => setLines((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  async function lookup() {
    const c = await findClientByPhone(phone);
    setClient(c ? { id: c.id, name: `${c.first_name} ${c.last_name}`.trim() } : null);
    if (!c && phone.replace(/\D/g, "").length >= 7) toast("No hay un cliente con ese número (la venta quedará sin cliente).", "err");
  }

  function submit() {
    setError(null);
    if (!lines.length) return setError("Agrega al menos un artículo.");
    if (lines.some((l) => !l.description.trim() || l.quantity < 1 || l.unit_price < 0)) return setError("Revisa nombre, cantidad y precio de los artículos.");
    if ((Number(discount) || 0) > subtotal) return setError("El descuento no puede superar el subtotal.");
    if (over && !overpay) return setError("El pago supera el total. Marca la casilla para confirmar el sobrepago.");
    start(async () => {
      const r = await createQuickSale({
        client_id: client?.id ?? null, employee_id: emp || null, discount: Number(discount) || 0, tip: Number(tip) || 0, notes: notes || undefined, allow_overpay: overpay,
        items: lines.map((l) => ({ description: l.description.trim(), quantity: l.quantity, unit_price: l.unit_price, service_id: l.service_id })),
        payments: pays.filter((p) => Number(p.amount) > 0).map((p) => ({ amount: Number(p.amount), method: p.method, reference: p.reference || undefined })),
      });
      if (!r.ok) return setError(r.error);
      toast(`Venta ${r.saleNumber} registrada`);
      onClose();
      router.push(`/admin/sales/${r.saleId}`);
    });
  }

  return (
    <Modal open onClose={onClose} title="Nueva venta" wide>
      <div className={u.grid}>
        <p className={u.sub}>Para productos o servicios sin cita (por ejemplo, la venta de un shampoo). Las ventas de citas se generan solas al completarlas.</p>
        <div className={u.form2}>
          <div className={u.field}><label htmlFor="qs-phone">Cliente (opcional, por teléfono)</label>
            <input id="qs-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setClient(null); }} onBlur={lookup} placeholder="809-555-5555" />
            {client && <span className={u.hint}>Cliente: {client.name}</span>}</div>
          <div className={u.field}><label htmlFor="qs-emp">Atendió (opcional)</label>
            <select id="qs-emp" value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">—</option>{staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
        </div>

        {lines.length > 0 && (
          <div className={u.tableWrap}>
            <table className={`${u.table} ${u.stack}`}>
              <thead><tr><th>Artículo</th><th>Cant.</th><th className={u.num}>Precio</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td data-label="Artículo"><input aria-label="Nombre del artículo" value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} style={{ minHeight: 40, width: "100%", minWidth: 150 }} /></td>
                    <td data-label="Cantidad"><NumInput aria-label={`Cantidad de ${l.description}`} integer min={1} value={l.quantity} emptyValue={1} onValue={(v) => set(l.key, { quantity: Math.max(1, Math.floor(v ?? 1)) })} style={{ width: 64, minHeight: 40 }} /></td>
                    <td data-label="Precio" className={u.num}><NumInput aria-label={`Precio de ${l.description}`} min={0} value={l.unit_price} emptyValue={0} onValue={(v) => set(l.key, { unit_price: Math.max(0, v ?? 0) })} style={{ width: 110, minHeight: 40, textAlign: "right" }} /></td>
                    <td><Button size="sm" variant="danger" aria-label={`Quitar ${l.description}`} onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))}>✕</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className={u.form2}>
          <div className={u.field}><label htmlFor="qs-prod">Agregar producto</label>
            <select id="qs-prod" value="" onChange={(e) => { const p = products.find((x) => x.id === e.target.value); if (p) setLines((l) => [...l, { key: k(), description: p.name, quantity: 1, unit_price: p.price, service_id: null }]); }}>
              <option value="">{products.length ? "Seleccionar…" : "Sin productos (créalos en Servicios → Productos)"}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price)}</option>)}
            </select></div>
          <div className={u.field}><label htmlFor="qs-svc">Agregar servicio</label>
            <select id="qs-svc" value="" onChange={(e) => { const o = options.find((x) => x.key === e.target.value); if (o) setLines((l) => [...l, { key: k(), description: o.label, quantity: 1, unit_price: o.price, service_id: o.serviceId }]); }}>
              <option value="">Seleccionar…</option>
              {options.map((o) => <option key={o.key} value={o.key}>{o.label} — {money(o.price)}</option>)}
            </select></div>
          <div className={u.span2} style={{ display: "grid", gridTemplateColumns: "1fr 130px auto", gap: 8, alignItems: "end" }}>
            <div className={u.field}><label htmlFor="qs-cn">Otro concepto</label><input id="qs-cn" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} /></div>
            <div className={u.field}><label htmlFor="qs-cp">Precio</label><input id="qs-cp" type="number" step="any" min={0} inputMode="decimal" value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} /></div>
            <Button size="sm" variant="soft" disabled={!custom.name.trim() || custom.price === "" || Number(custom.price) < 0} onClick={() => { setLines((l) => [...l, { key: k(), description: custom.name.trim(), quantity: 1, unit_price: Number(custom.price), service_id: null }]); setCustom({ name: "", price: "" }); }}>Agregar</Button>
          </div>
          <div className={u.field}><label htmlFor="qs-d">Descuento (RD$)</label><input id="qs-d" type="number" step="any" min={0} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          <div className={u.field}><label htmlFor="qs-t">Propina (RD$)</label><input id="qs-t" type="number" step="any" min={0} inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} /></div>
          <div className={`${u.field} ${u.span2}`}><label htmlFor="qs-n">Nota</label><input id="qs-n" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>

        <div className={u.card} style={{ background: "var(--color-cream)" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal</span><span>{money(subtotal)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "1.2rem" }}><span>Total</span><span>{money(Math.max(total, 0))}</span></div>
        </div>
        <PaymentRows rows={pays} onChange={setPays} pending={Math.max(total, 0)} />
        {over && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={overpay} onChange={(e) => setOverpay(e.target.checked)} /> Confirmo el pago mayor al total ({money(entered - total)} de más)</label>}
        {error && <Alert>{error}</Alert>}
        <Button block onClick={submit} disabled={pending || !lines.length}>{pending ? "Registrando…" : entered > 0 ? `Registrar venta y cobrar ${money(entered)}` : "Registrar venta (sin cobro)"}</Button>
      </div>
    </Modal>
  );
}
