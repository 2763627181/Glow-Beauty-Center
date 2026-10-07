"use client";

import { fmtDateTime } from "@/lib/format";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { addBlock, removeBlock, saveSetting } from "@/lib/actions/admin/content";
import type { BusinessSettings } from "@/types/domain";
import { Alert } from "../primitives";
import { fromLocalInput } from "../appointments/useApptActions";
import { ImageUpload } from "../ImageUpload";
import { NumInput } from "../NumInput";
import { useToast } from "../overlay";
import u from "../ui.module.css";

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function useSave() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const save = (fn: () => Promise<{ ok: boolean; error?: string }>, msg = "Guardado") => start(async () => {
    setErr(null);
    const r = await fn();
    if (r.ok) { toast(msg); router.refresh(); } else setErr(r.error ?? "Error");
  });
  return { pending, err, save, setErr };
}

export function BusinessForm({ initial }: { initial: BusinessSettings["business"] }) {
  const [f, setF] = useState(initial);
  const { pending, err, save } = useSave();
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const fld = (k: keyof typeof f, label: string, opts: { type?: string; hint?: string; span?: boolean; placeholder?: string } = {}) => (
    <div className={`${u.field} ${opts.span ? u.span2 : ""}`}>
      <label htmlFor={`b-${k}`}>{label}</label>
      <input id={`b-${k}`} type={opts.type ?? "text"} placeholder={opts.placeholder} value={f[k] ?? ""} onChange={(e) => set({ [k]: e.target.value })} />
      {opts.hint && <span className={u.hint}>{opts.hint}</span>}
    </div>
  );
  return (
    <section className={`${u.card} ${u.form2}`}>
      <h2 className={u.span2}>Datos del negocio</h2>
      {fld("name", "Nombre del negocio")}{fld("tagline", "Frase del negocio", { hint: "Aparece en el pie de página." })}
      {fld("phone", "Teléfono")}{fld("whatsapp", "WhatsApp", { hint: "Solo dígitos con código de país. Ej. 18296198257. Se usa en todos los botones de WhatsApp.", placeholder: "18296198257" })}
      {fld("email", "Correo", { type: "email" })}{fld("instagram", "Instagram", { placeholder: "glowbeautycenter" })}
      {fld("facebook", "Facebook (usuario)")}{fld("tiktok", "TikTok (usuario)")}
      {fld("address", "Dirección", { span: true })}
      {fld("maps_url", "Enlace de Google Maps", { type: "url", span: true, hint: "Pega el enlace de “Compartir” de Google Maps." })}
      <div className={u.span2}><ImageUpload bucket="gallery" value={f.logo_url || null} onChange={(url) => set({ logo_url: url ?? "" })} label="Logo (opcional: reemplaza el nombre en el encabezado y el pie)" /></div>
      {err && <div className={u.span2}><Alert>{err}</Alert></div>}
      <div className={u.span2}><Button size="sm" disabled={pending} onClick={() => save(() => saveSetting("business", f), "Datos guardados")}>Guardar datos del negocio</Button></div>
    </section>
  );
}

export function HoursForm({ initial }: { initial: BusinessSettings["hours"] }) {
  const [h, setH] = useState(initial);
  const { pending, err, save } = useSave();
  return (
    <section className={u.card}>
      <h2>Horario del negocio</h2>
      <p className={u.hint} style={{ marginBottom: 8 }}>Define cuándo se puede reservar. Cada especialista, además, tiene su propio horario en su ficha.</p>
      <div style={{ display: "grid", gap: 8 }}>
        {ORDER.map((d) => {
          const v = h[String(d)];
          return (
            <div key={d} style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 8, alignItems: "center" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 40 }}><input type="checkbox" checked={!!v} onChange={(e) => setH({ ...h, [d]: e.target.checked ? { open: "09:00", close: "18:00" } : null })} />{DAYS[d]}</label>
              {v ? (<>
                <input aria-label={`${DAYS[d]} apertura`} type="time" value={v.open} onChange={(e) => setH({ ...h, [d]: { ...v, open: e.target.value } })} />
                <input aria-label={`${DAYS[d]} cierre`} type="time" value={v.close} onChange={(e) => setH({ ...h, [d]: { ...v, close: e.target.value } })} />
              </>) : <span className={u.sub} style={{ gridColumn: "2 / -1" }}>Cerrado</span>}
            </div>
          );
        })}
      </div>
      {err && <Alert>{err}</Alert>}
      <div style={{ marginTop: 12 }}><Button size="sm" disabled={pending} onClick={() => save(() => saveSetting("hours", h), "Horario guardado")}>Guardar horario</Button></div>
    </section>
  );
}

export function BookingForm({ booking, policies }: { booking: BusinessSettings["booking"]; policies: BusinessSettings["policies"] }) {
  const [b, setB] = useState(booking);
  const [p, setP] = useState(policies.text ?? "");
  const { pending, err, save } = useSave();
  return (
    <section className={`${u.card} ${u.form2}`}>
      <h2 className={u.span2}>Reservas y políticas</h2>
      <div className={u.field}><label htmlFor="bk-min">Anticipación mínima para reservar (horas)</label><NumInput id="bk-min" integer min={0} value={b.min_notice_hours} emptyValue={0} onValue={(v) => setB({ ...b, min_notice_hours: v ?? 0 })} /></div>
      <div className={u.field}><label htmlFor="bk-max">Se puede reservar con hasta (días)</label><NumInput id="bk-max" integer min={1} value={b.max_advance_days} emptyValue={0} onValue={(v) => setB({ ...b, max_advance_days: v ?? 0 })} /></div>
      <div className={u.field}><label htmlFor="bk-slot">Intervalo entre horarios (min)</label>
        <select id="bk-slot" value={b.slot_minutes} onChange={(e) => setB({ ...b, slot_minutes: Number(e.target.value) })}>{[10, 15, 20, 30, 60].map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
      <div className={u.field}><label htmlFor="bk-ch">El cliente puede cancelar en línea hasta (horas antes)</label><NumInput id="bk-ch" integer min={0} value={b.cancel_hours} emptyValue={0} onValue={(v) => setB({ ...b, cancel_hours: v ?? 0 })} /><span className={u.hint}>Pasado ese límite, debe escribirte por WhatsApp.</span></div>
      <div className={u.field}><label htmlFor="bk-sim">Citas al mismo tiempo por especialista (reserva en línea)</label>
        <NumInput id="bk-sim" integer min={0} max={10} value={b.max_simultaneous} emptyValue={0} onValue={(v) => setB({ ...b, max_simultaneous: v ?? 0 })} />
        <span className={u.hint}>0 = sin límite (la web ofrece una hora aunque la especialista ya tenga citas). Con un número, por ejemplo 2, la web deja de ofrecer esa hora cuando se llena. Desde el panel (recepción) siempre puedes agendar todas las que quieras.</span></div>
      <div className={`${u.field} ${u.span2}`}><label htmlFor="bk-can">Política de cancelación (se muestra al cliente)</label><textarea id="bk-can" value={b.cancellation_policy} onChange={(e) => setB({ ...b, cancellation_policy: e.target.value })} /></div>
      <div className={`${u.field} ${u.span2}`}><label htmlFor="bk-pol">Otras políticas</label><textarea id="bk-pol" value={p} onChange={(e) => setP(e.target.value)} /></div>
      <div className={`${u.field} ${u.span2}`}><label>Moneda, idioma y zona horaria</label><p className={u.sub}>Peso dominicano (RD$) · Español (es-DO) · America/Santo_Domingo</p></div>
      {err && <div className={u.span2}><Alert>{err}</Alert></div>}
      <div className={u.span2}><Button size="sm" disabled={pending} onClick={() => save(async () => {
        const r = await saveSetting("booking", b);
        return r.ok ? saveSetting("policies", { text: p }) : r;
      }, "Reservas guardadas")}>Guardar reservas</Button></div>
    </section>
  );
}

type Block = { id: string; starts_at: string; ends_at: string; kind: string; reason: string | null; employee_id: string | null };
const KIND: Record<string, string> = { feriado: "Feriado", manual: "Bloqueo manual", almuerzo: "Break / almuerzo", especial: "Horario especial" };

export function BlocksForm({ blocks, staff }: { blocks: Block[]; staff: { id: string; full_name: string }[] }) {
  const [f, setF] = useState({ employeeId: "", a: "", b: "", kind: "feriado", reason: "" });
  const { pending, err, save } = useSave();
  const name = (id: string | null) => (id ? staff.find((s) => s.id === id)?.full_name ?? "—" : "Todo el negocio");
  const fmt = fmtDateTime;
  return (
    <section className={u.card}>
      <h2>Bloqueos, feriados y horarios especiales</h2>
      <p className={u.hint} style={{ marginBottom: 8 }}>En estos rangos no se ofrecen horarios para reservar. Útil para feriados, cierres, capacitaciones o descansos.</p>
      {blocks.length === 0 && <p className={u.sub}>Sin bloqueos futuros.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {blocks.map((b) => (
          <li key={b.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <span>{fmt(b.starts_at)} → {fmt(b.ends_at)} · {name(b.employee_id)} · {KIND[b.kind] ?? b.kind}{b.reason && ` · ${b.reason}`}</span>
            <Button size="sm" variant="danger" disabled={pending} onClick={() => save(() => removeBlock(b.id), "Bloqueo eliminado")}>Quitar</Button>
          </li>
        ))}
      </ul>
      <div className={u.form2}>
        <div className={u.field}><label htmlFor="bl-e">Aplica a</label>
          <select id="bl-e" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Todo el negocio</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
        <div className={u.field}><label htmlFor="bl-k">Tipo</label>
          <select id="bl-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className={u.field}><label htmlFor="bl-a">Desde</label><input id="bl-a" type="datetime-local" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} /></div>
        <div className={u.field}><label htmlFor="bl-b">Hasta</label><input id="bl-b" type="datetime-local" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })} /></div>
        <div className={`${u.field} ${u.span2}`}><label htmlFor="bl-r">Motivo</label><input id="bl-r" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        {err && <div className={u.span2}><Alert>{err}</Alert></div>}
        <div className={u.span2}><Button size="sm" disabled={pending || !f.a || !f.b} onClick={() => save(async () => {
          const r = await addBlock({ employeeId: f.employeeId || null, startsAt: fromLocalInput(f.a), endsAt: fromLocalInput(f.b), kind: f.kind as "feriado", reason: f.reason });
          if (r.ok) setF({ ...f, a: "", b: "", reason: "" });
          return r;
        }, "Bloqueo agregado")}>Agregar bloqueo</Button></div>
      </div>
    </section>
  );
}
