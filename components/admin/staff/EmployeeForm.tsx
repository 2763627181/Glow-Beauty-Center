"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { saveEmployee, type EmployeeInput } from "@/lib/actions/admin/staff";
import { MAX_DAY, MONTHS } from "@/lib/domain/birthday";
import { commissionFromSalonPct, salonPctFromCommission } from "@/lib/domain/cash";
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
        <div className={u.field}><label htmlFor="e-com">Comisión % (lo que se queda ella)</label><NumInput id="e-com" min={0} max={100} value={f.commission_pct ?? null} onValue={(v) => set({ commission_pct: v })} /></div>
        <div className={u.field}><label htmlFor="e-salon">Paga al salón %</label><NumInput id="e-salon" min={0} max={100} value={salonPctFromCommission(f.commission_pct)} onValue={(v) => set({ commission_pct: commissionFromSalonPct(v) })} aria-describedby="e-salon-hint" />
          <span id="e-salon-hint" className={u.hint}>Es lo mismo que la comisión, visto al revés: si de lo que produce paga el 15% al salón, escribe 15 y su comisión queda en 85. Se usa en la Caja y en la Nómina.</span></div>
        <div className={u.field}><label htmlFor="e-base">Sueldo base por pago, RD$ (opcional)</label><NumInput id="e-base" min={0} value={f.base_salary ?? null} emptyValue={0} onValue={(v) => set({ base_salary: v ?? 0 })} />
          <span className={u.hint}>Si cobra un monto fijo además de la comisión. Se copia a cada nómina y ahí se puede ajustar.</span></div>
        <div className={u.field}><label htmlFor="e-bd">Cumpleaños (día y mes)</label>
          <div style={{ display: "grid", gridTemplateColumns: "90px minmax(0, 1fr)", gap: 8 }}>
            <select id="e-bd" aria-label="Día de cumpleaños" value={f.birth_day ?? ""} onChange={(e) => set({ birth_day: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Día</option>
              {Array.from({ length: f.birth_month ? MAX_DAY[f.birth_month - 1] : 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select aria-label="Mes de cumpleaños" value={f.birth_month ?? ""} onChange={(e) => {
              const m = e.target.value ? Number(e.target.value) : null;
              set({ birth_month: m, birth_day: m && f.birth_day && f.birth_day > MAX_DAY[m - 1] ? MAX_DAY[m - 1] : f.birth_day });
            }}>
              <option value="">Mes</option>
              {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n[0].toUpperCase() + n.slice(1)}</option>)}
            </select>
          </div>
          <span className={u.hint}>Ese día te aparece una notificación para felicitarla. El año no hace falta.</span></div>
        <div className={`${u.field} ${u.span2}`}><label htmlFor="e-bio">Biografía</label><textarea id="e-bio" value={f.bio ?? ""} onChange={(e) => set({ bio: e.target.value })} /></div>
        <div className={u.span2}><ImageUpload bucket="employee-avatars" value={f.avatar_url ?? null} onChange={(url) => set({ avatar_url: url })} label="Foto" /></div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 40 }}><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} /> Activo</label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 40 }}><input type="checkbox" checked={f.accepts_online_booking} onChange={(e) => set({ accepts_online_booking: e.target.checked })} /> Aparece en reservas en línea</label>
      </section>
      <section className={u.card}>
        <h2>Servicios que realiza</h2>
        {cats.map((c) => (
          <fieldset key={c} style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
            <legend className={u.sub} style={{ marginBottom: 4 }}>{c}{" "}
              <button type="button" className={u.link} style={{ background: "none", border: 0, cursor: "pointer", marginLeft: 8, font: "inherit" }}
                onClick={() => {
                  const ids = services.filter((s) => s.category === c).map((s) => s.id);
                  const all = ids.every((id) => f.service_ids.includes(id));
                  set({ service_ids: all ? f.service_ids.filter((id) => !ids.includes(id)) : [...new Set([...f.service_ids, ...ids])] });
                }}>
                {services.filter((s) => s.category === c).every((s) => f.service_ids.includes(s.id)) ? "Quitar todos" : "Marcar todos"}
              </button></legend>
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
