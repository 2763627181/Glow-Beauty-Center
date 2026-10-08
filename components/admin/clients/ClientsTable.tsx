"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { fmtDate, money } from "@/lib/format";
import { DeleteDialog } from "../DeleteDialog";
import { BulkBar, SelectBox, useSelection } from "../Selection";
import u from "../ui.module.css";

export type ClientRow = {
  id: string; first_name: string; last_name: string; phone: string; email: string | null;
  last_visit: string | null; next_appointment: string | null; visits: number; total_spent: number; active: boolean;
};

/** Listado de clientes. Quien puede eliminar (gerencia) ve casillas para marcar varios y un botón «Eliminar» en cada fila. */
export function ClientsTable({ rows, showMoney, canDelete }: { rows: ClientRow[]; showMoney: boolean; canDelete: boolean }) {
  const sel = useSelection(rows.map((r) => r.id));
  const [del, setDel] = useState<string[] | null>(null);
  const name = (c: ClientRow) => `${c.first_name} ${c.last_name}`.trim();
  const titleFor = (ids: string[]) => (ids.length === 1 ? `¿Eliminar a ${name(rows.find((r) => r.id === ids[0])!)}?` : `¿Eliminar ${ids.length} clientes?`);
  return (
    <>
      {canDelete && sel.ids.length > 0 && (
        <BulkBar text={`${sel.ids.length} ${sel.ids.length === 1 ? "cliente seleccionado" : "clientes seleccionados"}`} deleteLabel="Eliminar seleccionados" onDelete={() => setDel(sel.ids)} onClear={sel.clear} />
      )}
      <div className={u.tableWrap}>
        <table className={`${u.table} ${u.stack}`}>
          <thead><tr>
            {canDelete && <th><SelectBox checked={sel.all} onChange={sel.toggleAll} label="Seleccionar todos los clientes de esta página" /></th>}
            <th>Cliente</th><th>WhatsApp</th><th>Correo</th><th>Última visita</th><th>Próxima cita</th><th className={u.num}>Visitas</th>{showMoney && <th className={u.num}>Total gastado</th>}<th>Estado</th>
            {canDelete && <th><span className="sr-only">Acciones</span></th>}
          </tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                {canDelete && <td data-label="Seleccionar"><SelectBox checked={sel.has(c.id)} onChange={() => sel.toggle(c.id)} label={`Seleccionar a ${name(c)}`} /></td>}
                <td data-label="Cliente"><Link className={u.link} href={`/admin/clients/${c.id}`}><strong>{name(c)}</strong></Link></td>
                <td data-label="WhatsApp">{c.phone}</td>
                <td data-label="Correo">{c.email ?? "—"}</td>
                <td data-label="Última visita">{c.last_visit ? fmtDate(c.last_visit, { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                <td data-label="Próxima cita">{c.next_appointment ? fmtDate(c.next_appointment, { day: "numeric", month: "short" }) : "—"}</td>
                <td data-label="Visitas" className={u.num}>{c.visits}</td>
                {showMoney && <td data-label="Total gastado" className={u.num}>{money(c.total_spent)}</td>}
                <td data-label="Estado"><span className={`${u.badge} ${c.active ? u.green : u.gray}`}>{c.active ? "Activo" : "Inactivo"}</span></td>
                {canDelete && <td><Button size="sm" variant="danger" onClick={() => setDel([c.id])} aria-label={`Eliminar a ${name(c)}`}>Eliminar</Button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {del && <DeleteDialog kind="clients" ids={del} title={titleFor(del)} onClose={() => setDel(null)} onDone={sel.clear} />}
    </>
  );
}
