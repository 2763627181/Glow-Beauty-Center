import Link from "next/link";
import type { BusinessSettings } from "@/types/domain";
import { Brand } from "./Brand";
import s from "./Footer.module.css";

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** "09:00" → "9:00 AM" */
const t12 = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
const handle = (v: string) => v.replace(/^@/, "").replace(/^https?:\/\/(www\.)?(instagram|facebook|tiktok)\.com\/(@)?/i, "").replace(/\/$/, "");

export function Footer({ settings }: { settings: BusinessSettings }) {
  const b = settings.business;
  return (
    <footer className={s.footer}>
      <div className={`container ${s.grid}`}>
        <div>
          <Brand name={b.name} logoUrl={b.logo_url || undefined} light />
          <p className={s.muted}>{b.tagline}</p>
        </div>
        <nav aria-label="Pie de página">
          <h2 className={s.h}>Explorar</h2>
          <Link href="/services">Servicios</Link>
          <Link href="/booking">Reservar cita</Link>
          <Link href="/booking/manage">Consultar o cancelar mi cita</Link>
          <Link href="/gallery">Galería</Link>
          <Link href="/about">Nosotros</Link>
          <Link href="/contact">Contacto</Link>
        </nav>
        <div>
          <h2 className={s.h}>Horario</h2>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const h = settings.hours[String(d)];
            return <p key={d} className={s.muted}>{DAYS[d]}: {h ? `${t12(h.open)} – ${t12(h.close)}` : "Cerrado"}</p>;
          })}
        </div>
        <div>
          <h2 className={s.h}>Visítanos</h2>
          {b.address && (b.maps_url ? <a href={b.maps_url} target="_blank" rel="noopener">{b.address}</a> : <p className={s.muted}>{b.address}</p>)}
          {b.phone && <a href={`tel:${b.phone}`}>{b.phone}</a>}
          {b.email && <a href={`mailto:${b.email}`}>{b.email}</a>}
          {b.instagram && <a href={`https://instagram.com/${handle(b.instagram)}`} target="_blank" rel="noopener">Instagram @{handle(b.instagram)}</a>}
          {b.facebook && <a href={`https://facebook.com/${handle(b.facebook)}`} target="_blank" rel="noopener">Facebook</a>}
          {b.tiktok && <a href={`https://tiktok.com/@${handle(b.tiktok)}`} target="_blank" rel="noopener">TikTok @{handle(b.tiktok)}</a>}
        </div>
      </div>
      <p className={`container ${s.copy}`}>© {new Date().getFullYear()} {b.name}</p>
    </footer>
  );
}
