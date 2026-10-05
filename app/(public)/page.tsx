import type { Metadata } from "next";
import Link from "next/link";
import { CatalogGrid } from "@/components/public/CatalogGrid";
import { Hero } from "@/components/public/Hero";
import { CategoryTiles, GalleryTeaser } from "@/components/public/home/HomeSections";
import { PromoCard } from "@/components/public/home/PromoCard";
import { ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { getActivePromotions, getCatalog, getGallery, getSettings } from "@/lib/data/catalog";
import s from "./page.module.css";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Home() {
  const [catalog, settings, promos, gallery] = await Promise.all([getCatalog(), getSettings(), getActivePromotions(), getGallery()]);
  const c = settings.content;
  const counts = Object.fromEntries(catalog.categories.map((cat) => [cat.id, catalog.services.filter((x) => x.category_id === cat.id).length]));
  const hasFeatured = catalog.services.some((x) => x.featured);

  return (
    <>
      <Hero title={c.hero_title} highlight={c.hero_highlight} subtitle={c.hero_subtitle} tags={c.hero_tags} imageUrl={c.hero_image_url || undefined} name={settings.business.name} />

      {catalog.categories.length > 0 && (
        <section className={`container ${s.section}`} aria-labelledby="cats">
          <Reveal className={s.head}><span className="eyebrow">Servicios</span><h2 id="cats">{c.categories_title}</h2></Reveal>
          <Reveal><CategoryTiles categories={catalog.categories} counts={counts} /></Reveal>
        </section>
      )}

      {hasFeatured && (
        <section className={`container ${s.section}`} aria-labelledby="fav">
          <Reveal className={s.head}>
            <span className="eyebrow">Favoritos</span>
            <h2 id="fav">{c.services_title}</h2>
            {c.services_text && <p>{c.services_text}</p>}
          </Reveal>
          <CatalogGrid catalog={catalog} onlyFeatured />
          <p style={{ marginTop: 28 }}><Link href="/services" style={{ textDecoration: "underline" }}>Ver todos los servicios →</Link></p>
        </section>
      )}

      {promos.length > 0 && (
        <section className={`container ${s.section}`} aria-labelledby="promos">
          <Reveal className={s.head}><span className="eyebrow">Promociones</span><h2 id="promos">Combos Glow</h2></Reveal>
          <div className={s.promos}>
            {promos.map((p) => <Reveal key={p.id}><PromoCard promo={p} /></Reveal>)}
          </div>
        </section>
      )}

      {gallery.length > 0 && (
        <section className={`container ${s.section}`} aria-labelledby="gal">
          <Reveal className={s.head}><span className="eyebrow">Galería</span><h2 id="gal">{c.gallery_title}</h2>{c.gallery_text && <p>{c.gallery_text}</p>}</Reveal>
          <Reveal><GalleryTeaser items={gallery} /></Reveal>
          <p style={{ marginTop: 20 }}><Link href="/gallery" style={{ textDecoration: "underline" }}>Ver toda la galería →</Link></p>
        </section>
      )}

      <section className={`container ${s.section}`} aria-labelledby="how">
        <Reveal className={s.head}><span className="eyebrow">Cómo funciona</span><h2 id="how">{c.steps_title}</h2></Reveal>
        <div className={s.steps}>
          {c.steps.map((st, i) => (
            <Reveal key={i} delay={i * 0.08}><div className={s.step}><h3>{st.title}</h3><p>{st.text}</p></div></Reveal>
          ))}
        </div>
      </section>

      <section className={`container ${s.cta}`}>
        <Reveal>
          <div className={s.ctaBox}>
            <h2>{c.cta_title}</h2>
            {c.cta_text && <p>{c.cta_text}</p>}
            <ButtonLink href="/booking">Reservar cita</ButtonLink>
          </div>
        </Reveal>
      </section>
    </>
  );
}
