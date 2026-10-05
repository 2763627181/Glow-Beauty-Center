"use client";

/** Último recurso: solo se muestra si falla el diseño raíz (no tiene acceso a las fuentes ni a los estilos globales). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es-DO">
      <body style={{ margin: 0, minHeight: "100svh", display: "grid", placeItems: "center", padding: 24, background: "#f8f4ed", color: "#292524", fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <main style={{ maxWidth: 460, display: "grid", gap: 14, justifyItems: "center" }}>
          <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 500, fontSize: "2.2rem", margin: 0 }}>Algo salió mal</h1>
          <p style={{ margin: 0, color: "#6a605d" }}>Ocurrió un error inesperado. Inténtalo de nuevo; si continúa, escríbenos por WhatsApp.</p>
          {error.digest && <p style={{ margin: 0, fontSize: "0.75rem", color: "#6a605d" }}>Código: {error.digest}</p>}
          <button onClick={reset} style={{ background: "#9f4d66", color: "#fff", border: 0, padding: "0 24px", minHeight: 48, borderRadius: 999, fontWeight: 600, fontSize: "0.95rem", cursor: "pointer" }}>Reintentar</button>
        </main>
      </body>
    </html>
  );
}
