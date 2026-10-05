// Publica las fotos reales del salón (carpeta «Img del negocio»): portada de la web, página «Nosotros» y galería.
// Se puede repetir sin problema (no duplica nada). Todo se puede cambiar después desde el panel.
//
//   node --env-file=.env.local scripts/upload-business-photos.mjs ["Img del negocio"]
//
// Después de correrlo, guarda cualquier cosa en el panel (p. ej. Configuración → Sitio web → Guardar) para que la web pública
// refresque al instante; si no, se actualiza sola en menos de 5 minutos.
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const dir = process.argv[2] ?? "Img del negocio";
// orden = orden en la galería (la primera es la «portada» de la galería); hero / about = dónde más se usa
const PHOTOS = [
  { file: "imagen 4 del negocio.jpg", slug: "nuestro-espacio", title: "Nuestro espacio", cover: true },
  { file: "imagen 2 del negocio.jpg", slug: "estacion-de-manicure", title: "Estación de manicure" },
  { file: "imagen 3 del negocio.jpg", slug: "estilismo-frente-al-espejo", title: "Estilismo frente al espejo", about: true },
  { file: "imagen 5 del negocio.jpg", slug: "pared-de-esmaltes", title: "Pared de esmaltes" },
  { file: "imagen 1 del negocio.jpg", slug: "recepcion-y-sala-de-espera", title: "Recepción y sala de espera", hero: true },
];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const missing = PHOTOS.filter((p) => !existsSync(`${dir}/${p.file}`));
if (missing.length) { console.error(`Faltan archivos en «${dir}»: ${missing.map((m) => m.file).join(", ")}`); process.exit(1); }

// 1. Subir a Storage (bucket público «gallery», carpeta negocio/)
for (const p of PHOTOS) {
  p.path = `negocio/${p.slug}.jpg`;
  const { error } = await sb.storage.from("gallery").upload(p.path, readFileSync(`${dir}/${p.file}`), { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(`${p.file}: ${error.message}`);
  p.url = sb.storage.from("gallery").getPublicUrl(p.path).data.publicUrl;
}

// 2. Galería: las fotos del salón van primero (categoría «Glow Beauty Center»); el resto conserva su orden detrás
const { data: all, error: ge } = await sb.from("gallery").select("id, storage_path, display_order, created_at").order("display_order").order("created_at");
if (ge) throw ge;
const byPath = new Map((all ?? []).map((g) => [g.storage_path, g]));
for (const [i, p] of PHOTOS.entries()) {
  const row = { title: p.title, category: "glow", image_url: p.url, storage_path: p.path, display_order: i + 1, is_cover: !!p.cover, active: true };
  const cur = byPath.get(p.path);
  const { error } = cur ? await sb.from("gallery").update(row).eq("id", cur.id) : await sb.from("gallery").insert(row);
  if (error) throw error;
}
const others = (all ?? []).filter((g) => !PHOTOS.some((p) => p.path === g.storage_path));
for (const [i, g] of others.entries()) {
  const { error } = await sb.from("gallery").update({ display_order: PHOTOS.length + i + 1, is_cover: false }).eq("id", g.id);
  if (error) throw error;
}

// 3. Portada y «Nosotros» (se mezclan con el contenido del sitio que ya existe)
const { data: cur } = await sb.from("business_settings").select("value").eq("key", "site_content").maybeSingle();
const content = { ...(cur?.value ?? {}) };
const hero = PHOTOS.find((p) => p.hero), about = PHOTOS.find((p) => p.about);
const before = { hero: content.hero_image_url, about: content.about_image_url };
content.hero_image_url = hero.url;
content.about_image_url = about.url;
const { error: se } = await sb.from("business_settings").upsert({ key: "site_content", value: content, is_public: true });
if (se) throw se;

console.log(`Subidas ${PHOTOS.length} fotos a gallery/negocio/ · galería: ${PHOTOS.length} del salón primero + ${others.length} anteriores · portada: ${hero.title} · «Nosotros»: ${about.title}`);
console.log("Fotos anteriores de portada / «Nosotros» (ya sin uso; `npm run cleanup:storage -- --delete` las borra pasado 1 día):", before);
