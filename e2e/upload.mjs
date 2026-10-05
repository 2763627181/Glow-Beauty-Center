import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { BASE, assert, expectVisible, launch, login, section, setPage, step, summary, until } from "./h.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;
const BIG = HERE + "/fixtures/big-photo.jpg"; // se genera sola la primera vez (ruido aleatorio: ~13 MB, como una foto de celular de 16 MP)
async function cleanup() {
  for (const r of await q(`select id, storage_path from gallery where title like 'E2E grande%'`)) {
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/gallery/${r.storage_path}`, { method: "DELETE", headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY } });
  }
  await q(`delete from gallery where title like 'E2E grande%'`);
}
await cleanup();

const { browser, page, errors } = await launch();
setPage(page);
if (!existsSync(BIG)) {
  await page.goto("about:blank");
  const b64 = await page.evaluate(async () => {
    const w = 4608, h = 3456, c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#d98fa3"); g.addColorStop(1, "#5f6f67");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h), noise = new Uint8Array(65536);
    for (let i = 0; i < img.data.length; i += 4) {
      if ((i / 4) % 16384 === 0) crypto.getRandomValues(noise);
      const n = noise[(i / 4) % 65536] - 128;
      img.data[i] = Math.min(255, Math.max(0, img.data[i] + n / 3)); img.data[i + 1] = Math.min(255, Math.max(0, img.data[i + 1] + n / 3)); img.data[i + 2] = Math.min(255, Math.max(0, img.data[i + 2] + n / 3));
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.97));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  writeFileSync(BIG, Buffer.from(b64, "base64"));
}
const bigMB = statSync(BIG).size / 1048576;
await login(page, "tmp-admin@glow.test");

section("Subida de fotos reales del celular");
await step(`Una foto de ${bigMB.toFixed(1)} MB (4608×3456) se reduce sola y se publica`, async () => {
  await page.goto(BASE + "/admin/gallery");
  await page.waitForLoadState("networkidle");
  await page.locator("#g-t").fill("E2E grande");
  await page.setInputFiles('input[type="file"]', BIG);
  await expectVisible(page.getByText("Imagen agregada"), "foto publicada", 40000);
  const [g] = await q(`select storage_path, image_url from gallery where title='E2E grande'`);
  assert(g?.storage_path, "debe existir la fila");
  const [o] = await q(`select (metadata->>'size')::int size, metadata->>'mimetype' mime from storage.objects where bucket_id='gallery' and name=$1`, [g.storage_path]);
  assert(o.size < 3 * 1048576 && o.size > 20 * 1024, `tamaño final ${(o.size / 1048576).toFixed(2)} MB`);
  assert(o.mime === "image/jpeg", "tipo: " + o.mime);
  const dims = await page.evaluate((url) => new Promise((res, rej) => { const i = new window.Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => rej(new Error("no carga")); i.src = url; }), g.image_url);
  assert(Math.max(...dims) <= 2000 && Math.max(...dims) >= 1900, `dimensiones ${dims.join("×")}`);
  assert(dims[0] > dims[1], "debe conservar la orientación horizontal");
  console.log(`       → ${bigMB.toFixed(1)} MB → ${(o.size / 1048576).toFixed(2)} MB, ${dims.join("×")}`);
});
await step("Elegir de nuevo el mismo archivo vuelve a funcionar (el campo se reinicia)", async () => {
  await page.locator("#g-t").fill("E2E grande 2");
  await page.setInputFiles('input[type="file"]', BIG);
  await until(async () => (await q(`select count(*)::int c from gallery where title like 'E2E grande%'`))[0].c === 2, "debe publicarse la segunda foto (dos filas)", 40000);
});
await step("Un archivo que no es imagen sigue rechazado", async () => {
  await page.setInputFiles('input[type="file"]', { name: "doc.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 x") });
  await expectVisible(page.getByRole("alert").filter({ hasText: /JPG, PNG, WebP o AVIF/ }), "rechazo");
});

await cleanup();
await db.end();
const code = summary(errors);
await browser.close();
process.exit(code);
