"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { saveEmployee, type EmployeeInput } from "@/lib/actions/admin/staff";
import { Alert } from "../primitives";
import { ImageUpload } from "../ImageUpload";
import { NumInput } from "../NumInput";
import { useToast } from "../overlay";
import u from "../ui.module.css";

export function EmployeeForm({ id, initial, services }: { id: string | null; initial: EmployeeInput; services: { id: string; name: string; category: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (p: Partial<EmployeeInput>) => setF((x) => ({ ...x, ...p }));
  const cats = [...new Set(services.map((s) => s.category))];

  return (
    <form className={u.grid} onSubmit={(e) => {
      e.preventDefault(); setErr(null);
      start(async () => {
        const r = await saveEmployee(id, f);
        if (!r.ok) return setErr(r.error);
        toast("Especialista guardado");
        if (!id) router.push(`/admin/staff/${r.id}`); else router.refresh();
      });
    }}>
      <section className={`${u.card} ${u.form2}`}>
        <h2 className={u.span2}>Datos</h2>
        <div className={u.field}><label htmlFor="e-name">Nombre</label><input id="e-name" value={f.full_name} onChange={(e) => set({ full_name: e.target.value })} required /></div>
        <div className={u.field}><label htmlFor="e-spec">Especialidad</label><input id="e-spec" value={f.specialty ?? ""} onChange={(e) => set({ specialty: e.target.value })} /></div>
        <div className={u.field}><label htmlFor="e-ph">Teléfono</label><input id="e-ph" type="tel" value={f.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} /></div>
        <div className={u.field}><label htmlFor="e-em">Correo</label><input id="e-em" type="email" value={f.email ?? ""} onChange={(e) => set({ email: e.target.value })} /></div>
        <div className={u.field}><label htmlFor="e-com">Comisión % (opcional)</label><NumInput id="e-com" min={0} max={100} value={f.commission_pct ?? null} onValue={(v) => set({ commission_pct: v })} /></div>
        <div className={`${u.field} ${u.span2}`}><label htmlFor="e-bio">Biografía</label><textarea id="e-bio" value={f.bio ?? ""} onChange={(e) => set({ bio: e.target.value })} /></div>
        <div className={u.span2}><ImageUpload bucket="employee-avatars" value={f.avatar_url ?? null} onChange={(url) => set({ avatar_url: url })} label="Foto" /></div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 40 }}><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} /> Activo</label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 40 }}><input type="checkbox" checked={f.accepts_online_booking} onChange={(e) => set({ accepts_online_booking: e.target.checked })} /> Aparece en reservas en línea</label>
      </section>
      <section className={u.card}>
        <h2>Servicios que realiza</h2>
        {cats.map((c) => (
          <fieldset key={c} style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
            <legend className={u.sub} style={{ marginBottom: 4 }}>{c}</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
              {services.filter((s) => s.category === c).map((s) => (
                <label key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 36 }}>
                  <input type="checkbox" checked={f.service_ids.includes(s.id)} onChange={(e) => set({ service_ids: e.target.checked ? [...f.service_ids, s.id] : f.service_ids.filter((x) => x !== s.id) })} /> {s.name}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </section>
      {err && <Alert>{err}</Alert>}
      <div><Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button></div>
    </form>
  );
}
