"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import {
  buildTimeline, cashEffect, changeOf, MOVE_LABEL, splitProduction, type CashMethodRow, type CashMovement, type ProductionRow, type TimelineRow, type CashReport,
} from "@/lib/domain/cash";
import { fmtTime, fmtDate, money } from "@/lib/format";
import { EmptyState } from "../primitives";
import u from "../ui.module.css";
import c from "./cash.module.css";

const signed = (n: number) => (n > 0 ? `+ ${money(n)}` : n < 0 ? `− ${money(Math.abs(n))}` : "—");
const stamp = (iso: string) => `${fmtDate(iso, { day: "numeric", month: "short" })} ${fmtTime(iso)}`;

/** Cobros, reembolsos y movimientos de efectivo del turno, en orden. */
export function Timeline({ report, onVoid }: { report: Pick<CashReport, "payments" | "movements">; onVoid?: (m: CashMovement) => void }) {
  const rows = buildTimeline(report);
  if (!rows.length) return <EmptyState title="Sin movimientos todavía" text="Aquí aparecen los cobros, reembolsos y las entradas y salidas de efectivo." />;
  return (
    <div className={u.tableWrap} role="region" aria-label="Tabla de movimientos del turno" tabIndex={0}>
      <table className={`${u.table} ${u.stack}`}>
        <thead><tr><th>Hora</th><th>Concepto</th><th>Detalle</th><th className={u.num}>Monto</th><th className={u.num}>En la caja</th><th><span className="sr-only">Acciones</span></th></tr></thead>
        <tbody>
          {rows.map((r) => <TimelineLine key={r.key} row={r} onVoid={onVoid} />)}
        </tbody>
      </table>
    </div>
  );
}

function TimelineLine({ row, onVoid }: { row: TimelineRow; onVoid?: (m: CashMovement) => void }) {
  const effect = cashEffect(row);
  if (row.type === "movimiento") {
    const m = row.movement;
    return (
      <tr>
        <td data-label="Hora">{stamp(row.at)}</td>
        <td data-label="Concepto"><span className={`${c.tag} ${m.kind === "entrada" ? c.tagIn : c.tagOut}`}>{m.kind === "entrada" ? "Entrada" : "Salida"}</span> <span className={m.voided_at ? c.struck : undefined}>{MOVE_LABEL[m.category]}</span></td>
        <td data-label="Detalle">
          <span className={m.voided_at ? c.struck : undefined}>{[m.employee_name, m.description].filter(Boolean).join(" · ") || "—"}</span>
          {m.by && <small className={`${c.muted} ${u.hint}`}> · {m.by}</small>}
          {m.voided_at && <div className={u.hint}>Anulado: {m.void_reason}</div>}
        </td>
        <td data-label="Monto" className={`${u.num} ${m.voided_at ? c.struck : ""}`}>{money(m.amount)}</td>
        <td data-label="En la caja" className={`${u.num} ${effect > 0 ? c.pos : effect < 0 ? c.neg : c.muted}`}>{signed(effect)}</td>
        <td>{onVoid && !m.voided_at && <Button size="sm" variant="secondary" onClick={() => onVoid(m)} aria-label={`Anular ${MOVE_LABEL[m.category]} de ${money(m.amount)}`}>Anular</Button>}</td>
      </tr>
    );
  }
  const p = row.payment;
  const change = changeOf(p);
  const what = p.sale_id ? <Link className={u.link} href={`/admin/sales/${p.sale_id}`}>{p.sale_number}</Link> : p.appointment_id ? <Link className={u.link} href={`/admin/appointments/${p.appointment_id}`}>Cita</Link> : "—";
  const refund = row.type === "reembolso";
  return (
    <tr>
      <td data-label="Hora">{stamp(row.at)}</td>
      <td data-label="Concepto">
        <span className={`${c.tag} ${p.is_cash ? c.tagCash : ""}`}>{p.is_cash ? "Efectivo" : "Cobrado aparte"}</span> {refund ? "Reembolso" : "Cobro"} · {p.label}
      </td>
      <td data-label="Detalle">
        {what}{p.client ? ` · ${p.client}` : ""}
        {!refund && p.is_cash && p.tendered != null && p.tendered > p.amount && <div className={u.hint}>Recibido {money(p.tendered)} · vuelto {money(change)}</div>}
        {p.reference && <div className={u.hint}>Ref. {p.reference}</div>}
        {refund && !p.is_cash && <div className={u.hint}>Se devuelve aparte (no sale de la caja)</div>}
        {!refund && !p.is_cash && <div className={u.hint}>Se cobró aparte; aquí solo se registra</div>}
      </td>
      <td data-label="Monto" className={u.num}>{money(p.amount)}</td>
      <td data-label="En la caja" className={`${u.num} ${effect > 0 ? c.pos : effect < 0 ? c.neg : c.muted}`}>{signed(effect)}</td>
      <td />
    </tr>
  );
}

export function MethodsTable({ methods }: { methods: CashMethodRow[] }) {
  if (!methods.length) return <EmptyState title="Sin cobros en este turno" />;
  return (
    <div className={u.tableWrap} role="region" aria-label="Tabla de cobrado por método" tabIndex={0}>
      <table className={`${u.table} ${u.stack}`}>
        <thead><tr><th>Método</th><th className={u.num}>Cobros</th><th className={u.num}>Cobrado</th><th className={u.num}>Reembolsado</th></tr></thead>
        <tbody>
          {methods.map((m) => (
            <tr key={m.method}>
              <td data-label="Método">{m.label} <span className={`${c.tag} ${m.is_cash ? c.tagCash : ""}`}>{m.is_cash ? "Entra a la caja" : "Cobrado aparte"}</span></td>
              <td data-label="Cobros" className={u.num}>{m.count}</td>
              <td data-label="Cobrado" className={u.num}>{money(m.total)}</td>
              <td data-label="Reembolsado" className={u.num}>{m.refunded > 0 ? money(m.refunded) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Producción de cada especialista en el turno: lo que se queda ella, lo que paga al salón y lo que ya se le entregó desde la caja. */
export function ProductionTable({ rows, onPay }: { rows: ProductionRow[]; onPay?: (r: ProductionRow, toPay: number) => void }) {
  if (!rows.length) return <EmptyState title="Sin ventas en este turno" text="Cuando se completen servicios aparece aquí lo que produjo cada especialista." />;
  return (
    <div className={u.tableWrap} role="region" aria-label="Tabla de producción por especialista" tabIndex={0}>
      <table className={`${u.table} ${u.stack}`}>
        <thead><tr><th>Especialista</th><th className={u.num}>Servicios</th><th className={u.num}>Producción</th><th className={u.num}>Paga al salón</th><th className={u.num}>Se queda ella</th><th className={u.num}>Entregado de caja</th><th className={u.num}>Por entregar</th><th><span className="sr-only">Acciones</span></th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const s = splitProduction(r);
            const base = r.production - s.noPct;
            const pct = base > 0 ? Math.round((s.salon / base) * 1000) / 10 : null;
            const noPct = s.noPct > 0;
            return (
              <tr key={r.employee_id ?? "none"}>
                <td data-label="Especialista">
                  {r.name}
                  {noPct && <div className={u.hint}>{r.employee_id ? "Falta su porcentaje en su ficha" : "Sin especialista: no se reparte"}</div>}
                </td>
                <td data-label="Servicios" className={u.num}>{r.services}</td>
                <td data-label="Producción" className={u.num}>{money(r.production)}</td>
                <td data-label="Paga al salón" className={u.num}>{noPct && s.hers === 0 ? "—" : <>{money(s.salon)}{pct != null && <div className={u.hint}>{pct}%</div>}</>}</td>
                <td data-label="Se queda ella" className={u.num}>{noPct && s.hers === 0 ? "—" : money(s.hers)}</td>
                <td data-label="Entregado de caja" className={u.num}>{s.paidOut > 0 ? money(s.paidOut) : "—"}{r.tips_out > 0 && <div className={u.hint}>+ propinas {money(r.tips_out)}</div>}</td>
                <td data-label="Por entregar" className={u.num}>{r.employee_id && s.hers > 0 ? (s.overPaid > 0 ? <span className={c.neg}>Se pasó {money(s.overPaid)}</span> : money(s.toPay)) : "—"}</td>
                <td>{onPay && r.employee_id && s.toPay > 0 && <Button size="sm" variant="secondary" onClick={() => onPay(r, s.toPay)} aria-label={`Pagar a ${r.name} desde la caja`}>Pagar</Button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
