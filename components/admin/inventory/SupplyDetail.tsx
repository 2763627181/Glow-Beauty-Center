"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { deleteLot, deleteSupply, reopenLot } from "@/lib/actions/admin/inventory";
import type { LotView, ServicePick, SupplyView } from "@/lib/data/inventory";
import { plural } from "@/lib/domain/inventory";
import { fmtDate, money } from "@/lib/format";
import { ConfirmDialog, useToast } from "../overlay";
import u from "../ui.module.css";
import { toneClass } from "./InventoryBoard";
import c from "./inventory.module.css";
import { DepleteModal, LotModal, SupplyModal } from "./InventoryModals";

const day = (d: string) => fmtDate(`${d}T12:00:00-04:00`, { day: "numeric", month: "short", year: "numeric" });
const num = (n: number) => String(Math.round(n * 100) / 100);

type Dialog = { type: "edit" } | { type: "add" } | { type: "lot"; lot: LotView } | { type: "deplete"; lot: LotView } | { type: "delLot"; lot: LotView } | { type: "delSupply" };

/** Detalle de un producto: lo que lleva usado, el análisis de cada entrada y el historial. */
export function SupplyDetail({ supply: s, services }: { supply: SupplyView; services: ServicePick[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => start(async () => {
    const r = await fn();
    if (!r.ok) toast(r.error ?? "No se pudo completar", "err"); else { toast(ok); router.refresh(); }
  });
  const sum = s.summary;
  const unitsWord = (n: number) => plural(s.unit, n);

  return (
    <div className={u.grid}>
      <div className={u.rowActions}>
        <Button size="sm" onClick={() => setDialog({ type: "add" })}>+ Registrar entrada</Button>
        <Button size="sm" variant="secondary" onClick={() => setDialog({ type: "edit" })}>Editar producto</Button>
        <Button size="sm" variant="danger" onClick={() => setDialog({ type: "delSupply" })}>Eliminar producto</Button>
        <Link className={u.link} style={{ alignSelf: "center" }} href="/admin/inventory">← Todo el inventario</Link>
      </div>

      <section className={u.card} aria-label="Datos del producto">
        <p className={u.sub}>Se usa en: {s.services.map((x) => x.name).join(", ") || "—"}.{" "}
          {s.expected != null ? `Una ${s.unit} rinde unos ${num(s.expected)} servicios.` : "No se ha indicado cuántos servicios rinde una unidad (se compara entre entradas)."}{s.notes && ` ${s.notes}`}</p>
        <div className={u.kpis} style={{ marginTop: 12 }}>
          <div className={`${u.card} ${u.stat}`}><span>Entradas</span><strong>{sum.lots}</strong><small>{sum.depleted} agotada{sum.depleted === 1 ? "" : "s"}</small></div>
          <div className={`${u.card} ${u.stat}`}><span>Servicios por {s.unit}</span><strong>{sum.servicesPerUnit == null ? "—" : num(sum.servicesPerUnit)}</strong><small>promedio de las entradas agotadas</small></div>
          <div className={`${u.card} ${u.stat}`}><span>Días que dura 1 {s.unit}</span><strong>{sum.daysPerUnit == null ? "—" : num(sum.daysPerUnit)}</strong><small>promedio de las entradas agotadas</small></div>
          <div className={`${u.card} ${u.stat}`}><span>Total consumido</span><strong>{num(sum.units)}</strong><small>{unitsWord(sum.units)} en {sum.services} servicios</small></div>
        </div>
      </section>

      <section className={u.card} aria-labelledby="lots-h">
        <h2 id="lots-h">Entradas y consumo</h2>
        {s.lots.length === 0 ? (
          <p className={u.sub}>Todavía no hay entradas. Registra la primera cuando llegue el pedido.</p>
        ) : (
          <ul className={c.lots}>
            {s.lots.map((l) => (
              <li key={l.id} className={c.lot} aria-label={`Entrada del ${day(l.received_on)}`}>
                <div className={c.lotHead}>
                  <strong>Llegaron {l.quantity} {unitsWord(l.quantity)} el {day(l.received_on)}</strong>
                  <span className={c.row}>
                    {l.state === "en_uso" && <span className={`${c.tag} ${c.tagInfo}`}>En uso</span>}
                    {l.state === "espera" && <span className={`${c.tag} ${c.tagMuted}`}>En espera</span>}
                    {l.state === "agotada" && <span className={`${c.tag} ${c.tagMuted}`}>Agotada el {day(l.depleted_on!)}</span>}
                    {l.verdictText && <span className={`${c.tag} ${toneClass(l.verdictTone)}`}>{l.verdictText}</span>}
                  </span>
                </div>
                <p className={c.muted}>
                  {l.unit_cost != null && <>Costo {money(l.unit_cost)} por {s.unit} · </>}{l.supplier && <>Proveedor: {l.supplier} · </>}{l.notes && <>{l.notes} · </>}
                  {l.state !== "espera" ? `${l.days} ${l.days === 1 ? "día" : "días"} · ${l.services} ${l.services === 1 ? "servicio" : "servicios"} · ${l.clients} ${l.clients === 1 ? "cliente" : "clientes"}` : "todavía no se usa"}
                </p>

                {l.narrative && (
                  <div className={`${c.story} ${l.verdictTone === "ok" ? c.storyOk : l.verdictTone === "warn" ? c.storyWarn : l.verdictTone === "bad" ? c.storyBad : ""}`}>
                    <p>{l.narrative.intro}</p>
                    <ul>{l.narrative.points.map((p) => <li key={p}>{p}</li>)}{l.narrative.problem && <li className={c.problem}>{l.narrative.problem}</li>}</ul>
                    <p className={c.conclusion}>Conclusión: {l.narrative.conclusion}</p>
                  </div>
                )}
                {l.progress.length > 0 && <div className={c.progress}>{l.progress.map((p) => <p key={p}>{p}</p>)}</div>}

                <div className={u.rowActions}>
                  {l.state === "en_uso" && <Button size="sm" onClick={() => setDialog({ type: "deplete", lot: l })}>Se agotó</Button>}
                  {l.state === "agotada" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => reopenLot(l.id), "Entrada reabierta")}>Reabrir (se marcó por error)</Button>}
                  <Button size="sm" variant="secondary" onClick={() => setDialog({ type: "lot", lot: l })} aria-label={`Editar entrada del ${day(l.received_on)}`}>Editar</Button>
                  <Button size="sm" variant="danger" onClick={() => setDialog({ type: "delLot", lot: l })} aria-label={`Eliminar entrada del ${day(l.received_on)}`}>Eliminar</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog?.type === "edit" && <SupplyModal supply={s} services={services} onClose={close} />}
      {dialog?.type === "add" && <LotModal supply={s} onClose={close} />}
      {dialog?.type === "lot" && <LotModal supply={s} lot={dialog.lot} onClose={close} />}
      {dialog?.type === "deplete" && <DepleteModal supply={s} lot={dialog.lot} onClose={close} />}
      <ConfirmDialog open={dialog?.type === "delLot"} danger title="¿Eliminar esta entrada?" confirmLabel="Eliminar" onClose={close}
        text="Se borra la entrada y deja de contar en el análisis. Queda en Auditoría y no se puede deshacer."
        onConfirm={() => { if (dialog?.type === "delLot") run(() => deleteLot(dialog.lot.id), "Entrada eliminada"); }} />
      <ConfirmDialog open={dialog?.type === "delSupply"} danger title={`¿Eliminar «${s.name}»?`} confirmLabel="Eliminar" onClose={close}
        text={`Se borra el producto con sus ${s.lots.length} entrada${s.lots.length === 1 ? "" : "s"} y su análisis. Queda en Auditoría y no se puede deshacer.`}
        onConfirm={() => start(async () => { const r = await deleteSupply(s.id); if (!r.ok) toast(r.error, "err"); else { toast("Producto eliminado"); router.push("/admin/inventory"); } })} />
    </div>
  );
}
