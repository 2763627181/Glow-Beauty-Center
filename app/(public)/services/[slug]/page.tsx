import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ServiceDetailActions } from "@/components/public/cart/ServiceDetailActions";
import { getCatalog } from "@/lib/data/catalog";
import { duration, money } from "@/lib/format";
import { jsonLd } from "@/lib/seo";
import s from "../../page.module.css";

type Props = PageProps<"/services/[slug]">;

/** Prepara cada servicio publicado como página estática; los nuevos se generan al primer acceso. */
export async function generateStaticParams() {
  try { return (await getCatalog()).services.map((x) => ({ slug: x.slug })); } catch { return []; }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const svc = (await getCatalog()).services.find((x) => x.slug === slug);
  if (!svc) notFound(); // 404 real también para buscadores (el estado HTTP se decide aquí, antes de enviar la página)
  return {
    title: svc.name,
    description: svc.short_description ?? `${svc.name} en Glow Beauty Center`,
    alternates: { canonical: `/services/${svc.slug}` },
    openGraph: { title: svc.name, images: svc.image_url ? [svc.image_url] : undefined },
  };
}

export default async function ServicePage({ params }: Props) {
  const { slug } = await params;
  const svc = (await getCatalog()).services.find((x) => x.slug === slug);
  if (!svc) notFound();
  const ld = {
    "@context": "https://schema.org", "@type": "Service", name: svc.name, description: svc.short_description,
    offers: { "@type": "Offer", priceCurrency: "DOP", price: svc.price },
  };
  return (
    <div className={`container ${s.page}`}>
      <div className={s.two}>
        <div style={{ position: "relative", aspectRatio: "4/3", borderRadius: 22, overflow: "hidden", background: "linear-gradient(135deg,var(--color-blush),var(--color-cream))" }}>
          {svc.image_url && <Image src={svc.image_url} alt={svc.name} fill loading="eager" fetchPriority="high" sizes="(max-width:800px) 100vw, 560px" style={{ objectFit: "cover" }} />}
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <span className="eyebrow">Servicio</span>
          <h1 style={{ fontSize: "clamp(2.2rem,5vw,3.4rem)" }}>{svc.name}</h1>
          <p style={{ color: "var(--color-text-secondary)" }}>{svc.description ?? svc.short_description}</p>
          <p style={{ fontSize: "1.3rem", fontWeight: 600 }}>
            {(svc.price_from || svc.variants.length > 0) && <small style={{ fontWeight: 400, fontSize: "0.85rem" }}>desde </small>}
            {money(svc.variants.length ? Math.min(...svc.variants.map((v) => v.price)) : svc.price)}
            <span style={{ fontWeight: 400, fontSize: "0.9rem", marginLeft: 12, color: "var(--color-text-secondary)" }}>{duration(svc.duration_minutes)}</span>
          </p>
          {svc.requires_consultation && <p style={{ color: "var(--color-gold-text)" }}>Este servicio requiere una consulta previa.</p>}
          <ServiceDetailActions service={svc} />
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
    </div>
  );
}
