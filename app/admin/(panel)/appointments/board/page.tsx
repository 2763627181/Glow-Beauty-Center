import { KanbanBoard } from "@/components/admin/appointments/KanbanBoard";
import { NewAppointment } from "@/components/admin/appointments/NewAppointment";
import { LiveRefresh } from "@/components/admin/LiveRefresh";
import { PageHead } from "@/components/admin/primitives";
import { requireAccess } from "@/lib/auth";
import { listAppointments } from "@/lib/data/appointments";
import { drToISO, todayISO } from "@/lib/format";

export const metadata = { title: "Tablero" };

export default async function BoardPage() {
  await requireAccess("appointments");
  const today = drToISO(todayISO(), "00:00");
  const from = new Date(new Date(today).getTime() - 7 * 864e5).toISOString();
  const appts = await listAppointments({ from, limit: 400 });
  // Completadas, canceladas y sin asistencia: solo las de hoy en adelante para no saturar el tablero.
  const items = appts.filter((a) => !["completado", "cancelado", "no_asistio"].includes(a.status) || a.start_time >= today);
  return (
    <>
      <LiveRefresh tables={["appointments"]} />
      <PageHead title="Tablero" sub="Arrastra las tarjetas para cambiar el estado. Se actualiza en tiempo real.">
        <NewAppointment />
      </PageHead>
      <KanbanBoard initial={items} />
    </>
  );
}
