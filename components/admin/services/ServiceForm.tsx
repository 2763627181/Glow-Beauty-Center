"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { saveService, type ServiceInput } from "@/lib/actions/admin/services";
import { Alert } from "../primitives";
import { ImageUpload } from "../ImageUpload";
import { NumInput } from "../NumInput";
import { useToast } from "../overlay";
import u from "../ui.module.css";

type Opt = { id: string; name: string };

export function ServiceForm({ id, initial, categories, employees }: { id: string | null; initial: ServiceInput; categories: Opt[]; employees: Opt[] }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState<ServiceInput>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (p: Partial<ServiceInput>) => setF((x) => ({ ...x, ...p }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    start(async () => {
      const r = await saveService(id, f);
      if (!r.ok) return setErr(r.error);
      toast("Servicio guardado");
      if (!id) router.push(`/admin/services/${r.id}`); else router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className={u.grid}>
      <section className={`${u.card} ${u.form2}`}>
        <h2 className={u.span2}>Información</h2>
        <div className={`${u.field} ${u.span2}`}><label htmlFor="s-name">Nombre</label><input id="s-name" value={f.name} onChange={(e) => set({ name: e.target.value })} required /></div>
        <div className={u.field}><label htmlFor="s-cat">Categoría</label>
          <select id="s-cat" value={f.category_id} onChange={(e) => set({ category_id: e.target.value })} required>
            <option value="">Elegir…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div className={u.field}><label htmlFor="s-short">Descripción corta</label><input id="s-short" maxLength={200} value={f.short_description ?? ""} onChange={(e) => set({ short_description: e.target.value })} /></div>
        <div className={`${u.field} ${u.span2}`}><label htmlFor="s-desc">Descripción</label><textarea id="s-desc" value={f.description ?? ""} onChange={(e) => set({ description: e.target.value })} /></div>
        <div className={u.span2}><ImageUpload bucket="service-images" value={f.image_url ?? null} onChange={(url) => set({ image_url: url })} label="Fotografía" /></div>
      </section>

      <section className={`${u.card} ${u.form2}`}>
        <h2 className={u.span2}>Precio y tiempos</h2>
        <div className={u.field}><label htmlFor="s-price">Precio (RD$)</label><NumInput id="s-price" min={0} value={f.price} emptyValue={0} onValue={(v) => set({ price: v ?? 0 })} /></div>
        <div className={u.field}><label htmlFor="s-dur">Duración (min)</label><NumInput id="s-dur" integer min={1} value={f.duration_minutes} emptyValue={0} onValue={(v) => set({ duration_minutes: v ?? 0 })} /></div>
        <div className={u.field}><label htmlFor="s-bb">Preparación antes (min)</label><NumInput id="s-bb" integer min={0} value={f.buffer_before_minutes} emptyValue={0} onValue={(v) => set({ buffer_before_minutes: v ?? 0 })} /></div>
        <div className={u.field}><label htmlFor="s-ba">Tiempo posterior (min)</label><NumInput id="s-ba" integer min={0} value={f.buffer_after_minutes} emptyValue={0} onValue={(v) => set({ buffer_after_minutes: v ?? 0 })} /></div>
        <div className={u.field}><label htmlFor="s-com">Comisión % (opcional)</label><NumInput id="s-com" min={0} max={100} value={f.commission_pct ?? null} onValue={(v) => set({ commission_pct: v })} /></div>
        <div className={u.span2} style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {([["price_from", "Mostrar “desde”"], ["featured", "Destacado"], ["requires_consultation", "Requiere consulta previa"], ["active", "Activo (visible)"]] as const).map(([k, l]) => (
            <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 40 }}><input type="checkbox" checked={!!f[k]} onChange={(e) => set({ [k]: e.target.checked })} /> {l}</label>
          ))}
          <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 40 }}><input type="checkbox" checked={f.pending_review} onChange={(e) => set({ pending_review: e.target.checked, ...(e.target.checked ? { active: false } : {}) })} /> Nombre por confirmar (no se publica)</label>
        </div>
      </section>

      <section className={u.card}>
        <h2>Variantes (ej. largo del cabello)</h2>
        <p className={u.hint}>Si defines variantes, el cliente elige una y se usa su precio y duración.</p>
        {f.variants.map((v, i) => (
          <div key={v.id ?? i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, margin: "8px 0" }}>
            <input aria-label="Nombre de la variante" placeholder="Nombre" value={v.name} onChange={(e) => set({ variants: f.variants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <NumInput aria-label="Precio de la variante" min={0} value={v.price} emptyValue={0} onValue={(p) => set({ variants: f.variants.map((x, j) => (j === i ? { ...x, price: p ?? 0 } : x)) })} />
            <NumInput aria-label="Duración de la variante" integer min={1} value={v.duration_minutes} emptyValue={0} onValue={(d) => set({ variants: f.variants.map((x, j) => (j === i ? { ...x, duration_minutes: d ?? 0 } : x)) })} />
            <Button type="button" size="sm" variant="danger" aria-label="Quitar variante" onClick={() => set({ variants: f.variants.filter((_, j) => j !== i) })}>✕</Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="soft" onClick={() => set({ variants: [...f.variants, { name: "", price: f.price, duration_minutes: f.duration_minutes, active: true }] })}>+ Variante</Button>
      </section>

      <section className={u.card}>
        <h2>Complementos (add-ons)</h2>
        <p className={u.hint}>Suman precio y duración. Ej. “Línea profesional” + RD$ 1,500.</p>
        {f.addons.map((a, i) => (
          <div key={a.id ?? i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, margin: "8px 0" }}>
            <input aria-label="Nombre del complemento" placeholder="Nombre" value={a.name} onChange={(e) => set({ addons: f.addons.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <NumInput aria-label="Precio adicional" min={0} value={a.price} emptyValue={0} onValue={(p) => set({ addons: f.addons.map((x, j) => (j === i ? { ...x, price: p ?? 0 } : x)) })} />
            <NumInput aria-label="Minutos adicionales" integer min={0} value={a.duration_minutes} emptyValue={0} onValue={(d) => set({ addons: f.addons.map((x, j) => (j === i ? { ...x, duration_minutes: d ?? 0 } : x)) })} />
            <Button type="button" size="sm" variant="danger" aria-label="Quitar complemento" onClick={() => set({ addons: f.addons.filter((_, j) => j !== i) })}>✕</Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="soft" onClick={() => set({ addons: [...f.addons, { name: "", price: 0, duration_minutes: 0, active: true }] })}>+ Complemento</Button>
      </section>

      <section className={u.card}>
        <h2>Especialistas que lo realizan</h2>
        <p className={u.hint}>Si no marcas ninguno, cualquier especialista activo puede tomarlo.</p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {employees.map((e) => (
            <label key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 40 }}>
              <input type="checkbox" checked={f.employee_ids.includes(e.id)} onChange={(ev) => set({ employee_ids: ev.target.checked ? [...f.employee_ids, e.id] : f.employee_ids.filter((x) => x !== e.id) })} /> {e.name}
            </label>
          ))}
        </div>
      </section>

      {err && <Alert>{err}</Alert>}
      <div><Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar servicio"}</Button></div>
    </form>
  );
}
