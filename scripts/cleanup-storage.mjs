// Limpia imágenes huérfanas del almacenamiento (fotos que ya no usa ningún servicio, categoría, promoción, especialista,
// galería ni ajuste del sitio: por ejemplo, las que se reemplazaron o quitaron desde el panel).
//
//   node --env-file=.env.local scripts/cleanup-storage.mjs            → solo lista (no borra nada)
//   node --env-file=.env.local scripts/cleanup-storage.mjs --delete   → borra las huérfanas con más de 1 día
import pg from "pg";

const DELETE = process.argv.includes("--delete");
const BUCKETS = ["service-images", "gallery", "employee-avatars"];
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const refs = (await db.query(`
  select image_url as u from public.services where image_url is not null
  union all select image_url from public.service_categories where image_url is not null
  union all select image_url from public.promotions where image_url is not null
  union all select avatar_url from public.employees where avatar_url is not null
  union all select image_url from public.gallery
  union all select value::text from public.business_settings
`)).rows.map((r) => r.u);

const objects = (await db.query(
  `select bucket_id, name, coalesce((metadata->>'size')::bigint, 0) size, created_at from storage.objects where bucket_id = any($1) order by bucket_id, created_at`, [BUCKETS],
)).rows;

const dayAgo = Date.now() - 864e5;
const orphans = objects.filter((o) => !refs.some((u) => u.includes(`/${o.bucket_id}/${o.name}`)));
const old = orphans.filter((o) => +new Date(o.created_at) < dayAgo);
console.log(`${objects.length} archivos en total · ${orphans.length} sin uso (${old.length} con más de 1 día)`);
for (const o of orphans) console.log(`  ${old.includes(o) ? "·" : "(reciente)"} ${o.bucket_id}/${o.name}  ${(o.size / 1024).toFixed(0)} KB  ${new Date(o.created_at).toISOString().slice(0, 10)}`);

if (DELETE && old.length) {
  for (const o of old) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${o.bucket_id}/${encodeURIComponent(o.name)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY },
    });
    console.log(res.ok ? "  borrado" : `  ERROR ${res.status}`, `${o.bucket_id}/${o.name}`);
  }
} else if (old.length) console.log("\nUsa --delete para borrar las huérfanas antiguas.");
await db.end();
