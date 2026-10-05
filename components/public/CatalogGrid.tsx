"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { motion } from "motion/react";
import type { Catalog, Category } from "@/types/domain";
import { ServiceCard } from "./cart/ServiceCard";
import s from "./CatalogGrid.module.css";

/** Lee ?cat=slug en el navegador y selecciona esa pestaña. Es lo único que depende de la URL: el resto se renderiza en el servidor. */
function UrlCategory({ categories, onPick }: { categories: Category[]; onPick: (id: string) => void }) {
  const slug = useSearchParams().get("cat");
  useEffect(() => {
    const c = categories.find((x) => x.slug === slug);
    if (c) onPick(c.id);
  }, [slug, categories, onPick]);
  return null;
}

/** Servicios por categoría con pestañas. `onlyFeatured` muestra solo los destacados (home). Acepta ?cat=slug. */
export function CatalogGrid({ catalog, onlyFeatured = false }: { catalog: Catalog; onlyFeatured?: boolean }) {
  const [cat, setCat] = useState<string>("all");
  const base = onlyFeatured ? catalog.services.filter((x) => x.featured) : catalog.services;
  const list = cat === "all" ? base : base.filter((x) => x.category_id === cat);
  const cats = catalog.categories.filter((c) => base.some((x) => x.category_id === c.id));

  if (catalog.services.length === 0) return <p className={s.empty}>Muy pronto publicaremos nuestros servicios.</p>;
  return (
    <div>
      {!onlyFeatured && <Suspense fallback={null}><UrlCategory categories={catalog.categories} onPick={setCat} /></Suspense>}
      <div className={s.tabs} role="tablist" aria-label="Categorías de servicios">
        {[{ id: "all", name: "Todos" }, ...cats].map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id}
            className={`${s.tab} ${cat === c.id ? s.on : ""}`} onClick={() => setCat(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className={s.empty}>Pronto agregaremos servicios en esta categoría.</p>
      ) : (
        <motion.div layout className={s.grid}>
          {list.map((svc, i) => (
            <motion.div key={svc.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.45 }}>
              <ServiceCard service={svc} level={onlyFeatured ? 3 : 2} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
