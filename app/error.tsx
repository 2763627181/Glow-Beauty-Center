"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main style={{ minHeight: "60svh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div style={{ display: "grid", gap: 14, justifyItems: "center", maxWidth: 460 }}>
        <h1 style={{ fontSize: "clamp(2rem,6vw,3rem)" }}>Algo salió mal</h1>
        <p style={{ color: "var(--color-text-secondary)" }}>No pudimos cargar esta página. Inténtalo de nuevo; si el problema continúa, escríbenos por WhatsApp.</p>
        {error.digest && <p style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>Código: {error.digest}</p>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button onClick={reset} style={{ background: "var(--color-primary-dark)", color: "#fff", border: 0, padding: "0 24px", minHeight: 48, borderRadius: 999, fontWeight: 600 }}>Reintentar</button>
          <Link href="/" style={{ border: "1px solid rgb(41 37 36 / 0.25)", padding: "0 24px", minHeight: 48, borderRadius: 999, display: "inline-flex", alignItems: "center", fontWeight: 600 }}>Ir al inicio</Link>
        </div>
      </div>
    </main>
  );
}
