"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/auth";
import { loadSales } from "@/lib/data/reports";
import { friendlyError } from "@/lib/domain/errors";
import { computePayroll, netOf, round2, type PayrollCalc } from "@/lib/domain/payroll";
import { drToISO, todayISO } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./appointments";

type Sb = Awaited<ReturnType<typeof createClient>>;
const fail = (m?: string | null): { ok: false; error: string } => ({ ok: false, error: friendlyError(m) });
const refresh = (id?: string) => { revalidatePath("/admin/payroll"); if (id) revalidatePath(`/admin/payroll/${id}`); };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida");
const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const money = z.number("Escribe un monto").min(0, "No puede ser negativo").max(10_000_000, "Monto demasiado grande");

/** Ventas del período → lo que generó cada especialista (misma regla que el reporte de comisiones). */
async function calculate(sb: Sb, start: string, end: string, o: { onlyPaid: boolean; includeTips: boolean }) {
  const [sales, { data: emps }] = await Promise.all([
    loadSales(drToISO(start, "00:00"), drToISO(nextDay(end), "00:00")),
    sb.from("employees").select("id,full_name,active,commission_pct,base_salary"),
  ]);
  const employees = emps ?? [];
  const calc = computePayroll(sales, {
    employeeCommission: Object.fromEntries(employees.filter((e) => e.commission_pct != null).map((e) => [e.id, Number(e.commission_pct)])),
    ...o,
  });
  return { calc, employees };
}

const amounts = (c: PayrollCalc | undefined) => ({
  services_count: c?.servicesCount ?? 0, sales_total: c?.salesTotal ?? 0, commission: c?.commission ?? 0, tips: c?.tips ?? 0, detail: c?.detail ?? [],
});

/** Mensaje claro cuando la base de datos impide pagar dos veces el mismo día a la misma especialista. */
async function overlapError(sb: Sb, start: string, end: string, who?: string): Promise<string> {
  const { data } = await sb.from("payroll_lines").select("employee_name,run:payroll_runs(run_number,title)").lte("period_start", end).gte("period_end", start).limit(20);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runs = [...new Set((data ?? []).map((l: any) => l.run?.title ? `${l.run.run_number} «${l.run.title}»` : null).filter(Boolean))];
  return `${who ?? "Una especialista"} ya está en otra nómina que cubre esas fechas${runs.length ? ` (${runs.join(", ")})` : ""}. Elimina esa nómina, quítala de ella o elige otro período.`;
}

const createSchema = z.object({
  title: z.string().trim().min(2, "Escribe un nombre para la nómina").max(120, "El nombre es muy largo"),
  start: day, end: day, onlyPaid: z.boolean(), includeTips: z.boolean(), notes: z.string().trim().max(300).optional(),
}).refine((v) => v.end >= v.start, { message: "La fecha final debe ser igual o posterior a la inicial.", path: ["end"] })
  .refine((v) => daysBetween(v.start, v.end) <= 92, { message: "Una nómina puede cubrir hasta 3 meses.", path: ["end"] })
  .refine((v) => v.start <= todayISO(), { message: "El período no puede empezar en el futuro.", path: ["start"] });
export type CreatePayrollInput = z.input<typeof createSchema>;

/** Crea la nómina en borrador con un volante por especialista activa (y por cualquiera que haya vendido en el período). */
export async function createPayroll(input: CreatePayrollInput): Promise<ActionResult<{ id: string }>> {
  const s = await requireAction("managePayroll");
  const p = createSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  const sb = await createClient();
  const { calc, employees } = await calculate(sb, d.start, d.end, { onlyPaid: d.onlyPaid, includeTips: d.includeTips });
  const people = employees.filter((e) => e.active || calc.has(e.id));
  if (!people.length) return { ok: false, error: "No hay especialistas activas para incluir en la nómina." };

  const { data: run, error } = await sb.from("payroll_runs").insert({
    title: d.title, period_start: d.start, period_end: d.end, only_paid: d.onlyPaid, include_tips: d.includeTips, notes: d.notes || null, created_by: s.userId,
  }).select("id").single();
  if (error || !run) return fail(error?.message);

  const { error: lerr } = await sb.from("payroll_lines").insert(people.map((e) => ({
    run_id: run.id, employee_id: e.id, employee_name: e.full_name, period_start: d.start, period_end: d.end,
    ...amounts(calc.get(e.id)), base_salary: Number(e.base_salary ?? 0), bonus: 0, deductions: 0,
  })));
  if (lerr) {
    await sb.from("payroll_runs").delete().eq("id", run.id);
    return { ok: false, error: lerr.code === "23P01" ? await overlapError(sb, d.start, d.end) : fail(lerr.message).error };
  }
  refresh();
  return { ok: true, id: run.id };
}

async function loadRun(sb: Sb, id: string) {
  const { data } = await sb.from("payroll_runs").select("id,period_start,period_end,status,only_paid,include_tips").eq("id", id).maybeSingle();
  return data;
}

/** Vuelve a leer las ventas del período y actualiza ventas, comisión y propinas (sueldo base, bonos y descuentos se conservan). */
export async function recalculatePayroll(id: string): Promise<ActionResult<{ updated: number }>> {
  await requireAction("managePayroll");
  const sb = await createClient();
  const run = await loadRun(sb, id);
  if (!run) return { ok: false, error: "La nómina no existe." };
  if (run.status !== "borrador") return fail("payroll_paid");
  const { calc } = await calculate(sb, run.period_start, run.period_end, { onlyPaid: run.only_paid, includeTips: run.include_tips });
  const { data: lines } = await sb.from("payroll_lines").select("id,employee_id").eq("run_id", id);
  for (const l of lines ?? []) {
    const { error } = await sb.from("payroll_lines").update(amounts(calc.get(l.employee_id))).eq("id", l.id);
    if (error) return fail(error.message);
  }
  refresh(id);
  return { ok: true, updated: lines?.length ?? 0 };
}

const lineSchema = z.object({ base_salary: money, bonus: money, deductions: money, notes: z.string().trim().max(300, "La nota es muy larga").nullish() });
export type LineInput = z.input<typeof lineSchema>;

export async function updatePayrollLine(lineId: string, runId: string, input: LineInput): Promise<ActionResult> {
  await requireAction("managePayroll");
  const p = lineSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const sb = await createClient();
  const { data, error } = await sb.from("payroll_lines").update({
    base_salary: round2(p.data.base_salary), bonus: round2(p.data.bonus), deductions: round2(p.data.deductions), notes: p.data.notes || null,
  }).eq("id", lineId).select("id").maybeSingle();
  if (error) return fail(error.message);
  if (!data) return { ok: false, error: "El volante no existe." };
  refresh(runId);
  return { ok: true };
}

/** Agrega a una especialista que no estaba (por ejemplo, una que se activó después de crear la nómina). */
export async function addPayrollLine(runId: string, employeeId: string): Promise<ActionResult> {
  await requireAction("managePayroll");
  if (!z.uuid().safeParse(employeeId).success) return { ok: false, error: "Elige una especialista." };
  const sb = await createClient();
  const run = await loadRun(sb, runId);
  if (!run) return { ok: false, error: "La nómina no existe." };
  if (run.status !== "borrador") return fail("payroll_paid");
  const { calc, employees } = await calculate(sb, run.period_start, run.period_end, { onlyPaid: run.only_paid, includeTips: run.include_tips });
  const e = employees.find((x) => x.id === employeeId);
  if (!e) return { ok: false, error: "La especialista no existe." };
  const { error } = await sb.from("payroll_lines").insert({
    run_id: runId, employee_id: e.id, employee_name: e.full_name, period_start: run.period_start, period_end: run.period_end,
    ...amounts(calc.get(e.id)), base_salary: Number(e.base_salary ?? 0), bonus: 0, deductions: 0,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: `${e.full_name} ya está en esta nómina.` };
    if (error.code === "23P01") return { ok: false, error: await overlapError(sb, run.period_start, run.period_end, e.full_name) };
    return fail(error.message);
  }
  refresh(runId);
  return { ok: true };
}

export async function removePayrollLine(lineId: string, runId: string): Promise<ActionResult> {
  await requireAction("managePayroll");
  const sb = await createClient();
  const { error } = await sb.from("payroll_lines").delete().eq("id", lineId);
  if (error) return fail(error.message);
  refresh(runId);
  return { ok: true };
}

const paySchema = z.object({
  paidOn: day.refine((d) => d <= todayISO(), "La fecha de pago no puede ser futura."),
  method: z.string().trim().min(1, "Elige cómo se pagó").max(40),
  reference: z.string().trim().max(80).optional(),
});
export type PayInput = z.input<typeof paySchema>;

/** Marca la nómina como pagada: queda congelada (no se puede editar ni recalcular). */
export async function markPayrollPaid(id: string, input: PayInput): Promise<ActionResult> {
  const s = await requireAction("managePayroll");
  const p = paySchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const sb = await createClient();
  const run = await loadRun(sb, id);
  if (!run) return { ok: false, error: "La nómina no existe." };
  if (run.status !== "borrador") return fail("payroll_paid");
  const { data: lines } = await sb.from("payroll_lines").select("employee_name,base_salary,commission,tips,bonus,deductions").eq("run_id", id);
  if (!lines?.length) return { ok: false, error: "La nómina no tiene ninguna especialista." };
  const negative = lines.filter((l) => netOf({ base_salary: Number(l.base_salary), commission: Number(l.commission), tips: Number(l.tips), bonus: Number(l.bonus), deductions: Number(l.deductions) }) < 0);
  if (negative.length) return { ok: false, error: `Los descuentos superan lo que le corresponde a ${negative.map((l) => l.employee_name).join(", ")}. Revisa los montos antes de pagar.` };
  const { data, error } = await sb.from("payroll_runs")
    .update({ status: "pagada", paid_on: p.data.paidOn, paid_method: p.data.method, paid_reference: p.data.reference || null, paid_by: s.userId })
    .eq("id", id).eq("status", "borrador").select("id").maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("payroll_paid");
  refresh(id);
  return { ok: true };
}

/** Reabre una nómina pagada para corregirla (queda en el historial de auditoría). */
export async function reopenPayroll(id: string): Promise<ActionResult> {
  await requireAction("managePayroll");
  const sb = await createClient();
  const { data, error } = await sb.from("payroll_runs")
    .update({ status: "borrador", paid_on: null, paid_method: null, paid_reference: null, paid_by: null })
    .eq("id", id).eq("status", "pagada").select("id").maybeSingle();
  if (error) return fail(error.message);
  if (!data) return { ok: false, error: "La nómina no está pagada." };
  refresh(id);
  return { ok: true };
}

export async function deletePayroll(id: string): Promise<ActionResult> {
  await requireAction("managePayroll");
  const sb = await createClient();
  const run = await loadRun(sb, id);
  if (!run) return { ok: false, error: "La nómina no existe." };
  if (run.status !== "borrador") return fail("payroll_paid");
  const { error } = await sb.from("payroll_runs").delete().eq("id", id).eq("status", "borrador");
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}
