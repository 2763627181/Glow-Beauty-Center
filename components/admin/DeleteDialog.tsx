"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { deleteAppointments, deleteClients, deleteSales, describeDeletion, type DeleteKind } from "@/lib/actions/admin/records";
import { involvesMoney, summarizeResult, type DeletionInfo } from "@/lib/domain/deletion";
import { money } from "@/lib/format";
import { Modal, useToast } from "./overlay";
import { Alert } from "./primitives";
import u from "./ui.module.css";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Confirmación para eliminar citas / solicitudes, ventas o clientes. Antes de borrar cuenta exactamente qué se va a llevar
 * (citas, ventas, pagos y dinero) y, si hay dinero o son varios registros, pide marcar que se entiende que no se puede deshacer.
 *  - citas: la venta y los pagos de la cita se borran con ella.
 *  - ventas: la cita de la venta se elimina también o vuelve a «confirmada».
 *  - clientes: sin historial se borran; con historial solo si se marca «borrar también su historial».
 */
export function DeleteDialog({ kind, ids, title, onClose, onDone }: { kind: DeleteKind; ids: string[]; title: string; onClose: () => void; onDone?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [info, setInfo] = useState<DeletionInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [withAppt, setWithAppt] = useState(false);
  const [withHistory, setWithHistory] = useState(false);
  const [pending, start] = useTransition();
  const key = ids.join(",");

  useEffect(() => {
    let on = true;
    describeDeletion(kind, key.split(",")).then((r) => { if (!on) return; if (r.ok) setInfo(r.info); else setLoadErr(r.error); }).catch(() => on && setLoadErr("No se pudo calcular qué se borraría. Intenta de nuevo."));
    return () => { on = false; };
  }, [kind, key]);

  const hist = info?.clients_with_history ?? 0;
  const clean = info?.clients_clean ?? 0;
  // Qué se llevaría realmente con las opciones elegidas
  const clientsGone = kind === "clients" ? clean + (withHistory ? hist : 0) : 0;
  const money$ = info ? (kind === "clients" ? withHistory && involvesMoney(info) : involvesMoney(info)) : false;
  const needsAck = money$ || ids.length > 1;
  const nothing = kind === "clients" && clientsGone === 0;
  const ready = !!info && !pending && !nothing && (!needsAck || ack);

  function confirm() {
    setErr(null);
    start(async () => {
      const r = kind === "appointments" ? await deleteAppointments(ids) : kind === "sales" ? await deleteSales(ids, withAppt) : await deleteClients(ids, withHistory);
      if (!r.ok) return setErr(r.error);
      toast(summarizeResult(r.result));
      onClose(); onDone?.(); router.refresh();
    });
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <div className={u.grid}>
        {!info && !loadErr && <p className={u.sub}>Calculando qué se borraría…</p>}
        {loadErr && <Alert>{loadErr}</Alert>}
        {info && (
          <>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
              {kind === "appointments" && <li><strong>{plural(info.appointments, "cita o solicitud", "citas o solicitudes")}</strong></li>}
              {kind === "sales" && <li><strong>{plural(info.sales, "venta", "ventas")}</strong>{info.sales_total > 0 && ` por ${money(info.sales_total)}`}</li>}
              {kind === "clients" && <li><strong>{plural(clientsGone, "cliente", "clientes")}</strong>{hist > 0 && !withHistory && ` (${plural(hist, "se conserva porque tiene historial", "se conservan porque tienen historial")})`}</li>}
              {kind !== "sales" && (kind === "appointments" || withHistory) && info.sales > 0 && <li>{plural(info.sales, "venta", "ventas")} por {money(info.sales_total)}</li>}
              {kind === "clients" && withHistory && info.appointments > 0 && <li>{plural(info.appointments, "cita", "citas")}</li>}
              {(kind !== "clients" || withHistory) && info.payments > 0 && <li>{plural(info.payments, "pago", "pagos")}{info.paid_total > 0 && ` (${money(info.paid_total)} cobrados)`}</li>}
            </ul>

            {kind === "clients" && hist > 0 && (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" checked={withHistory} onChange={(e) => { setWithHistory(e.target.checked); setAck(false); }} style={{ marginTop: 4 }} />
                <span><strong>Borrar también su historial</strong><br /><span className={u.hint}>{plural(hist, "cliente tiene", "clientes tienen")} {plural(info.appointments, "cita", "citas")} y {plural(info.sales, "venta", "ventas")}{info.sales_total > 0 ? ` por ${money(info.sales_total)}` : ""}. Sin marcar, solo se borran los que no tienen historial; para conservar su historial puedes desactivarlos o fusionarlos.</span></span>
              </label>
            )}
            {kind === "sales" && (info.linked_appointments ?? 0) > 0 && (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" checked={withAppt} onChange={(e) => setWithAppt(e.target.checked)} style={{ marginTop: 4 }} />
                <span><strong>Eliminar también {(info.linked_appointments ?? 0) === 1 ? "la cita" : "las citas"} de {(info.linked_appointments ?? 0) === 1 ? "esta venta" : "estas ventas"}</strong><br /><span className={u.hint}>Sin marcar, {(info.linked_appointments ?? 0) === 1 ? "la cita vuelve" : "las citas vuelven"} a «confirmada» para poder cobrar{(info.linked_appointments ?? 0) === 1 ? "la" : "las"} de nuevo.</span></span>
              </label>
            )}
            {money$ && <Alert kind="warn"><strong>Incluye dinero registrado.</strong> Ese dinero deja de aparecer en ventas, cobros, reportes y nómina. Queda anotado en Auditoría con los datos que tenía.</Alert>}
            {needsAck && !nothing && (
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                Entiendo que no se puede deshacer
              </label>
            )}
            {!needsAck && !nothing && <p className={u.sub}>Esta acción no se puede deshacer.</p>}
          </>
        )}
        {err && <Alert>{err}</Alert>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={onClose}>Volver</Button>
          <Button variant="danger" onClick={confirm} disabled={!ready}>{pending ? "Eliminando…" : "Eliminar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
