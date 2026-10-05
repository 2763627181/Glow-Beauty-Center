"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Button, ButtonAnchor, ButtonLink } from "@/components/ui/Button";
import { setAppointmentStatus } from "@/lib/actions/admin/appointments";
import type { ApptRow } from "@/lib/data/appointments";
import { apptTotal } from "@/lib/data/appointment-math";
import { BOARD_CLOSED_COLUMNS, BOARD_COLUMNS, SOURCE_LABEL, STATUS_META } from "@/lib/domain/status";
import { fmtTime, money } from "@/lib/format";
import { allowed } from "@/lib/permissions";
import type { AppointmentStatus } from "@/types/domain";
import { useAdmin } from "../AdminContext";
import { Modal, useToast } from "../overlay";
import { AppointmentModal } from "./AppointmentModal";
import { EditAppointmentModal } from "./EditAppointmentModal";
import { PaymentModal } from "./PaymentModal";
import { useNow } from "../useNow";
import { canMove, clientWaLink, NEXT_STEP } from "./useApptActions";
import s from "./KanbanBoard.module.css";

function remaining(iso: string, status: AppointmentStatus, now: number) {
  if (["completado", "cancelado", "no_asistio"].includes(status)) return null;
  const min = Math.round((new Date(iso).getTime() - now) / 60000);
  const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
  if (min < -1) return { text: `hace ${fmt(Math.abs(min))}`, late: true };
  if (min <= 1) return { text: "ahora", late: false };
  return { text: `en ${fmt(min)}`, late: false };
}

type CardProps = {
  a: ApptRow; overlay?: boolean; own: boolean;
  onOpen: () => void; onPay: () => void; onEdit: () => void; onStep: (to: AppointmentStatus) => void;
};

function Card({ a, overlay, own, onOpen, onPay, onEdit, onStep }: CardProps) {
  const { role, templates, business } = useAdmin();
  const movable = role !== "specialist" || own;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: a.id, data: { status: a.status }, disabled: !movable });
  const now = useNow();
  const rem = now === null ? null : remaining(a.start_time, a.status, now);
  const next = NEXT_STEP[a.status];
  const manage = allowed(role, "manageAppointments");
  const charge = allowed(role, "charge");
  const closed = ["cancelado", "no_asistio"].includes(a.status);
  return (
    <article ref={setNodeRef} className={`${s.card} ${overlay ? s.drag : ""} ${isDragging ? s.dragging : ""} ${closed ? s.closedCard : ""}`} aria-label={`${a.client.first_name} ${fmtTime(a.start_time)}`}>
      <div className={s.cardTop}>
        <button className={s.name} onClick={onOpen}>{a.client.first_name} {a.client.last_name}</button>
        <span className={s.time}>{fmtTime(a.start_time)}</span>
        {movable && <button className={s.grip} {...listeners} {...attributes} aria-label="Arrastrar para cambiar de estado">⋮⋮</button>}
      </div>
      <p className={s.meta}>{a.services.map((x) => x.name).join(" · ")}</p>
      <p className={s.meta}>{a.employees.length ? a.employees.map((e) => e.name).join(" + ") : "Sin asignar"}{allowed(role, "seeMoney") ? ` · ${money(apptTotal(a))}` : ""}</p>
      <div className={s.tags}>
        <span className={s.src}>{SOURCE_LABEL[a.source]}</span>
        {rem && <span className={`${s.meta} ${rem.late ? s.late : ""}`}>{rem.text}</span>}
      </div>
      <div className={s.actions}>
        {manage && <ButtonAnchor size="sm" variant="whatsapp" href={clientWaLink(a, templates, business.name, a.status === "confirmado" ? "reminder" : "confirm")} target="_blank" rel="noopener" aria-label={`WhatsApp a ${a.client.first_name}`}>WA</ButtonAnchor>}
        <ButtonAnchor size="sm" variant="secondary" href={`tel:${a.client.phone}`} aria-label={`Llamar a ${a.client.first_name}`}>Llamar</ButtonAnchor>
        {role !== "specialist" && <ButtonLink size="sm" variant="secondary" href={`/admin/clients/${a.client_id}`}>Cliente</ButtonLink>}
        {manage && next && <Button size="sm" onClick={() => onStep(next.to)}>{next.label}</Button>}
        {!manage && canMove(role, own, a.status, "en_servicio") && <Button size="sm" onClick={() => onStep("en_servicio")}>Comenzar servicio</Button>}
        {manage && !closed && a.status !== "completado" && <Button size="sm" variant="secondary" onClick={onEdit}>Editar</Button>}
        {charge && ["confirmado", "en_espera", "en_servicio"].includes(a.status) && <Button size="sm" variant="soft" onClick={onPay}>Cobrar</Button>}
        {a.status === "en_servicio" && canMove(role, own, a.status, "completado") && <Button size="sm" onClick={() => onStep("completado")}>Completar</Button>}
        {manage && closed && <Button size="sm" variant="secondary" onClick={() => onStep("solicitud")}>Reabrir</Button>}
      </div>
    </article>
  );
}

function Column({ status, items, muted, children }: { status: AppointmentStatus; items: number; muted?: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section ref={setNodeRef} className={`${s.col} ${muted ? s.colMuted : ""} ${isOver ? s.over : ""}`} aria-label={STATUS_META[status].label}>
      <div className={s.colHead}><span>{STATUS_META[status].mark} {STATUS_META[status].label}</span><span className={s.count}>{items}</span></div>
      {children}
      {items === 0 && <p className={s.emptyCol}>{muted ? "Arrastra aquí para cerrar" : "Sin citas"}</p>}
    </section>
  );
}

type Pending = { id: string; to: AppointmentStatus } | null;
const COLS = [...BOARD_COLUMNS, ...BOARD_CLOSED_COLUMNS];

export function KanbanBoard({ initial }: { initial: ApptRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const { role, employeeId } = useAdmin();
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [pay, setPay] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<Pending>(null);
  const [completeDrop, setCompleteDrop] = useState<string | null>(null);

  // Resincroniza con los datos del servidor tras router.refresh() (la página del tablero incluye <LiveRefresh>, que lo dispara con Realtime)
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) { setSeen(initial); setItems(initial); }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );
  const owns = (a: ApptRow) => !!employeeId && (a.employee_id === employeeId || a.services.some((x) => x.employee_id === employeeId));
  const byStatus = useMemo(() => Object.fromEntries(COLS.map((c) => [c, items.filter((i) => i.status === c)])) as Record<AppointmentStatus, ApptRow[]>, [items]);

  async function move(id: string, to: AppointmentStatus) {
    const prev = items;
    setItems((l) => l.map((i) => (i.id === id ? { ...i, status: to } : i)));
    const r = await setAppointmentStatus(id, to);
    if (!r.ok) { setItems(prev); toast(r.error, "err"); return; }
    toast(to === "completado" ? `Completada · venta ${r.saleNumber}` : `Movida a ${STATUS_META[to].label}`);
    router.refresh();
  }

  /** Aplica las reglas de negocio al soltar o pulsar un botón de paso. */
  function request(a: ApptRow, to: AppointmentStatus) {
    if (!canMove(role, owns(a), a.status, to)) { toast("No puedes mover esta cita a ese estado.", "err"); return; }
    if (to === "cancelado" || to === "no_asistio") { setConfirmDrop({ id: a.id, to }); return; }
    if (to === "completado" && allowed(role, "charge") && a.paid < apptTotal(a) - 0.001) { setCompleteDrop(a.id); return; }
    void move(a.id, to);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragId(null);
    const to = e.over?.id as AppointmentStatus | undefined;
    const a = items.find((i) => i.id === e.active.id);
    if (to && a && a.status !== to) request(a, to);
  }

  const openAppt = items.find((i) => i.id === open) ?? null;
  const payAppt = items.find((i) => i.id === pay) ?? null;
  const editAppt = items.find((i) => i.id === edit) ?? null;
  const dropAppt = items.find((i) => i.id === completeDrop) ?? null;
  const dragging = items.find((i) => i.id === dragId);
  const noop = () => {};
  const cardFor = (a: ApptRow) => (
    <Card key={a.id} a={a} own={owns(a)} onOpen={() => setOpen(a.id)} onPay={() => setPay(a.id)} onEdit={() => setEdit(a.id)} onStep={(to) => request(a, to)} />
  );

  return (
    <>
      <DndContext id="kanban" sensors={sensors} onDragStart={(e) => setDragId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
        <div className={s.board}>
          {COLS.map((c) => (
            <Column key={c} status={c} items={byStatus[c].length} muted={BOARD_CLOSED_COLUMNS.includes(c)}>{byStatus[c].map(cardFor)}</Column>
          ))}
        </div>
        <DragOverlay>{dragging && <Card a={dragging} overlay own={owns(dragging)} onOpen={noop} onPay={noop} onEdit={noop} onStep={noop} />}</DragOverlay>
      </DndContext>

      <AppointmentModal appt={openAppt} onClose={() => setOpen(null)} />
      {payAppt && <PaymentModal appt={payAppt} onClose={() => setPay(null)} onDone={() => router.refresh()} completeByDefault={payAppt.status !== "confirmado"} />}
      {editAppt && <EditAppointmentModal appt={editAppt} onClose={() => setEdit(null)} onSaved={() => router.refresh()} />}

      <Modal open={!!confirmDrop} onClose={() => setConfirmDrop(null)} title={confirmDrop?.to === "cancelado" ? "¿Cancelar la cita?" : "¿Marcar como no asistió?"}>
        <p style={{ marginBottom: 20 }}>{confirmDrop?.to === "cancelado" ? "El horario quedará libre. Podrás reabrir la cita después." : "Se registrará que el cliente no llegó y el horario quedará libre."}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={() => setConfirmDrop(null)}>Volver</Button>
          <Button variant="danger" onClick={() => { if (confirmDrop) void move(confirmDrop.id, confirmDrop.to); setConfirmDrop(null); }}>Confirmar</Button>
        </div>
      </Modal>

      <Modal open={!!dropAppt} onClose={() => setCompleteDrop(null)} title="Completar cita">
        <p style={{ marginBottom: 16 }}>Esta cita aún tiene saldo pendiente. ¿Quieres cobrarlo ahora?</p>
        <div style={{ display: "grid", gap: 8 }}>
          <Button onClick={() => { if (dropAppt) setPay(dropAppt.id); setCompleteDrop(null); }}>Cobrar y completar</Button>
          <Button variant="secondary" onClick={() => { if (dropAppt) void move(dropAppt.id, "completado"); setCompleteDrop(null); }}>Completar sin cobrar (queda pendiente)</Button>
          <Button variant="secondary" onClick={() => setCompleteDrop(null)}>Volver</Button>
        </div>
      </Modal>
    </>
  );
}
