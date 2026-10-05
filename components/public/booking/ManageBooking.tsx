"use client";

import { useState, useTransition } from "react";
import { Button, ButtonAnchor } from "@/components/ui/Button";
import { WhatsAppIcon } from "@/components/ui/Icons";
import { cancelMyBooking, lookupBooking, type BookingInfo } from "@/lib/actions/manage-booking";
import { fmtDate, fmtTime, money } from "@/lib/format";
import { waLink } from "@/lib/whatsapp";
import s from "./BookingFlow.module.css";

const STATUS: Record<string, string> = {
  solicitud: "Solicitud recibida", contactando: "Te estamos contactando", contactado: "Contactada", confirmado: "Confirmada", en_espera: "En espera",
  en_servicio: "En servicio", completado: "Completada", cancelado: "Cancelada", no_asistio: "No asististe",
};

export function ManageBooking({ initialNumber, whatsapp, business }: { initialNumber: string; whatsapp: string; business: string }) {
  const [number, setNumber] = useState(initialNumber);
  const [phone, setPhone] = useState("");
  const [b, setB] = useState<BookingInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  const find = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setDone(false); setConfirm(false);
    start(async () => { const r = await lookupBooking({ number, phone }); if (r.ok) setB(r.booking); else { setB(null); setErr(r.error); } });
  };
  const cancel = () => start(async () => {
    const r = await cancelMyBooking({ number, phone });
    if (!r.ok) return setErr(r.error);
    setDone(true); setConfirm(false);
    const f = await lookupBooking({ number, phone }); if (f.ok) setB(f.booking);
  });

  return (
    <div className={s.panel} style={{ maxWidth: 560 }}>
      <form className={s.group} onSubmit={find}>
        <div className={s.field}><label htmlFor="m-n">Número de solicitud</label><input id="m-n" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="SOL-1A2B3C4D" autoCapitalize="characters" required /></div>
        <div className={s.field}><label htmlFor="m-p">WhatsApp con el que reservaste</label><input id="m-p" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="809-555-5555" required /></div>
        {err && <p className={s.err} role="alert">{err}</p>}
        <Button type="submit" disabled={pending}>{pending && !b ? "Buscando…" : "Consultar mi cita"}</Button>
      </form>

      {b && (
        <div className={s.successCard} style={{ width: "100%", marginTop: 18 }}>
          <strong>Hola {b.first_name} · {STATUS[b.status] ?? b.status}</strong>
          {b.lines.map((l) => <span key={l.name}>{l.name}{l.quantity > 1 ? ` ×${l.quantity}` : ""}</span>)}
          <span>{fmtDate(b.start_time, { weekday: "long", day: "numeric", month: "long" })} · {fmtTime(b.start_time)}</span>
          <span>Precio aproximado: <strong>{money(b.total)}</strong></span>
          <span className={s.muted}>Solicitud {b.request_number}</span>
          {done && <span role="status" style={{ color: "var(--color-success)", fontWeight: 600 }}>Tu cita fue cancelada. ¡Esperamos verte pronto!</span>}
          {!done && b.cancellable && !confirm && <Button variant="danger" size="sm" onClick={() => setConfirm(true)}>Cancelar mi cita</Button>}
          {!done && confirm && (
            <div style={{ display: "grid", gap: 8 }}>
              <span>¿Seguro que quieres cancelar? Esta acción libera tu horario.</span>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="danger" size="sm" disabled={pending} onClick={cancel}>{pending ? "Cancelando…" : "Sí, cancelar"}</Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirm(false)}>Volver</Button>
              </div>
            </div>
          )}
          {!done && !b.cancellable && ["solicitud", "contactando", "contactado", "confirmado"].includes(b.status) && (
            <span className={s.muted}>Ya no se puede cancelar en línea (límite: {b.cancel_hours} horas antes). Escríbenos y lo resolvemos.</span>
          )}
          <ButtonAnchor variant="whatsapp" size="sm" href={waLink(whatsapp, `Hola ${business} ✨ Escribo por mi solicitud ${b.request_number}.`)} target="_blank" rel="noopener"><WhatsAppIcon width={18} height={18} /> Hablar con el salón</ButtonAnchor>
        </div>
      )}
    </div>
  );
}
