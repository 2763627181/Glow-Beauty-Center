import Image from "next/image";
import { ButtonLink } from "@/components/ui/Button";
import s from "./Hero.module.css";

type Props = { title: string; highlight: string; subtitle: string; tags: string[]; imageUrl?: string; name: string };

/**
 * Portada. Es un componente de servidor y su entrada se anima con CSS (no con JavaScript): así el texto y la foto principal
 * se pintan en cuanto llega el HTML, sin esperar a que la página se hidrate (importante para el LCP en celulares lentos).
 */
export function Hero({ title, highlight, subtitle, tags, imageUrl, name }: Props) {
  const d = (delay: number) => ({ "--d": `${delay}s` }) as React.CSSProperties;
  return (
    <section className={s.hero} aria-labelledby="hero-title">
      <div className={`container ${s.grid}`}>
        <div className={s.copy}>
          <p className={`eyebrow ${s.fade}`} style={d(0)}>{name}</p>
          <h1 id="hero-title" className={s.fade} style={d(0.1)}>
            {title}{highlight && <> <em>{highlight}</em></>}
          </h1>
          <p className={`${s.lead} ${s.fade}`} style={d(0.2)}>{subtitle}</p>
          <div className={`${s.ctas} ${s.fade}`} style={d(0.3)}>
            <ButtonLink href="/booking">Reservar cita</ButtonLink>
            <ButtonLink href="/services" variant="secondary">Ver servicios</ButtonLink>
          </div>
          {tags.length > 0 && (
            <ul className={`${s.tags} ${s.fade}`} style={{ ...d(0.4), listStyle: "none", padding: 0, margin: 0 }} aria-label="Especialidades">
              {tags.map((t) => <li key={t} className={s.tag}>{t}</li>)}
            </ul>
          )}
        </div>
        <div className={`${s.visual} ${s.rise}`}>
          <div className={s.arch}>
            {imageUrl
              ? <Image src={imageUrl} alt={`Interior y estilo de ${name}`} fill loading="eager" fetchPriority="high" sizes="(max-width: 900px) 90vw, 440px" style={{ objectFit: "cover" }} />
              : <><div className={s.vein} /><div className={s.glow} /><span className={s.word} aria-hidden>Glow</span></>}
          </div>
          <div className={s.ring} aria-hidden />
        </div>
      </div>
    </section>
  );
}
