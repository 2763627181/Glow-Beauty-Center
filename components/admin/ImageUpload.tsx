"use client";

import Image from "next/image";
import { useId, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import u from "./ui.module.css";

const OK = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 2000;

/**
 * Las fotos del celular suelen pesar 4–12 MB: se reducen en el navegador (lado mayor 2000 px, JPEG al 86 %) antes de subirlas.
 * Si el archivo no se puede procesar se devuelve tal cual y la validación de tamaño decide.
 */
async function optimize(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= 1.5 * 1024 * 1024) { bmp.close(); return file; }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) { bmp.close(); return file; }
    const png = file.type === "image/png"; // se conserva la transparencia de logotipos
    if (!png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const encode = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.86));
    let blob = await encode(png ? "image/png" : "image/jpeg");
    let type = png ? "image/png" : "image/jpeg";
    if (png && blob && blob.size > MAX_BYTES) { blob = await encode("image/jpeg"); type = "image/jpeg"; }
    if (!blob || (scale === 1 && blob.size >= file.size)) return file;
    return new File([blob], `${file.name.replace(/\.\w+$/, "")}.${type === "image/png" ? "png" : "jpg"}`, { type });
  } catch {
    return file;
  }
}

/** Sube una imagen directo a Supabase Storage con la sesión del usuario (las policies exigen manager/super_admin). */
export function ImageUpload({ bucket, value, onChange, label = "Imagen" }: {
  bucket: "service-images" | "gallery" | "employee-avatars"; value: string | null; onChange: (url: string | null, path?: string) => void; label?: string;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(original?: File) {
    if (!original) return;
    setErr(null);
    if (!OK.includes(original.type)) return setErr("Usa una imagen JPG, PNG, WebP o AVIF.");
    setBusy(true);
    const file = await optimize(original);
    if (file.size > MAX_BYTES) { setBusy(false); return setErr("La imagen no puede pesar más de 5 MB."); }
    const sb = createBrowserSupabase();
    const ext = file.type.split("/")[1];
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from(bucket).upload(path, file, { contentType: file.type, cacheControl: "31536000" });
    setBusy(false);
    if (error) return setErr("No se pudo subir (¿tienes permiso?).");
    onChange(sb.storage.from(bucket).getPublicUrl(path).data.publicUrl, path);
  }

  return (
    <div className={u.field}>
      <label htmlFor={id}>{label}</label>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 96, height: 96, borderRadius: 14, overflow: "hidden", background: "var(--color-blush)", flex: "none" }}>
          {value && <Image src={value} alt="" fill sizes="96px" style={{ objectFit: "cover" }} />}
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <input id={id} type="file" accept={OK.join(",")} disabled={busy} style={{ minHeight: 0, border: 0, padding: 0 }}
            onChange={(e) => { const input = e.currentTarget; const file = input.files?.[0]; input.value = ""; pick(file); }} />
          {busy && <span className={u.hint}>Subiendo…</span>}
          {value && <button type="button" className={u.link} style={{ background: "none", border: 0, textAlign: "left", padding: 0 }} onClick={() => onChange(null)}>Quitar imagen</button>}
          {err && <span role="alert" style={{ color: "var(--color-danger)", fontSize: "0.82rem" }}>{err}</span>}
        </div>
      </div>
    </div>
  );
}
