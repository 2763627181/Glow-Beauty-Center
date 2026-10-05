"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { deleteClient, mergeClients, saveClient, saveClientNotes, searchClientsForMerge, setClientActive } from "@/lib/actions/admin/clients";
import { Alert } from "../primitives";
import { ConfirmDialog, Modal, useToast } from "../overlay";
import u from "../ui.module.css";

type C = { id?: string; first_name: string; last_name: string; phone: string; email: string | null };

export function ClientForm({ client, label = "Editar" }: { client?: C; label?: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ first_name: client?.first_name ?? "", last_name: client?.last_name ?? "", phone: client?.phone ?? "", email: client?.email ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <>
      <Button size="sm" variant={client ? "secondary" : "primary"} onClick={() => { setErr(null); setOpen(true); }}>{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={client ? "Editar cliente" : "Nuevo cliente"}>
        <form className={u.form2} onSubmit={(e) => {
          e.preventDefault(); setErr(null);
          start(async () => {
            const r = await saveClient(client?.id ?? null, f);
            if (!r.ok) return setErr(r.error);
            toast("Cliente guardado"); setOpen(false);
            if (!client) router.push(`/admin/clients/${r.id}`); else router.refresh();
          });
        }}>
          <div className={u.field}><label htmlFor="c-fn">Nombre</label><input id="c-fn" value={f.first_name} onChange={(e) => set({ first_name: e.target.value })} required /></div>
          <div className={u.field}><label htmlFor="c-ln">Apellido</label><input id="c-ln" value={f.last_name} onChange={(e) => set({ last_name: e.target.value })} /></div>
          <div className={u.field}><label htmlFor="c-ph">WhatsApp</label><input id="c-ph" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} required /></div>
          <div className={u.field}><label htmlFor="c-em">Correo</label><input id="c-em" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></div>
          {err && <div className={u.span2}><Alert>{err}</Alert></div>}
          <div className={u.span2}><Button type="submit" block disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button></div>
        </form>
      </Modal>
    </>
  );
}

export function ClientNotes({ id, initial, readOnly }: { id: string; initial: string; readOnly?: boolean }) {
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <div className={u.field}>
      <label htmlFor="cn">Notas privadas</label>
      <textarea id="cn" rows={5} value={v} readOnly={readOnly} onChange={(e) => setV(e.target.value)} placeholder="Ej. Prefiere uñas cortas. Usa tratamiento Redken." />
      {!readOnly && <div><Button size="sm" disabled={pending || v === initial} onClick={() => start(async () => {
        const r = await saveClientNotes(id, v);
        toast(r.ok ? "Notas guardadas" : r.error, r.ok ? "ok" : "err");
      })}>Guardar notas</Button></div>}
    </div>
  );
}

/** Desactivar, fusionar duplicados y eliminar (este último solo gerencia, y solo sin historial). */
export function ClientManage({ id, name, active, canDelete }: { id: string; name: string; active: boolean; canDelete: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [del, setDel] = useState(false);
  const [merge, setMerge] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [target, setTarget] = useState<{ id: string; name: string; phone: string } | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; } // eslint-disable-line react-hooks/set-state-in-effect
    const t = setTimeout(async () => setFound(await searchClientsForMerge(q, id).catch(() => [])), 250);
    return () => clearTimeout(t);
  }, [q, id]);

  return (
    <>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await setClientActive(id, !active); toast(r.ok ? (active ? "Cliente desactivado" : "Cliente activado") : r.error, r.ok ? "ok" : "err"); router.refresh(); })}>{active ? "Desactivar" : "Activar"}</Button>
      {canDelete && <Button size="sm" variant="secondary" onClick={() => { setQ(""); setTarget(null); setMerge(true); }}>Fusionar duplicado</Button>}
      {canDelete && <Button size="sm" variant="danger" onClick={() => setDel(true)}>Eliminar</Button>}

      <Modal open={merge} onClose={() => setMerge(false)} title="Fusionar cliente duplicado">
        <div className={u.grid}>
          <p>Busca el cliente <strong>duplicado</strong>. Sus citas y ventas pasarán a <strong>{name}</strong> y el duplicado se eliminará. No se puede deshacer.</p>
          <div className={u.field}><label htmlFor="mg-q">Buscar duplicado (nombre o teléfono)</label><input id="mg-q" value={q} onChange={(e) => { setQ(e.target.value); setTarget(null); }} /></div>
          {found.length > 0 && !target && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
              {found.map((c) => <li key={c.id}><button className={u.link} style={{ background: "none", border: 0, textAlign: "left", minHeight: 36 }} onClick={() => setTarget(c)}>{c.name} · {c.phone}</button></li>)}
            </ul>
          )}
          {target && (
            <>
              <Alert>Se eliminará <strong>{target.name}</strong> ({target.phone}) y todo su historial pasará a {name}.</Alert>
              <Button variant="danger" disabled={pending} onClick={() => start(async () => {
                const r = await mergeClients(id, target.id);
                if (!r.ok) return toast(r.error, "err");
                toast("Clientes fusionados"); setMerge(false); router.refresh();
              })}>Fusionar</Button>
            </>
          )}
        </div>
      </Modal>
      <ConfirmDialog open={del} danger title={`¿Eliminar a ${name}?`} confirmLabel="Eliminar" onClose={() => setDel(false)}
        text="Solo se puede eliminar un cliente sin citas ni ventas. Si tiene historial, desactívalo o fusiónalo."
        onConfirm={() => start(async () => { const r = await deleteClient(id); if (!r.ok) return toast(r.error, "err"); toast("Cliente eliminado"); router.push("/admin/clients"); })} />
    </>
  );
}
