"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ButtonAnchor, ButtonLink } from "@/components/ui/Button";
import { CloseIcon, MenuIcon, WhatsAppIcon } from "@/components/ui/Icons";
import s from "./PublicHeader.module.css";

const NAV = [
  { href: "/", label: "Inicio" },
  { href: "/services", label: "Servicios" },
  { href: "/booking", label: "Reservar" },
  { href: "/gallery", label: "Galería" },
  { href: "/about", label: "Nosotros" },
  { href: "/contact", label: "Contacto" },
];

/** `brand` es el logotipo/nombre ya renderizado en el servidor. */
export function PublicHeader({ whatsappHref, brand, name }: { whatsappHref: string; brand: ReactNode; name: string }) {
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const onHero = path === "/";

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <a href="#contenido" className={s.skip}>Saltar al contenido</a>
      <header className={`${s.header} ${scrolled || !onHero ? s.solid : ""}`}>
        <div className={`container ${s.inner}`}>
          <Link href="/" className={s.logo} aria-label={`${name}, inicio`}>{brand}</Link>
          <nav className={s.nav} aria-label="Principal">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}>{n.label}</Link>
            ))}
          </nav>
          <div className={s.actions}>
            <ButtonAnchor variant="whatsapp" size="sm" href={whatsappHref} target="_blank" rel="noopener" aria-label="Escribir por WhatsApp">
              <WhatsAppIcon /> WhatsApp
            </ButtonAnchor>
            <ButtonLink href="/booking" size="sm">Reservar cita</ButtonLink>
          </div>
          <button className={s.burger} onClick={() => setOpen(true)} aria-label="Abrir menú" aria-expanded={open}>
            <MenuIcon />
          </button>
        </div>
      </header>
      <AnimatePresence>
        {open && (
          <>
            <motion.div className={s.overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside
              className={s.drawer} role="dialog" aria-modal="true" aria-label="Menú"
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className={s.drawerTop}>
                <span className={s.logo}>{brand}</span>
                <button className={s.burger} onClick={() => setOpen(false)} aria-label="Cerrar menú"><CloseIcon /></button>
              </div>
              {NAV.map((n) => (<Link key={n.href} href={n.href} className={s.link} onClick={() => setOpen(false)}>{n.label}</Link>))}
              <div className={s.drawerCta}>
                <ButtonLink href="/booking" block>Reservar cita</ButtonLink>
                <ButtonAnchor variant="whatsapp" block href={whatsappHref} target="_blank" rel="noopener"><WhatsAppIcon /> WhatsApp</ButtonAnchor>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
