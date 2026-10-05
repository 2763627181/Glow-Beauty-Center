/** Contenido editable del sitio público. Los valores por defecto solo se usan mientras el administrador no haya guardado los suyos. */

export type SiteContent = {
  hero_title: string;
  hero_highlight: string;
  hero_subtitle: string;
  hero_image_url: string;
  hero_tags: string[];
  services_title: string;
  services_text: string;
  categories_title: string;
  steps_title: string;
  steps: { title: string; text: string }[];
  gallery_title: string;
  gallery_text: string;
  cta_title: string;
  cta_text: string;
  about_title: string;
  about_paragraphs: string[];
  about_image_url: string;
  team_title: string;
  services_page_title: string;
  services_page_text: string;
  booking_title: string;
  booking_text: string;
  contact_title: string;
  contact_text: string;
  seo_title: string;
  seo_description: string;
};

export const DEFAULT_SITE_CONTENT: SiteContent = {
  hero_title: "Tu momento. Tu belleza.",
  hero_highlight: "Tu Glow.",
  hero_subtitle: "Cabello, uñas y cuidado personal en un espacio diseñado para ti.",
  hero_image_url: "",
  hero_tags: ["Cabello", "Nails", "Pedicure", "Hair Care"],
  services_title: "Nuestros favoritos",
  services_text: "Selecciona uno o varios servicios y reserva en minutos.",
  categories_title: "Todo para tu cuidado",
  steps_title: "Reservar es muy fácil",
  steps: [
    { title: "Elige tus servicios", text: "Combina cabello, uñas y spa en una sola visita." },
    { title: "Escoge día y hora", text: "Solo verás horarios realmente disponibles." },
    { title: "Confirma por WhatsApp", text: "Recibimos tu solicitud y te confirmamos en poco tiempo." },
  ],
  gallery_title: "Galería",
  gallery_text: "Un vistazo a lo que hacemos y al espacio donde lo hacemos.",
  cta_title: "Es tu momento",
  cta_text: "Reserva tu cita y déjanos cuidar de ti.",
  about_title: "Un espacio hecho para ti",
  about_paragraphs: [
    "Glow Beauty Center es un salón de belleza moderno donde el cuidado del cabello, las uñas y el bienestar se viven con calma, calidez y profesionalismo.",
    "Cada detalle, desde la iluminación hasta el trato, está pensado para que disfrutes tu momento.",
  ],
  about_image_url: "",
  team_title: "Nuestro equipo",
  services_page_title: "Servicios y precios",
  services_page_text: "Selecciona los servicios que deseas y continúa con tu reserva.",
  booking_title: "Reserva tu cita",
  booking_text: "",
  contact_title: "Hablemos",
  contact_text: "",
  seo_title: "Glow Beauty Center — Cabello, uñas y cuidado personal",
  seo_description: "Salón de belleza moderno: cabello, manicure, pedicure, gel, soft gel, builder, spa y tratamientos Redken. Reserva tu cita en línea.",
};

const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v : d);
const strOrEmpty = (v: unknown, d: string) => (typeof v === "string" ? v : d);

/** Combina lo guardado con los valores por defecto, validando tipos (nunca rompe la web por datos inesperados). */
export function mergeSiteContent(raw: unknown): SiteContent {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SITE_CONTENT;
  const strList = (v: unknown, def: string[]) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]).filter((x) => x.trim()) : def);
  const steps = Array.isArray(r.steps)
    ? (r.steps as unknown[]).filter((s): s is { title: string; text: string } => !!s && typeof (s as { title?: unknown }).title === "string" && typeof (s as { text?: unknown }).text === "string" && !!(s as { title: string }).title.trim())
    : d.steps;
  return {
    hero_title: str(r.hero_title, d.hero_title), hero_highlight: strOrEmpty(r.hero_highlight, d.hero_highlight),
    hero_subtitle: str(r.hero_subtitle, d.hero_subtitle), hero_image_url: strOrEmpty(r.hero_image_url, d.hero_image_url),
    hero_tags: strList(r.hero_tags, d.hero_tags),
    services_title: str(r.services_title, d.services_title), services_text: strOrEmpty(r.services_text, d.services_text),
    categories_title: str(r.categories_title, d.categories_title),
    steps_title: str(r.steps_title, d.steps_title), steps: steps.length ? steps : d.steps,
    gallery_title: str(r.gallery_title, d.gallery_title), gallery_text: strOrEmpty(r.gallery_text, d.gallery_text),
    cta_title: str(r.cta_title, d.cta_title), cta_text: strOrEmpty(r.cta_text, d.cta_text),
    about_title: str(r.about_title, d.about_title), about_paragraphs: strList(r.about_paragraphs, d.about_paragraphs),
    about_image_url: strOrEmpty(r.about_image_url, d.about_image_url),
    team_title: str(r.team_title, d.team_title),
    services_page_title: str(r.services_page_title, d.services_page_title), services_page_text: strOrEmpty(r.services_page_text, d.services_page_text),
    booking_title: str(r.booking_title, d.booking_title), booking_text: strOrEmpty(r.booking_text, d.booking_text),
    contact_title: str(r.contact_title, d.contact_title), contact_text: strOrEmpty(r.contact_text, d.contact_text),
    seo_title: str(r.seo_title, d.seo_title), seo_description: str(r.seo_description, d.seo_description),
  };
}
