"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { ApptRow } from "@/lib/data/appointments";
import { apptTotal } from "@/lib/data/appointment-math";
import { SOURCE_LABEL } from "@/lib/domain/status";
import { fmtDate, fmtTime, money } from "@/lib/format";
import { allowed } from "@/lib/permissions";
import { useAdmin } from "../AdminContext";
import { EmptyState, StatusBadge } from "../primitives";
import u from "../ui.module.css";
import { AppointmentModal } from "./AppointmentModal";

export function AppointmentList({ items }: { items: ApptRow[] }) {
  const { role } = useAdmin();
  const [open, setOpen] = useState<string | null>(null);
  if (items.length === 0) return <EmptyState title="Sin citas" text="No hay citas con estos filtros." />;
  const money$ = allowed(role, "seeMoney");
  return (
    <>
      <div className={u.tableWrap}>
        <table className={`${u.table} ${u.stack}`}>
          <thead><tr><th>Fecha</th><th>Cliente</th><th>Servicios</th><th>Especialista</th><th>Origen</th>{money$ && <th className={u.num}>Total</th>}<th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td data-label="Fecha">{fmtDate(a.start_time, { day: "numeric", month: "short" })} · {fmtTime(a.start_time)}</td>
                <td data-label="Cliente"><strong>{a.client.first_name} {a.client.last_name}</strong><br /><span className={u.sub}>{a.client.phone}</span></td>
                <td data-label="Servicios">{a.services.map((s) => s.name).join(", ")}</td>
                <td data-label="Especialista">{a.employees.length ? a.employees.map((e) => e.name).join(" + ") : "—"}</td>
                <td data-label="Origen">{SOURCE_LABEL[a.source]}</td>
                {money$ && <td data-label="Total" className={u.num}>{money(a.final_total ?? apptTotal(a))}</td>}
                <td data-label="Estado"><StatusBadge status={a.status} /></td>
                <td><Button size="sm" variant="soft" onClick={() => setOpen(a.id)}>Abrir</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AppointmentModal appt={items.find((i) => i.id === open) ?? null} onClose={() => setOpen(null)} />
    </>
  );
}
