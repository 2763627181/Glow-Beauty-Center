"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { deleteEmployee, moveEmployee } from "@/lib/actions/admin/staff";
import { ConfirmDialog, useToast } from "../overlay";
import u from "../ui.module.css";

type E = { id: string; full_name: string; specialty: string | null; avatar_url: string | null; active: boolean; services: number };

/** Lista de especialistas con orden (↑↓). El orden define cómo aparecen en la web y en la agenda. */
export function StaffList({ staff }: { staff: E[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const move = (id: string, dir: -1 | 1) => start(async () => { const r = await moveEmployee(id, dir); if (!r.ok) toast(r.error, "err"); else router.refresh(); });
  return (
    <div className={u.kpis}>
      {staff.map((e, i) => (
        <div key={e.id} className={u.card} style={{ display: "flex", gap: 14, alignItems: "center", opacity: e.active ? 1 : 0.65 }}>
          <Link href={`/admin/staff/${e.id}`} style={{ display: "flex", gap: 14, alignItems: "center", flex: 1, minWidth: 0 }}>
            <span style={{ position: "relative", width: 56, height: 56, borderRadius: "50%", overflow: "hidden", background: "var(--color-blush)", flex: "none" }}>
              {e.avatar_url && <Image src={e.avatar_url} alt="" fill sizes="56px" style={{ objectFit: "cover" }} />}
            </span>
            <span><strong>{e.full_name}</strong><br /><span className={u.sub}>{e.specialty ?? "—"} · {e.services} servicios</span><br />
              <span className={`${u.badge} ${e.active ? u.green : u.gray}`}>{e.active ? "Activo" : "Inactivo"}</span></span>
          </Link>
          <div style={{ display: "grid", gap: 4 }}>
            <Button size="sm" variant="secondary" disabled={pending || i === 0} onClick={() => move(e.id, -1)} aria-label={`Subir ${e.full_name}`}>↑</Button>
            <Button size="sm" variant="secondary" disabled={pending || i === staff.length - 1} onClick={() => move(e.id, 1)} aria-label={`Bajar ${e.full_name}`}>↓</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function StaffDelete({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="danger" disabled={pending} onClick={() => setOpen(true)}>Eliminar</Button>
      <ConfirmDialog open={open} danger title={`¿Eliminar a ${name}?`} confirmLabel="Eliminar" onClose={() => setOpen(false)}
        text="Si nunca atendió citas ni ventas se borra por completo. Si ya tiene historial, se desactiva (deja de aparecer en la web y en reservas) para conservar los reportes."
        onConfirm={() => start(async () => {
          const r = await deleteEmployee(id);
          if (!r.ok) return toast(r.error, "err");
          toast(r.archived ? "Tenía historial: quedó desactivado" : "Especialista eliminado");
          router.push("/admin/staff");
        })} />
    </>
  );
}
