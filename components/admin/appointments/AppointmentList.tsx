"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { ApptRow } from "@/lib/data/appointments";
import { apptTotal } from "@/lib/data/appointment-math";
import { SOURCE_LABEL } from "@/lib/domain/status";
import { serviceNames } from "@/lib/domain/serviceLines";
import { fmtDate, fmtTime, money } from "@/lib/format";
import { allowed } from "@/lib/permissions";
import { useAdmin } from "../AdminContext";
import { DeleteDialog } from "../DeleteDialog";
import { EmptyState, StatusBadge } from "../primitives";
import { BulkBar, SelectBox, useSelection } from "../Selection";
import u from "../ui.module.css";
import { AppointmentModal } from "./AppointmentModal";

const REQUEST = ["solicitud", "contactando", "contactado"];

/** «la solicitud de María» / «la cita de María» / «3 citas y solicitudes». */
export function deleteTitle(items: ApptRow[], ids: string[]) {
  if (ids.length !== 1) return `¿Eliminar ${ids.length} citas y solicitudes?`;
  const a = items.find((i) => i.id === ids[0]);
  return REQUEST.includes(a?.status ?? "") ? "¿Eliminar la solicitud?" : "¿Eliminar la cita?";
}

export function AppointmentList({ items }: { items: ApptRow[] }) {
  const { role } = useAdmin();
  const [open, setOpen] = useState<string | null>(null);
  const [del, setDel] = useState<string[] | null>(null);
  const sel = useSelection(items.map((i) => i.id));
  if (items.length === 0) return <EmptyState title="Sin citas" text="No hay citas con estos filtros." />;
  const money$ = allowed(role, "seeMoney");
  const canDelete = allowed(role, "deleteRecords");
  return (
    <>
      {canDelete && sel.ids.length > 0 && (
        <BulkBar text={`${sel.ids.length} ${sel.ids.length === 1 ? "registro seleccionado" : "registros seleccionados"}`} deleteLabel="Eliminar seleccionados" onDelete={() => setDel(sel.ids)} onClear={sel.clear} />
      )}
      <div className={u.tableWrap}>
        <table className={`${u.table} ${u.stack}`}>
          <thead><tr>
            {canDelete && <th><SelectBox checked={sel.all} onChange={sel.toggleAll} label="Seleccionar todas las citas de esta lista" /></th>}
            <th>Fecha</th><th>Cliente</th><th>Servicios</th><th>Especialista</th><th>Origen</th>{money$ && <th className={u.num}>Total</th>}<th>Estado</th><th><span className="sr-only">Acciones</span></th>
          </tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                {canDelete && <td data-label="Seleccionar"><SelectBox checked={sel.has(a.id)} onChange={() => sel.toggle(a.id)} label={`Seleccionar la cita de ${a.client.first_name} ${a.client.last_name}`} /></td>}
                <td data-label="Fecha">{fmtDate(a.start_time, { day: "numeric", month: "short" })} · {fmtTime(a.start_time)}</td>
                <td data-label="Cliente"><strong>{a.client.first_name} {a.client.last_name}</strong><br /><span className={u.sub}>{a.client.phone}</span></td>
                <td data-label="Servicios">{serviceNames(a.services).join(", ")}</td>
                <td data-label="Especialista">{a.employees.length ? a.employees.map((e) => e.name).join(" + ") : "—"}</td>
                <td data-label="Origen">{SOURCE_LABEL[a.source]}</td>
                {money$ && <td data-label="Total" className={u.num}>{money(a.final_total ?? apptTotal(a))}</td>}
                <td data-label="Estado"><StatusBadge status={a.status} /></td>
                <td>
                  <div className={u.rowActions}>
                    <Button size="sm" variant="soft" onClick={() => setOpen(a.id)}>Abrir</Button>
                    {canDelete && <Button size="sm" variant="danger" onClick={() => setDel([a.id])} aria-label={`Eliminar la ${REQUEST.includes(a.status) ? "solicitud" : "cita"} de ${a.client.first_name} ${a.client.last_name}`}>Eliminar</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AppointmentModal appt={items.find((i) => i.id === open) ?? null} onClose={() => setOpen(null)} />
      {del && <DeleteDialog kind="appointments" ids={del} title={deleteTitle(items, del)} onClose={() => setDel(null)} onDone={sel.clear} />}
    </>
  );
}
