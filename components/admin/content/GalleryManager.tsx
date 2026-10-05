"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { addGalleryItem, deleteGalleryItem, moveGalleryItem, updateGalleryItem } from "@/lib/actions/admin/content";
import { EmptyState } from "../primitives";
import { ImageUpload } from "../ImageUpload";
import { ConfirmDialog, useToast } from "../overlay";
import u from "../ui.module.css";

type Item = { id: string; title: string | null; category: string; image_url: string; is_cover: boolean; active: boolean };
const CATS: [string, string][] = [["unas", "Uñas"], ["cabello", "Cabello"], ["pedicure", "Pedicure"], ["tratamientos", "Tratamientos"], ["glow", "Glow Beauty Center"]];

export function GalleryManager({ items }: { items: Item[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [del, setDel] = useState<string | null>(null);
  const [cat, setCat] = useState("unas");
  const [title, setTitle] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => start(async () => {
    const r = await fn();
    if (!r.ok) toast(r.error ?? "Error", "err"); else { if (ok) toast(ok); router.refresh(); }
  });
  return (
    <>
      <section className={u.card} style={{ marginBottom: 16 }}>
        <h2>Subir imagen</h2>
        <div className={u.form2}>
          <div className={u.field}><label htmlFor="g-t">Título</label><input id="g-t" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className={u.field}><label htmlFor="g-c">Categoría</label><select id="g-c" value={cat} onChange={(e) => setCat(e.target.value)}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className={u.span2}>
            <ImageUpload bucket="gallery" value={null} label="Elegir imagen (se publica al subir)" onChange={(url, path) => {
              if (url) run(() => addGalleryItem({ image_url: url, storage_path: path, title: title || undefined, category: cat as "unas" }), "Imagen agregada");
              setTitle("");
            }} />
          </div>
        </div>
      </section>
      {items.length === 0 ? <div className={u.card}><EmptyState title="Galería vacía" text="Sube tus mejores trabajos para mostrarlos en la web." /></div> : (
        <div className={u.kpis}>
          {items.map((i) => (
            <article key={i.id} className={u.card} style={{ display: "grid", gap: 8, opacity: i.active ? 1 : 0.6 }}>
              <div style={{ position: "relative", aspectRatio: "4/5", borderRadius: 12, overflow: "hidden" }}><Image src={i.image_url} alt={i.title ?? "Imagen de galería"} fill sizes="220px" style={{ objectFit: "cover" }} /></div>
              <input aria-label="Título" defaultValue={i.title ?? ""} onBlur={(e) => e.target.value !== (i.title ?? "") && run(() => updateGalleryItem(i.id, { title: e.target.value }))} style={{ minHeight: 40, padding: "0 10px", border: "1px solid rgb(41 37 36 / 0.2)", borderRadius: 10 }} />
              <select aria-label="Categoría" value={i.category} onChange={(e) => run(() => updateGalleryItem(i.id, { category: e.target.value as "unas" }))} style={{ minHeight: 40, borderRadius: 10 }}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <div className={u.rowActions}>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => moveGalleryItem(i.id, -1))} aria-label="Mover antes">←</Button>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => moveGalleryItem(i.id, 1))} aria-label="Mover después">→</Button>
                <Button size="sm" variant={i.is_cover ? "primary" : "soft"} disabled={pending} onClick={() => run(() => updateGalleryItem(i.id, { is_cover: !i.is_cover }))}>{i.is_cover ? "Portada ✓" : "Portada"}</Button>
                <Button size="sm" variant="soft" disabled={pending} onClick={() => run(() => updateGalleryItem(i.id, { active: !i.active }))}>{i.active ? "Ocultar" : "Mostrar"}</Button>
                <Button size="sm" variant="danger" disabled={pending} onClick={() => setDel(i.id)}>Eliminar</Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <ConfirmDialog open={!!del} danger title="¿Eliminar imagen?" text="Se borrará de la galería y del almacenamiento." confirmLabel="Eliminar" onClose={() => setDel(null)} onConfirm={() => del && run(() => deleteGalleryItem(del), "Imagen eliminada")} />
    </>
  );
}
