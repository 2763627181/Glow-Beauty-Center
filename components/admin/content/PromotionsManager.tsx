"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { deletePromotion, savePromotion, type PromoInput } from "@/lib/actions/admin/content";
import { money } from "@/lib/format";
import { Alert, EmptyState } from "../primitives";
import { ImageUpload } from "../ImageUpload";
import { NumInput } from "../NumInput";
import { ConfirmDialog, Modal, useToast } from "../overlay";
import u from "../ui.module.css";

export type PromoRow = PromoInput & { id: string };
const blank: PromoInput = { name: "", description: "", original_price: null, promo_price: 0, starts_on: "", ends_on: "", image_url: null, active: true, service_ids: [] };

export function PromotionsManager({ promos, services }: { promos: PromoRow[]; services: { id: string; name: string }[] }) {
  const [edit, setEdit] = useState<{ id: string | null; data: PromoInput } | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const set = (p: Partial<PromoInput>) => setEdit((e) => e && { ...e, data: { ...e.data, ...p } });

  return (
    <>
      <div style={{ marginBottom: 16 }}><Button size="sm" onClick={() => { setErr(null); setEdit({ id: null, data: blank }); }}>+ Nueva promoción</Button></div>
      {promos.length === 0 ? <div className={u.card}><EmptyState title="Sin promociones" text="Crea combos como “Manicure + Pedicure” para mostrarlos en la web." /></div> : (
        <div className={u.kpis}>
          {promos.map((p) => (
            <article key={p.id} className={u.card} style={{ display: "grid", gap: 6, alignContent: "start" }}>
              <h2 style={{ margin: 0 }}>{p.name}</h2>
              <p className={u.sub}>{p.description}</p>
              <p>{p.original_price != null && <del className={u.sub}>{money(p.original_price)} </del>}<strong>{money(p.promo_price)}</strong></p>
              <p className={u.sub}>{p.starts_on || "—"} → {p.ends_on || "sin fin"} · {p.service_ids.length} servicios</p>
              <span className={`${u.badge} ${p.active ? u.green : u.gray}`} style={{ justifySelf: "start" }}>{p.active ? "Activa" : "Inactiva"}</span>
              <div className={u.rowActions}>
                <Button size="sm" variant="secondary" onClick={() => { setErr(null); setEdit({ id: p.id, data: p }); }}>Editar</Button>
                <Button size="sm" variant="danger" onClick={() => setDel(p.id)}>Eliminar</Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Editar promoción" : "Nueva promoción"} wide>
        {edit && (
          <form className={u.form2} onSubmit={(e) => {
            e.preventDefault(); setErr(null);
            start(async () => {
              const r = await savePromotion(edit.id, edit.data);
              if (!r.ok) return setErr(r.error);
              toast("Promoción guardada"); setEdit(null); router.refresh();
            });
          }}>
            <div className={`${u.field} ${u.span2}`}><label htmlFor="p-n">Nombre</label><input id="p-n" value={edit.data.name} onChange={(e) => set({ name: e.target.value })} required /></div>
            <div className={`${u.field} ${u.span2}`}><label htmlFor="p-d">Descripción</label><textarea id="p-d" value={edit.data.description ?? ""} onChange={(e) => set({ description: e.target.value })} /></div>
            <div className={u.field}><label htmlFor="p-o">Precio original</label><NumInput id="p-o" min={0} value={edit.data.original_price ?? null} onValue={(v) => set({ original_price: v })} /></div>
            <div className={u.field}><label htmlFor="p-p">Precio promocional</label><NumInput id="p-p" min={0} value={edit.data.promo_price} emptyValue={0} onValue={(v) => set({ promo_price: v ?? 0 })} required /></div>
            <div className={u.field}><label htmlFor="p-s">Inicio</label><input id="p-s" type="date" value={edit.data.starts_on ?? ""} onChange={(e) => set({ starts_on: e.target.value })} /></div>
            <div className={u.field}><label htmlFor="p-e">Fin</label><input id="p-e" type="date" value={edit.data.ends_on ?? ""} onChange={(e) => set({ ends_on: e.target.value })} /></div>
            <div className={u.span2}><ImageUpload bucket="service-images" value={edit.data.image_url ?? null} onChange={(url) => set({ image_url: url })} /></div>
            <fieldset className={u.span2} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600 }}>Servicios incluidos</legend>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", maxHeight: 180, overflow: "auto" }}>
                {services.map((s) => (
                  <label key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 36 }}>
                    <input type="checkbox" checked={edit.data.service_ids.includes(s.id)} onChange={(e) => set({ service_ids: e.target.checked ? [...edit.data.service_ids, s.id] : edit.data.service_ids.filter((x) => x !== s.id) })} /> {s.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={u.span2} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={edit.data.active} onChange={(e) => set({ active: e.target.checked })} /> Activa (visible en la web dentro de sus fechas)</label>
            {err && <div className={u.span2}><Alert>{err}</Alert></div>}
            <div className={u.span2}><Button type="submit" block disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button></div>
          </form>
        )}
      </Modal>
      <ConfirmDialog open={!!del} danger title="¿Eliminar promoción?" text="Dejará de mostrarse en la web." confirmLabel="Eliminar" onClose={() => setDel(null)}
        onConfirm={() => del && start(async () => { const r = await deletePromotion(del); toast(r.ok ? "Eliminada" : r.error, r.ok ? "ok" : "err"); router.refresh(); })} />
    </>
  );
}
