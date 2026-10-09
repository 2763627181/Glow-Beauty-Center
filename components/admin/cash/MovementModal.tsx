"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { addCashMovement } from "@/lib/actions/admin/cash";
import { categoriesFor, MOVE_HINT, MOVE_LABEL, needsDescription, needsEmployee, round2, type MoveCategory, type MoveKind } from "@/lib/domain/cash";
import { money } from "@/lib/format";
import { useAdmin } from "../AdminContext";
import { NumInput } from "../NumInput";
import { Alert } from "../primitives";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";

export type MovementPreset = { category?: MoveCategory; employeeId?: string; amount?: number; description?: string };

/** Registrar una salida (dinero que se saca de la caja) o una entrada (dinero que se mete). Una salida no puede ser mayor que el efectivo que hay. */
export function MovementModal({ kind, expected, preset, onClose }: { kind: MoveKind; expected: number; preset?: MovementPreset; onClose: () => void }) {
  const { staff } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const cats = categoriesFor(kind);
  const [category, setCategory] = useState<MoveCategory>(preset?.category && cats.includes(preset.category) ? preset.category : cats[0]);
  const [employeeId, setEmployeeId] = useState(preset?.employeeId ?? "");
  const [amount, setAmount] = useState<number | null>(preset?.amount ?? null);
  const [description, setDescription] = useState(preset?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const out = kind === "salida";
  const after = round2(expected + (amount ?? 0) * (out ? -1 : 1));
  const people = staff.filter((s) => s.active);

  function submit() {
    setError(null);
    if (amount == null || amount <= 0) return setError("Escribe un monto mayor a 0.");
    if (out && amount > expected + 0.004) return setError(`En la caja solo hay ${money(expected)}.`);
    if (needsEmployee(category) && !employeeId) return setError("Elige a la especialista.");
    if (needsDescription(category) && !description.trim()) return setError(out ? "Escribe en qué se usó el dinero." : "Escribe de dónde viene el dinero.");
    start(async () => {
      const r = await addCashMovement({ kind, category, amount, description: description.trim() || undefined, employeeId: needsEmployee(category) ? employeeId : null });
      if (!r.ok) return setError(r.error);
      toast(out ? `Salida de ${money(amount)} registrada` : `Entrada de ${money(amount)} registrada`);
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal open onClose={onClose} title={out ? "Salida de efectivo" : "Entrada de efectivo"}>
      <form className={u.grid} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className={u.sub}>{out ? "Dinero que se saca de la caja." : "Dinero que se mete a la caja."} Ahora hay <strong>{money(expected)}</strong> en efectivo.</p>
        <div className={u.field}>
          <label htmlFor="mv-cat">{out ? "¿Para qué es?" : "¿De dónde viene?"}</label>
          <select id="mv-cat" value={category} onChange={(e) => setCategory(e.target.value as MoveCategory)}>
            {cats.map((c) => <option key={c} value={c}>{MOVE_LABEL[c]}</option>)}
          </select>
          {MOVE_HINT[category] && <span className={u.hint}>{MOVE_HINT[category]}</span>}
        </div>
        {needsEmployee(category) && (
          <div className={u.field}>
            <label htmlFor="mv-emp">Especialista</label>
            <select id="mv-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Elegir…</option>
              {people.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
        )}
        <div className={u.field}>
          <label htmlFor="mv-amount">Monto (RD$)</label>
          <NumInput id="mv-amount" min={0} value={amount} onValue={setAmount} />
        </div>
        <div className={u.field}>
          <label htmlFor="mv-desc">{needsDescription(category) ? "Detalle (obligatorio)" : "Detalle (opcional)"}</label>
          <input id="mv-desc" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={out ? "Ej.: esponjas y limas" : "Ej.: cambio menudo"} />
        </div>
        {amount != null && amount > 0 && <p className={u.sub} aria-live="polite">Después de esto quedarían <strong>{money(Math.max(after, 0))}</strong> en caja.</p>}
        {error && <Alert>{error}</Alert>}
        <Button type="submit" block disabled={busy}>{busy ? "Registrando…" : out ? "Registrar salida" : "Registrar entrada"}</Button>
      </form>
    </Modal>
  );
}
