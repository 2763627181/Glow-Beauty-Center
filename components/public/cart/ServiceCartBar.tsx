"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ButtonLink } from "@/components/ui/Button";
import { duration, money } from "@/lib/format";
import { useCart } from "./CartProvider";
import s from "./ServiceCartBar.module.css";

/** Resumen flotante de servicios seleccionados. */
export function ServiceCartBar() {
  const cart = useCart();
  const path = usePathname();
  const hidden = path.startsWith("/booking");
  const n = cart.lines.length;
  return (
    <AnimatePresence>
      {n > 0 && !hidden && (
        <motion.aside
          className={s.bar} aria-label="Resumen de servicios seleccionados"
          initial={{ y: 90, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 90, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        >
          <div className={s.info} aria-live="polite">
            <strong>{n} {n === 1 ? "servicio seleccionado" : "servicios seleccionados"}</strong>
            <span>{money(cart.total)} estimado{cart.promo ? ` · ${cart.promo.name}` : ""} · {duration(cart.minutes)}</span>
          </div>
          <div className={s.actions}>
            <button className={s.clear} onClick={cart.clear}>Vaciar</button>
            <ButtonLink href="/booking" size="sm">Continuar reserva</ButtonLink>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
