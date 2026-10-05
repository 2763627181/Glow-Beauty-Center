import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100svh", display: "grid", placeItems: "center", padding: 24, textAlign: "center", background: "var(--color-ivory)" }}>
      <div style={{ display: "grid", gap: 14, justifyItems: "center", maxWidth: 440 }}>
        <p className="eyebrow">Error 404</p>
        <h1 style={{ fontSize: "clamp(2.4rem,8vw,3.6rem)" }}>No encontramos esta página</h1>
        <p style={{ color: "var(--color-text-secondary)" }}>Puede que el enlace haya cambiado o que el servicio ya no esté disponible.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <Link href="/" style={{ background: "var(--color-primary-dark)", color: "#fff", padding: "0 24px", minHeight: 48, borderRadius: 999, display: "inline-flex", alignItems: "center", fontWeight: 600 }}>Volver al inicio</Link>
          <Link href="/services" style={{ border: "1px solid rgb(41 37 36 / 0.25)", padding: "0 24px", minHeight: 48, borderRadius: 999, display: "inline-flex", alignItems: "center", fontWeight: 600 }}>Ver servicios</Link>
        </div>
      </div>
    </main>
  );
}
