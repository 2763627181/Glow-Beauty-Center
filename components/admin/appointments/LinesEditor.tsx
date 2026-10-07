"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { money } from "@/lib/format";
import { useAdmin } from "../AdminContext";
import { NumInput } from "../NumInput";
import u from "../ui.module.css";
import { addTeammate, newKey, type EditLine } from "./lines";
import { StaffOptions } from "./StaffOptions";

/** Editor de las líneas de una cita: especialista, precio final, cantidad, orden, altas (servicio / producto / concepto) y bajas. */
export function LinesEditor({ lines, onChange, showStaff = true, showOrder = true, lockedTimed = false }: {
  lines: EditLine[]; onChange: (l: EditLine[]) => void; showStaff?: boolean; showOrder?: boolean; lockedTimed?: boolean;
}) {
  const { staff, links, options, products } = useAdmin();
  const [custom, setCustom] = useState({ name: "", price: "" });
  const set = (i: number, patch: Partial<EditLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= lines.length) return;
    const next = [...lines];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className={u.grid}>
      <div className={u.tableWrap}>
        <table className={`${u.table} ${u.stack}`}>
          <thead>
            <tr><th>Servicio / artículo</th>{showStaff && <th>Especialista</th>}<th>Cant.</th><th className={u.num}>Precio final</th><th><span className="sr-only">Acciones</span></th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key}>
                <td data-label="Servicio">
                  <strong>{l.name}</strong>
                  {!l.timed && <span className={u.hint}> · sin horario</span>}
                  {l.listPrice !== l.final_price && <div className={u.hint}>Precio de lista {money(l.listPrice)}</div>}
                  {showStaff && l.timed && l.service_id && (() => {
                    const timedBefore = lines.slice(0, i).filter((x) => x.timed).length;
                    const joins = !!l.team && lines.findIndex((x) => x.team === l.team) < i; // no es la primera del equipo: empieza junto con ella
                    return (
                      <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
                        {l.team && <span className={`${u.badge} ${u.blue}`} style={{ justifySelf: "start" }}>En equipo</span>}
                        {timedBefore > 0 && (
                          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.82rem" }}>
                            <input type="checkbox" checked={joins || !!l.parallel} disabled={joins} onChange={(e) => set(i, { parallel: e.target.checked })} aria-label={`${l.name}: al mismo tiempo que el anterior`} />
                            Al mismo tiempo que el anterior
                          </label>
                        )}
                        <Button type="button" size="sm" variant="soft" onClick={() => onChange(addTeammate(lines, i))} aria-label={`Sumar otra especialista a ${l.name}`} style={{ justifySelf: "start" }}>+ Otra especialista</Button>
                      </div>
                    );
                  })()}
                </td>
                {showStaff && (
                  <td data-label="Especialista">
                    <select aria-label={`Especialista para ${l.name}`} value={l.employee_id ?? ""} onChange={(e) => set(i, { employee_id: e.target.value || null })} style={{ minHeight: 40, borderRadius: 10, padding: "0 8px", maxWidth: 170 }}>
                      <option value="">Sin asignar</option>
                      <StaffOptions serviceId={l.service_id} staff={staff} links={links} />
                    </select>
                  </td>
                )}
                <td data-label="Cantidad"><NumInput aria-label={`Cantidad de ${l.name}`} integer min={1} value={l.quantity} emptyValue={1} onValue={(v) => set(i, { quantity: Math.max(1, Math.floor(v ?? 1)) })} style={{ width: 64, minHeight: 40 }} /></td>
                <td data-label="Precio" className={u.num}><NumInput aria-label={`Precio de ${l.name}`} min={0} value={l.final_price} emptyValue={0} onValue={(v) => set(i, { final_price: Math.max(0, v ?? 0) })} style={{ width: 110, minHeight: 40, textAlign: "right" }} /></td>
                <td>
                  <div className={u.rowActions}>
                    {showOrder && l.timed && <>
                      <Button type="button" size="sm" variant="secondary" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir ${l.name}`}>↑</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => move(i, 1)} disabled={i === lines.length - 1} aria-label={`Bajar ${l.name}`}>↓</Button>
                    </>}
                    <Button type="button" size="sm" variant="danger" onClick={() => onChange(lines.filter((_, j) => j !== i))} disabled={lockedTimed && l.timed && lines.filter((x) => x.timed).length === 1} aria-label={`Quitar ${l.name}`}>✕</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={u.form2}>
        <div className={u.field}>
          <label htmlFor="le-svc">Agregar servicio</label>
          <select id="le-svc" value="" onChange={(e) => {
            const o = options.find((x) => x.key === e.target.value);
            if (!o) return;
            const prev = [...lines].reverse().find((l) => l.timed)?.employee_id ?? null;
            onChange([...lines, { key: newKey(), service_id: o.serviceId, variant_id: o.variantId, name: o.label, employee_id: prev, final_price: o.price, quantity: 1, timed: true, listPrice: o.price }]);
          }}>
            <option value="">Seleccionar…</option>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label} — {money(o.price)}</option>)}
          </select>
        </div>
        <div className={u.field}>
          <label htmlFor="le-prod">Agregar producto</label>
          <select id="le-prod" value="" onChange={(e) => {
            const p = products.find((x) => x.id === e.target.value);
            if (p) onChange([...lines, { key: newKey(), name: p.name, employee_id: null, final_price: p.price, quantity: 1, timed: false, listPrice: p.price }]);
          }}>
            <option value="">{products.length ? "Seleccionar…" : "Sin productos (créalos en Servicios → Productos)"}</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price)}</option>)}
          </select>
        </div>
        <div className={`${u.span2}`} style={{ display: "grid", gridTemplateColumns: "1fr 130px auto", gap: 8, alignItems: "end" }}>
          <div className={u.field}><label htmlFor="le-cn">Otro concepto</label><input id="le-cn" placeholder="Ej. Propina extra, producto…" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} /></div>
          <div className={u.field}><label htmlFor="le-cp">Precio</label><input id="le-cp" type="number" step="any" min={0} inputMode="decimal" value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} /></div>
          <Button type="button" size="sm" variant="soft" disabled={!custom.name.trim() || custom.price === "" || Number(custom.price) < 0} onClick={() => {
            onChange([...lines, { key: newKey(), name: custom.name.trim(), employee_id: null, final_price: Number(custom.price), quantity: 1, timed: false, listPrice: Number(custom.price) }]);
            setCustom({ name: "", price: "" });
          }}>Agregar</Button>
        </div>
      </div>
    </div>
  );
}
