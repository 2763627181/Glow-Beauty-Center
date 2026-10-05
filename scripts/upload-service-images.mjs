// Uso: node --env-file=.env.local scripts/upload-service-images.mjs <carpeta con .jpg y map.json>
// map.json: { "slug-del-servicio": "nombre-de-archivo-sin-extensión" }
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const dir = process.argv[2];
const map = JSON.parse(readFileSync(`${dir}/map.json`, "utf8"));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const urls = new Map();
for (const file of new Set(Object.values(map))) {
  const path = `catalog/${file.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jpg`;
  const { error } = await sb.storage.from("service-images").upload(path, readFileSync(`${dir}/${file}.jpg`), { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" });
  if (error) { console.error("subida falló", file, error.message); process.exit(1); }
  urls.set(file, sb.storage.from("service-images").getPublicUrl(path).data.publicUrl);
}
let n = 0;
for (const [slug, file] of Object.entries(map)) {
  const { data, error } = await sb.from("services").update({ image_url: urls.get(file) }).eq("slug", slug).select("slug");
  if (error || !data?.length) console.error("sin actualizar", slug, error?.message ?? "slug no existe");
  else n++;
}
console.log(`${urls.size} imágenes subidas, ${n}/${Object.keys(map).length} servicios actualizados`);
