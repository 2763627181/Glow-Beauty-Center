"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtDate, todayISO } from "@/lib/format";
import { useCart } from "../cart/CartProvider";
import s from "./BookingFlow.module.css";
import type { StepProps } from "./state";

type Slot = { time: string; start: string };

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00-04:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const label = (iso: string) => {
  return {
    dow: fmtDate(iso + "T12:00:00-04:00", { weekday: "short" }),
    day: fmtDate(iso + "T12:00:00-04:00", { day: "numeric" }),
    month: fmtDate(iso + "T12:00:00-04:00", { month: "short" }),
  };
};
const to12h = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

export function StepDateTime({ form, set, maxDays }: StepProps & { maxDays: number }) {
  const cart = useCart();
  const today = todayISO();
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), [today]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const itemsKey = JSON.stringify(cart.items);

  useEffect(() => {
    if (!form.date) return;
    const ctrl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga asíncrona dependiente de la fecha
    setSlots(null); setMsg(null);
    fetch("/api/availability", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
      body: JSON.stringify({ date: form.date, employeeId: form.employeeId, items: JSON.parse(itemsKey) }),
    })
      .then((r) => r.json())
      .then((d) => { setSlots(d.slots ?? []); setMsg(d.error ?? null); })
      .catch((e) => { if (e.name !== "AbortError") { setSlots([]); setMsg("No pudimos cargar los horarios. Revisa tu conexión."); } });
    return () => ctrl.abort();
  }, [form.date, form.employeeId, itemsKey]);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div className={s.group}>
        <h3>Día</h3>
        <div className={s.days} role="radiogroup" aria-label="Día de la cita">
          {days.map((d) => {
            const l = label(d);
            const on = form.date === d;
            return (
              <button key={d} type="button" role="radio" aria-checked={on} className={`${s.day} ${on ? s.dayOn : ""}`}
                onClick={() => set({ date: d, slot: null })}>
                <small>{l.dow}</small><strong>{l.day}</strong><small>{l.month}</small>
              </button>
            );
          })}
        </div>
        <div className={s.field}>
          <label htmlFor="other-date">¿Otro día?</label>
          <input id="other-date" type="date" min={today} max={addDays(today, maxDays)} value={form.date}
            onChange={(e) => e.target.value && set({ date: e.target.value, slot: null })} />
        </div>
      </div>

      {form.date && (
        <div className={s.group} aria-live="polite">
          <h3>Hora</h3>
          {slots === null && <p className={s.muted}>Buscando horarios disponibles…</p>}
          {slots && slots.length === 0 && (
            <p className={s.muted}>{msg ?? "No hay horarios disponibles ese día. Prueba con otra fecha o escríbenos por WhatsApp."}</p>
          )}
          {slots && slots.length > 0 && (
            <div className={s.times} role="radiogroup" aria-label="Hora de la cita">
              {slots.map((t) => (
                <button key={t.start} type="button" role="radio" aria-checked={form.slot?.start === t.start}
                  className={`${s.time} ${form.slot?.start === t.start ? s.timeOn : ""}`} onClick={() => set({ slot: t })}>
                  {to12h(t.time)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
