import type { NextConfig } from "next";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : undefined;

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // Raíz del proyecto fija: evita que Next busque (y vigile) archivos de carpetas superiores, p. ej. un package-lock.json suelto en el usuario
  turbopack: { root: __dirname },
  // Librerías de Excel y PDF: se cargan desde node_modules en el servidor (no se empaquetan en el bundle)
  serverExternalPackages: ["exceljs", "jspdf", "jspdf-autotable"],
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // Imágenes subidas desde el panel (Supabase Storage). El comodín evita depender de la variable de entorno al arrancar.
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
      ...(supabaseHost && !supabaseHost.endsWith(".supabase.co") ? [{ protocol: "https" as const, hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }] : []),
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // El panel nunca se puede incrustar en otro sitio ni indexar
      { source: "/admin/:path*", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
