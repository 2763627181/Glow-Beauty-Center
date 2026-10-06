import "server-only";
import { getSettings } from "@/lib/data/catalog";
import { todayISO } from "@/lib/format";
import { buildCsv } from "./csv";
import { imageSize } from "./image";
import type { ExportDoc, Format, Logo } from "./model";
import { buildPdf } from "./pdf";
import { buildXlsx } from "./xlsx";

/** Solo se descarga el logo si está en el almacenamiento público de Supabase (evita que se use esta función para pedir direcciones internas). */
const LOGO_HOST = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\//i;

async function loadLogo(url: string): Promise<Logo | null> {
  if (!url || !LOGO_HOST.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 2_000_000) return null;
    const info = imageSize(bytes); // solo PNG y JPEG (los WebP no caben en PDF/Excel)
    return info ? { bytes, ...info } : null;
  } catch {
    return null;
  }
}

/** Datos del negocio (nombre, dirección, teléfono, logo) y momento de generación, compartidos por todas las exportaciones. */
export async function exportContext() {
  const { business: b } = await getSettings();
  return {
    business: { name: b.name, tagline: b.tagline || undefined, address: b.address || undefined, phone: b.phone || undefined, email: b.email || undefined, logo: await loadLogo(b.logo_url) },
    generatedAt: new Date().toISOString(),
  };
}

const TYPES: Record<Format, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/** Respuesta de descarga en el formato pedido. */
export async function exportResponse(doc: ExportDoc, format: Format): Promise<Response> {
  const body: string | Uint8Array = format === "csv" ? buildCsv(doc) : format === "xlsx" ? await buildXlsx(doc) : buildPdf(doc);
  const name = `${doc.fileBase}${/\d{4}-\d{2}-\d{2}/.test(doc.fileBase) ? "" : `-${todayISO()}`}.${format}`;
  return new Response(body as unknown as BodyInit, {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
