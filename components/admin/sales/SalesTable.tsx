"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { fmtDate, money } from "@/lib/format";
import { DeleteDialog } from "../DeleteDialog";
import { PayBadge } from "../primitives";
import { BulkBar, SelectBox, useSelection } from "../Selection";
import u from "../ui.module.css";

export type SaleRow = {
  id: string; sale_number: string; completed_at: string; client: string; services: string; employee: string;
  subtotal: number; discount: number; total: number; methods: string; payment_status: string; voided: boolean;
};

/** Listado de ventas. Gerencia puede marcar varias y eliminarlas (con sus pagos), o una por una con «Eliminar». */
export function SalesTable({ rows, canDelete }: { rows: SaleRow[]; canDelete: boolean }) {
  const sel = useSelection(rows.map((r) => r.id));
  const [del, setDel] = useState<string[] | null>(null);
  const titleFor = (ids: string[]) => (ids.length === 1 ? `¿Eliminar la venta ${rows.find((r) => r.id === ids[0])?.sale_number}?` : `¿Eliminar ${ids.length} ventas?`);
  return (
    <>
      {canDelete && sel.ids.length > 0 && (
        <BulkBar text={`${sel.ids.length} ${sel.ids.length === 1 ? "venta seleccionada" : "ventas seleccionadas"}`} deleteLabel="Eliminar seleccionadas" onDelete={() => setDel(sel.ids)} onClear={sel.clear} />
      )}
      <div className={u.tableWrap}>
        <table className={`${u.table} ${u.stack}`}>
          <thead><tr>
            {canDelete && <th><SelectBox checked={sel.all} onChange={sel.toggleAll} label="Seleccionar todas las ventas de esta página" /></th>}
            <th>Número</th><th>Fecha</th><th>Cliente</th><th>Servicios</th><th>Especialista</th><th className={u.num}>Subtotal</th><th className={u.num}>Desc.</th><th className={u.num}>Total</th><th>Método</th><th>Estado</th>
            {canDelete && <th><span className="sr-only">Acciones</span></th>}
          </tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                {canDelete && <td data-label="Seleccionar"><SelectBox checked={sel.has(s.id)} onChange={() => sel.toggle(s.id)} label={`Seleccionar la venta ${s.sale_number}`} /></td>}
                <td data-label="Número"><Link className={u.link} href={`/admin/sales/${s.id}`}>{s.sale_number}</Link></td>
                <td data-label="Fecha">{fmtDate(s.completed_at, { day: "numeric", month: "short" })}</td>
                <td data-label="Cliente">{s.client}</td>
                <td data-label="Servicios">{s.services}</td>
                <td data-label="Especialista">{s.employee}</td>
                <td data-label="Subtotal" className={u.num}>{money(s.subtotal)}</td>
                <td data-label="Desc." className={u.num}>{s.discount ? `−${money(s.discount)}` : "—"}</td>
                <td data-label="Total" className={u.num}><strong>{money(s.total)}</strong></td>
                <td data-label="Método">{s.methods || "—"}</td>
                <td data-label="Estado"><PayBadge status={s.payment_status} />{s.voided && <span className={`${u.badge} ${u.red}`} style={{ marginLeft: 6 }}>Anulada</span>}</td>
                {canDelete && <td><Button size="sm" variant="danger" onClick={() => setDel([s.id])} aria-label={`Eliminar la venta ${s.sale_number}`}>Eliminar</Button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {del && <DeleteDialog kind="sales" ids={del} title={titleFor(del)} onClose={() => setDel(null)} onDone={sel.clear} />}
    </>
  );
}
