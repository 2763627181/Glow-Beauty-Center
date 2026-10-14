import "server-only";
import { buildManicurists, periodRange, salaryFactor, type ManiSummary, type Period } from "@/lib/domain/manicurists";
import { drToISO } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { loadSales } from "./reports";

/** Las manicuristas con lo que hicieron en la quincena (o el mes) y su sueldo fijo del período. `onlyPaid`: solo ventas cobradas por completo. */
export async function getManicurists(period: Period, onlyPaid: boolean): Promise<ManiSummary[]> {
  const { from, to } = periodRange(period);
  const sb = await createClient();
  const [sales, { data: emps }] = await Promise.all([
    loadSales(drToISO(from, "00:00"), drToISO(to, "00:00")),
    sb.from("employees").select("id,full_name,active,specialty,base_salary,commission_pct"),
  ]);
  return buildManicurists(sales, (emps ?? []).map((e) => ({
    id: e.id, full_name: e.full_name, active: e.active, specialty: e.specialty, base_salary: Number(e.base_salary ?? 0), commission_pct: e.commission_pct == null ? null : Number(e.commission_pct),
  })), { onlyPaid, salaryFactor: salaryFactor(period.kind) });
}
