"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { LotView, ServicePick, SupplyView } from "@/lib/data/inventory";
import { plural } from "@/lib/domain/inventory";
import { fmtDate } from "@/lib/format";
import { EmptyState } from "../primitives";
import u from "../ui.module.css";
import c from "./inventory.module.css";
import { DepleteModal, LotModal, SupplyModal } from "./InventoryModals";

const shortDay = (d: string) => fmtDate(`${d}T12:00:00-04:00`, { day: "numeric", month: "short" });
export const toneClass = (t: string | null) => (t === "ok" ? c.tagOk : t === "warn" ? c.tagWarn : t === "bad" ? c.tagBad : c.tagMuted);

type Dialog = { type: "supply" } | { type: "lot"; supply: SupplyView } | { type: "deplete"; supply: SupplyView; lot: LotView };

/** Lista de productos del inventario con su estado, y atajos para registrar una entrada o marcar que se agotó. */
export function InventoryBoard({ supplies, services }: { supplies: SupplyView[]; services: ServicePick[] }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  return (
    <div className={u.grid}>
      <div className={u.rowActions}><Button size="sm" onClick={() => setDialog({ type: "supply" })}>+ Nuevo producto</Button></div>

      {supplies.length === 0 ? (
        <section className={u.card}>
          <EmptyState title="Aún no hay productos en el inventario" text="Crea un producto (por ejemplo, «Pintura de gel»), dile en qué servicios se usa y registra cada vez que llegue un pedido. Cuando se acabe, márcalo y el sistema te dice cuánto se consumió por cliente.">
            <div><Button onClick={() => setDialog({ type: "supply" })}>+ Crear mi primer producto</Button></div>
          </EmptyState>
        </section>
      ) : (
        <div className={c.grid}>
          {supplies.map((s) => {
            const inUse = s.lots.find((l) => l.state === "en_uso");
            const last = s.lots.find((l) => l.state === "agotada");
            return (
              <article key={s.id} className={`${u.card} ${c.item}`} aria-labelledby={`sup-${s.id}`}>
                <div className={c.row} style={{ justifyContent: "space-between" }}>
                  <h2 id={`sup-${s.id}`}><Link className={u.link} href={`/admin/inventory/${s.id}`}>{s.name}</Link></h2>
                  {!s.active && <span className={`${u.badge} ${u.gray}`}>Inactivo</span>}
                </div>
                {s.services.length > 0
                  ? <div className={c.chips} role="group" aria-label="Servicios en los que se usa">{s.services.map((x) => <span key={x.id} className={c.svc}>{x.name}</span>)}</div>
                  : <p className={c.muted}>Sin servicios asignados: edita el producto para decir en cuáles se usa.</p>}
                {inUse ? (
                  <p>
                    <span className={`${c.tag} ${c.tagInfo}`}>En uso</span>{" "}
                    {inUse.quantity} {plural(s.unit, inUse.quantity)} llegaron el {shortDay(inUse.received_on)}
                    <br /><span className={c.muted}>{inUse.days} {inUse.days === 1 ? "día" : "días"} · {inUse.services} {inUse.services === 1 ? "servicio" : "servicios"} · {inUse.clients} {inUse.clients === 1 ? "cliente" : "clientes"}</span>
                  </p>
                ) : s.lots.length ? (
                  <p><span className={`${c.tag} ${c.tagMuted}`}>Agotado</span>{last?.depleted_on && <> el {shortDay(last.depleted_on)}</>}<br /><span className={c.muted}>No hay una entrada en uso: registra la siguiente cuando llegue.</span></p>
                ) : (
                  <p><span className={`${c.tag} ${c.tagMuted}`}>Sin entradas</span><br /><span className={c.muted}>Registra la primera entrada cuando llegue el pedido.</span></p>
                )}
                {last?.verdictText && <p><span className={`${c.tag} ${toneClass(last.verdictTone)}`}>Última entrada: {last.verdictText}</span></p>}
                <div className={u.rowActions}>
                  <Button size="sm" variant="secondary" onClick={() => setDialog({ type: "lot", supply: s })} aria-label={`Registrar entrada de ${s.name}`}>+ Entrada</Button>
                  {inUse && <Button size="sm" variant="soft" onClick={() => setDialog({ type: "deplete", supply: s, lot: inUse })} aria-label={`Marcar ${s.name} como agotado`}>Se agotó</Button>}
                  <Link className={u.link} style={{ alignSelf: "center" }} href={`/admin/inventory/${s.id}`} aria-label={`Ver análisis de ${s.name}`}>Ver análisis</Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {dialog?.type === "supply" && <SupplyModal supply={null} services={services} onClose={close} />}
      {dialog?.type === "lot" && <LotModal supply={dialog.supply} onClose={close} />}
      {dialog?.type === "deplete" && <DepleteModal supply={dialog.supply} lot={dialog.lot} onClose={close} />}
    </div>
  );
}
