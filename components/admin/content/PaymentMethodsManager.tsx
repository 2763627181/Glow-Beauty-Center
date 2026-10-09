"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { deletePaymentMethod, movePaymentMethod, savePaymentMethod } from "@/lib/actions/admin/content";
import { Alert } from "../primitives";
import { ConfirmDialog, Modal, useToast } from "../overlay";
import u from "../ui.module.css";

/** `isCash` solo viene cuando la caja está instalada (si falta, no se muestra la opción «es efectivo»). */
export type Method = { key: string; label: string; active: boolean; isCash?: boolean };

export function PaymentMethodsManager({ methods }: { methods: Method[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<{ key: string | null; label: string; active: boolean; isCash?: boolean } | null>(null);
  const cashSupported = methods.some((m) => m.isCash !== undefined);
  const [del, setDel] = useState<Method | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => start(async () => {
    const r = await fn();
    if (!r.ok) toast(r.error ?? "Error", "err"); else { if (ok) toast(ok); router.refresh(); }
  });
  return (
    <section className={u.card}>
      <h2>Métodos de pago</h2>
      <p className={u.hint} style={{ marginBottom: 12 }}>Los que estén activos aparecen al cobrar. Puedes renombrarlos, reordenarlos y agregar otros (por ejemplo, Zelle o un datáfono específico).</p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {methods.map((m, i) => (
          <li key={m.key} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", opacity: m.active ? 1 : 0.6 }}>
            <span><strong>{m.label}</strong> <span className={`${u.badge} ${m.active ? u.green : u.gray}`}>{m.active ? "Activo" : "Inactivo"}</span>{m.isCash && <> <span className={`${u.badge} ${u.gold}`}>Efectivo</span></>}</span>
            <span className={u.rowActions}>
              <Button size="sm" variant="secondary" disabled={pending || i === 0} onClick={() => run(() => movePaymentMethod(m.key, -1))} aria-label={`Subir ${m.label}`}>↑</Button>
              <Button size="sm" variant="secondary" disabled={pending || i === methods.length - 1} onClick={() => run(() => movePaymentMethod(m.key, 1))} aria-label={`Bajar ${m.label}`}>↓</Button>
              <Button size="sm" variant="soft" onClick={() => { setError(null); setEdit({ key: m.key, label: m.label, active: m.active, isCash: m.isCash }); }}>Editar</Button>
              <Button size="sm" variant="danger" onClick={() => setDel(m)}>Eliminar</Button>
            </span>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 14 }}><Button size="sm" onClick={() => { setError(null); setEdit({ key: null, label: "", active: true, isCash: cashSupported ? false : undefined }); }}>+ Agregar método</Button></div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.key ? "Editar método de pago" : "Nuevo método de pago"}>
        {edit && (
          <form className={u.grid} onSubmit={(e) => {
            e.preventDefault(); setError(null);
            start(async () => { const r = await savePaymentMethod(edit.key, { label: edit.label, active: edit.active, isCash: edit.isCash }); if (!r.ok) return setError(r.error); toast("Método guardado"); setEdit(null); router.refresh(); });
          }}>
            <div className={u.field}><label htmlFor="pm-l">Nombre</label><input id="pm-l" maxLength={40} value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} required /></div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Disponible al cobrar</label>
            {edit.isCash !== undefined && (
              <div>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={edit.isCash} onChange={(e) => setEdit({ ...edit, isCash: e.target.checked })} /> Es efectivo (entra a la caja)</label>
                <span className={u.hint}>Solo el efectivo suma a la caja y permite anotar cuánto entregó el cliente para calcular el vuelto. Tarjeta, transferencia y demás se cobran aparte: aquí solo se registran. Para cambiarlo debe estar cerrada la caja.</span>
              </div>
            )}
            {error && <Alert>{error}</Alert>}
            <Button type="submit" block disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button>
          </form>
        )}
      </Modal>
      <ConfirmDialog open={!!del} danger title={`¿Eliminar “${del?.label}”?`} confirmLabel="Eliminar" onClose={() => setDel(null)}
        text="Si ya se usó en pagos, no se borra: se desactiva para conservar el historial."
        onConfirm={() => del && start(async () => {
          const r = await deletePaymentMethod(del.key);
          if (!r.ok) toast(r.error, "err"); else { toast(r.archived ? "Ya tenía pagos: quedó desactivado" : "Método eliminado"); router.refresh(); }
        })} />
    </section>
  );
}
