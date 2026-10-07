import Link from "next/link";
import { notFound } from "next/navigation";
import { PayrollView } from "@/components/admin/payroll/PayrollView";
import { PageHead } from "@/components/admin/primitives";
import { requireAccess } from "@/lib/auth";
import { getPayroll } from "@/lib/data/payroll";
import { periodLabel } from "@/lib/domain/payroll";
import { todayISO } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Nómina" };

export default async function PayrollDetail({ params }: PageProps<"/admin/payroll/[id]">) {
  await requireAccess("payroll");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getPayroll(id);
  if (!data) notFound();
  const sb = await createClient();
  const { data: emps } = await sb.from("employees").select("id,full_name,active").order("full_name");
  const inRun = new Set(data.lines.map((l) => l.employee_id));
  const candidates = (emps ?? []).filter((e) => e.active && !inRun.has(e.id)).map((e) => ({ id: e.id, name: e.full_name }));
  const { run } = data;
  return (
    <>
      <PageHead title={run.title} sub={`${run.run_number} · ${periodLabel(run.period_start, run.period_end)}`}>
        <Link href="/admin/payroll" style={{ textDecoration: "underline" }}>← Todas las nóminas</Link>
      </PageHead>
      <PayrollView run={run} lines={data.lines} candidates={candidates} today={todayISO()} />
    </>
  );
}
