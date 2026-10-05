"use client";

import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Button, ButtonAnchor } from "@/components/ui/Button";
import { CheckIcon, ClockIcon, PlusIcon, WhatsAppIcon } from "@/components/ui/Icons";
import { duration, money } from "@/lib/format";
import { bookingMessage, waLink } from "@/lib/whatsapp";
import type { Service } from "@/types/domain";
import { useCart } from "./CartProvider";
import s from "./ServiceCard.module.css";

/** `level`: nivel del título según el lugar donde se use (2 si cuelga directo del h1; 3 bajo un h2; "none" si el nombre ya es el h1 de la página). */
export function ServiceCard({ service, level = 3 }: { service: Service; level?: 2 | 3 | "none" }) {
  const cart = useCart();
  const Title = level === "none" ? "p" : (`h${level}` as "h2" | "h3");
  const on = cart.has(service.id);
  const item = cart.items.find((i) => i.serviceId === service.id);
  const variant = service.variants.find((v) => v.id === item?.variantId) ?? service.variants[0];
  const minVariant = service.variants.length ? Math.min(...service.variants.map((v) => v.price)) : null;
  const shownPrice = on && variant ? variant.price : (minVariant ?? service.price);
  const fromLabel = service.price_from || (!on && service.variants.length > 0);
  const shownDur = on && variant ? variant.duration_minutes : (service.variants[0]?.duration_minutes ?? service.duration_minutes);

  const waText = bookingMessage({ services: [{ name: service.name, price: shownPrice }], total: shownPrice });

  return (
    <motion.article layout className={`${s.card} ${on ? s.selected : ""}`}>
      <Link href={`/services/${service.slug}`} className={s.media} aria-hidden="true" tabIndex={-1}>
        {service.image_url
          ? <Image src={service.image_url} alt="" fill sizes="(max-width: 700px) 100vw, 400px" style={{ objectFit: "cover" }} />
          : <span className={s.mark} aria-hidden>Glow</span>}
        {service.featured && <span className={s.badge}>Favorito</span>}
      </Link>
      <div className={s.body}>
        {service.featured && <span className="sr-only">Servicio favorito. </span>}
        <Title className={s.title}><Link href={`/services/${service.slug}`}>{service.name}</Link></Title>
        {service.short_description && <p className={s.desc}>{service.short_description}</p>}

        <AnimatePresence initial={false}>
          {on && (service.variants.length > 0 || service.addons.length > 0) && (
            <motion.div className={s.opts} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              {service.variants.length > 0 && (
                <div role="radiogroup" aria-label="Opciones">
                  <span className={s.label}>Opción</span>
                  <div className={s.chips}>
                    {service.variants.map((v) => (
                      <button key={v.id} role="radio" aria-checked={item?.variantId === v.id}
                        className={`${s.chip} ${item?.variantId === v.id ? s.chipOn : ""}`}
                        onClick={() => cart.setVariant(service.id, v.id)}>
                        {v.name} · {money(v.price)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {service.addons.length > 0 && (
                <div>
                  <span className={s.label}>Complementos</span>
                  <div className={s.chips}>
                    {service.addons.map((a) => {
                      const sel = item?.addonIds.includes(a.id);
                      return (
                        <button key={a.id} aria-pressed={sel} className={`${s.chip} ${sel ? s.chipOn : ""}`}
                          onClick={() => cart.toggleAddon(service.id, a.id)}>
                          {a.name} + {money(a.price)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className={s.meta}>
          <span className={s.price}>{fromLabel && <small>desde</small>}{money(shownPrice)}</span>
          <span className={s.dur}><ClockIcon width={16} height={16} />{duration(shownDur)}</span>
        </div>
        <div className={s.actions}>
          <Button variant={on ? "soft" : "primary"} size="sm" onClick={() => cart.toggle(service.id)} aria-pressed={on}>
            {on ? <><CheckIcon width={18} height={18} /> Agregado</> : <><PlusIcon width={18} height={18} /> Agregar</>}
          </Button>
          <ButtonAnchor variant="whatsapp" size="sm" aria-label={`Consultar ${service.name} por WhatsApp`}
            href={waLink(cart.whatsappNumber, waText)} target="_blank" rel="noopener">
            <WhatsAppIcon width={18} height={18} />
          </ButtonAnchor>
        </div>
      </div>
    </motion.article>
  );
}
