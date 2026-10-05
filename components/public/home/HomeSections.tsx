import Image from "next/image";
import Link from "next/link";
import type { Category, GalleryItem } from "@/types/domain";
import s from "./HomeSections.module.css";

/** Mosaico de categorías con su imagen (editable en Servicios → Categorías). */
export function CategoryTiles({ categories, counts }: { categories: Category[]; counts: Record<string, number> }) {
  if (!categories.length) return null;
  return (
    <ul className={s.tiles}>
      {categories.map((c) => (
        <li key={c.id}>
          <Link href={`/services?cat=${c.slug}`} className={s.tile}>
            {c.image_url ? <Image src={c.image_url} alt="" fill sizes="(max-width: 700px) 50vw, 280px" style={{ objectFit: "cover" }} /> : <span className={s.mark} aria-hidden>Glow</span>}
            <span className={s.shade} aria-hidden />
            <span className={s.label}><strong>{c.name}</strong><small>{counts[c.id] ?? 0} servicios</small></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Vista previa de la galería: la portada primero y las más recientes. */
export function GalleryTeaser({ items }: { items: GalleryItem[] }) {
  const sorted = [...items].sort((a, b) => Number(b.is_cover) - Number(a.is_cover)).slice(0, 5); // 1 grande + 4 chicas = cuadrícula completa
  if (!sorted.length) return null;
  return (
    <ul className={s.gallery}>
      {sorted.map((g, i) => (
        <li key={g.id} className={i === 0 ? s.big : undefined}>
          <Link href="/gallery" aria-label={g.title ?? "Ver galería"}>
            <Image src={g.image_url} alt={g.title ?? "Trabajo realizado"} fill sizes={i === 0 ? "(max-width: 700px) 100vw, 440px" : "(max-width: 700px) 50vw, 220px"} style={{ objectFit: "cover" }} loading="lazy" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
