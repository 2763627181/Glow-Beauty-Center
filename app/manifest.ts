import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Glow Beauty Center",
    short_name: "Glow",
    description: "Reserva tu cita en Glow Beauty Center.",
    start_url: "/",
    display: "standalone",
    background_color: "#F8F4ED",
    theme_color: "#F8F4ED",
    lang: "es-DO",
    icons: [{ src: "/icon", sizes: "64x64", type: "image/png" }],
  };
}
