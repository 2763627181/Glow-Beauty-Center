import "server-only";
import type { DetailRow } from "@/lib/domain/payroll";
import { createClient } from "@/lib/supabase/server";

export type PayrollRun = {
  id: string; run_number: string; title: string; period_start: string; period_end: string; status: "borrador" | "pagada";
  only_paid: boolean; include_tips: boolean; notes: string | null; paid_on: string | null; paid_method: string | null; paid_reference: string | null;
  created_at: string;
};
export type PayrollLine = {
  id: string; run_id: string; employee_id: string; employee_name: string; services_count: number; sales_total: number; commission: number;
  tips: number; base_salary: number; bonus: number; deductions: number; net: number; notes: string | null; detail: DetailRow[];
};
export type PayrollListItem = PayrollRun & { people: number; net_total: number };

const RUN_COLS = "id,run_number,title,period_start,period_end,status,only_paid,include_tips,notes,paid_on,paid_method,paid_reference,created_at";
const LINE_COLS = "id,run_id,employee_id,employee_name,services_count,sales_total,commission,tips,base_salary,bonus,deductions,net,notes,detail";

/* eslint-disable @typescript-eslint/no-explicit-any */
const toLine = (l: any): PayrollLine => ({
  ...l, sales_total: Number(l.sales_total), commission: Number(l.commission), tips: Number(l.tips), base_salary: Number(l.base_salary),
  bonus: Number(l.bonus), deductions: Number(l.deductions), net: Number(l.net), detail: Array.isArray(l.detail) ? l.detail : [],
});

export async function listPayrolls(): Promise<PayrollListItem[]> {
  const sb = await createClient();
  const { data: runs } = await sb.from("payroll_runs").select(RUN_COLS).order("period_end", { ascending: false }).order("created_at", { ascending: false }).limit(200);
  if (!runs?.length) return [];
  const { data: lines } = await sb.from("payroll_lines").select("run_id,net").in("run_id", runs.map((r) => r.id));
  const agg = new Map<string, { people: number; net: number }>();
  for (const l of lines ?? []) {
    const a = agg.get(l.run_id) ?? { people: 0, net: 0 };
    a.people += 1; a.net += Number(l.net);
    agg.set(l.run_id, a);
  }
  return runs.map((r) => ({ ...(r as PayrollRun), people: agg.get(r.id)?.people ?? 0, net_total: Math.round((agg.get(r.id)?.net ?? 0) * 100) / 100 }));
}

export async function getPayroll(id: string): Promise<{ run: PayrollRun; lines: PayrollLine[] } | null> {
  const sb = await createClient();
  const { data: run } = await sb.from("payroll_runs").select(RUN_COLS).eq("id", id).maybeSingle();
  if (!run) return null;
  const { data: lines } = await sb.from("payroll_lines").select(LINE_COLS).eq("run_id", id).order("employee_name");
  return { run: run as PayrollRun, lines: (lines ?? []).map(toLine) };
}
