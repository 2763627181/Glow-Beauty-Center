import type { Metadata } from "next";
import { GalleryGrid } from "@/components/public/GalleryGrid";
import { getGallery, getSettings } from "@/lib/data/catalog";
import s from "../page.module.css";

export const metadata: Metadata = {
  title: "Galería",
  description: "Resultados de uñas, cabello, pedicure y tratamientos.",
  alternates: { canonical: "/gallery" },
};

export default async function GalleryPage() {
  const [items, settings] = await Promise.all([getGallery(), getSettings()]);
  const c = settings.content;
  // La portada va primero
  const sorted = [...items].sort((a, b) => Number(b.is_cover) - Number(a.is_cover));
  return (
    <div className={`container ${s.page}`}>
      <div className={s.head}>
        <span className="eyebrow">Galería</span>
        <h1 style={{ fontSize: "clamp(2.4rem,6vw,3.8rem)" }}>{c.gallery_title}</h1>
        {c.gallery_text && <p>{c.gallery_text}</p>}
      </div>
      <GalleryGrid items={sorted} />
    </div>
  );
}
