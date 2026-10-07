"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { createPayroll } from "@/lib/actions/admin/payroll";
import { defaultTitle, periodLabel, suggestPeriods } from "@/lib/domain/payroll";
import { Alert } from "../primitives";
import { Modal } from "../overlay";
import u from "../ui.module.css";

/** Botón «+ Nueva nómina»: elige el período (o uno de los sugeridos) y crea el borrador con las ventas de esas fechas. */
export function NewPayroll({ today }: { today: string }) {
  const router = useRouter();
  const periods = useMemo(() => suggestPeriods(today), [today]);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const first = periods[0];
  const [pick, setPick] = useState(first.key);
  const [from, setFrom] = useState(first.start);
  const [to, setTo] = useState(first.end);
  const [title, setTitle] = useState(defaultTitle(first.start, first.end));
  const [titleEdited, setTitleEdited] = useState(false);
  const [onlyPaid, setOnlyPaid] = useState(true);
  const [tips, setTips] = useState(true);
  const [notes, setNotes] = useState("");

  const setRange = (a: string, b: string) => {
    setFrom(a); setTo(b);
    if (!titleEdited && a && b && b >= a) setTitle(defaultTitle(a, b));
  };
  const choose = (key: string) => {
    setPick(key);
    const p = periods.find((x) => x.key === key);
    if (p) setRange(p.start, p.end);
  };

  function submit() {
    setErr(null);
    start(async () => {
      const r = await createPayroll({ title, start: from, end: to, onlyPaid, includeTips: tips, notes: notes || undefined });
      if (!r.ok) return setErr(r.error);
      setOpen(false);
      router.push(`/admin/payroll/${r.id}`);
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => { setErr(null); setOpen(true); }}>+ Nueva nómina</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nueva nómina" wide>
        <div className={u.form2}>
          <div className={`${u.field} ${u.span2}`}><label htmlFor="pr-period">Período</label>
            <select id="pr-period" value={pick} onChange={(e) => choose(e.target.value)}>
              {periods.map((p) => <option key={p.key} value={p.key}>{p.label} · {periodLabel(p.start, p.end)}</option>)}
              <option value="custom">Otro período…</option>
            </select></div>
          <div className={u.field}><label htmlFor="pr-from">Desde</label>
            <input id="pr-from" type="date" max={today} value={from} onChange={(e) => { setPick("custom"); setRange(e.target.value, to); }} /></div>
          <div className={u.field}><label htmlFor="pr-to">Hasta (incluido)</label>
            <input id="pr-to" type="date" value={to} onChange={(e) => { setPick("custom"); setRange(from, e.target.value); }} /></div>
          <div className={`${u.field} ${u.span2}`}><label htmlFor="pr-title">Nombre de la nómina</label>
            <input id="pr-title" value={title} maxLength={120} onChange={(e) => { setTitle(e.target.value); setTitleEdited(true); }} /></div>
          <label className={u.span2} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={onlyPaid} onChange={(e) => setOnlyPaid(e.target.checked)} style={{ marginTop: 4 }} />
            <span>Contar solo las ventas cobradas por completo<br /><span className={u.hint}>Si lo quitas, también cuentan las ventas pendientes o con pago parcial. Las reembolsadas nunca cuentan.</span></span>
          </label>
          <label className={u.span2} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={tips} onChange={(e) => setTips(e.target.checked)} style={{ marginTop: 4 }} />
            <span>Incluir las propinas<br /><span className={u.hint}>Se reparten entre quienes atendieron cada venta, según lo que vendió cada una.</span></span>
          </label>
          <div className={`${u.field} ${u.span2}`}><label htmlFor="pr-notes">Notas (opcional)</label>
            <textarea id="pr-notes" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <p className={`${u.hint} ${u.span2}`}>Se crea un volante por cada especialista activa con su comisión, propinas y sueldo base. Después podrás ajustar bonos y descuentos antes de pagar.</p>
          {err && <div className={u.span2}><Alert>{err}</Alert></div>}
          <div className={u.span2}><Button block onClick={submit} disabled={pending || !from || !to || title.trim().length < 2}>{pending ? "Calculando…" : "Crear nómina"}</Button></div>
        </div>
      </Modal>
    </>
  );
}
