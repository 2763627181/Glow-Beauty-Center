import { money, fmtDate } from "./format";
import { toWaNumber } from "./phone";

export function waLink(phone: string, message: string) {
  return `https://wa.me/${toWaNumber(phone)}?text=${encodeURIComponent(message)}`;
}

export type WaServiceLine = { name: string; price: number };

export function bookingMessage(p: {
  services: WaServiceLine[];
  total: number;
  date?: string; // ISO
  time?: string; // "3:00 PM"
  name?: string;
  business?: string;
}) {
  const lines = p.services.map((s) => `• ${s.name} – ${money(s.price)}`).join("\n");
  return [
    `Hola ${p.business ?? "Glow Beauty Center"} ✨`,
    "",
    "Me gustaría reservar los siguientes servicios:",
    "",
    lines,
    ...(p.date ? ["", "Fecha preferida:", fmtDate(p.date, { day: "numeric", month: "long" })] : []),
    ...(p.time ? ["", "Hora:", p.time] : []),
    ...(p.name ? ["", "Mi nombre es:", p.name] : []),
    "",
    "Precio estimado:",
    money(p.total),
    "",
    "¿Me pueden confirmar disponibilidad?",
  ].join("\n");
}
