"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { createManualAppointment, findClientByPhone } from "@/lib/actions/admin/appointments";
import { money } from "@/lib/format";
import { useAdmin, useCan } from "../AdminContext";
import { Alert } from "../primitives";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";
import { eligibleStaff } from "./lines";
import { fromLocalInput, toLocalInput } from "./useApptActions";

export type Preset = { start?: string; employeeId?: string; phone?: string; firstName?: string; lastName?: string; email?: string };
type Mode = "cita" | "walkin";

const blank = { phone: "", firstName: "", lastName: "", email: "", source: "phone", employeeId: "", when: "", status: "confirmado", notes: "" };

/** Alta de cita manual (teléfono, WhatsApp, Instagram, recepción) o de cliente sin cita. */
export function NewAppointmentDialog({ mode, preset, onClose }: { mode: Mode; preset?: Preset; onClose: () => void }) {
  const { options, staff, links } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(() => ({
    ...blank,
    ...(mode === "walkin" ? { source: "walk_in", status: "en_espera" } : { when: toLocalInput(preset?.start ?? new Date(Date.now() + 3600_000).toISOString()) }),
    employeeId: preset?.employeeId ?? "",
    phone: preset?.phone ?? "", firstName: preset?.firstName ?? "", lastName: preset?.lastName ?? "", email: preset?.email ?? "",
  }));
  const [sel, setSel] = useState<string[]>([]);
  const [empBy, setEmpBy] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [known, setKnown] = useState<string | null>(null);

  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  const chosen = sel.map((k) => options.find((o) => o.key === k)!).filter(Boolean);
  const total = chosen.reduce((t, o) => t + o.price, 0);
  const minutes = chosen.reduce((t, o) => t + o.durationMin, 0);
  const shown = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())), [options, q]);

  function toggle(key: string, on: boolean) {
    setError(null);
    const o = options.find((x) => x.key === key)!;
    if (on) {
      const ok = f.employeeId && eligibleStaff(o.serviceId, staff, links).some((s) => s.id === f.employeeId);
      setEmpBy((m) => ({ ...m, [key]: ok ? f.employeeId : "" }));
      setSel((x) => [...x, key]);
    } else setSel((x) => x.filter((k) => k !== key));
  }

  async function lookup() {
    const c = await findClientByPhone(f.phone);
    if (c) { set({ firstName: c.first_name, lastName: c.last_name, email: c.email ?? "" }); setKnown(`Cliente existente: ${c.first_name} ${c.last_name}`); } else setKnown(null);
  }

  function submit() {
    setError(null);
    if (!chosen.length) return setError("Selecciona al menos un servicio.");
    start(async () => {
      const r = await createManualAppointment({
        firstName: f.firstName, lastName: f.lastName, phone: f.phone, email: f.email, notes: f.notes || undefined,
        source: f.source as "admin", start: mode === "walkin" ? new Date().toISOString() : fromLocalInput(f.when),
        status: f.status as "confirmado",
        items: chosen.map((o) => ({ serviceId: o.serviceId, variantId: o.variantId, addonIds: [], employeeId: empBy[o.key] || null })),
      });
      if (!r.ok) return setError(r.error);
      toast(mode === "walkin" ? "Cliente registrado" : "Cita creada");
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal open onClose={onClose} title={mode === "walkin" ? "Cliente sin cita" : "Nueva cita"} wide>
      <div className={u.form2}>
        <div className={u.field}><label htmlFor="n-phone">WhatsApp / teléfono</label>
          <input id="n-phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} onBlur={lookup} placeholder="809-555-5555" />
          {known && <span className={u.hint}>{known}</span>}</div>
        <div className={u.field}><label htmlFor="n-email">Correo (opcional)</label><input id="n-email" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></div>
        <div className={u.field}><label htmlFor="n-fn">Nombre</label><input id="n-fn" value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} /></div>
        <div className={u.field}><label htmlFor="n-ln">Apellido</label><input id="n-ln" value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} /></div>
        {mode === "cita" && (
          <>
            <div className={u.field}><label htmlFor="n-src">Origen</label>
              <select id="n-src" value={f.source} onChange={(e) => set({ source: e.target.value })}>
                <option value="phone">Teléfono</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="admin">Recepción</option>
              </select></div>
            <div className={u.field}><label htmlFor="n-when">Fecha y hora</label><input id="n-when" type="datetime-local" value={f.when} onChange={(e) => set({ when: e.target.value })} /></div>
          </>
        )}
        <div className={u.field}><label htmlFor="n-emp">Especialista (para todos los servicios)</label>
          <select id="n-emp" value={f.employeeId} onChange={(e) => {
            const id = e.target.value; set({ employeeId: id });
            if (id) setEmpBy((m) => Object.fromEntries(sel.map((k) => [k, eligibleStaff(options.find((o) => o.key === k)!.serviceId, staff, links).some((s) => s.id === id) ? id : m[k] ?? ""])));
          }}>
            <option value="">Sin asignar</option>
            {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select></div>
        <div className={u.field}><label htmlFor="n-st">Estado inicial</label>
          <select id="n-st" value={f.status} onChange={(e) => set({ status: e.target.value })}>
            {mode === "walkin"
              ? <><option value="en_espera">En espera</option><option value="en_servicio">En servicio</option></>
              : <><option value="confirmado">Confirmado</option><option value="solicitud">Solicitud</option></>}
          </select></div>

        <fieldset className={u.span2} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>Servicios ({sel.length}) · {money(total)} · {minutes} min</legend>
          <input aria-label="Buscar servicio" type="search" placeholder="Buscar servicio…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8, minHeight: 42, borderRadius: 12, border: "1px solid rgb(41 37 36 / 0.2)", padding: "0 12px", width: "100%" }} />
          <div style={{ maxHeight: 220, overflow: "auto", display: "grid", gap: 2, border: "var(--border)", borderRadius: 12, padding: 8, background: "#fff" }}>
            {shown.map((o) => (
              <label key={o.key} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 38 }}>
                <input type="checkbox" checked={sel.includes(o.key)} onChange={(e) => toggle(o.key, e.target.checked)} />
                <span style={{ flex: 1 }}>{o.label}</span><span>{money(o.price)}</span>
              </label>
            ))}
            {!shown.length && <span className={u.hint}>Sin resultados.</span>}
          </div>
        </fieldset>

        {chosen.length > 0 && (
          <div className={u.span2} style={{ display: "grid", gap: 8 }}>
            <strong style={{ fontSize: "0.9rem" }}>Especialista por servicio (se agendan en este orden, uno tras otro)</strong>
            {chosen.map((o) => (
              <div key={o.key} style={{ display: "grid", gridTemplateColumns: "1fr 190px", gap: 8, alignItems: "center" }}>
                <span>{o.label}</span>
                <select aria-label={`Especialista para ${o.label}`} value={empBy[o.key] ?? ""} onChange={(e) => setEmpBy((m) => ({ ...m, [o.key]: e.target.value }))} style={{ minHeight: 40, borderRadius: 10, padding: "0 8px" }}>
                  <option value="">Sin asignar</option>
                  {eligibleStaff(o.serviceId, staff, links).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}

        <div className={`${u.field} ${u.span2}`}><label htmlFor="n-notes">Notas</label><textarea id="n-notes" maxLength={500} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
        {error && <div className={u.span2}><Alert>{error}</Alert></div>}
        <div className={u.span2}><Button block onClick={submit} disabled={pending || sel.length === 0}>{pending ? "Guardando…" : mode === "walkin" ? "Registrar" : "Crear cita"}</Button></div>
      </div>
    </Modal>
  );
}

/** Botones "Nueva cita" y "Cliente sin cita" con su diálogo. Solo para quien puede gestionar citas. */
export function NewAppointment() {
  const can = useCan("manageAppointments");
  const [mode, setMode] = useState<Mode | null>(null);
  if (!can) return null;
  return (
    <>
      <Button size="sm" onClick={() => setMode("cita")}>+ Nueva cita</Button>
      <Button size="sm" variant="soft" onClick={() => setMode("walkin")}>Cliente sin cita</Button>
      {mode && <NewAppointmentDialog mode={mode} onClose={() => setMode(null)} />}
    </>
  );
}

/** Botón "Agendar cita" desde la ficha de un cliente (precarga sus datos). */
export function NewForClient({ client }: { client: { phone: string; first_name: string; last_name: string; email: string | null } }) {
  const can = useCan("manageAppointments");
  const [open, setOpen] = useState(false);
  if (!can) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Agendar cita</Button>
      {open && <NewAppointmentDialog mode="cita" preset={{ phone: client.phone, firstName: client.first_name, lastName: client.last_name, email: client.email ?? "" }} onClose={() => setOpen(false)} />}
    </>
  );
}
