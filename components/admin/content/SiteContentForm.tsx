"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { saveSetting } from "@/lib/actions/admin/content";
import { DEFAULT_SITE_CONTENT, type SiteContent } from "@/lib/domain/siteContent";
import { Alert } from "../primitives";
import { ImageUpload } from "../ImageUpload";
import u from "../ui.module.css";
import { useSave } from "./SettingsForms";

/** Editor de TODO el texto e imágenes de la web pública: portada, servicios, pasos, galería, nosotros y SEO. */
export function SiteContentForm({ initial }: { initial: SiteContent }) {
  const [c, setC] = useState(initial);
  const { pending, err, save } = useSave();
  const set = (p: Partial<SiteContent>) => setC((x) => ({ ...x, ...p }));
  const text = (k: keyof SiteContent, label: string, o: { max?: number; hint?: string; span?: boolean; area?: boolean } = {}) => (
    <div className={`${u.field} ${o.span ? u.span2 : ""}`}>
      <label htmlFor={`sc-${k}`}>{label}</label>
      {o.area
        ? <textarea id={`sc-${k}`} maxLength={o.max} value={c[k] as string} onChange={(e) => set({ [k]: e.target.value })} />
        : <input id={`sc-${k}`} maxLength={o.max} value={c[k] as string} onChange={(e) => set({ [k]: e.target.value })} />}
      {o.hint && <span className={u.hint}>{o.hint}</span>}
    </div>
  );

  return (
    <form className={u.grid} onSubmit={(e) => { e.preventDefault(); save(() => saveSetting("site_content", c), "Contenido del sitio guardado"); }}>
      <section className={`${u.card} ${u.form2}`}>
        <h2 className={u.span2}>Portada</h2>
        {text("hero_title", "Título principal", { max: 80 })}
        {text("hero_highlight", "Parte destacada del título (en cursiva y color)", { max: 40, hint: "Ej. “Tu Glow.” Déjalo vacío si no la quieres." })}
        {text("hero_subtitle", "Subtítulo", { max: 200, span: true, area: true })}
        <div className={`${u.field} ${u.span2}`}>
          <label>Etiquetas bajo los botones</label>
          <input aria-label="Etiquetas separadas por comas" value={c.hero_tags.join(", ")} onChange={(e) => set({ hero_tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 6) })} />
          <span className={u.hint}>Separadas por comas (máximo 6). Ej. Cabello, Nails, Pedicure, Hair Care.</span>
        </div>
        <div className={u.span2}><ImageUpload bucket="gallery" value={c.hero_image_url || null} onChange={(url) => set({ hero_image_url: url ?? "" })} label="Foto de la portada (vertical se ve mejor; ideal las fotos reales del salón)" /></div>
      </section>

      <section className={`${u.card} ${u.form2}`}>
        <h2 className={u.span2}>Secciones de la página principal</h2>
        {text("services_title", "Título de servicios favoritos", { max: 60 })}
        {text("services_text", "Texto de servicios favoritos", { max: 200 })}
        {text("categories_title", "Título de las categorías", { max: 60 })}
        {text("gallery_title", "Título de la galería", { max: 60 })}
        {text("gallery_text", "Texto de la galería", { max: 200, span: true })}
        {text("cta_title", "Título del llamado final", { max: 60 })}
        {text("cta_text", "Texto del llamado final", { max: 200 })}
      </section>

      <section className={u.card}>
        <h2>Cómo funciona (pasos)</h2>
        <div className={u.field}><label htmlFor="sc-steps_title">Título de la sección</label><input id="sc-steps_title" maxLength={60} value={c.steps_title} onChange={(e) => set({ steps_title: e.target.value })} /></div>
        {c.steps.map((s, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8, marginTop: 10 }}>
            <input aria-label={`Título del paso ${i + 1}`} placeholder="Título" maxLength={60} value={s.title} onChange={(e) => set({ steps: c.steps.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
            <input aria-label={`Texto del paso ${i + 1}`} placeholder="Descripción" maxLength={160} value={s.text} onChange={(e) => set({ steps: c.steps.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
            <Button type="button" size="sm" variant="danger" aria-label={`Quitar paso ${i + 1}`} disabled={c.steps.length <= 1} onClick={() => set({ steps: c.steps.filter((_, j) => j !== i) })}>✕</Button>
          </div>
        ))}
        <div style={{ marginTop: 10 }}><Button type="button" size="sm" variant="soft" disabled={c.steps.length >= 6} onClick={() => set({ steps: [...c.steps, { title: "", text: "" }] })}>+ Agregar paso</Button></div>
      </section>

      <section className={`${u.card} ${u.form2}`}>
        <h2 className={u.span2}>Página “Nosotros”</h2>
        {text("about_title", "Título", { max: 80, span: true })}
        <div className={`${u.span2} ${u.grid}`}>
          <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Párrafos</label>
          {c.about_paragraphs.map((p, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
              <textarea aria-label={`Párrafo ${i + 1}`} maxLength={800} value={p} onChange={(e) => set({ about_paragraphs: c.about_paragraphs.map((x, j) => (j === i ? e.target.value : x)) })} />
              <Button type="button" size="sm" variant="danger" aria-label={`Quitar párrafo ${i + 1}`} disabled={c.about_paragraphs.length <= 1} onClick={() => set({ about_paragraphs: c.about_paragraphs.filter((_, j) => j !== i) })}>✕</Button>
            </div>
          ))}
          <div><Button type="button" size="sm" variant="soft" disabled={c.about_paragraphs.length >= 6} onClick={() => set({ about_paragraphs: [...c.about_paragraphs, ""] })}>+ Agregar párrafo</Button></div>
        </div>
        <div className={u.span2}><ImageUpload bucket="gallery" value={c.about_image_url || null} onChange={(url) => set({ about_image_url: url ?? "" })} label="Foto de “Nosotros” (opcional)" /></div>
      </section>

      <section className={`${u.card} ${u.form2}`}>
        <h2 className={u.span2}>Otras páginas</h2>
        {text("team_title", "Título del equipo (en “Nosotros”)", { max: 60, span: true })}
        {text("services_page_title", "Servicios: título", { max: 60 })}
        {text("services_page_text", "Servicios: texto", { max: 200 })}
        {text("booking_title", "Reservar: título", { max: 60 })}
        {text("booking_text", "Reservar: texto (opcional)", { max: 200, hint: "Se muestra bajo el título de la página de reservas." })}
        {text("contact_title", "Contacto: título", { max: 60, span: true })}
        {text("contact_text", "Contacto: texto (opcional)", { max: 400, span: true, area: true, hint: "Ej. cómo llegar, estacionamiento, formas de pago aceptadas…" })}
      </section>

      <section className={`${u.card} ${u.form2}`}>
        <h2 className={u.span2}>Google y redes (SEO)</h2>
        {text("seo_title", "Título para Google", { max: 70, span: true, hint: "Lo que aparece como título al buscar el negocio. Máx. 70 caracteres." })}
        {text("seo_description", "Descripción para Google", { max: 170, span: true, area: true, hint: "Máx. 170 caracteres." })}
      </section>

      {err && <Alert>{err}</Alert>}
      <div className={u.rowActions}>
        <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar contenido del sitio"}</Button>
        <Button type="button" variant="secondary" onClick={() => setC({ ...DEFAULT_SITE_CONTENT, hero_image_url: c.hero_image_url, about_image_url: c.about_image_url })}>Restablecer textos originales</Button>
      </div>
      <p className={u.hint}>“Restablecer” solo rellena el formulario con los textos originales; no se aplica hasta que pulses Guardar.</p>
    </form>
  );
}
