"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { deleteService, duplicateService, moveService, toggleService } from "@/lib/actions/admin/services";
import { duration, money } from "@/lib/format";
import { ConfirmDialog, useToast } from "../overlay";
import u from "../ui.module.css";

type S = { id: string; name: string; price: number; price_from: boolean; duration_minutes: number; active: boolean; featured: boolean; pending_review: boolean; variants: number; nobody?: boolean };

export function ServiceRow({ s }: { s: S }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [del, setDel] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => start(async () => {
    const r = await fn();
    if (!r.ok) toast(r.error ?? "Error", "err"); else { if (ok) toast(ok); router.refresh(); }
  });
  return (
    <tr>
      <td data-label="Servicio"><Link className={u.link} href={`/admin/services/${s.id}`}><strong>{s.name}</strong></Link>
        {s.pending_review && <span className={`${u.badge} ${u.gold}`} style={{ marginLeft: 8 }}>Por confirmar</span>}
        {s.featured && <span className={`${u.badge} ${u.pink}`} style={{ marginLeft: 8 }}>Destacado</span>}
        {s.nobody && s.active && !s.pending_review && <><br /><span className={`${u.badge} ${u.red}`} style={{ marginTop: 4 }} title="Ninguna especialista activa y visible en la web tiene este servicio asignado">Nadie lo realiza: no se puede reservar en línea</span></>}</td>
      <td data-label="Precio" className={u.num}>{s.price_from || s.variants > 0 ? "desde " : ""}{money(s.price)}</td>
      <td data-label="Duración">{duration(s.duration_minutes)}</td>
      <td data-label="Estado"><span className={`${u.badge} ${s.active ? u.green : u.gray}`}>{s.active ? "Activo" : "Inactivo"}</span></td>
      <td>
        <div className={u.rowActions}>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => moveService(s.id, -1))} aria-label={`Subir ${s.name}`}>↑</Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => moveService(s.id, 1))} aria-label={`Bajar ${s.name}`}>↓</Button>
          <Button size="sm" variant="soft" disabled={pending || s.pending_review} onClick={() => run(() => toggleService(s.id, !s.active), s.active ? "Servicio desactivado" : "Servicio activado")}>{s.active ? "Desactivar" : "Activar"}</Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(async () => { const r = await duplicateService(s.id); if (r.ok) router.push(`/admin/services/${r.id}`); return r; }, "Servicio duplicado (inactivo): revísalo y actívalo")}>Duplicar</Button>
          <Button size="sm" variant="danger" disabled={pending} onClick={() => setDel(true)}>Eliminar</Button>
        </div>
        <ConfirmDialog open={del} danger title={`¿Eliminar “${s.name}”?`} confirmLabel="Eliminar" onClose={() => setDel(false)}
          text="Si nunca se usó en citas o ventas se borra por completo. Si ya tiene historial, se archiva (queda inactivo) para conservar los reportes."
          onConfirm={() => start(async () => {
            const r = await deleteService(s.id);
            if (!r.ok) toast(r.error, "err"); else { toast(r.archived ? "Tenía historial: quedó archivado (inactivo)" : "Servicio eliminado"); router.refresh(); }
          })} />
      </td>
    </tr>
  );
}
