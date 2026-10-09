import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClosedActions } from "@/components/admin/cash/ClosedActions";
import c from "@/components/admin/cash/cash.module.css";
import { MethodsTable, ProductionTable, Timeline } from "@/components/admin/cash/ReportSections";
import { PageHead } from "@/components/admin/primitives";
import u from "@/components/admin/ui.module.css";
import { requireAccess } from "@/lib/auth";
import { getCashReport, getOpenSessionId, listCashSessions } from "@/lib/data/cash";
import { getSettings } from "@/lib/data/catalog";
import { fmtDateTime, money } from "@/lib/format";
import { allowed } from "@/lib/permissions";

export const metadata = { title: "Cierre de caja" };

export default async function CashSessionPage({ params }: PageProps<"/admin/cash/[id]">) {
  const session = await requireAccess("cash");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const report = await getCashReport(id);
  if (!report) notFound();
  const closedAt = report.session.closed_at;
  if (!closedAt) redirect("/admin/cash");
  const [recent, openId, settings] = await Promise.all([listCashSessions(1), getOpenSessionId(), getSettings()]);
  const s = report.session, t = report.totals, diff = s.difference ?? 0;
  const canReopen = allowed(session.role, "voidCash") && recent[0]?.id === s.id && !openId;
  const row = (label: string, value: string, strong?: boolean) => (
    <div key={label}>{strong ? <strong>{label}</strong> : <span>{label}</span>}{strong ? <strong>{value}</strong> : <span>{value}</span>}</div>
  );
  return (
    <>
      <PageHead title={`Cierre ${s.number}`} sub={`${fmtDateTime(s.opened_at)} → ${fmtDateTime(closedAt)}`}>
        <Link href="/admin/cash" style={{ textDecoration: "underline" }}>← Caja</Link>
        <ClosedActions sessionId={s.id} canReopen={canReopen} />
      </PageHead>
      <div className={`${c.stack} ${c.printArea}`}>
        <p className={c.printOnly}><strong>{settings.business.name}</strong> · Cierre de caja {s.number}</p>
        <section className={u.card} aria-label="Resumen del cierre">
          <div className={c.summaryGrid}>
            {row("Fondo inicial", money(t.opening))}
            {row("+ Efectivo cobrado", money(t.cash_in))}
            {t.entradas > 0 && row("+ Entradas de efectivo", money(t.entradas))}
            {t.cash_refunds > 0 && row("− Efectivo reembolsado", money(t.cash_refunds))}
            {t.salidas > 0 && row("− Salidas de efectivo", money(t.salidas))}
            {row("Debía haber", money(s.expected_cash ?? t.expected), true)}
            {row("Se contó", money(s.counted_cash ?? 0), true)}
          </div>
          <p className={`${c.diff} ${diff === 0 ? c.diffOk : diff < 0 ? c.diffLess : c.diffMore}`} style={{ marginTop: 12 }} role="status">
            {diff === 0 ? "Cuadró exacto: no hubo diferencia." : diff < 0 ? `Faltaron ${money(Math.abs(diff))}.` : `Sobraron ${money(diff)}.`}
          </p>
          <p className={u.sub} style={{ marginTop: 8 }}>
            {s.opened_by && <>Abrió: {s.opened_by}. </>}{s.closed_by && <>Cerró: {s.closed_by}. </>}
            {s.opening_note && <>Nota de apertura: {s.opening_note}. </>}{s.closing_note && <>Nota de cierre: {s.closing_note}</>}
          </p>
        </section>
        <section className={u.card}><h2>Movimientos del turno</h2><Timeline report={report} /></section>
        <section className={u.card}><h2>Producción por especialista</h2><ProductionTable rows={report.production} /></section>
        <section className={u.card}><h2>Cobrado por método</h2><MethodsTable methods={report.methods} /></section>
      </div>
    </>
  );
}
