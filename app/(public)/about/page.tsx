import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/ui/Button";
import { getPublicEmployees, getSettings } from "@/lib/data/catalog";
import s from "../page.module.css";

export const metadata: Metadata = {
  title: "Nosotros",
  description: "Conoce el salón: un espacio de belleza moderno, cálido y profesional.",
  alternates: { canonical: "/about" },
};

export default async function AboutPage() {
  const [team, settings] = await Promise.all([getPublicEmployees(), getSettings()]);
  const c = settings.content;
  return (
    <div className={`container ${s.page}`}>
      <div className={s.head}>
        <span className="eyebrow">Nosotros</span>
        <h1 style={{ fontSize: "clamp(2.4rem,6vw,3.8rem)" }}>{c.about_title}</h1>
      </div>
      <div className={c.about_image_url ? s.two : undefined}>
        <div className={s.prose}>{c.about_paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
        {c.about_image_url && (
          <div style={{ position: "relative", aspectRatio: "4/5", borderRadius: 22, overflow: "hidden", background: "var(--color-cream)" }}>
            <Image src={c.about_image_url} alt={settings.business.name} fill sizes="(max-width:800px) 100vw, 520px" style={{ objectFit: "cover" }} />
          </div>
        )}
      </div>
      {team.length > 0 && (
        <section style={{ marginTop: 64 }} aria-labelledby="team">
          <h2 id="team" style={{ marginBottom: 24 }}>{c.team_title}</h2>
          <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {team.map((e) => (
              <article key={e.id} style={{ background: "#fff", borderRadius: 22, padding: 20, border: "var(--border)" }}>
                <div style={{ position: "relative", aspectRatio: "1", borderRadius: 16, overflow: "hidden", background: "var(--color-blush)", marginBottom: 12 }}>
                  {e.avatar_url && <Image src={e.avatar_url} alt={e.full_name} fill sizes="240px" style={{ objectFit: "cover" }} />}
                </div>
                <h3 style={{ fontSize: "1.4rem" }}>{e.full_name}</h3>
                {e.specialty && <p style={{ color: "var(--color-sage)", fontSize: "0.9rem" }}>{e.specialty}</p>}
                {e.bio && <p style={{ color: "var(--color-text-secondary)", fontSize: "0.88rem", marginTop: 6 }}>{e.bio}</p>}
              </article>
            ))}
          </div>
        </section>
      )}
      <div style={{ marginTop: 48 }}><ButtonLink href="/booking">Reservar cita</ButtonLink></div>
    </div>
  );
}
