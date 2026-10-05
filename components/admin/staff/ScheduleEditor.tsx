"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { addTimeOff, removeTimeOff, saveSchedule } from "@/lib/actions/admin/staff";
import { fmtDate } from "@/lib/format";
import { Alert } from "../primitives";
import { useToast } from "../overlay";
import u from "../ui.module.css";
import { fromLocalInput } from "../appointments/useApptActions";

export type Day = { weekday: number; working: boolean; start: string; end: string; breakStart: string; breakEnd: string };
const NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function ScheduleEditor({ employeeId, initial }: { employeeId: string; initial: Day[] }) {
  const [days, setDays] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const set = (wd: number, p: Partial<Day>) => setDays((d) => d.map((x) => (x.weekday === wd ? { ...x, ...p } : x)));
  return (
    <section className={u.card}>
      <h2>Horario semanal</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {ORDER.map((wd) => {
          const d = days.find((x) => x.weekday === wd)!;
          return (
            <div key={wd} style={{ display: "grid", gridTemplateColumns: "110px repeat(4, minmax(0,1fr))", gap: 8, alignItems: "center" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 40 }}><input type="checkbox" checked={d.working} onChange={(e) => set(wd, { working: e.target.checked })} />{NAMES[wd]}</label>
              {d.working ? (
                <>
                  <input aria-label={`${NAMES[wd]} entrada`} type="time" value={d.start} onChange={(e) => set(wd, { start: e.target.value })} />
                  <input aria-label={`${NAMES[wd]} salida`} type="time" value={d.end} onChange={(e) => set(wd, { end: e.target.value })} />
                  <input aria-label={`${NAMES[wd]} inicio de almuerzo`} type="time" value={d.breakStart} onChange={(e) => set(wd, { breakStart: e.target.value })} />
                  <input aria-label={`${NAMES[wd]} fin de almuerzo`} type="time" value={d.breakEnd} onChange={(e) => set(wd, { breakEnd: e.target.value })} />
                </>
              ) : <span className={u.sub} style={{ gridColumn: "2 / -1" }}>Día libre</span>}
            </div>
          );
        })}
      </div>
      <p className={u.hint} style={{ margin: "8px 0" }}>Orden de columnas: entrada · salida · inicio almuerzo · fin almuerzo.</p>
      {err && <Alert>{err}</Alert>}
      <Button size="sm" disabled={pending} onClick={() => start(async () => {
        setErr(null);
        const r = await saveSchedule(employeeId, days);
        if (r.ok) toast("Horario guardado"); else setErr(r.error);
      })}>Guardar horario</Button>
    </section>
  );
}

export function TimeOffEditor({ employeeId, items }: { employeeId: string; items: { id: string; starts_at: string; ends_at: string; reason: string | null }[] }) {
  const [a, setA] = useState(""), [b, setB] = useState(""), [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <section className={u.card}>
      <h2>Días libres y vacaciones</h2>
      {items.length === 0 && <p className={u.sub}>Sin ausencias programadas.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {items.map((t) => (
          <li key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <span>{fmtDate(t.starts_at, { day: "numeric", month: "short" })} → {fmtDate(t.ends_at, { day: "numeric", month: "short", year: "numeric" })} {t.reason && <span className={u.sub}>· {t.reason}</span>}</span>
            <Button size="sm" variant="danger" onClick={() => start(async () => { const r = await removeTimeOff(t.id, employeeId); if (r.ok) router.refresh(); else toast(r.error, "err"); })}>Quitar</Button>
          </li>
        ))}
      </ul>
      <div className={u.form2}>
        <div className={u.field}><label htmlFor="to-a">Desde</label><input id="to-a" type="datetime-local" value={a} onChange={(e) => setA(e.target.value)} /></div>
        <div className={u.field}><label htmlFor="to-b">Hasta</label><input id="to-b" type="datetime-local" value={b} onChange={(e) => setB(e.target.value)} /></div>
        <div className={`${u.field} ${u.span2}`}><label htmlFor="to-r">Motivo (opcional)</label><input id="to-r" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        {err && <div className={u.span2}><Alert>{err}</Alert></div>}
        <div className={u.span2}><Button size="sm" disabled={pending || !a || !b} onClick={() => start(async () => {
          setErr(null);
          const r = await addTimeOff(employeeId, fromLocalInput(a), fromLocalInput(b), reason);
          if (r.ok) { setA(""); setB(""); setReason(""); toast("Ausencia registrada"); router.refresh(); } else setErr(r.error);
        })}>Agregar ausencia</Button></div>
      </div>
    </section>
  );
}
