"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { fmtDate, money } from "@/lib/format";
import type { Promotion } from "@/types/domain";
import { useCart } from "../cart/CartProvider";
import s from "./PromoCard.module.css";

/** Combo: al pulsar, sus servicios pasan a la reserva con el precio promocional. */
export function PromoCard({ promo }: { promo: Promotion }) {
  const cart = useCart();
  const router = useRouter();
  const names = promo.service_ids.map((id) => cart.catalog.services.find((x) => x.id === id)?.name).filter(Boolean) as string[];
  const available = names.length === promo.service_ids.length && names.length > 0;
  return (
    <article className={s.promo}>
      {promo.image_url && <div className={s.img}><Image src={promo.image_url} alt="" fill sizes="(max-width: 700px) 100vw, 360px" style={{ objectFit: "cover" }} /></div>}
      <div className={s.body}>
        <h3>{promo.name}</h3>
        {promo.description && <p>{promo.description}</p>}
        {names.length > 0 && <p className={s.incl}>Incluye: {names.join(" + ")}</p>}
        <p className={s.price}>{promo.original_price != null && <del>{money(promo.original_price)}</del>}<strong>{money(promo.promo_price)}</strong></p>
        {promo.ends_on && <p className={s.until}>Válida hasta el {fmtDate(`${promo.ends_on}T12:00:00-04:00`, { day: "numeric", month: "long" })}</p>}
        <Button size="sm" variant="soft" disabled={!available} onClick={() => { if (cart.applyPromo(promo.id)) router.push("/booking"); }}>Reservar este combo</Button>
      </div>
    </article>
  );
}
