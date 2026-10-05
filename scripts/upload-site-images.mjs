// Sube imágenes del sitio (categorías, portada, "Nosotros" y galería) a Supabase Storage y las asigna.
// Uso: node --env-file=.env.local scripts/upload-site-images.mjs <carpeta con .jpg y manifest.json>
// manifest.json: { gallery:[{file,category,title}], categories:{slug:file}, hero:file|null, about:file|null }
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const dir = process.argv[2];
const m = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const clean = (f) => f.toLowerCase().replace(/[^a-z0-9]+/g, "-");
async function up(bucket, folder, file) {
  const path = `${folder}/${clean(file)}.jpg`;
  const { error } = await sb.storage.from(bucket).upload(path, readFileSync(`${dir}/${file}.jpg`), { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(`${file}: ${error.message}`);
  return { path, url: sb.storage.from(bucket).getPublicUrl(path).data.publicUrl };
}

// Categorías
for (const [slug, file] of Object.entries(m.categories)) {
  const { url } = await up("service-images", "categories", file);
  const { error } = await sb.from("service_categories").update({ image_url: url }).eq("slug", slug);
  if (error) throw error;
}
// Portada y "Nosotros" (se fusionan con el contenido existente del sitio)
const { data: cur } = await sb.from("business_settings").select("value").eq("key", "site_content").maybeSingle();
const content = { ...(cur?.value ?? {}) };
if (m.hero) content.hero_image_url = (await up("gallery", "site", m.hero)).url;
if (m.about) content.about_image_url = (await up("gallery", "site", m.about)).url;
await sb.from("business_settings").upsert({ key: "site_content", value: content, is_public: true });

// Galería (idempotente por ruta de almacenamiento)
const { data: existing } = await sb.from("gallery").select("storage_path");
const have = new Set((existing ?? []).map((r) => r.storage_path));
let order = (await sb.from("gallery").select("display_order").order("display_order", { ascending: false }).limit(1).maybeSingle()).data?.display_order ?? 0;
let added = 0;
for (const g of m.gallery) {
  const { path, url } = await up("gallery", "stock", g.file);
  if (have.has(path)) continue;
  const { error } = await sb.from("gallery").insert({ title: g.title, category: g.category, image_url: url, storage_path: path, display_order: ++order, is_cover: added === 0 && have.size === 0 });
  if (error) throw error;
  added++;
}
console.log(`categorías: ${Object.keys(m.categories).length} · portada: ${!!m.hero} · nosotros: ${!!m.about} · galería nuevas: ${added}`);
