"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { deleteService, duplicateService } from "@/lib/actions/admin/services";
import { ConfirmDialog, useToast } from "../overlay";
import u from "../ui.module.css";

/** Acciones de la ficha de un servicio: ver en la web, duplicar y eliminar/archivar. */
export function ServiceTools({ id, slug, name, publicVisible }: { id: string; slug: string; name: string; publicVisible: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [del, setDel] = useState(false);
  return (
    <div className={u.rowActions}>
      {publicVisible && <Link className={u.link} href={`/services/${slug}`} target="_blank">Ver en la web ↗</Link>}
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => {
        const r = await duplicateService(id);
        if (!r.ok) return toast(r.error, "err");
        toast("Servicio duplicado (inactivo): revísalo y actívalo"); router.push(`/admin/services/${r.id}`);
      })}>Duplicar</Button>
      <Button size="sm" variant="danger" disabled={pending} onClick={() => setDel(true)}>Eliminar</Button>
      <ConfirmDialog open={del} danger title={`¿Eliminar “${name}”?`} confirmLabel="Eliminar" onClose={() => setDel(false)}
        text="Si nunca se usó en citas o ventas se borra por completo. Si ya tiene historial, se archiva (queda inactivo) para conservar los reportes."
        onConfirm={() => start(async () => {
          const r = await deleteService(id);
          if (!r.ok) return toast(r.error, "err");
          toast(r.archived ? "Tenía historial: quedó archivado (inactivo)" : "Servicio eliminado");
          router.push("/admin/services");
        })} />
    </div>
  );
}
