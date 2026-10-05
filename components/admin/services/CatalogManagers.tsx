"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { deleteCategory, deleteProduct, moveCategory, saveCategory, saveProduct, type CategoryInput, type ProductInput } from "@/lib/actions/admin/services";
import { money } from "@/lib/format";
import { Alert, EmptyState } from "../primitives";
import { ImageUpload } from "../ImageUpload";
import { NumInput } from "../NumInput";
import { ConfirmDialog, Modal, useToast } from "../overlay";
import u from "../ui.module.css";

/* ───────── Categorías ───────── */
export type CategoryRow = CategoryInput & { id: string; count: number };

export function CategoriesManager({ categories }: { categories: CategoryRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<{ id: string | null; data: CategoryInput } | null>(null);
  const [del, setDel] = useState<CategoryRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => start(async () => {
    const r = await fn();
    if (!r.ok) toast(r.error ?? "Error", "err"); else { if (ok) toast(ok); router.refresh(); }
  });
  return (
    <>
      <p className={u.sub} style={{ marginBottom: 12 }}>Las categorías organizan el menú de servicios de la web. Una categoría sin servicios publicados no se muestra al público.</p>
      <div style={{ marginBottom: 16 }}><Button size="sm" onClick={() => { setError(null); setEdit({ id: null, data: { name: "", description: "", image_url: null, active: true } }); }}>+ Nueva categoría</Button></div>
      {categories.length === 0 ? <div className={u.card}><EmptyState title="Sin categorías" /></div> : (
        <div className={u.kpis}>
          {categories.map((c, i) => (
            <article key={c.id} className={u.card} style={{ display: "grid", gap: 8, alignContent: "start", opacity: c.active ? 1 : 0.65 }}>
              <div style={{ position: "relative", aspectRatio: "16/9", borderRadius: 12, overflow: "hidden", background: "var(--color-blush)" }}>
                {c.image_url && <Image src={c.image_url} alt="" fill sizes="280px" style={{ objectFit: "cover" }} />}
              </div>
              <h2 style={{ margin: 0 }}>{c.name}</h2>
              <p className={u.sub}>{c.description || "Sin descripción"} · {c.count} servicio(s)</p>
              <div className={u.rowActions}>
                <Button size="sm" variant="secondary" disabled={pending || i === 0} onClick={() => run(() => moveCategory(c.id, -1))} aria-label={`Subir ${c.name}`}>↑</Button>
                <Button size="sm" variant="secondary" disabled={pending || i === categories.length - 1} onClick={() => run(() => moveCategory(c.id, 1))} aria-label={`Bajar ${c.name}`}>↓</Button>
                <Button size="sm" variant="soft" onClick={() => { setError(null); setEdit({ id: c.id, data: { name: c.name, description: c.description, image_url: c.image_url, active: c.active } }); }}>Editar</Button>
                <Button size="sm" variant="danger" onClick={() => setDel(c)}>Eliminar</Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Editar categoría" : "Nueva categoría"}>
        {edit && (
          <form className={u.grid} onSubmit={(e) => {
            e.preventDefault(); setError(null);
            start(async () => { const r = await saveCategory(edit.id, edit.data); if (!r.ok) return setError(r.error); toast("Categoría guardada"); setEdit(null); router.refresh(); });
          }}>
            <div className={u.field}><label htmlFor="cat-n">Nombre</label><input id="cat-n" value={edit.data.name} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, name: e.target.value } })} required /></div>
            <div className={u.field}><label htmlFor="cat-d">Descripción corta</label><input id="cat-d" maxLength={200} value={edit.data.description ?? ""} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, description: e.target.value } })} /></div>
            <ImageUpload bucket="service-images" value={edit.data.image_url ?? null} onChange={(url) => setEdit({ ...edit, data: { ...edit.data, image_url: url } })} label="Imagen de la categoría (portada en la home)" />
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={edit.data.active} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, active: e.target.checked } })} /> Visible en la web</label>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" block disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button>
          </form>
        )}
      </Modal>
      <ConfirmDialog open={!!del} danger title={`¿Eliminar “${del?.name}”?`} confirmLabel="Eliminar" onClose={() => setDel(null)}
        text={del && del.count > 0 ? `Tiene ${del.count} servicio(s): primero muévelos a otra categoría o elimínalos.` : "La categoría se borrará. Esta acción no se puede deshacer."}
        onConfirm={() => del && run(() => deleteCategory(del.id), "Categoría eliminada")} />
    </>
  );
}

/* ───────── Productos ───────── */
export type ProductRow = ProductInput & { id: string };

export function ProductsManager({ products }: { products: ProductRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<{ id: string | null; data: ProductInput } | null>(null);
  const [del, setDel] = useState<ProductRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <p className={u.sub} style={{ marginBottom: 12 }}>Productos que se venden en el salón (shampoo, cremas, etc.). Aparecen al cobrar una cita y en “Nueva venta”.</p>
      <div style={{ marginBottom: 16 }}><Button size="sm" onClick={() => { setError(null); setEdit({ id: null, data: { name: "", price: 0, active: true } }); }}>+ Nuevo producto</Button></div>
      <div className={u.card}>
        {products.length === 0 ? <EmptyState title="Sin productos" text="Agrega los productos que vendes para cobrarlos con un toque." /> : (
          <div className={u.tableWrap}>
            <table className={`${u.table} ${u.stack}`}>
              <thead><tr><th>Producto</th><th className={u.num}>Precio</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Producto"><strong>{p.name}</strong></td>
                    <td data-label="Precio" className={u.num}>{money(p.price)}</td>
                    <td data-label="Estado"><span className={`${u.badge} ${p.active ? u.green : u.gray}`}>{p.active ? "Activo" : "Inactivo"}</span></td>
                    <td><div className={u.rowActions}>
                      <Button size="sm" variant="soft" onClick={() => { setError(null); setEdit({ id: p.id, data: { name: p.name, price: p.price, active: p.active } }); }}>Editar</Button>
                      <Button size="sm" variant="danger" onClick={() => setDel(p)}>Eliminar</Button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Editar producto" : "Nuevo producto"}>
        {edit && (
          <form className={u.grid} onSubmit={(e) => {
            e.preventDefault(); setError(null);
            start(async () => { const r = await saveProduct(edit.id, edit.data); if (!r.ok) return setError(r.error); toast("Producto guardado"); setEdit(null); router.refresh(); });
          }}>
            <div className={u.field}><label htmlFor="pr-n">Nombre</label><input id="pr-n" value={edit.data.name} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, name: e.target.value } })} required /></div>
            <div className={u.field}><label htmlFor="pr-p">Precio (RD$)</label><NumInput id="pr-p" min={0} value={edit.data.price} emptyValue={0} onValue={(v) => setEdit({ ...edit, data: { ...edit.data, price: v ?? 0 } })} required /></div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={edit.data.active} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, active: e.target.checked } })} /> Disponible para vender</label>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" block disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button>
          </form>
        )}
      </Modal>
      <ConfirmDialog open={!!del} danger title={`¿Eliminar “${del?.name}”?`} confirmLabel="Eliminar" onClose={() => setDel(null)}
        text="Se quita del catálogo. Las ventas ya registradas conservan su nombre y precio."
        onConfirm={() => del && start(async () => { const r = await deleteProduct(del.id); toast(r.ok ? "Producto eliminado" : r.error, r.ok ? "ok" : "err"); router.refresh(); })} />
    </>
  );
}
