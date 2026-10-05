import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { OfflineBanner } from "@/components/OfflineBanner";
import "./globals.css";

const serif = Cormorant_Garamond({ variable: "--font-cormorant", subsets: ["latin"], weight: ["400", "500", "600"] });
const sans = Inter({ variable: "--font-inter", subsets: ["latin"] });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// Los textos del sitio público (título, descripción) los define el administrador y se aplican en app/(public)/layout.tsx.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Glow Beauty Center", template: "%s | Glow Beauty Center" },
  description: "Salón de belleza: cabello, uñas, pedicure y tratamientos.",
};
export const viewport: Viewport = { themeColor: "#f8f4ed", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-DO" className={`${serif.variable} ${sans.variable}`}>
      <body>
        <OfflineBanner />
        {children}
      </body>
    </html>
  );
}
