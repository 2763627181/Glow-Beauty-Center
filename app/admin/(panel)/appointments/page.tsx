import Link from "next/link";
import { Suspense } from "react";
import { AppointmentList } from "@/components/admin/appointments/AppointmentList";
import { NewAppointment } from "@/components/admin/appointments/NewAppointment";
import { ExportMenu } from "@/components/admin/ExportMenu";
import { LiveRefresh } from "@/components/admin/LiveRefresh";
import { PageHead } from "@/components/admin/primitives";
import { StatusFilter } from "@/components/admin/StatusFilter";
import u from "@/components/admin/ui.module.css";
import { UrlSearch } from "@/components/admin/UrlSearch";
import { requireAccess } from "@/lib/auth";
import { listAppointments } from "@/lib/data/appointments";
import { STATUS_META } from "@/lib/domain/status";
import { drToISO, todayISO } from "@/lib/format";
import { can } from "@/lib/permissions";
import type { AppointmentStatus } from "@/types/domain";

export const metadata = { title: "Solicitudes y citas" };

export default async function AppointmentsPage({ searchParams }: PageProps<"/admin/appointments">) {
  const s = await requireAccess("appointments");
  const sp = await searchParams;
  const status = typeof sp.status === "string" && sp.status in STATUS_META ? (sp.status as AppointmentStatus) : undefined;
  const range = typeof sp.range === "string" ? sp.range : "upcoming";
  const search = typeof sp.q === "string" ? sp.q : "";
  const today = drToISO(todayISO(), "00:00");

  const items = await listAppointments({
    from: range === "upcoming" ? today : undefined, to: range === "past" ? today : undefined,
    status: status ? [status] : undefined, search, limit: 300,
  });
  const rows = range === "past" ? [...items].reverse() : items;
  const qs = (r: string) => `/admin/appointments?${new URLSearchParams({ range: r, ...(status ? { status } : {}), ...(search ? { q: search } : {}) })}`;
  const tab = (key: string, label: string) => (
    <Link key={key} href={qs(key)} className={`${u.badge} ${range === key ? u.pink : u.gray}`} style={{ minHeight: 36, padding: "0 14px", display: "inline-flex", alignItems: "center" }}>{label}</Link>
  );
  return (
    <>
      <LiveRefresh />
      <PageHead title="Solicitudes y citas" sub={`${rows.length} resultado${rows.length === 1 ? "" : "s"}`}>
        {can(s.role, "reports") && <ExportMenu groups={[{ href: `/admin/appointments/export?${new URLSearchParams({ range, ...(status ? { status } : {}), ...(search ? { q: search } : {}) })}` }]} />}
        <NewAppointment />
      </PageHead>
      <div className={u.filters}>
        {tab("upcoming", "Próximas")}{tab("past", "Pasadas")}{tab("all", "Todas")}
        <Suspense><UrlSearch placeholder="Buscar por nombre, teléfono o SOL-…" /></Suspense>
        <div style={{ marginLeft: "auto" }}><Suspense><StatusFilter /></Suspense></div>
      </div>
      <div className={u.card}><AppointmentList items={rows} /></div>
    </>
  );
}
