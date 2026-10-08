"use client";

import { groupLines } from "@/lib/domain/serviceLines";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, ButtonAnchor, ButtonLink } from "@/components/ui/Button";
import { WhatsAppIcon } from "@/components/ui/Icons";
import { syncCalendarNow } from "@/lib/actions/admin/appointments";
import type { ApptRow } from "@/lib/data/appointments";
import { apptTotal } from "@/lib/data/appointment-math";
import { can, allowed } from "@/lib/permissions";
import { SOURCE_LABEL } from "@/lib/domain/status";
import { duration, fmtDate, fmtTime, money } from "@/lib/format";
import { useAdmin } from "../AdminContext";
import { DeleteDialog } from "../DeleteDialog";
import { ConfirmDialog, Modal, useToast } from "../overlay";
import { StatusBadge } from "../primitives";
import u from "../ui.module.css";
import { EditAppointmentModal } from "./EditAppointmentModal";
import { OverlapNotice, PastNotice, useOverlapHints } from "./OverlapNotice";
import { PaymentModal } from "./PaymentModal";
import { canMove, clientWaLink, CLOSED, fromLocalInput, NEXT_STEP, toLocalInput, useApptActions, WA_KIND_LABEL, type WaKind } from "./useApptActions";

/** Ficha de una cita con todas las acciones permitidas para el rol actual. */
export function AppointmentModal({ appt, onClose }: { appt: ApptRow | null; onClose: () => void }) {
  const { role, employeeId, staff, templates, business } = useAdmin();
  const toast = useToast();
  const act = useApptActions(onClose);
  const [pay, setPay] = useState(false);
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState<null | "cancelado" | "no_asistio">(null);
  const [del, setDel] = useState(false);
  const [resched, setResched] = useState(false);
  const [when, setWhen] = useState("");
  const [emp, setEmp] = useState("");
  const [kind, setKind] = useState<WaKind>("confirm");
  const [busy, start] = useTransition();
  const reschedHints = useOverlapHints(
    resched && appt && when ? fromLocalInput(when) : null,
    (appt?.services ?? []).filter((s) => s.start_time && s.end_time)
      .map((s) => ({ employeeId: emp || s.employee_id, minutes: (+new Date(s.end_time!) - +new Date(s.start_time!)) / 60000, parallel: s.parallel })),
    appt?.id,
  );

  if (!appt) return null;
  const manage = allowed(role, "manageAppointments");
  const charge = allowed(role, "charge");
  const own = !!employeeId && (appt.employee_id === employeeId || appt.services.some((s) => s.employee_id === employeeId));
  const closed = CLOSED.includes(appt.status);
  const next = NEXT_STEP[appt.status];
  const total = apptTotal(appt);
  const name = `${appt.client.first_name} ${appt.client.last_name}`.trim();
  const mayAdvance = (to: "en_servicio" | "completado") => canMove(role, own, appt.status, to);
  const start0 = fmtTime(appt.start_time);

  return (
    <>
      <Modal open={!pay && !edit} onClose={onClose} title={name} wide>
        <div className={u.grid}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <StatusBadge status={appt.status} />
            <span className={u.sub}>{SOURCE_LABEL[appt.source]} · {appt.request_number}</span>
          </div>
          <p>
            <strong>{fmtDate(appt.start_time, { weekday: "long", day: "numeric", month: "long" })}</strong> · {start0} – {fmtTime(appt.end_time)} ({duration(Math.round((+new Date(appt.end_time) - +new Date(appt.start_time)) / 60000))})
            <br />{appt.client.phone}{appt.client.email ? ` · ${appt.client.email}` : ""}
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 2 }}>
            {groupLines(appt.services).map((g) => (
              <li key={g.key}>
                {g.name} {g.quantity > 1 && `×${g.quantity}`} — {money(g.price * g.quantity)}
                {(g.employees.length > 0 || g.lines[0].start_time) && <span className={u.sub}> · {g.employees.length ? g.employees.join(" + ") : "Sin asignar"}{g.lines[0].start_time ? ` · ${fmtTime(g.lines[0].start_time)}` : ""}</span>}
              </li>
            ))}
          </ul>
          <p>
            {appt.discount > 0 && <span className={u.sub}>Descuento −{money(appt.discount)} · </span>}
            {appt.tip > 0 && <span className={u.sub}>Propina {money(appt.tip)} · </span>}
            {allowed(role, "seeMoney") && <><strong>Total {money(total)}</strong>{appt.paid > 0 && <span className={u.sub}> · pagado {money(appt.paid)}</span>}</>}
          </p>
          {appt.notes && <p className={u.sub}>Nota del cliente: {appt.notes}</p>}

          {/* Contacto */}
          <div className={u.rowActions} style={{ alignItems: "center" }}>
            {manage && (
              <>
                <label className="sr-only" htmlFor="wa-kind">Mensaje de WhatsApp</label>
                <select id="wa-kind" value={kind} onChange={(e) => setKind(e.target.value as WaKind)} style={{ minHeight: 40, borderRadius: 999, padding: "0 12px", border: "1px solid rgb(41 37 36 / 0.2)" }}>
                  {(Object.keys(WA_KIND_LABEL) as WaKind[]).map((k) => <option key={k} value={k}>{WA_KIND_LABEL[k]}</option>)}
                </select>
              </>
            )}
            <ButtonAnchor variant="whatsapp" size="sm" href={clientWaLink(appt, templates, business.name, kind)} target="_blank" rel="noopener"><WhatsAppIcon width={18} height={18} /> Hablar por WhatsApp</ButtonAnchor>
            <ButtonAnchor variant="secondary" size="sm" href={`tel:${appt.client.phone}`}>Llamar</ButtonAnchor>
            {can(role, "clients") && <ButtonLink variant="secondary" size="sm" href={`/admin/clients/${appt.client_id}`}>Ver cliente</ButtonLink>}
            <ButtonLink variant="secondary" size="sm" href={`/admin/appointments/${appt.id}`}>Detalle</ButtonLink>
          </div>

          {/* Flujo */}
          {!closed && (
            <div className={u.rowActions}>
              {manage && next && <Button size="sm" disabled={act.pending} onClick={() => act.setStatus(appt.id, next.to)}>{next.label}</Button>}
              {!manage && mayAdvance("en_servicio") && <Button size="sm" disabled={act.pending} onClick={() => act.setStatus(appt.id, "en_servicio", "Servicio iniciado")}>Comenzar servicio</Button>}
              {charge && <Button size="sm" variant="soft" onClick={() => setPay(true)}>Cobrar</Button>}
              {appt.status === "en_servicio" && mayAdvance("completado") && <Button size="sm" disabled={act.pending} onClick={() => act.setStatus(appt.id, "completado", "Cita completada y venta generada")}>Completar</Button>}
              {manage && <Button size="sm" variant="secondary" onClick={() => setEdit(true)}>Editar</Button>}
              {manage && <Button size="sm" variant="secondary" onClick={() => { setWhen(toLocalInput(appt.start_time)); setEmp(""); setResched((r) => !r); }}>Reprogramar</Button>}
              {manage && ["confirmado", "en_espera"].includes(appt.status) && <Button size="sm" variant="secondary" onClick={() => setConfirm("no_asistio")}>No asistió</Button>}
              {manage && <Button size="sm" variant="danger" onClick={() => setConfirm("cancelado")}>Cancelar cita</Button>}
            </div>
          )}
          {closed && manage && appt.status !== "completado" && (
            <div className={u.rowActions}>
              <Button size="sm" variant="secondary" disabled={act.pending} onClick={() => act.setStatus(appt.id, "solicitud", "Cita reabierta como solicitud")}>Reabrir como solicitud</Button>
            </div>
          )}

          {resched && (
            <div className={u.form2}>
              <div className={u.field}><label htmlFor="rs-when">Nueva fecha y hora de inicio</label><input id="rs-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
              <div className={u.field}><label htmlFor="rs-emp">Asignar todo a</label>
                <select id="rs-emp" value={emp} onChange={(e) => setEmp(e.target.value)}>
                  <option value="">Mantener especialistas actuales</option>
                  {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              {when && <div className={u.span2}><PastNotice whenISO={fromLocalInput(when)} /></div>}
              {reschedHints.length > 0 && <div className={u.span2} style={{ display: "grid", gap: 6 }}><OverlapNotice hints={reschedHints} /></div>}
              <div className={u.span2}><Button size="sm" disabled={act.pending || !when} onClick={() => act.reschedule(appt.id, fromLocalInput(when), emp || null)}>Guardar nueva hora</Button></div>
            </div>
          )}

          {appt.status === "completado" && <p className={u.sub}>Cita completada. <Link className={u.link} href={`/admin/appointments/${appt.id}`}>Ver venta y cobros</Link></p>}

          {manage && (
            <div className={u.rowActions} style={{ borderTop: "var(--border)", paddingTop: 12 }}>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => start(async () => { const r = await syncCalendarNow(appt.id); toast(r.ok ? "Sincronizada con Google Calendar" : r.error, r.ok ? "ok" : "err"); })}>Sincronizar con Google Calendar</Button>
              {allowed(role, "deleteRecords") && <Button size="sm" variant="danger" onClick={() => setDel(true)}>Eliminar definitivamente</Button>}
            </div>
          )}
        </div>
      </Modal>

      {pay && <PaymentModal appt={appt} onClose={() => setPay(false)} onDone={() => { act.refresh(); }} completeByDefault={appt.status === "en_servicio" || appt.status === "en_espera"} />}
      {edit && <EditAppointmentModal appt={appt} onClose={() => setEdit(false)} onSaved={() => act.refresh()} />}

      <ConfirmDialog open={!!confirm} danger
        title={confirm === "cancelado" ? "¿Cancelar la cita?" : confirm === "no_asistio" ? "¿Marcar como no asistió?" : "¿Eliminar la cita?"}
        text={confirm === "cancelado" ? "El horario quedará libre y se actualizará en el calendario. Podrás reabrirla después." : confirm === "no_asistio" ? "Se registrará que el cliente no llegó y el horario quedará libre." : "Se borrará por completo con su historial. Esta acción no se puede deshacer."}
        confirmLabel={confirm === "cancelado" ? "Cancelar cita" : confirm === "no_asistio" ? "Marcar" : "Eliminar"} onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) act.setStatus(appt.id, confirm, confirm === "cancelado" ? "Cita cancelada" : "Marcada como no asistió");
        }} />
      {del && <DeleteDialog kind="appointments" ids={[appt.id]} title={["solicitud", "contactando", "contactado"].includes(appt.status) ? "¿Eliminar la solicitud?" : "¿Eliminar la cita?"} onClose={() => setDel(false)} onDone={() => { setDel(false); onClose(); act.refresh(); }} />}
    </>
  );
}
