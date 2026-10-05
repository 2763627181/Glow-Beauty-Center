import type { Metadata } from "next";
import { CatalogGrid } from "@/components/public/CatalogGrid";
import { getCatalog, getSettings } from "@/lib/data/catalog";
import s from "../page.module.css";

export const metadata: Metadata = {
  title: "Servicios y precios",
  description: "Lavado y secado, tintes, keratina, Redken, manicure, pedicure, gel, soft gel, builder y spa. Precios en RD$.",
  alternates: { canonical: "/services" },
};

export default async function ServicesPage() {
  const [catalog, settings] = await Promise.all([getCatalog(), getSettings()]);
  const c = settings.content;
  return (
    <div className={`container ${s.page}`}>
      <div className={s.head}>
        <span className="eyebrow">Servicios</span>
        <h1 style={{ fontSize: "clamp(2.4rem,6vw,3.8rem)" }}>{c.services_page_title}</h1>
        {c.services_page_text && <p>{c.services_page_text}</p>}
      </div>
      <CatalogGrid catalog={catalog} />
    </div>
  );
}
