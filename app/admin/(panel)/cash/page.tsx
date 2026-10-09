import { CashDesk } from "@/components/admin/cash/CashDesk";
import { LiveRefresh } from "@/components/admin/LiveRefresh";
import { EmptyState, PageHead } from "@/components/admin/primitives";
import u from "@/components/admin/ui.module.css";
import { requireAccess } from "@/lib/auth";
import { cashInstalled, getCashReport, getChargeQueue, getLooseCash, getOpenSessionId, listCashSessions } from "@/lib/data/cash";

export const metadata = { title: "Caja" };

export default async function CashPage() {
  await requireAccess("cash");
  if (!(await cashInstalled())) {
    return (
      <>
        <PageHead title="Caja" />
        <section className={u.card}>
          <EmptyState title="Falta instalar la actualización de la Caja" text="La base de datos todavía no tiene las tablas de la caja. Se instala una sola vez (archivo 20261008000016_caja.sql en supabase/migrations) y no borra nada." />
        </section>
      </>
    );
  }
  const openId = await getOpenSessionId();
  const [report, queue, sessions, loose] = await Promise.all([openId ? getCashReport(openId) : Promise.resolve(null), getChargeQueue(), listCashSessions(40), getLooseCash()]);
  return (
    <>
      <LiveRefresh tables={["payments", "sales", "cash_movements", "cash_sessions"]} />
      <PageHead title="Caja" sub="Cobros, efectivo, vuelto, entradas y salidas de dinero, y la producción de cada especialista." />
      <CashDesk report={report} queue={queue} sessions={sessions} loose={loose} />
    </>
  );
}
