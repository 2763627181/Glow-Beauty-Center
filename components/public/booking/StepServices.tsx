"use client";

import { CheckIcon } from "@/components/ui/Icons";
import { duration, money } from "@/lib/format";
import { useCart } from "../cart/CartProvider";
import s from "./BookingFlow.module.css";

export function StepServices() {
  const cart = useCart();
  const { categories, services } = cart.catalog;
  return (
    <div style={{ display: "grid", gap: 22 }}>
      {categories.map((c) => {
        const list = services.filter((x) => x.category_id === c.id);
        if (!list.length) return null;
        return (
          <section key={c.id} className={s.group} aria-label={c.name}>
            <h3>{c.name}</h3>
            {list.map((svc) => {
              const on = cart.has(svc.id);
              const item = cart.items.find((i) => i.serviceId === svc.id);
              const min = svc.variants.length ? Math.min(...svc.variants.map((v) => v.price)) : svc.price;
              return (
                <div key={svc.id}>
                  <button type="button" role="checkbox" aria-checked={on} className={`${s.row} ${on ? s.rowOn : ""}`} onClick={() => cart.toggle(svc.id)}>
                    <span className={s.check}>{on && <CheckIcon width={16} height={16} />}</span>
                    <span className={s.rowMain}>
                      <strong>{svc.name}</strong>
                      <small>{duration(svc.duration_minutes)}</small>
                    </span>
                    <span>{(svc.price_from || svc.variants.length > 0) && <small>desde </small>}{money(min)}</span>
                  </button>
                  {on && svc.variants.length > 0 && (
                    <div className={s.chips} role="radiogroup" aria-label={`Opción de ${svc.name}`}>
                      {svc.variants.map((v) => (
                        <button key={v.id} type="button" role="radio" aria-checked={item?.variantId === v.id}
                          className={`${s.chip} ${item?.variantId === v.id ? s.chipOn : ""}`} onClick={() => cart.setVariant(svc.id, v.id)}>
                          {v.name} · {money(v.price)}
                        </button>
                      ))}
                    </div>
                  )}
                  {on && svc.addons.length > 0 && (
                    <div className={s.chips}>
                      {svc.addons.map((a) => {
                        const sel = item?.addonIds.includes(a.id);
                        return (
                          <button key={a.id} type="button" aria-pressed={sel} className={`${s.chip} ${sel ? s.chipOn : ""}`} onClick={() => cart.toggleAddon(svc.id, a.id)}>
                            {a.name} + {money(a.price)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
