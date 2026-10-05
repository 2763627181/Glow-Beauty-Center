"use client";

import { usePathname } from "next/navigation";
import { WhatsAppIcon } from "@/components/ui/Icons";
import { useCart } from "./cart/CartProvider";
import s from "./FloatingWhatsApp.module.css";

/** Botón flotante de WhatsApp (se sube cuando aparece el resumen de servicios y se oculta durante la reserva). */
export function FloatingWhatsApp({ href }: { href: string }) {
  const path = usePathname();
  const { lines } = useCart();
  if (path.startsWith("/booking")) return null;
  return (
    <aside aria-label="Contacto rápido">
      <a className={`${s.fab} ${lines.length ? s.up : ""}`} href={href} target="_blank" rel="noopener" aria-label="Escribir por WhatsApp">
        <WhatsAppIcon width={28} height={28} />
      </a>
    </aside>
  );
}
