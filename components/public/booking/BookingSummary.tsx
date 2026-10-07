"use client";

import { duration, fmtDate, money } from "@/lib/format";
import type { Employee } from "@/types/domain";
import { useCart } from "../cart/CartProvider";
import s from "./BookingFlow.module.css";
import { effectiveMinutes, type BookingForm } from "./state";

export const to12h = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

export function BookingSummary({ form, employees, showClient = false }: { form: BookingForm; employees: Employee[]; showClient?: boolean }) {
  const cart = useCart();
  const who = (serviceId: string) => {
    const ids = form.staff[serviceId] ?? [];
    return ids.length ? ids.map((id) => employees.find((e) => e.id === id)?.full_name).filter(Boolean).join(" + ") : "Cualquier especialista disponible";
  };
  const minutes = effectiveMinutes(cart.minutes, cart.lines.map((l) => l.duration), form.parallel);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {cart.lines.length === 0 && <p className={s.muted}>Aún no has elegido servicios.</p>}
      {cart.lines.map((l) => (
        <div key={l.item.serviceId}>
          <div className={s.sumLine}><span>{l.name}</span><span>{money(l.price)}</span></div>
          <p className={s.muted} style={{ margin: "2px 0 0" }}>Con {who(l.item.serviceId)}</p>
        </div>
      ))}
      {cart.lines.length > 0 && (
        <>
          {cart.promo && cart.discount > 0 && <div className={s.sumLine} style={{ color: "var(--color-success)" }}><span>Combo “{cart.promo.name}”</span><span>−{money(cart.discount)}</span></div>}
          <div className={s.sumTotal}><span>Total estimado</span><span>{money(cart.total)}</span></div>
          <p className={s.muted}>Duración aproximada: {duration(minutes)}{form.parallel && cart.lines.length > 1 ? " (al mismo tiempo)" : ""}</p>
        </>
      )}
      {form.date && <p className={s.muted}>Fecha: {fmtDate(`${form.date}T12:00:00-04:00`, { weekday: "long", day: "numeric", month: "long" })}</p>}
      {form.slot && <p className={s.muted}>Hora: {to12h(form.slot.time)}</p>}
      {showClient && (
        <p className={s.muted}>{form.firstName} {form.lastName} · {form.phone}{form.email ? ` · ${form.email}` : ""}</p>
      )}
    </div>
  );
}
