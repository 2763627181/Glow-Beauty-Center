"use client";

import Link from "next/link";
import { useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import type { ApptRow } from "@/lib/data/appointments";
import { STATUS_META } from "@/lib/domain/status";
import { drToISO, fmtDate, fmtTime, TZ, type DateOpts } from "@/lib/format";
import { allowed } from "@/lib/permissions";
import { useAdmin } from "../AdminContext";
import { AppointmentModal } from "../appointments/AppointmentModal";
import { useNow } from "../useNow";
import { NewAppointmentDialog, type Preset } from "../appointments/NewAppointment";
import s from "./CalendarView.module.css";

export type View = "day" | "week" | "month";
const START_H = 8, END_H = 20, PX = 1.1; // px por minuto

const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const minutesOfDay = (iso: string) => {
  const [h, m] = new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).split(":").map(Number);
  return h * 60 + m;
};
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00-04:00`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const longDay = (d: string, o: DateOpts) => fmtDate(`${d}T12:00:00-04:00`, o);
const monthShift = (date: string, n: number) => { const d = new Date(`${date.slice(0, 7)}-01T12:00:00-04:00`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const pad = (n: number) => String(n).padStart(2, "0");

function Chip({ a, label, onOpen }: { a: ApptRow; label?: string; onOpen: () => void }) {
  const st = STATUS_META[a.status];
  return (
    <button className={`${s.chip} ${s[`st_${a.status}`] ?? ""}`} onClick={onOpen}
      aria-label={`${a.client.first_name}, ${fmtTime(a.start_time)}, ${a.services.map((x) => x.name).join(", ")}, ${st.label}`}>
      <strong>{label ?? fmtTime(a.start_time)} · {a.client.first_name}</strong>
      {a.services.map((x) => x.name).join(", ")} · {st.mark} {st.label}
    </button>
  );
}

type Block = { key: string; a: ApptRow; start: string; end: string; text: string };

/** Bloques de un día para una columna: una por línea de servicio cronometrada del especialista (o la cita entera si es antigua). */
function blocksFor(appts: ApptRow[], day: string, employeeId: string | null): Block[] {
  const out: Block[] = [];
  for (const a of appts) {
    const timed = a.services.filter((x) => x.start_time && x.end_time);
    if (timed.length) {
      for (const l of timed) if ((l.employee_id ?? null) === employeeId && dayOf(l.start_time!) === day) out.push({ key: l.id, a, start: l.start_time!, end: l.end_time!, text: l.name });
    } else if ((a.employee_id ?? null) === employeeId && dayOf(a.start_time) === day) {
      out.push({ key: a.id, a, start: a.start_time, end: a.end_time, text: a.services.map((x) => x.name).join(", ") });
    }
  }
  return out;
}

export function CalendarView({ view, date, today, appts, employees, query }: {
  view: View; date: string; today: string; appts: ApptRow[]; employees: { id: string; full_name: string }[]; query: string;
}) {
  const { role } = useAdmin();
  const manage = allowed(role, "manageAppointments");
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState<Preset | null>(null);
  const href = (v: View, d: string) => `/admin/calendar?view=${v}&date=${d}${query}`;
  const monday = (d: string) => addDays(d, -((new Date(`${d}T12:00:00-04:00`).getUTCDay() + 6) % 7));

  const nextDate = view === "month" ? monthShift(date, 1) : addDays(date, view === "day" ? 1 : 7);
  const prevDate = view === "month" ? monthShift(date, -1) : addDays(date, view === "day" ? -1 : -7);
  const title = view === "day" ? longDay(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : view === "week" ? `${longDay(monday(date), { day: "numeric", month: "short" })} – ${longDay(addDays(monday(date), 6), { day: "numeric", month: "short", year: "numeric" })}`
    : longDay(date, { month: "long", year: "numeric" });

  const byDay = (d: string) => appts.filter((a) => dayOf(a.start_time) === d);
  const grid = (END_H - START_H) * 60 * PX;
  const now = useNow();
  const nowMin = today === date && now !== null ? minutesOfDay(new Date(now).toISOString()) : null;
  const unassigned = blocksFor(appts, date, null);
  const cols = [...employees.map((e) => ({ id: e.id as string | null, name: e.full_name })), ...(unassigned.length ? [{ id: null, name: "Sin asignar" }] : [])];

  function clickColumn(e: React.MouseEvent<HTMLDivElement>, empId: string | null) {
    if (!manage || e.target !== e.currentTarget) return; // solo en espacio libre, no sobre una cita
    const rect = e.currentTarget.getBoundingClientRect();
    const mins = Math.max(START_H * 60, Math.min(END_H * 60 - 15, Math.round((START_H * 60 + (e.clientY - rect.top - 40) / PX) / 15) * 15));
    setCreate({ start: drToISO(date, `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`), employeeId: empId ?? undefined });
  }

  return (
    <>
      <div className={s.bar}>
        <div className={s.nav}>
          <ButtonLink size="sm" variant="secondary" href={href(view, prevDate)} aria-label="Anterior">←</ButtonLink>
          <ButtonLink size="sm" variant="secondary" href={href(view, today)}>Hoy</ButtonLink>
          <ButtonLink size="sm" variant="secondary" href={href(view, nextDate)} aria-label="Siguiente">→</ButtonLink>
        </div>
        <h2 className={s.title}>{title}</h2>
        <div className={s.seg} role="tablist" aria-label="Vista">
          {(["day", "week", "month"] as View[]).map((v) => (
            <Link key={v} href={href(v, date)} role="tab" aria-selected={view === v} className={view === v ? s.segOn : ""}>{{ day: "Día", week: "Semana", month: "Mes" }[v]}</Link>
          ))}
        </div>
      </div>
      {view === "day" && manage && <p className={s.hint}>Toca un espacio libre de la agenda para crear una cita en esa hora.</p>}

      {view === "day" && (
        <div className={s.dayWrap} tabIndex={0} role="region" aria-label="Agenda del día; se desplaza con las flechas del teclado">
          <div className={s.hours} style={{ height: grid + 40 }}>
            {Array.from({ length: END_H - START_H + 1 }, (_, i) => <span key={i} className={s.hour} style={{ top: 40 + i * 60 * PX }}>{(START_H + i) % 12 || 12}{START_H + i >= 12 ? "p" : "a"}</span>)}
          </div>
          {cols.length === 0 && <p className={s.hint} style={{ padding: 20 }}>No hay especialistas activos.</p>}
          {cols.map((c) => (
            <div key={c.id ?? "none"} className={s.col} style={{ height: grid + 40, cursor: manage ? "copy" : "default" }} onClick={(e) => clickColumn(e, c.id)}>
              <div className={s.colHead}>{c.name}</div>
              {Array.from({ length: END_H - START_H }, (_, i) => <div key={i} className={s.line} style={{ top: 40 + i * 60 * PX }} />)}
              {nowMin !== null && nowMin >= START_H * 60 && nowMin <= END_H * 60 && <div className={s.now} style={{ top: 40 + (nowMin - START_H * 60) * PX }} aria-hidden />}
              {blocksFor(appts, date, c.id).map((b) => {
                const top = Math.max(0, (minutesOfDay(b.start) - START_H * 60) * PX);
                const h = Math.max(((+new Date(b.end) - +new Date(b.start)) / 60000) * PX, 34);
                return <div key={b.key} className={s.block} style={{ top: 40 + top, height: h }}><Chip a={b.a} label={fmtTime(b.start)} onOpen={() => setOpen(b.a.id)} /></div>;
              })}
            </div>
          ))}
        </div>
      )}

      {view === "week" && (
        <div className={s.week}>
          {Array.from({ length: 7 }, (_, i) => addDays(monday(date), i)).map((d) => (
            <section key={d} className={`${s.dayBox} ${d === today ? s.today : ""}`} aria-label={longDay(d, { weekday: "long", day: "numeric" })}>
              <h3><Link href={href("day", d)}>{longDay(d, { weekday: "short", day: "numeric" })}</Link></h3>
              {byDay(d).map((a) => <Chip key={a.id} a={a} onOpen={() => setOpen(a.id)} />)}
            </section>
          ))}
        </div>
      )}

      {view === "month" && (() => {
        const start = monday(`${date.slice(0, 7)}-01`);
        return (
          <div className={s.month}>
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((h) => <div key={h} className={s.mh}>{h}</div>)}
            {Array.from({ length: 42 }, (_, i) => addDays(start, i)).map((d) => {
              const list = byDay(d);
              return (
                <div key={d} className={`${s.cell} ${d.slice(0, 7) !== date.slice(0, 7) ? s.out : ""} ${d === today ? s.today : ""}`}>
                  <Link href={href("day", d)}><strong>{Number(d.slice(8))}</strong>{list.length > 0 && <span className={s.more}> · {list.length} cita{list.length > 1 ? "s" : ""}</span>}</Link>
                  {list.slice(0, 3).map((a) => <Chip key={a.id} a={a} onOpen={() => setOpen(a.id)} />)}
                  {list.length > 3 && <span className={s.more}>+{list.length - 3} más</span>}
                </div>
              );
            })}
          </div>
        );
      })()}

      <AppointmentModal appt={appts.find((a) => a.id === open) ?? null} onClose={() => setOpen(null)} />
      {create && <NewAppointmentDialog mode="cita" preset={create} onClose={() => setCreate(null)} />}
    </>
  );
}
