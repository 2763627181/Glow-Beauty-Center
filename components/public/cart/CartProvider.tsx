"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Catalog, Promotion, SelectionItem } from "@/types/domain";

export type CartLine = {
  item: SelectionItem;
  name: string;
  price: number;
  duration: number;
  requiresConsultation: boolean;
};

type CartCtx = {
  catalog: Catalog;
  promotions: Promotion[];
  items: SelectionItem[];
  lines: CartLine[];
  /** Suma a precio de lista. */
  subtotal: number;
  /** Promoción aplicada y vigente (todos sus servicios están en el carrito). */
  promo: Promotion | null;
  discount: number;
  /** Total estimado a pagar (subtotal − descuento de la promoción). */
  total: number;
  minutes: number;
  has: (serviceId: string) => boolean;
  toggle: (serviceId: string) => void;
  setVariant: (serviceId: string, variantId: string) => void;
  toggleAddon: (serviceId: string, addonId: string) => void;
  remove: (serviceId: string) => void;
  clear: () => void;
  applyPromo: (promoId: string) => boolean;
  whatsappNumber: string;
};

const Ctx = createContext<CartCtx | null>(null);
const KEY = "glow-cart-v2";

export function CartProvider({ catalog, promotions, whatsappNumber, children }: { catalog: Catalog; promotions: Promotion[]; whatsappNumber: string; children: ReactNode }) {
  const [items, setItems] = useState<SelectionItem[]>([]);
  const [promoId, setPromoId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { items: SelectionItem[]; promoId: string | null };
        // Hidratación desde localStorage (solo existe en el cliente); descarta servicios y promociones que ya no existen
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setItems((parsed.items ?? []).filter((i) => catalog.services.some((s) => s.id === i.serviceId)));
        setPromoId(parsed.promoId && promotions.some((p) => p.id === parsed.promoId) ? parsed.promoId : null);
      }
    } catch {}
    setReady(true);
  }, [catalog, promotions]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify({ items, promoId })); } catch {}
  }, [items, promoId, ready]);

  const has = useCallback((id: string) => items.some((i) => i.serviceId === id), [items]);

  const toggle = useCallback((serviceId: string) => {
    setItems((cur) => {
      if (cur.some((i) => i.serviceId === serviceId)) return cur.filter((i) => i.serviceId !== serviceId);
      const svc = catalog.services.find((s) => s.id === serviceId);
      if (!svc) return cur;
      return [...cur, { serviceId, variantId: svc.variants[0]?.id ?? null, addonIds: [] }];
    });
  }, [catalog]);

  const applyPromo = useCallback((id: string) => {
    const p = promotions.find((x) => x.id === id);
    if (!p) return false;
    const picked = p.service_ids.map((sid) => catalog.services.find((s) => s.id === sid)).filter((s): s is NonNullable<typeof s> => !!s);
    if (picked.length !== p.service_ids.length) return false; // algún servicio de la promo ya no está publicado
    setItems(picked.map((s) => ({ serviceId: s.id, variantId: s.variants[0]?.id ?? null, addonIds: [] })));
    setPromoId(id);
    return true;
  }, [catalog, promotions]);

  const patch = (serviceId: string, fn: (i: SelectionItem) => SelectionItem) =>
    setItems((cur) => cur.map((i) => (i.serviceId === serviceId ? fn(i) : i)));

  const value = useMemo<CartCtx>(() => {
    const lines: CartLine[] = items.flatMap((item) => {
      const s = catalog.services.find((x) => x.id === item.serviceId);
      if (!s) return [];
      const v = s.variants.find((x) => x.id === item.variantId);
      const addons = s.addons.filter((a) => item.addonIds.includes(a.id));
      return [{
        item,
        name: v ? `${s.name} – ${v.name}` : s.name,
        price: (v?.price ?? s.price) + addons.reduce((t, a) => t + a.price, 0),
        duration: (v?.duration_minutes ?? s.duration_minutes) + addons.reduce((t, a) => t + a.duration_minutes, 0) + s.buffer_before_minutes + s.buffer_after_minutes,
        requiresConsultation: s.requires_consultation,
      }];
    });
    const subtotal = lines.reduce((t, l) => t + l.price, 0);
    const found = promoId ? promotions.find((p) => p.id === promoId) ?? null : null;
    const promo = found && found.service_ids.every((sid) => items.some((i) => i.serviceId === sid)) ? found : null;
    const discount = promo ? Math.max(subtotal - promo.promo_price, 0) : 0;
    return {
      catalog, promotions, items, lines, whatsappNumber, subtotal, promo, discount, total: subtotal - discount,
      minutes: lines.reduce((t, l) => t + l.duration, 0),
      has, toggle, applyPromo,
      setVariant: (id, variantId) => patch(id, (i) => ({ ...i, variantId })),
      toggleAddon: (id, addonId) => patch(id, (i) => ({
        ...i, addonIds: i.addonIds.includes(addonId) ? i.addonIds.filter((a) => a !== addonId) : [...i.addonIds, addonId],
      })),
      remove: (id) => setItems((cur) => cur.filter((i) => i.serviceId !== id)),
      clear: () => { setItems([]); setPromoId(null); },
    };
  }, [items, promoId, catalog, promotions, has, toggle, applyPromo, whatsappNumber]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart fuera de CartProvider");
  return c;
}
