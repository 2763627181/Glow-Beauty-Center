"use client";

import { motion } from "motion/react";
import { ButtonAnchor, ButtonLink } from "@/components/ui/Button";
import { CheckIcon, WhatsAppIcon } from "@/components/ui/Icons";
import { fmtDate, money } from "@/lib/format";
import { bookingMessage, waLink } from "@/lib/whatsapp";
import s from "./BookingFlow.module.css";
import { to12h } from "./BookingSummary";

export type Confirmed = {
  requestNumber: string; name: string; date: string; time: string; start: string; durationMin: number; phone: string;
  lines: { name: string; price: number }[]; total: number; whatsappNumber: string;
};

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function icsLink(c: Confirmed, businessName: string) {
  const start = new Date(c.start);
  const end = new Date(start.getTime() + c.durationMin * 60_000);
  const body = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Glow Beauty Center//ES", "BEGIN:VEVENT",
    `UID:${c.requestNumber}@glowbeautycenter`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:Cita en ${businessName}`, `DESCRIPTION:${c.lines.map((l) => l.name).join(", ")} (solicitud ${c.requestNumber})`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(body);
}

function googleLink(c: Confirmed, businessName: string) {
  const start = new Date(c.start);
  const end = new Date(start.getTime() + c.durationMin * 60_000);
  const q = new URLSearchParams({ action: "TEMPLATE", text: `Cita en ${businessName}`, dates: `${stamp(start)}/${stamp(end)}`, details: `${c.lines.map((l) => l.name).join(", ")} (solicitud ${c.requestNumber})` });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function BookingSuccess({ c, businessName }: { c: Confirmed; businessName: string }) {
  const msg = bookingMessage({ services: c.lines, total: c.total, date: `${c.date}T12:00:00-04:00`, time: to12h(c.time), name: c.name, business: businessName })
    + `\n\nNúmero de solicitud: ${c.requestNumber}`;
  return (
    <div className={s.success} role="status">
      <motion.div className={s.successMark} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
        <CheckIcon width={44} height={44} strokeWidth={2.2} />
      </motion.div>
      <h2>Solicitud recibida ✨</h2>
      <p className={s.muted}>Te contactaremos por WhatsApp para confirmar tu cita.</p>
      <div className={s.successCard}>
        <strong>{c.name}</strong>
        {c.lines.map((l) => <span key={l.name}>{l.name}</span>)}
        <span>{fmtDate(`${c.date}T12:00:00-04:00`, { weekday: "long", day: "numeric", month: "long" })} · {to12h(c.time)}</span>
        <span>Precio aproximado: <strong>{money(c.total)}</strong></span>
        <span className={s.muted}>Solicitud n.º <strong>{c.requestNumber}</strong> — guárdala para consultar o cancelar tu cita.</span>
      </div>
      <div className={s.actionsCol}>
        <ButtonAnchor variant="whatsapp" block href={waLink(c.whatsappNumber, msg)} target="_blank" rel="noopener"><WhatsAppIcon /> Hablar por WhatsApp</ButtonAnchor>
        <ButtonAnchor variant="secondary" block href={googleLink(c, businessName)} target="_blank" rel="noopener">Agregar a Google Calendar</ButtonAnchor>
        <ButtonAnchor variant="secondary" block href={icsLink(c, businessName)} download="cita.ics">Descargar para otro calendario (.ics)</ButtonAnchor>
        <ButtonLink variant="secondary" block href={`/booking/manage?number=${encodeURIComponent(c.requestNumber)}`}>Consultar o cancelar mi cita</ButtonLink>
        <ButtonLink variant="soft" block href="/">Volver al inicio</ButtonLink>
      </div>
    </div>
  );
}
