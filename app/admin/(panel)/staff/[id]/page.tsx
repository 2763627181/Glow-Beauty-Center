import { notFound } from "next/navigation";
import { Alert, PageHead } from "@/components/admin/primitives";
import { AccountSection } from "@/components/admin/staff/AccountSection";
import { EmployeeForm } from "@/components/admin/staff/EmployeeForm";
import { StaffDelete } from "@/components/admin/staff/StaffTools";
import { ScheduleEditor, TimeOffEditor, type Day } from "@/components/admin/staff/ScheduleEditor";
import u from "@/components/admin/ui.module.css";
import { requireAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Especialista" };
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function StaffDetail({ params }: PageProps<"/admin/staff/[id]">) {
  const session = await requireAccess("staff");
  const { id } = await params;
  const sb = await createClient();
  const { data: svcs } = await sb.from("services").select("id,name,category:service_categories(name)").eq("pending_review", false).order("display_order");
  const services = (svcs ?? []).map((s: any) => ({ id: s.id, name: s.name, category: s.category?.name ?? "Otros" }));

  if (id === "new") {
    return (
      <>
        <PageHead title="Nuevo especialista" />
        <EmployeeForm id={null} services={services} initial={{ full_name: "", avatar_url: null, phone: "", email: "", specialty: "", bio: "", commission_pct: null, base_salary: 0, active: true, accepts_online_booking: true, birth_month: null, birth_day: null, service_ids: [] }} />
      </>
    );
  }
  const [{ data: e }, { data: links }, { data: scheds }, { data: off }, { data: accounts }] = await Promise.all([
    sb.from("employees").select("*").eq("id", id).maybeSingle(),
    sb.from("employee_services").select("service_id").eq("employee_id", id),
    sb.from("employee_schedules").select("*").eq("employee_id", id),
    sb.from("employee_time_off").select("id,starts_at,ends_at,reason").eq("employee_id", id).order("starts_at", { ascending: false }),
    sb.from("profiles").select("id,full_name,role,active,employee_id").eq("employee_id", id),
  ]);
  if (!e) notFound();
  const days: Day[] = Array.from({ length: 7 }, (_, wd) => {
    const s = (scheds ?? []).find((x: any) => x.weekday === wd);
    return { weekday: wd, working: !!s, start: s?.start_time.slice(0, 5) ?? "09:00", end: s?.end_time.slice(0, 5) ?? "18:00", breakStart: s?.break_start?.slice(0, 5) ?? "", breakEnd: s?.break_end?.slice(0, 5) ?? "" };
  });
  return (
    <>
      <PageHead title={e.full_name} sub={e.specialty ?? undefined}><StaffDelete id={e.id} name={e.full_name} /></PageHead>
      <div className={u.grid}>
        {e.active && e.accepts_online_booking && (scheds ?? []).length === 0 && <Alert kind="warn"><strong>Sin horario de trabajo.</strong> Mientras no lo guardes abajo (sección «Horario semanal»), {e.full_name} no aparece en la reserva en línea.</Alert>}
        {e.active && e.accepts_online_booking && (links ?? []).length === 0 && <Alert kind="warn"><strong>Sin servicios asignados.</strong> Marca en «Servicios que realiza» lo que hace {e.full_name}; si no, la web no le ofrece ninguno.</Alert>}
        <EmployeeForm id={e.id} services={services} initial={{
          full_name: e.full_name, avatar_url: e.avatar_url, phone: e.phone, email: e.email, specialty: e.specialty, bio: e.bio,
          commission_pct: e.commission_pct == null ? null : Number(e.commission_pct), base_salary: Number(e.base_salary ?? 0), active: e.active, accepts_online_booking: e.accepts_online_booking,
          birth_month: e.birth_month, birth_day: e.birth_day,
          service_ids: (links ?? []).map((l) => l.service_id),
        }} />
        <ScheduleEditor employeeId={e.id} initial={days} />
        <TimeOffEditor employeeId={e.id} items={off ?? []} />
        {session.role === "super_admin" && <AccountSection employeeId={e.id} employeeName={e.full_name} accounts={accounts ?? []} />}
      </div>
    </>
  );
}
