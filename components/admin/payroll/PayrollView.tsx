"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { addPayrollLine, deletePayroll, markPayrollPaid, recalculatePayroll, removePayrollLine, reopenPayroll, updatePayrollLine } from "@/lib/actions/admin/payroll";
import type { PayrollLine, PayrollRun } from "@/lib/data/payroll";
import { netOf, round2 } from "@/lib/domain/payroll";
import { fmtDate, money } from "@/lib/format";
import { ExportMenu } from "../ExportMenu";
import { Kpi } from "../KpiCard";
import { NumInput } from "../NumInput";
import { Alert } from "../primitives";
import { ConfirmDialog, Modal, useToast } from "../overlay";
import u from "../ui.module.css";

const METHODS = ["Efectivo", "Transferencia", "Cheque", "Otro"];
const day = (d: string) => fmtDate(`${d}T12:00:00-04:00`, { day: "numeric", month: "long", year: "numeric" });

type Props = { run: PayrollRun; lines: PayrollLine[]; candidates: { id: string; name: string }[]; today: string };

export function PayrollView({ run, lines, candidates, today }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const draft = run.status === "borrador";
  const [edit, setEdit] = useState<PayrollLine | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "reopen" | "recalc">(null);
  const [removing, setRemoving] = useState<PayrollLine | null>(null);
  const [adding, setAdding] = useState("");

  const sum = (pick: (l: PayrollLine) => number) => round2(lines.reduce((t, l) => t + pick(l), 0));
  const total = useMemo(() => sum((l) => l.net), [lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const negative = lines.filter((l) => l.net < 0);

  const act = (fn: () => Promise<{ ok: boolean } & { error?: string }>, okMsg: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return toast(r.error ?? "No se pudo completar la acción.", "err");
      toast(okMsg); after?.(); router.refresh();
    });

  return (
    <div className={u.grid}>
      {draft ? (
        <Alert kind="warn"><strong>Borrador.</strong> Revisa los montos, ajusta sueldo base, bonos o descuentos de cada especialista y, cuando pagues, márcala como pagada. Las ventas se calcularon al crear la nómina; si se registró algo después, usa «Recalcular».</Alert>
      ) : (
        <Alert kind="ok"><strong>Pagada el {day(run.paid_on!)}</strong>{run.paid_method ? ` · ${run.paid_method}` : ""}{run.paid_reference ? ` · Ref. ${run.paid_reference}` : ""}. Está congelada: no cambia aunque después se anule o cambie alguna venta.</Alert>
      )}
      {negative.length > 0 && draft && <Alert>Los descuentos de {negative.map((l) => l.employee_name).join(", ")} superan lo que le corresponde. Corrígelo para poder pagar.</Alert>}

      <div className={u.kpis}>
        <Kpi label="Total a pagar" value={total} hint={`${lines.length} ${lines.length === 1 ? "especialista" : "especialistas"}`} />
        <Kpi label="Ventas del período" value={sum((l) => l.sales_total)} />
        <Kpi label="Comisiones" value={sum((l) => l.commission)} />
        <Kpi label="Propinas" value={sum((l) => l.tips)} />
        <Kpi label="Sueldos base" value={sum((l) => l.base_salary)} />
        <Kpi label="Bonos − descuentos" value={sum((l) => l.bonus - l.deductions)} />
      </div>

      <section className={u.card}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Pago por especialista</h2>
          <div className={u.rowActions}>
            <ExportMenu groups={[{ label: "Nómina completa", href: `/admin/payroll/${run.id}/export` }]} />
            {draft && <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm("recalc")}>Recalcular desde ventas</Button>}
          </div>
        </div>
        {lines.length === 0 ? <p className={u.sub}>Esta nómina no tiene especialistas. Agrega una abajo.</p> : (
          <div className={u.tableWrap}>
            <table className={`${u.table} ${u.stack}`}>
              <thead><tr><th>Especialista</th><th className={u.num}>Servicios</th><th className={u.num}>Ventas</th><th className={u.num}>Comisión</th><th className={u.num}>Propinas</th><th className={u.num}>Sueldo base</th><th className={u.num}>Bonos</th><th className={u.num}>Descuentos</th><th className={u.num}>Neto a pagar</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td data-label="Especialista"><strong>{l.employee_name}</strong>{l.notes && <><br /><span className={u.hint}>{l.notes}</span></>}</td>
                    <td data-label="Servicios" className={u.num}>{l.services_count}</td>
                    <td data-label="Ventas" className={u.num}>{money(l.sales_total)}</td>
                    <td data-label="Comisión" className={u.num}>{money(l.commission)}</td>
                    <td data-label="Propinas" className={u.num}>{money(l.tips)}</td>
                    <td data-label="Sueldo base" className={u.num}>{money(l.base_salary)}</td>
                    <td data-label="Bonos" className={u.num}>{l.bonus ? money(l.bonus) : "—"}</td>
                    <td data-label="Descuentos" className={u.num}>{l.deductions ? `−${money(l.deductions)}` : "—"}</td>
                    <td data-label="Neto a pagar" className={u.num}><strong style={l.net < 0 ? { color: "var(--color-danger)" } : undefined}>{money(l.net)}</strong></td>
                    <td data-label="Acciones">
                      <div className={u.rowActions} style={{ justifyContent: "flex-end" }}>
                        <Button size="sm" variant="secondary" onClick={() => setEdit(l)} aria-label={`${draft ? "Editar" : "Ver detalle de"} ${l.employee_name}`}>{draft ? "Editar" : "Detalle"}</Button>
                        <a className={u.link} style={{ alignSelf: "center" }} href={`/admin/payroll/${run.id}/export?employee=${l.employee_id}&format=pdf`} aria-label={`Descargar volante de ${l.employee_name}`}>Volante</a>
                        {draft && <Button size="sm" variant="danger" onClick={() => setRemoving(l)} aria-label={`Quitar a ${l.employee_name}`}>Quitar</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td data-label="Total"><strong>Total</strong></td>
                  <td className={u.num} data-label="Servicios">{sum((l) => l.services_count)}</td>
                  <td className={u.num} data-label="Ventas">{money(sum((l) => l.sales_total))}</td>
                  <td className={u.num} data-label="Comisión">{money(sum((l) => l.commission))}</td>
                  <td className={u.num} data-label="Propinas">{money(sum((l) => l.tips))}</td>
                  <td className={u.num} data-label="Sueldo base">{money(sum((l) => l.base_salary))}</td>
                  <td className={u.num} data-label="Bonos">{money(sum((l) => l.bonus))}</td>
                  <td className={u.num} data-label="Descuentos">{sum((l) => l.deductions) ? `−${money(sum((l) => l.deductions))}` : "—"}</td>
                  <td className={u.num} data-label="Neto a pagar"><strong>{money(total)}</strong></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {draft && candidates.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 14 }}>
            <label htmlFor="pr-add" className="sr-only">Agregar especialista</label>
            <select id="pr-add" value={adding} onChange={(e) => setAdding(e.target.value)} style={{ minHeight: 42, borderRadius: 12, padding: "0 12px", border: "1px solid rgb(41 37 36 / 0.2)", maxWidth: "100%" }}>
              <option value="">Agregar especialista…</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button size="sm" variant="secondary" disabled={pending || !adding} onClick={() => act(() => addPayrollLine(run.id, adding), "Especialista agregada", () => setAdding(""))}>Agregar</Button>
          </div>
        )}
      </section>

      <section className={u.card}>
        <div className={u.rowActions}>
          {draft ? (
            <>
              <Button disabled={pending || lines.length === 0 || negative.length > 0} onClick={() => setPayOpen(true)}>Marcar como pagada</Button>
              <Button variant="danger" disabled={pending} onClick={() => setConfirm("delete")}>Eliminar nómina</Button>
            </>
          ) : (
            <Button variant="secondary" disabled={pending} onClick={() => setConfirm("reopen")}>Reabrir para corregir</Button>
          )}
        </div>
        {run.notes && <p className={u.sub} style={{ marginTop: 12 }}>Notas: {run.notes}</p>}
        <p className={u.hint} style={{ marginTop: 12 }}>
          {run.only_paid ? "Cuentan solo las ventas cobradas por completo" : "Cuentan las ventas cobradas y las pendientes"} (nunca las reembolsadas). {run.include_tips ? "Las propinas se reparten entre quienes atendieron cada venta." : "No se incluyen propinas."}
        </p>
      </section>

      {edit && <LineModal key={edit.id} run={run} line={lines.find((l) => l.id === edit.id) ?? edit} draft={draft} onClose={() => setEdit(null)} />}
      {payOpen && <PayModal run={run} total={total} count={lines.length} today={today} onClose={() => setPayOpen(false)} />}

      <ConfirmDialog open={confirm === "recalc"} title="¿Recalcular desde las ventas?" confirmLabel="Recalcular" onClose={() => setConfirm(null)}
        text="Se vuelven a leer las ventas del período y se actualizan ventas, comisión y propinas de cada especialista. El sueldo base, los bonos y los descuentos que escribiste se conservan."
        onConfirm={() => act(() => recalculatePayroll(run.id), "Nómina recalculada")} />
      <ConfirmDialog open={confirm === "reopen"} title="¿Reabrir esta nómina?" confirmLabel="Reabrir" onClose={() => setConfirm(null)}
        text="Volverá a ser un borrador: podrás editar montos y recalcular, y después marcarla como pagada otra vez. Queda registrado en Auditoría."
        onConfirm={() => act(() => reopenPayroll(run.id), "Nómina reabierta")} />
      <ConfirmDialog open={confirm === "delete"} danger title="¿Eliminar esta nómina?" confirmLabel="Eliminar" onClose={() => setConfirm(null)}
        text="Se borra el borrador con todos sus volantes. Las ventas no se tocan y podrás crear otra para el mismo período."
        onConfirm={() => act(() => deletePayroll(run.id), "Nómina eliminada", () => router.push("/admin/payroll"))} />
      <ConfirmDialog open={!!removing} danger title={`¿Quitar a ${removing?.employee_name ?? ""}?`} confirmLabel="Quitar" onClose={() => setRemoving(null)}
        text="Se quita su volante de esta nómina (por ejemplo, si no trabajó ese período). Podrás volver a agregarla."
        onConfirm={() => removing && act(() => removePayrollLine(removing.id, run.id), "Volante quitado")} />
    </div>
  );
}

/* ───────── Editar un volante (o ver su detalle si la nómina ya está pagada) ───────── */
function LineModal({ run, line, draft, onClose }: { run: PayrollRun; line: PayrollLine; draft: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [base, setBase] = useState(line.base_salary);
  const [bonus, setBonus] = useState(line.bonus);
  const [ded, setDed] = useState(line.deductions);
  const [notes, setNotes] = useState(line.notes ?? "");
  const [err, setErr] = useState<string | null>(null);
  const net = netOf({ base_salary: base, commission: line.commission, tips: line.tips, bonus, deductions: ded });

  function save() {
    setErr(null);
    start(async () => {
      const r = await updatePayrollLine(line.id, run.id, { base_salary: base, bonus, deductions: ded, notes });
      if (!r.ok) return setErr(r.error);
      toast("Volante guardado"); onClose(); router.refresh();
    });
  }

  return (
    <Modal open onClose={onClose} title={line.employee_name} wide>
      <div className={u.form2}>
        <div className={u.span2} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <div className={`${u.card} ${u.stat}`}><span>Ventas ({line.services_count} servicios)</span><strong style={{ fontSize: "1.4rem" }}>{money(line.sales_total)}</strong></div>
          <div className={`${u.card} ${u.stat}`}><span>Comisión</span><strong style={{ fontSize: "1.4rem" }}>{money(line.commission)}</strong></div>
          <div className={`${u.card} ${u.stat}`}><span>Propinas</span><strong style={{ fontSize: "1.4rem" }}>{money(line.tips)}</strong></div>
        </div>
        <div className={u.field}><label htmlFor="pl-base">Sueldo base (RD$)</label><NumInput id="pl-base" min={0} value={base} emptyValue={0} disabled={!draft} onValue={(v) => setBase(v ?? 0)} /></div>
        <div className={u.field}><label htmlFor="pl-bonus">Bonos (RD$)</label><NumInput id="pl-bonus" min={0} value={bonus} emptyValue={0} disabled={!draft} onValue={(v) => setBonus(v ?? 0)} /></div>
        <div className={u.field}><label htmlFor="pl-ded">Descuentos (RD$)</label><NumInput id="pl-ded" min={0} value={ded} emptyValue={0} disabled={!draft} onValue={(v) => setDed(v ?? 0)} />
          <span className={u.hint}>Adelantos, faltas, tardanzas, préstamos…</span></div>
        <div className={u.field}><label htmlFor="pl-notes">Nota (sale en el volante)</label><input id="pl-notes" value={notes} maxLength={300} disabled={!draft} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className={u.span2}><p style={{ fontSize: "1.1rem" }}>Neto a pagar: <strong>{money(net)}</strong></p>
          {net < 0 && <Alert>Los descuentos superan lo que le corresponde.</Alert>}</div>

        <div className={u.span2}>
          <strong style={{ fontSize: "0.9rem" }}>Ventas que originan la comisión ({line.detail.length})</strong>
          {line.detail.length === 0 ? <p className={u.sub}>No hay ventas de esta especialista en el período.</p> : (
            <div className={u.tableWrap} style={{ maxHeight: 240, overflowY: "auto", marginTop: 6 }}>
              <table className={u.table}>
                <thead><tr><th>Fecha</th><th>Venta</th><th>Servicio</th><th className={u.num}>Importe</th><th className={u.num}>%</th><th className={u.num}>Comisión</th></tr></thead>
                <tbody>
                  {line.detail.map((d, i) => (
                    <tr key={i}><td>{fmtDate(d.date, { day: "numeric", month: "short" })}</td><td>{d.sale}</td><td>{d.description}</td><td className={u.num}>{money(d.total)}</td><td className={u.num}>{d.pct}%</td><td className={u.num}>{money(d.commission)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {err && <div className={u.span2}><Alert>{err}</Alert></div>}
        <div className={u.span2} style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose}>{draft ? "Cancelar" : "Cerrar"}</Button>
          {draft && <Button onClick={save} disabled={pending || net < 0}>{pending ? "Guardando…" : "Guardar"}</Button>}
        </div>
      </div>
    </Modal>
  );
}

/* ───────── Marcar como pagada ───────── */
function PayModal({ run, total, count, today, onClose }: { run: PayrollRun; total: number; count: number; today: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState(METHODS[0]);
  const [reference, setReference] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    start(async () => {
      const r = await markPayrollPaid(run.id, { paidOn, method, reference: reference || undefined });
      if (!r.ok) return setErr(r.error);
      toast("Nómina marcada como pagada"); onClose(); router.refresh();
    });
  }

  return (
    <Modal open onClose={onClose} title="Marcar como pagada">
      <div className={u.form2}>
        <p className={u.span2}>Vas a registrar el pago de <strong>{money(total)}</strong> a {count} {count === 1 ? "especialista" : "especialistas"}. Después no se podrá editar (solo reabrir a propósito).</p>
        <div className={u.field}><label htmlFor="pp-date">Fecha de pago</label><input id="pp-date" type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></div>
        <div className={u.field}><label htmlFor="pp-method">Cómo se pagó</label>
          <select id="pp-method" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
        <div className={`${u.field} ${u.span2}`}><label htmlFor="pp-ref">Referencia (opcional)</label><input id="pp-ref" value={reference} maxLength={80} placeholder="N.º de transferencia, cheque…" onChange={(e) => setReference(e.target.value)} /></div>
        {err && <div className={u.span2}><Alert>{err}</Alert></div>}
        <div className={u.span2} style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={pending || !paidOn}>{pending ? "Guardando…" : "Confirmar pago"}</Button>
        </div>
      </div>
    </Modal>
  );
}
