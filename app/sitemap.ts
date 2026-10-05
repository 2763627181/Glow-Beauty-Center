import type { MetadataRoute } from "next";
import { getCatalog } from "@/lib/data/catalog";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { services } = await getCatalog().catch(() => ({ services: [] }));
  const fixed = ["", "/services", "/booking", "/gallery", "/about", "/contact"];
  return [
    ...fixed.map((p) => ({ url: base + p, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.7 })),
    ...services.map((s) => ({ url: `${base}/services/${s.slug}`, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
