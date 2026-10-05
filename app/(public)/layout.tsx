import type { Metadata } from "next";
import { CartProvider } from "@/components/public/cart/CartProvider";
import { ServiceCartBar } from "@/components/public/cart/ServiceCartBar";
import { Brand } from "@/components/public/Brand";
import { FloatingWhatsApp } from "@/components/public/FloatingWhatsApp";
import { Footer } from "@/components/public/Footer";
import { PublicHeader } from "@/components/public/PublicHeader";
import { getActivePromotions, getCatalog, getSettings } from "@/lib/data/catalog";
import { jsonLd } from "@/lib/seo";
import { waLink } from "@/lib/whatsapp";

export async function generateMetadata(): Promise<Metadata> {
  const { content, business } = await getSettings();
  return {
    title: { default: content.seo_title, template: `%s | ${business.name}` },
    description: content.seo_description,
    openGraph: { type: "website", locale: "es_DO", siteName: business.name, title: content.seo_title, description: content.seo_description },
    twitter: { card: "summary_large_image", title: content.seo_title, description: content.seo_description },
  };
}

export default async function PublicLayout({ children }: LayoutProps<"/">) {
  const [catalog, settings, promotions] = await Promise.all([getCatalog(), getSettings(), getActivePromotions()]);
  const b = settings.business;
  const wa = b.whatsapp || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "";
  const waHref = waLink(wa, `Hola ${b.name} ✨`);
  const ld = {
    "@context": "https://schema.org", "@type": "BeautySalon", name: b.name, telephone: b.phone || undefined, email: b.email || undefined,
    address: b.address || undefined, url: process.env.NEXT_PUBLIC_SITE_URL, image: b.logo_url || settings.content.hero_image_url || undefined,
    sameAs: [b.instagram && `https://instagram.com/${b.instagram.replace(/^@/, "")}`, b.facebook && `https://facebook.com/${b.facebook}`, b.tiktok && `https://tiktok.com/@${b.tiktok.replace(/^@/, "")}`].filter(Boolean),
    priceRange: "RD$",
  };
  return (
    <CartProvider catalog={catalog} promotions={promotions} whatsappNumber={wa}>
      <PublicHeader whatsappHref={waHref} name={b.name} brand={<Brand name={b.name} logoUrl={b.logo_url || undefined} />} />
      <main id="contenido">{children}</main>
      <Footer settings={settings} />
      <ServiceCartBar />
      <FloatingWhatsApp href={waHref} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
    </CartProvider>
  );
}
