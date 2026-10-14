"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { addLot, depleteLot, saveLot, saveSupply } from "@/lib/actions/admin/inventory";
import type { LotView, ServicePick, SupplyView } from "@/lib/data/inventory";
import { plural } from "@/lib/domain/inventory";
import { fmtDate, todayISO } from "@/lib/format";
import { NumInput } from "../NumInput";
import { Alert } from "../primitives";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";
import c from "./inventory.module.css";

const shortDay = (d: string) => fmtDate(`${d}T12:00:00-04:00`, { day: "numeric", month: "short", year: "numeric" });

/** Crear o editar un producto: nombre, unidad, en qué servicios se usa y cuántos servicios rinde una unidad. */
export function SupplyModal({ supply, services, onClose }: { supply: SupplyView | null; services: ServicePick[]; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: supply?.name ?? "", unit: supply?.unit ?? "pote", notes: supply?.notes ?? "", active: supply?.active ?? true });
  const [expected, setExpected] = useState<number | null>(supply?.expected ?? null);
  const [ids, setIds] = useState<string[]>(supply?.services.map((s) => s.id) ?? []);
  const [error, setError] = useState<string | null>(null);
  const cats = [...new Set(services.map((s) => s.category))];
  const toggle = (id: string) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  function submit() {
    setError(null);
    if (!f.name.trim()) return setError("Escribe el nombre del producto.");
    if (!ids.length) return setError("Elige al menos un servicio en el que se use: de ahí sale cuántos clientes se atendieron.");
    start(async () => {
      const r = await saveSupply(supply?.id ?? null, { name: f.name, unit: f.unit, expected, notes: f.notes, active: f.active, service_ids: ids });
      if (!r.ok) return setError(r.error);
      toast(supply ? "Producto guardado" : "Producto creado");
      onClose();
      if (!supply) router.push(`/admin/inventory/${r.id}`); else router.refresh();
    });
  }

  return (
    <Modal open onClose={onClose} title={supply ? "Editar producto" : "Nuevo producto"} wide>
      <form className={u.grid} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className={u.form2}>
          <div className={u.field}><label htmlFor="sp-name">Producto</label><input id="sp-name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej.: Pintura de gel" required /></div>
          <div className={u.field}><label htmlFor="sp-unit">Unidad (una palabra)</label><input id="sp-unit" maxLength={30} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value.replace(/\s/g, "") })} placeholder="pote, botella, caja…" aria-describedby="sp-unit-h" required />
            <span id="sp-unit-h" className={u.hint}>Cómo se cuenta lo que llega: potes, botellas, cajas, frascos…</span></div>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6, minWidth: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 4 }}>¿En qué servicios se usa?</legend>
          <div className={c.picks}>
            {cats.map((cat) => (
              <div key={cat}>
                <p className={c.catName}>{cat}</p>
                <div className={u.chips}>
                  {services.filter((s) => s.category === cat).map((s) => (
                    <label key={s.id} className={u.chipPick}><input type="checkbox" checked={ids.includes(s.id)} onChange={() => toggle(s.id)} />{s.name}</label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <span className={u.hint}>Cada servicio de estos que se haga mientras la entrada está en uso cuenta como un cliente atendido con este producto.</span>
        </fieldset>
        <div className={u.field}>
          <label htmlFor="sp-exp">¿Cuántos servicios rinde una unidad? (opcional)</label>
          <NumInput id="sp-exp" min={0} value={expected} onValue={setExpected} aria-describedby="sp-exp-h" />
          <span id="sp-exp-h" className={u.hint}>Por ejemplo, si un pote alcanza para unos 8 manicures, escribe 8. Con eso el sistema dice si el consumo es normal; sin eso compara entre entradas.</span>
        </div>
        <div className={u.field}><label htmlFor="sp-notes">Nota (opcional)</label><input id="sp-notes" maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Producto activo</label>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" block disabled={pending}>{pending ? "Guardando…" : supply ? "Guardar" : "Crear producto"}</Button>
      </form>
    </Modal>
  );
}

/** Registrar (o corregir) una entrada: cuando llega un pedido. */
export function LotModal({ supply, lot, onClose }: { supply: { id: string; name: string; unit: string }; lot?: LotView | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [day, setDay] = useState(lot?.received_on ?? todayISO());
  const [qty, setQty] = useState<number | null>(lot?.quantity ?? null);
  const [cost, setCost] = useState<number | null>(lot?.unit_cost ?? null);
  const [supplier, setSupplier] = useState(lot?.supplier ?? "");
  const [notes, setNotes] = useState(lot?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!day) return setError("Elige la fecha en que llegó.");
    if (qty == null || qty <= 0) return setError(`Escribe cuántos ${plural(supply.unit, 2)} llegaron.`);
    const input = { received_on: day, quantity: qty, unit_cost: cost, supplier, notes };
    start(async () => {
      const r = lot ? await saveLot(lot.id, input) : await addLot(supply.id, input);
      if (!r.ok) return setError(r.error);
      toast(lot ? "Entrada guardada" : `Entrada de ${supply.name} registrada`);
      router.refresh();
      onClose();
    });
  }
  return (
    <Modal open onClose={onClose} title={lot ? `Editar entrada · ${supply.name}` : `Nueva entrada · ${supply.name}`}>
      <form className={u.grid} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className={u.form2}>
          <div className={u.field}><label htmlFor="lt-day">Fecha en que llegó</label><input id="lt-day" type="date" max={todayISO()} value={day} onChange={(e) => setDay(e.target.value)} required /></div>
          <div className={u.field}><label htmlFor="lt-qty">Cantidad ({plural(supply.unit, 2)})</label><NumInput id="lt-qty" min={0} value={qty} onValue={setQty} /></div>
          <div className={u.field}><label htmlFor="lt-cost">Costo por {supply.unit} (opcional, RD$)</label><NumInput id="lt-cost" min={0} value={cost} onValue={setCost} /></div>
          <div className={u.field}><label htmlFor="lt-sup">Proveedor (opcional)</label><input id="lt-sup" maxLength={120} value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div>
        </div>
        <div className={u.field}><label htmlFor="lt-notes">Nota (opcional)</label><input id="lt-notes" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" block disabled={pending}>{pending ? "Guardando…" : lot ? "Guardar" : "Registrar entrada"}</Button>
      </form>
    </Modal>
  );
}

/** Marcar una entrada como agotada ese día. */
export function DepleteModal({ supply, lot, onClose }: { supply: { name: string; unit: string }; lot: LotView; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [day, setDay] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  function submit() {
    setError(null);
    start(async () => {
      const r = await depleteLot(lot.id, day);
      if (!r.ok) return setError(r.error);
      toast("Entrada marcada como agotada");
      router.refresh();
      onClose();
    });
  }
  return (
    <Modal open onClose={onClose} title={`Se agotó · ${supply.name}`}>
      <form className={u.grid} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className={u.sub}>La entrada del {shortDay(lot.received_on)} ({lot.quantity} {plural(supply.unit, lot.quantity)}) {lot.startDate !== lot.received_on ? `se empezó a usar el ${shortDay(lot.startDate)}` : "se está usando"}. Al marcarla, el sistema cuenta los servicios que se hicieron en ese tiempo y analiza el consumo.</p>
        <div className={u.field}><label htmlFor="dp-day">¿Qué día se agotó?</label><input id="dp-day" type="date" min={lot.startDate} max={todayISO()} value={day} onChange={(e) => setDay(e.target.value)} required /></div>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" block disabled={pending}>{pending ? "Guardando…" : "Marcar como agotada"}</Button>
      </form>
    </Modal>
  );
}
