"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { updateAppointment } from "@/lib/actions/admin/appointments";
import type { ApptRow } from "@/lib/data/appointments";
import { SOURCE_LABEL } from "@/lib/domain/status";
import { money } from "@/lib/format";
import { Alert } from "../primitives";
import { Modal, useToast } from "../overlay";
import u from "../ui.module.css";
import { linesFromAppt, linesToPayload, subtotalOf, validateLines } from "./lines";
import { LinesEditor } from "./LinesEditor";
import { fromLocalInput, toLocalInput } from "./useApptActions";

const SOURCES = ["website", "admin", "whatsapp", "phone", "walk_in", "instagram"] as const;

export function EditAppointmentModal({ appt, onClose, onSaved }: { appt: ApptRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [lines, setLines] = useState(() => linesFromAppt(appt.services));
  const [when, setWhen] = useState(toLocalInput(appt.start_time));
  const [notes, setNotes] = useState(appt.notes ?? "");
  const [source, setSource] = useState<string>(appt.source);
  const [discount, setDiscount] = useState(String(appt.discount || ""));
  const [tip, setTip] = useState(String(appt.tip || ""));
  const [error, setError] = useState<string | null>(null);

  const sub = subtotalOf(lines);
  const total = sub - (Number(discount) || 0) + (Number(tip) || 0);

  function save() {
    setError(null);
    const bad = validateLines(lines) ?? ((Number(discount) || 0) > sub ? "El descuento no puede superar el subtotal." : null);
    if (bad) return setError(bad);
    if (!when) return setError("Elige la fecha y hora.");
    start(async () => {
      const r = await updateAppointment(appt.id, {
        start_time: fromLocalInput(when), notes: notes.trim() || null, source: source as "admin",
        discount: Number(discount) || 0, tip: Number(tip) || 0, lines: linesToPayload(lines),
      });
      if (!r.ok) return setError(r.error);
      toast("Cita actualizada");
      onSaved();
      onClose();
    });
  }

  return (
    <Modal open onClose={onClose} title={`Editar cita · ${appt.client.first_name}`} wide>
      <div className={u.grid}>
        <p className={u.sub}>Los servicios con horario se agendan uno tras otro desde la hora de inicio, en el orden de la lista. Si un especialista ya tiene cita en ese tramo, se avisará.</p>
        <div className={u.form2}>
          <div className={u.field}><label htmlFor="ea-when">Inicio</label><input id="ea-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
          <div className={u.field}><label htmlFor="ea-src">Origen</label>
            <select id="ea-src" value={source} onChange={(e) => setSource(e.target.value)}>{SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select></div>
        </div>

        <LinesEditor lines={lines} onChange={setLines} lockedTimed />

        <div className={u.form2}>
          <div className={u.field}><label htmlFor="ea-disc">Descuento (RD$)</label><input id="ea-disc" type="number" step="any" min={0} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          <div className={u.field}><label htmlFor="ea-tip">Propina (RD$)</label><input id="ea-tip" type="number" step="any" min={0} inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} /></div>
          <div className={`${u.field} ${u.span2}`}><label htmlFor="ea-notes">Notas</label><textarea id="ea-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>

        <div className={u.card} style={{ background: "var(--color-cream)", display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
          <span>Total</span><span>{money(total)}</span>
        </div>
        {error && <Alert>{error}</Alert>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button onClick={save} disabled={pending}>{pending ? "Guardando…" : "Guardar cambios"}</Button>
        </div>
      </div>
    </Modal>
  );
}
