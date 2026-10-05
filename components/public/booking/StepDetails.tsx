"use client";

import s from "./BookingFlow.module.css";
import type { StepProps } from "./state";

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className={s.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error && <span className={s.err} id={`${id}-err`} role="alert">{error}</span>}
    </div>
  );
}

export function StepDetails({ form, set, errors }: StepProps) {
  const a = (id: string) => ({ "aria-invalid": !!errors[id], "aria-describedby": errors[id] ? `${id}-err` : undefined });
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className={s.grid2}>
        <Field id="firstName" label="Nombre" error={errors.firstName}>
          <input id="firstName" autoComplete="given-name" value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} {...a("firstName")} />
        </Field>
        <Field id="lastName" label="Apellido" error={errors.lastName}>
          <input id="lastName" autoComplete="family-name" value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} {...a("lastName")} />
        </Field>
      </div>
      <Field id="phone" label="WhatsApp" error={errors.phone}>
        <input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="809-555-5555" value={form.phone} onChange={(e) => set({ phone: e.target.value })} {...a("phone")} />
      </Field>
      <Field id="email" label="Correo electrónico (opcional)" error={errors.email}>
        <input id="email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => set({ email: e.target.value })} {...a("email")} />
      </Field>
      <Field id="notes" label="Notas (opcional)">
        <textarea id="notes" maxLength={500} placeholder="Ej. prefiero uñas cortas" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.88rem" }}>
        <input type="checkbox" checked={form.remember} onChange={(e) => set({ remember: e.target.checked })} /> Recordar mis datos en este dispositivo para la próxima vez
      </label>
      <input className={s.hp} tabIndex={-1} autoComplete="off" aria-hidden name="website" value={form.website} onChange={(e) => set({ website: e.target.value })} />
    </div>
  );
}
