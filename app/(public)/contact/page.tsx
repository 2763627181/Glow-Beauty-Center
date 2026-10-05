import type { Metadata } from "next";
import { ButtonAnchor } from "@/components/ui/Button";
import { WhatsAppIcon } from "@/components/ui/Icons";
import { getSettings } from "@/lib/data/catalog";
import { waLink } from "@/lib/whatsapp";
import s from "../page.module.css";

export const metadata: Metadata = {
  title: "Contacto",
  description: "Escríbenos por WhatsApp, llámanos o visítanos.",
  alternates: { canonical: "/contact" },
};

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const t12 = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
const handle = (v: string) => v.replace(/^@/, "");

export default async function ContactPage() {
  const st = await getSettings();
  const b = st.business;
  const wa = b.whatsapp || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "";
  return (
    <div className={`container ${s.page}`}>
      <div className={s.head}>
        <span className="eyebrow">Contacto</span>
        <h1 style={{ fontSize: "clamp(2.4rem,6vw,3.8rem)" }}>{st.content.contact_title}</h1>
        {st.content.contact_text && <p style={{ whiteSpace: "pre-line" }}>{st.content.contact_text}</p>}
      </div>
      <div className={s.two}>
        <div className={s.prose}>
          {b.address && <p><strong>Dirección:</strong> {b.address}</p>}
          {b.phone && <p><strong>Teléfono:</strong> <a href={`tel:${b.phone}`}>{b.phone}</a></p>}
          {b.email && <p><strong>Correo:</strong> <a href={`mailto:${b.email}`}>{b.email}</a></p>}
          {b.instagram && <p><strong>Instagram:</strong> <a href={`https://instagram.com/${handle(b.instagram)}`} target="_blank" rel="noopener">@{handle(b.instagram)}</a></p>}
          {b.facebook && <p><strong>Facebook:</strong> <a href={`https://facebook.com/${b.facebook}`} target="_blank" rel="noopener">{b.facebook}</a></p>}
          {b.tiktok && <p><strong>TikTok:</strong> <a href={`https://tiktok.com/@${handle(b.tiktok)}`} target="_blank" rel="noopener">@{handle(b.tiktok)}</a></p>}
          <div><strong>Horario</strong>{[1, 2, 3, 4, 5, 6, 0].map((d) => { const h = st.hours[String(d)]; return <p key={d} style={{ fontSize: "0.92rem" }}>{DAYS[d]}: {h ? `${t12(h.open)} – ${t12(h.close)}` : "Cerrado"}</p>; })}</div>
          {st.booking.cancellation_policy && <p><strong>Cancelaciones:</strong> {st.booking.cancellation_policy}</p>}
          {st.policies.text && <p style={{ whiteSpace: "pre-line" }}>{st.policies.text}</p>}
          <div><ButtonAnchor variant="whatsapp" href={waLink(wa, `Hola ${b.name} ✨`)} target="_blank" rel="noopener"><WhatsAppIcon /> Escribir por WhatsApp</ButtonAnchor></div>
        </div>
        {b.maps_url && (
          <a href={b.maps_url} target="_blank" rel="noopener" style={{ display: "grid", placeItems: "center", minHeight: 240, borderRadius: 22, background: "var(--color-cream)", textAlign: "center", padding: 24, fontFamily: "var(--font-serif)", fontSize: "1.6rem" }}>
            Ver cómo llegar en Google Maps →
          </a>
        )}
      </div>
    </div>
  );
}
