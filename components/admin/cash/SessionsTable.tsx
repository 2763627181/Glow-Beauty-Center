import Link from "next/link";
import type { CashSessionRow } from "@/lib/data/cash";
import { fmtDateTime, money } from "@/lib/format";
import { EmptyState } from "../primitives";
import u from "../ui.module.css";
import c from "./cash.module.css";

/** Cierres de caja anteriores, con lo esperado, lo contado y la diferencia. */
export function SessionsTable({ sessions }: { sessions: CashSessionRow[] }) {
  if (!sessions.length) return <EmptyState title="Aún no hay cierres" text="Cuando cierres la caja aparece aquí con su reporte." />;
  return (
    <div className={u.tableWrap} role="region" aria-label="Tabla de cierres de caja anteriores" tabIndex={0}>
      <table className={`${u.table} ${u.stack}`}>
        <thead><tr><th>Caja</th><th>Abierta</th><th>Cerrada</th><th className={u.num}>Debía haber</th><th className={u.num}>Se contó</th><th className={u.num}>Diferencia</th><th><span className="sr-only">Ver</span></th></tr></thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td data-label="Caja"><strong>{s.number}</strong></td>
              <td data-label="Abierta">{fmtDateTime(s.opened_at)}{s.opened_by && <div className={u.hint}>{s.opened_by}</div>}</td>
              <td data-label="Cerrada">{s.closed_at ? fmtDateTime(s.closed_at) : "—"}{s.closed_by && <div className={u.hint}>{s.closed_by}</div>}</td>
              <td data-label="Debía haber" className={u.num}>{s.expected_cash == null ? "—" : money(s.expected_cash)}</td>
              <td data-label="Se contó" className={u.num}>{s.counted_cash == null ? "—" : money(s.counted_cash)}</td>
              <td data-label="Diferencia" className={`${u.num} ${s.difference ? (s.difference < 0 ? c.neg : c.pos) : ""}`}>
                {s.difference == null ? "—" : s.difference === 0 ? "Cuadra" : `${s.difference < 0 ? "Faltó" : "Sobró"} ${money(Math.abs(s.difference))}`}
              </td>
              <td><Link className={u.link} href={`/admin/cash/${s.id}`} aria-label={`Ver cierre ${s.number}`}>Ver</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
