import { ImageResponse } from "next/og";
import { getSettings } from "@/lib/data/catalog";

export const alt = "Glow Beauty Center";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Imagen para compartir en redes (WhatsApp, Facebook, Instagram…): nombre y frase del negocio y, si ya subiste la foto de
 * portada en Configuración → Sitio web, esa foto del salón dentro de un arco.
 */
export default async function OgImage() {
  const { business, content } = await getSettings().catch(() => ({ business: { name: "Glow Beauty Center", tagline: "Tu momento. Tu belleza. Tu Glow." }, content: { hero_image_url: "" } }));
  const photo = content.hero_image_url;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "linear-gradient(135deg,#FBEEF1 0%,#F1E8DC 55%,#E7E4E1 100%)", color: "#292524", fontFamily: "serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, padding: "0 20px 0 84px" }}>
          <div style={{ fontSize: 26, letterSpacing: 8, textTransform: "uppercase", color: "#7D6428", fontFamily: "sans-serif" }}>Beauty Studio</div>
          <div style={{ fontSize: photo ? 96 : 120, marginTop: 20, lineHeight: 1.05 }}>{business.name}</div>
          <div style={{ fontSize: photo ? 40 : 44, marginTop: 28, color: "#9F4D66", fontStyle: "italic" }}>{business.tagline}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: photo ? 470 : 360 }}>
          {photo ? (
            <div style={{ display: "flex", width: 360, height: 480, borderRadius: "180px 180px 28px 28px", overflow: "hidden", border: "4px solid #D3B36B" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse (Satori) no usa next/image */}
              <img src={photo} alt="" width={360} height={480} style={{ width: 360, height: 480, objectFit: "cover" }} />
            </div>
          ) : (
            <div style={{ width: 190, height: 260, border: "3px solid #D3B36B", borderRadius: "95px 95px 20px 20px" }} />
          )}
        </div>
      </div>
    ),
    size,
  );
}
