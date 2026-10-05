import { Suspense } from "react";
import { NewAppointment } from "@/components/admin/appointments/NewAppointment";
import { CalendarFilters } from "@/components/admin/calendar/CalendarFilters";
import { CalendarView, type View } from "@/components/admin/calendar/CalendarView";
import { LiveRefresh } from "@/components/admin/LiveRefresh";
import { PageHead } from "@/components/admin/primitives";
import { requireAccess } from "@/lib/auth";
import { listAppointments, listStaffOptions } from "@/lib/data/appointments";
import { listServiceOptions } from "@/lib/data/options";
import { STATUS_META } from "@/lib/domain/status";
import { drToISO, todayISO } from "@/lib/format";
import type { AppointmentStatus } from "@/types/domain";

export const metadata = { title: "Agenda" };
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00-04:00`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function CalendarPage({ searchParams }: PageProps<"/admin/calendar">) {
  await requireAccess("agenda");
  const sp = await searchParams;
  const today = todayISO();
  const view: View = sp.view === "week" || sp.view === "month" ? sp.view : "day";
  const date = isDay(sp.date) ? sp.date : today;
  const employee = typeof sp.employee === "string" ? sp.employee : undefined;
  const service = typeof sp.service === "string" ? sp.service : undefined;
  const status = typeof sp.status === "string" && sp.status in STATUS_META ? (sp.status as AppointmentStatus) : undefined;

  const monday = (d: string) => addDays(d, -((new Date(`${d}T12:00:00-04:00`).getUTCDay() + 6) % 7));
  let from = date, to = addDays(date, 1);
  if (view === "week") { from = monday(date); to = addDays(from, 7); }
  if (view === "month") { from = monday(`${date.slice(0, 7)}-01`); to = addDays(from, 42); }

  const [all, staff, options] = await Promise.all([
    listAppointments({ from: drToISO(from, "00:00"), to: drToISO(to, "00:00"), employeeId: employee, status: status ? [status] : undefined, limit: 600 }),
    listStaffOptions(), listServiceOptions(false),
  ]);
  const appts = service ? all.filter((a) => a.services.some((x) => x.service_id === service)) : all;
  const query = [employee && `&employee=${employee}`, service && `&service=${service}`, status && `&status=${status}`].filter(Boolean).join("");
  const columns = employee ? staff.filter((e) => e.id === employee) : staff.filter((e) => e.active);
  const serviceNames = [...new Map(options.map((o) => [o.serviceId, o.label.split(" – ")[0]])).entries()].map(([id, name]) => ({ id, name }));

  return (
    <>
      <LiveRefresh />
      <PageHead title="Agenda"><NewAppointment /></PageHead>
      <Suspense><CalendarFilters employees={staff} services={serviceNames} /></Suspense>
      <CalendarView view={view} date={date} today={today} appts={appts} employees={columns} query={query} />
    </>
  );
}
