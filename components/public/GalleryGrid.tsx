"use client";

import Image from "next/image";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { GalleryItem } from "@/types/domain";
import s from "./GalleryGrid.module.css";

const LABELS: Record<string, string> = {
  unas: "Uñas", cabello: "Cabello", pedicure: "Pedicure", tratamientos: "Tratamientos", glow: "Glow Beauty Center",
};

export function GalleryGrid({ items }: { items: GalleryItem[] }) {
  const [cat, setCat] = useState("all");
  const cats = Array.from(new Set(items.map((i) => i.category)));
  const list = cat === "all" ? items : items.filter((i) => i.category === cat);

  if (items.length === 0) return <p className={s.empty}>Muy pronto compartiremos aquí nuestros trabajos.</p>;
  return (
    <div>
      <div className={s.tabs} role="tablist" aria-label="Categorías de galería">
        {["all", ...cats].map((c) => (
          <button key={c} role="tab" aria-selected={cat === c} className={`${s.tab} ${cat === c ? s.on : ""}`} onClick={() => setCat(c)}>
            {c === "all" ? "Todo" : LABELS[c] ?? c}
          </button>
        ))}
      </div>
      <div className={s.grid}>
        <AnimatePresence mode="popLayout">
          {list.map((i) => (
            <motion.figure layout key={i.id} className={s.item} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
              <Image src={i.image_url} alt={i.title ?? "Trabajo realizado en Glow Beauty Center"} fill sizes="(max-width: 700px) 50vw, 300px" loading="lazy" style={{ objectFit: "cover" }} />
              {i.title && <figcaption>{i.title}</figcaption>}
            </motion.figure>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
