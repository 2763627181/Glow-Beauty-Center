"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { closeCash } from "@/lib/actions/admin/cash";
import { cashDifference, countDenominations, DENOMINATIONS, type CashTotals } from "@/lib/domain/cash";
import { money } from "@/lib/format";
import { NumInput } from "../NumInput";
import { Alert } from "../primitives";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";
import c from "./cash.module.css";

/** Cerrar la caja: se cuenta el efectivo, se compara con lo que el sistema espera y, si hay diferencia, se explica en una nota. */
export function CloseCashModal({ totals, onClose }: { totals: CashTotals; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [counted, setCounted] = useState<number | null>(null);
  const [bills, setBills] = useState<Partial<Record<number, number>>>({});
  const [showBills, setShowBills] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const diff = counted == null ? null : cashDifference(counted, totals.expected);

  function submit() {
    setError(null);
    if (counted == null || counted < 0) return setError("Escribe cuánto efectivo contaste (si no hay nada, escribe 0).");
    if (diff !== 0 && !note.trim()) return setError("Hay una diferencia: escribe una nota que la explique.");
    start(async () => {
      const r = await closeCash({ counted, note: note.trim() || undefined });
      if (!r.ok) return setError(r.error);
      toast(r.difference === 0 ? `Caja ${r.number} cerrada sin diferencias` : `Caja ${r.number} cerrada · diferencia ${money(r.difference)}`);
      router.push(`/admin/cash/${r.id}`);
      router.refresh();
    });
  }

  return (
    <Modal open onClose={onClose} title="Cerrar caja" wide>
      <form className={u.grid} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className={c.summaryGrid}>
          <div><span>Fondo inicial</span><span>{money(totals.opening)}</span></div>
          <div><span>+ Efectivo cobrado</span><span>{money(totals.cash_in)}</span></div>
          {totals.entradas > 0 && <div><span>+ Entradas de efectivo</span><span>{money(totals.entradas)}</span></div>}
          {totals.cash_refunds > 0 && <div><span>− Efectivo reembolsado</span><span>{money(totals.cash_refunds)}</span></div>}
          {totals.salidas > 0 && <div><span>− Salidas de efectivo</span><span>{money(totals.salidas)}</span></div>}
          <div><strong>Efectivo que debería haber</strong><strong>{money(totals.expected)}</strong></div>
        </div>

        <div className={u.field}>
          <label htmlFor="cc-counted">Efectivo que contaste (RD$)</label>
          <NumInput id="cc-counted" min={0} value={counted} onValue={setCounted} />
          <div><Button type="button" size="sm" variant="soft" onClick={() => setShowBills((v) => !v)} aria-expanded={showBills}>{showBills ? "Ocultar conteo de billetes" : "Contar billetes y monedas"}</Button></div>
        </div>

        {showBills && (
          <div className={c.count} role="group" aria-label="Conteo de billetes y monedas">
            {DENOMINATIONS.map((d) => (
              <label key={d}>
                <span>{money(d)}</span>
                <NumInput integer min={0} aria-label={`Cantidad de ${money(d)}`} value={bills[d] ?? null} onValue={(v) => {
                  const next = { ...bills, [d]: v ?? undefined };
                  setBills(next);
                  setCounted(countDenominations(next));
                }} />
              </label>
            ))}
          </div>
        )}

        {diff !== null && (
          <p className={`${c.diff} ${diff === 0 ? c.diffOk : diff < 0 ? c.diffLess : c.diffMore}`} role="status">
            {diff === 0 ? "Cuadra exacto: no hay diferencia." : diff < 0 ? `Faltan ${money(Math.abs(diff))} en la caja.` : `Sobran ${money(diff)} en la caja.`}
          </p>
        )}

        <div className={u.field}>
          <label htmlFor="cc-note">{diff !== null && diff !== 0 ? "Nota (obligatoria: explica la diferencia)" : "Nota (opcional)"}</label>
          <textarea id="cc-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" block disabled={busy || counted == null}>{busy ? "Cerrando…" : "Cerrar caja"}</Button>
      </form>
    </Modal>
  );
}
